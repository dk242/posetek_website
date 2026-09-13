import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const input = resolve(root, process.argv[2] || '.netlify/pose-source');
const checksums = JSON.parse(await readFile(resolve(root, 'deployment/pose-source-checksums.json'), 'utf8'));
async function read(name) {
  const bytes = await readFile(resolve(input, name));
  if (createHash('sha256').update(bytes).digest('hex') !== checksums[name]) throw new Error(`Source changed: ${name}`);
  return JSON.parse(bytes.toString('utf8'));
}
const source = await read('shooting-pose.json');
const boxes = await read('shooting-ball.json');
const frameIndex = 464; // Downswing, eight captured frames before contact.
const frame = source[frameIndex];
if (frame.length !== 33 || frame.some(p=>p.length < 3 || !p.slice(0,3).every(Number.isFinite))) throw new Error('Invalid captured pose');
const aspect = 16/9;
const hip = [0,1,2].map(i=>(frame[23][i]+frame[24][i])/2);
const ground = Math.max(...[27,28,29,30,31,32].map(i=>frame[i][1]));
const scale = 2/(ground-Math.min(...frame.map(p=>p[1])));
const round = v=>Math.round(v*1e5)/1e5;
// MediaPipe image coordinates use downward Y and camera-facing negative Z.
// Fit the captured geometry uniformly after converting X/Z from width units.
const convert = p=>[round((p[0]-hip[0])*aspect*scale),round((ground-p[1])*scale+.045),round(-(p[2]-hip[2])*aspect*scale)];
const box = boxes[frameIndex];
const ballRadius = round((box[3]-box[1])/2*scale);
// The ball has 2D tracking only: place it on the floor at the support-foot depth.
const ballPosition = convert([(box[0]+box[2])/2,ground,frame[28][2]]);
ballPosition[1] = ballRadius;
const asset = {frameIndex,sourceSha256:checksums['shooting-pose.json'],points:frame.map(convert),ballPosition,ballRadius};
await writeFile(resolve(root,'app/src/pages/home/pitch/shooting-pose.json'), JSON.stringify(asset)+'\n');
console.log(`Prepared shooting frame ${frameIndex} with ${frame.length} captured landmarks`);
