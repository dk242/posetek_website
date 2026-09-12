// Prepare the four additional homepage demos from locally downloaded, authorized
// admin artifacts. Raw recordings and their URLs stay in the ignored input folder.
// Only 2D coordinates, timing, and selected result values reach the public bundle.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = resolve(root, process.argv[2] || '.netlify/pose-source');
const output = resolve(root, 'app/src/pages/home/landing-pose-demo-data.json');
const checksums = JSON.parse(await readFile(resolve(root, 'deployment/pose-source-checksums.json'), 'utf8'));
const read = async (key, suffix) => {
  const name = `${key}-${suffix}.json`;
  const bytes = await readFile(resolve(input, name));
  if (createHash('sha256').update(bytes).digest('hex') !== checksums[name]) throw new Error(`Source changed: review crop, timing and results for ${name}`);
  return JSON.parse(bytes.toString('utf8'));
};
const round = value => Math.round(value * 10000) / 10000;
const sourceAspect = 16 / 9;
const config = {
  sprint: { title: 'Sprint', label: 'Speed · recorded rep', start: 120, end: 416, step: 4, preview: 312, follow: true,
    metrics: [['Top speed', '12.5 mph'], ['Average', '8.7 mph'], ['Acceleration', '5.76 m/s²'], ['Run time', '2.48 s']] },
  jump: { title: 'Vertical Jump', label: 'Power · recorded rep', start: 0, end: 280, step: 4, preview: 160,
    metrics: [['Jump height', '18.4 in']] },
  dribbling: { title: 'Dribbling', label: 'Ball control · recorded rep', start: 71, end: 968, step: 4, preview: 502, follow: true,
    metrics: [['Outbound', '2.91 s'], ['Turn', '2.12 s'], ['Return', '2.45 s'], ['Total', '7.48 s']] },
  shooting: { title: 'Shooting', label: 'Technique · recorded rep', start: 300, end: 660, step: 4, preview: 472,
    metrics: [['Ball speed', '50.6 mph'], ['Shooting foot', 'Left']] },
};

async function prepare(key, options) {
  const [raw, metadata, context] = await Promise.all([read(key, 'pose'), read(key, 'metadata'), read(key, 'context')]);
  const source = Array.isArray(raw) ? raw : raw.frames;
  const sourceFps = context.capture?.clipFramesPerSecondUsed || metadata.framesPerSecond || metadata.fps;
  if (!Array.isArray(source) || !Number.isFinite(sourceFps) || sourceFps <= 0 || options.end >= source.length) throw new Error(`Invalid ${key} source`);
  const indices = [];
  for (let f = options.start; f <= options.end; f += options.step) indices.push(f);
  const missing = indices.filter(f => !Array.isArray(source[f]) || source[f].length !== 33);
  if (missing.length) throw new Error(`${key}: selected frames lack a 33-point pose: ${missing.join(', ')}`);
  // Follow the athlete horizontally for the two long running drills. This is a
  // camera translation only; joint proportions and vertical movement are kept.
  const offsets = indices.map(f => options.follow ? (source[f][23][0] + source[f][24][0]) / 2 : 0);
  const translated = indices.map((f, i) => source[f].map(p =>
    Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
      ? [p[0] - offsets[i], p[1]] : null));
  const points = translated.flat().filter(Boolean);
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const cx = (left + right) / 2, cy = (top + bottom) / 2;
  // A fixed 16:9 crop with breathing room, preserving source geometry.
  const cropHeight = Math.max(bottom - top, right - left) * 1.3;
  const cropWidth = cropHeight;
  const x0 = cx - cropWidth / 2, y0 = cy - cropHeight / 2;
  const transform = p => p ? [round((p[0] - x0) / cropWidth), round((p[1] - y0) / cropHeight)] : null;
  const toFrame = f => Math.max(0, Math.min(indices.length - 1, Math.round((f - options.start) / options.step)));
  const sequence = {
    key, title: options.title, label: options.label,
    fps: sourceFps / options.step, sourceAspectRatio: sourceAspect,
    previewFrame: toFrame(options.preview), frames: translated.map(frame => frame.map(transform)),
    markers: {}, metrics: options.metrics,
  };
  if (key === 'dribbling') {
    sequence.phases = [
      { from: 0, title: 'Outbound', color: '#66c2ff' },
      { from: toFrame(metadata.phase1EndFrame), title: 'Turn', color: '#ffc969' },
      { from: toFrame(metadata.phase2EndFrame), title: 'Return', color: '#71d39b' },
    ];
  }
  if (key === 'shooting') {
    sequence.phases = [
      { from: 0, title: 'Approach', color: '#66c2ff' },
      { from: toFrame(458), title: 'Downswing', color: '#ffc969' },
      { from: toFrame(472), title: 'Contact', color: '#b7f34a' },
      { from: toFrame(480), title: 'Follow-through', color: '#71d39b' },
    ];
    const boxes = await read(key, 'ball');
    sequence.ball = indices.map((f, i) => {
      const box = boxes[f];
      // The source fit ends at exitFrame; don't extend it beyond its evidence.
      if (f > metadata.exitFrame || !Array.isArray(box) || box.length < 4 || !box.every(Number.isFinite)) return null;
      const [x, y] = transform([(box[0] + box[2]) / 2 - offsets[i], (box[1] + box[3]) / 2]);
      return { x, y, radius: round((box[3] - box[1]) / 2 / cropHeight) };
    });
  }
  return sequence;
}

const data = JSON.parse(await readFile(output, 'utf8'));
const added = await Promise.all(Object.entries(config).map(([key, options]) => prepare(key, options)));
const all = [...data.sequences.filter(s => !config[s.key]), ...added];
const order = ['sprint', 'jump', 'broadJump', 'dribbling', 'changeOfDirection', 'shooting'];
data.version = 2;
data.autoAdvance = false;
data.sequences = order.map(key => all.find(s => s.key === key));
if (data.sequences.some(s => !s)) throw new Error('All six recordings are required');
await writeFile(output, JSON.stringify(data) + '\n');
await writeFile(resolve(root, 'app/src/pages/home/pose-recordings.json'), JSON.stringify(order) + '\n');
console.log(JSON.stringify(data.sequences.map(s => ({ key: s.key, frames: s.frames.length, fps: s.fps || data.fps })), null, 2));
