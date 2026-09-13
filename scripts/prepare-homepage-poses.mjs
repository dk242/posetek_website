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
  sprint: { title: 'Sprint', label: 'Speed · recorded rep', start: 120, end: 416, step: 4, preview: 312,
    metrics: [['Top speed', '12.5 mph'], ['Average', '8.7 mph'], ['Acceleration', '5.76 m/s²'], ['Run time', '2.48 s']] },
  jump: { title: 'Vertical Jump', label: 'Power · recorded rep', start: 0, end: 280, step: 4, preview: 160,
    metrics: [['Jump height', '18.4 in']] },
  dribbling: { title: 'Dribbling', label: 'Ball control · recorded rep', start: 71, end: 968, step: 4, preview: 502,
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
  // Preserve the original camera frame: no crop, recentering, or tracking zoom.
  const transform = p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
    ? [round(p[0]), round(p[1])] : null;
  const toFrame = f => Math.max(0, Math.min(indices.length - 1, Math.round((f - options.start) / options.step)));
  const sequence = {
    key, title: options.title, label: options.label,
    fps: sourceFps / options.step, sourceAspectRatio: sourceAspect,
    previewFrame: toFrame(options.preview), frames: indices.map(f => source[f].map(transform)),
    markers: {}, metrics: options.metrics,
  };
  if (key === 'jump') {
    const [com, heights, events] = await Promise.all([read(key, 'com'), read(key, 'height'), read(key, 'events')]);
    if (com.length !== source.length || heights.length !== source.length || events.length !== 4) throw new Error('Jump overlays must match source frames');
    const peakMeters = Math.max(...heights.map(p => -p[1]));
    sequence.verticalJump = {
      com: indices.map(f => transform(com[f])),
      heightMeters: indices.map(f => round(Math.max(0, -heights[f][1]))),
      baselineY: metadata.chest_starting_loc, groundY: metadata.ground_loc_y,
      peakMeters: round(peakMeters), takeoff: toFrame(events[2]), apex: toFrame(events[3]),
    };
    // The calibrated height artifact is authoritative; an older context result can be stale.
    sequence.metrics = [['Jump height', `${(peakMeters / .0254).toFixed(1)} in`]];
    sequence.previewFrame = toFrame(events[3]);
    sequence.phases = [
      { from: 0, title: 'Load', color: '#66c2ff' },
      { from: toFrame(events[2]), title: 'Flight', color: '#b7f34a' },
      { from: toFrame(events[3]) + 1, title: 'Descent', color: '#ffc969' },
    ];
  }
  if (key === 'dribbling') {
    const ball = await read(key, 'ball');
    if (ball.length !== source.length) throw new Error('Ball track must match source frames');
    sequence.ball = indices.map(f => ball[f]);
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
    sequence.ball = indices.map(f => {
      const box = boxes[f];
      // The source fit ends at exitFrame; don't extend it beyond its evidence.
      if (f > metadata.exitFrame || !Array.isArray(box) || box.length < 4 || !box.every(Number.isFinite)) return null;
      const [x, y] = transform([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]);
      return { x, y, radius: round((box[3] - box[1]) / 2) };
    });
  }
  return sequence;
}

const data = JSON.parse(await readFile(output, 'utf8'));
const added = await Promise.all(Object.entries(config).map(([key, options]) => prepare(key, options)));
const all = [...data.sequences.filter(s => !config[s.key]), ...added];
const order = ['sprint', 'jump', 'broadJump', 'dribbling', 'changeOfDirection', 'shooting'];
data.version = 3;
data.autoAdvance = false;
data.sequences = order.map(key => all.find(s => s.key === key));
if (data.sequences.some(s => !s)) throw new Error('All six recordings are required');
await writeFile(output, JSON.stringify(data) + '\n');
await writeFile(resolve(root, 'app/src/pages/home/pose-recordings.json'), JSON.stringify(order) + '\n');
console.log(JSON.stringify(data.sequences.map(s => ({ key: s.key, frames: s.frames.length, fps: s.fps || data.fps })), null, 2));

// A separate, tiny artifact keeps the full playback bundle lazy-loaded.
const thumbnails = Object.fromEntries(data.sequences.map(sequence => {
  const frameIndex = sequence.previewFrame ?? (sequence.key === 'broadJump'
    ? Math.round((sequence.markers.takeoff + sequence.markers.landing) / 2)
    : sequence.markers.turn);
  if (!Number.isInteger(frameIndex) || !sequence.frames[frameIndex]) throw new Error(`Missing thumbnail: ${sequence.key}`);
  return [sequence.key, { frameIndex, aspect: sequence.sourceAspectRatio || data.sourceAspectRatio,
    points: sequence.frames[frameIndex], ball: sequence.ball?.[frameIndex] || null }];
}));
await writeFile(resolve(root, 'app/src/pages/home/pose-thumbnails.json'), JSON.stringify(thumbnails) + '\n');
