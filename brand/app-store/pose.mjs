import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const POSE_EDGES = Object.freeze([
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
  [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
  [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
  [11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],
  [24,26],[26,28],[28,30],[30,32],[28,32],
].map(edge => Object.freeze(edge)));
export const recordedPoses = JSON.parse(fs.readFileSync(fileURLToPath(new URL('./pose/recorded-poses.json', import.meta.url)), 'utf8'));

export function validatePose(pose, schema = 'mediapipe33') {
  if (schema !== 'mediapipe33') throw new Error('A genuine MediaPipe33 source is required; padded COCO17 is not supported.');
  if (!Array.isArray(pose?.points) || pose.points.length !== 33) throw new Error('Expected exactly 33 pose points.');
  for (const [index, point] of pose.points.entries()) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) throw new Error(`Invalid landmark ${index}.`);
    if (point[0] === 0 && point[1] === 0) throw new Error(`Missing landmark ${index}; zero sentinel cannot be drawn.`);
  }
  if (new Set(pose.points.map(point => point.join(','))).size !== 33) throw new Error('Repeated landmarks are not accepted as recorded MediaPipe33 data.');
  return pose;
}

export function fitPose(pose, {x, y, width, height, padding = 12}) {
  validatePose(pose);
  if (![x,y,width,height,padding].every(Number.isFinite) || padding < 0 || width <= 2*padding || height <= 2*padding) throw new Error('Invalid pose viewport.');
  const xs=pose.points.map(p=>p[0]), ys=pose.points.map(p=>p[1]);
  let minX=Math.min(...xs), maxX=Math.max(...xs), minY=Math.min(...ys), maxY=Math.max(...ys);
  if (pose.ball) {
    const {center, radius}=pose.ball;
    if (!Array.isArray(center) || center.length!==2 || !center.every(Number.isFinite) || !Number.isFinite(radius) || radius<=0) throw new Error('Invalid recorded ball.');
    minX=Math.min(minX,center[0]-radius); maxX=Math.max(maxX,center[0]+radius);
    minY=Math.min(minY,center[1]-radius); maxY=Math.max(maxY,center[1]+radius);
  }
  if (maxX<=minX || maxY<=minY) throw new Error('Degenerate pose bounds.');
  const scale=Math.min((width-2*padding)/(maxX-minX),(height-2*padding)/(maxY-minY));
  const tx=x+(width-(maxX-minX)*scale)/2-minX*scale;
  const ty=y+(height-(maxY-minY)*scale)/2-minY*scale;
  const project=([px,py])=>[px*scale+tx,py*scale+ty];
  return {points:pose.points.map(project), scale, ball:pose.ball?{center:project(pose.ball.center),radius:pose.ball.radius*scale}:null};
}

export function poseSVG(id, viewport, {lineColor='#f0f5ed',pointColor='#7cff18',strokeWidth=1.35,dotRadius=1.65} = {}) {
  const source=recordedPoses.poses[id];
  if (!source) throw new Error(`Unknown recorded pose ${id}.`);
  validatePose(source,recordedPoses.schema);
  const pose=fitPose(source,viewport);
  const number=value=>Number(value.toFixed(4));
  const edges=POSE_EDGES.map(([a,b])=>`<line data-edge="${a}-${b}" x1="${number(pose.points[a][0])}" y1="${number(pose.points[a][1])}" x2="${number(pose.points[b][0])}" y2="${number(pose.points[b][1])}" stroke="${lineColor}" stroke-width="${a<11&&b<11?strokeWidth*.55:strokeWidth}" stroke-linecap="round"/>`).join('');
  // Every source landmark remains in its original position. Dense face points are
  // intentionally smaller rather than displaced, omitted, or substituted.
  const dots=pose.points.map(([x,y],index)=>`<circle data-landmark="${index}" cx="${number(x)}" cy="${number(y)}" r="${index<11?dotRadius*.4:dotRadius}" fill="${pointColor}"/>`).join('');
  const ball=pose.ball?`<circle cx="${number(pose.ball.center[0])}" cy="${number(pose.ball.center[1])}" r="${number(pose.ball.radius)}" fill="none" stroke="${lineColor}" stroke-width="${strokeWidth}"/>`:'';
  return `<g data-pose="${id}" data-landmarks="33" data-frame-index="${source.frameIndex}">${edges}${dots}${ball}</g>`;
}
