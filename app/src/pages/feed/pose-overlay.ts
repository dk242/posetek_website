import type { SocialPoseOverlay } from './contracts';

export const poseConnections = {
  coco17: [[0,1],[0,2],[1,3],[2,4],[5,6],[5,7],[7,9],[6,8],[8,10],[5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]],
  mediapipe33: [[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[12,14],[14,16],[16,18],[16,20],[16,22],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32]],
};
export function validatedOverlay(value: unknown): SocialPoseOverlay | null {
  const v = value as SocialPoseOverlay | null;
  if (!v || v.version !== 1 || v.coordinateSpace !== 'normalized' || (v.layout !== 'coco17' && v.layout !== 'mediapipe33') ||
    !Number.isFinite(v.sourceWidth) || !Number.isFinite(v.sourceHeight) || v.sourceWidth <= 0 || v.sourceHeight <= 0 || v.sourceWidth > 16384 || v.sourceHeight > 16384 ||
    !Array.isArray(v.frames) || !v.frames.length || v.frames.length > 300) return null;
  const count = v.layout === 'coco17' ? 17 : 33;
  let last = -1;
  for (const frame of v.frames) {
    if (!frame || !Number.isFinite(frame.time) || frame.time < 0 || frame.time > 600 || frame.time <= last || !Array.isArray(frame.points) || frame.points.length !== count) return null;
    last = frame.time;
    if (frame.points.some(point => point !== null && (!Array.isArray(point) || point.length !== 2 || point.some(n => !Number.isFinite(n) || n < 0 || n > 1)))) return null;
  }
  if (!v.footJoints || v.footJoints.left !== (count === 17 ? 15 : 27) || v.footJoints.right !== (count === 17 ? 16 : 28)) return null;
  return { ...v, markers: Array.isArray(v.markers) ? v.markers.filter(m => m && typeof m.label === 'string' && m.label.length <= 60 && Number.isFinite(m.time) && m.time >= 0 && m.time <= last).slice(0, 12) : [] };
}
/** Never hold an old pose over an unsupported interval or extrapolate a joint. */
export function poseAtTime(overlay: SocialPoseOverlay, time: number) {
  const frames = overlay.frames;
  if (!Number.isFinite(time) || time < frames[0].time - .08 || time > frames.at(-1)!.time + .08) return null;
  let low = 0, high = frames.length - 1;
  while (low < high) { const mid = Math.floor((low + high) / 2); if (frames[mid].time < time) low = mid + 1; else high = mid; }
  const next = frames[low], previous = frames[Math.max(0, low - 1)];
  if (Math.abs(time - next.time) <= .02) return next.points;
  if (next.time - previous.time > .25) return Math.abs(time - previous.time) <= .08 ? previous.points : Math.abs(time - next.time) <= .08 ? next.points : null;
  const fraction = Math.max(0, Math.min(1, (time - previous.time) / (next.time - previous.time || 1)));
  return previous.points.map((point, i) => point && next.points[i] ? [point[0] + (next.points[i]![0] - point[0]) * fraction, point[1] + (next.points[i]![1] - point[1]) * fraction] as [number, number] : null);
}
export function footTrail(overlay: SocialPoseOverlay, time: number, index: number) {
  let trail: [number, number][] = [], previous = -Infinity;
  for (const frame of overlay.frames) {
    if (frame.time > time) break;
    if (frame.time < time - .35) continue;
    const point = frame.points[index];
    if (!point || frame.time - previous > .25) trail = [];
    if (point) trail.push(point);
    previous = frame.time;
  }
  return time - previous <= .08 ? trail : [];
}
