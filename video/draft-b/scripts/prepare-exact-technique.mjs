import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// The caller supplies the current website sample; never silently use an older worktree.
// The second source is a previously verified, local-only pose export. No network access.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const websitePath = process.argv[2];
const pairPath = process.argv[3] ?? path.join(root, 'public/product/poses.json');
if (!websitePath) throw new Error('Usage: node scripts/prepare-exact-technique.mjs <current technique-data.json> [verified poses.json]');
const websiteBytes = await fs.readFile(websitePath);
const pairBytes = await fs.readFile(pairPath);
const website = JSON.parse(websiteBytes);
const source = JSON.parse(pairBytes);
const allowedFrames = [458, 472, 522];
if (website.fps !== 240 || website.step !== 2 || website.startFrame !== 420 ||
    website.phases.some((phase, index) => phase.sourceFrame !== allowedFrames[index])) {
  throw new Error('Recorded website sample changed: review the fixed walkthrough timing before preparing.');
}
const fields = ['fps', 'startFrame', 'step', 'frames', 'ball', 'phases', 'focusAreas'];
const technique = Object.fromEntries(fields.map(field => [field, website[field]]));
const records = ['left', 'right'].map(foot => {
  const candidates = source.records.filter(record => record.kind === 'shooting' && record.strikeFoot === foot);
  if (candidates.length !== 1) throw new Error(`Expected exactly one verified ${foot}-foot kick`);
  const record = candidates[0];
  const keyFrames = source.comparison[`${foot}KeyFrames`];
  const startFrame = Math.max(0, keyFrames.backswing - 100);
  const endFrame = keyFrames.followThrough + 1;
  if (!(record.fps > 0) || endFrame > record.frames.length) throw new Error('Invalid recorded kick bounds');
  // Anonymous display labels only. Preserve original coordinate values and null masks.
  return {foot, fps: record.fps, width: record.width, height: record.height, startFrame,
    keyFrames, frames: record.frames.slice(startFrame, endFrame)};
});
const row = source.comparison.differences.find(item => item.id === 'backswing.knee_angle.support');
if (!row?.comparable || !Number.isFinite(row.left) || !Number.isFinite(row.right) ||
    row.leftFrame !== records[0].keyFrames.backswing || row.rightFrame !== records[1].keyFrames.backswing) {
  throw new Error('Comparable knee observation does not match the recorded phase frames');
}
const smaller = row.left < row.right ? 'left' : 'right';
const comparison = {records, observation: {
  title: 'Standing knee bend',
  cue: `Your standing knee is more bent in the backswing in the ${smaller}-foot kick.`,
  lookFor: 'Watch the bend in the highlighted standing leg.',
  left: row.left, right: row.right,
}};
const output = {technique, comparison, provenance: {
  websiteSha256: createHash('sha256').update(websiteBytes).digest('hex'),
  pairSha256: createHash('sha256').update(pairBytes).digest('hex'),
  note: 'Recorded coordinates; native controls reconstructed for the film. Professional poses are static saved phases only.',
}};
const target = path.join(root, 'public/investor-exact/technique.json');
await fs.mkdir(path.dirname(target), {recursive: true});
await fs.writeFile(target, JSON.stringify(output));
console.log(`Prepared anonymous recorded sample: ${technique.frames.length} technique frames, ${records.length} kick excerpts.`);
