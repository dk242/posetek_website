/* eslint-disable @typescript-eslint/no-explicit-any */
import { finiteNumber } from "./result-values";

export type PosePoint = { x: number | null; y: number | null; visibility?: number | null };
export function poseFrames(raw: any, meta: any = {}): PosePoint[][] {
  const source = Array.isArray(raw) ? raw : Array.isArray(raw?.frames) ? raw.frames : [];
  const pixels = ["pixel", "pixels"].includes(meta.coordinateSpace || meta.poseCoordinateSpace);
  const width = finiteNumber(meta.videoDisplayWidth ?? meta.videoWidth ?? meta.imageWidth ?? meta.frameWidth ?? meta.width);
  const height = finiteNumber(meta.videoDisplayHeight ?? meta.videoHeight ?? meta.imageHeight ?? meta.frameHeight ?? meta.height);
  return source.map((frame: any) => {
    const points = Array.isArray(frame) ? frame : frame?.landmarks || frame?.pose || [];
    const layout = String(meta.keypointLayout ?? meta.poseLayout ?? "").toLowerCase();
    const coco = layout.includes("coco") || (!layout.includes("mediapipe") && points.length === 17);
    return (Array.isArray(points) ? points : []).map((point: any) => {
      let x = finiteNumber(Array.isArray(point) ? point[0] : point?.x);
      let y = finiteNumber(Array.isArray(point) ? point[1] : point?.y);
      const visibilityIndex = Array.isArray(point) ? (point.length >= 4 ? 3 : coco && point.length >= 3 ? 2 : -1) : -1;
      const visibilityPresent = Array.isArray(point) ? visibilityIndex >= 0 : point != null && (Object.hasOwn(point, "visibility") || Object.hasOwn(point, "confidence"));
      const visibility = finiteNumber(Array.isArray(point) ? point[visibilityIndex] : Object.hasOwn(point ?? {}, "visibility") ? point.visibility : point?.confidence);
      if (pixels) { x = x !== null && width && width > 0 ? x / width : null; y = y !== null && height && height > 0 ? y / height : null; }
      if (x === null || y === null || x < 0 || x > 1 || y < 0 || y > 1 || (visibilityPresent && (visibility === null || visibility < 0.1 || visibility > 1))) return { x: null, y: null, visibility };
      return { x, y, visibility };
    });
  });
}

export interface Timeline { times: number[]; source: "timestamps" | "fps" | "unavailable" }
export function poseTimeline(meta: any, count: number): Timeline {
  const milliseconds = Array.isArray(meta.frameTimestampsMs);
  const raw = milliseconds ? meta.frameTimestampsMs : meta.frameTimestampsSeconds ?? meta.frameTimestamps;
  if (Array.isArray(raw) && raw.length === count && count > 0) {
    const times = raw.map((value: unknown) => { const number = finiteNumber(value); return number === null ? null : number / (milliseconds ? 1000 : 1); });
    if (times.every((time, index) => time !== null && time >= 0 && time <= 86400 && (index === 0 || time > times[index - 1]!))) return { times: times as number[], source: "timestamps" };
  }
  const fps = finiteNumber(meta.framesPerSecond ?? meta.fps ?? meta.frameRate);
  const offset = finiteNumber(meta.videoStartTimeSeconds ?? meta.poseStartTimeSeconds) ?? 0;
  if (fps && fps > 0 && fps <= 1000 && offset >= 0) return { times: Array.from({ length: count }, (_, index) => offset + index / fps), source: "fps" };
  return { times: [], source: "unavailable" };
}
export function frameAtTime(timeline: Timeline, seconds: number): number {
  if (!timeline.times.length) return 0;
  let low = 0, high = timeline.times.length - 1;
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (timeline.times[middle] <= seconds) low = middle; else high = middle - 1; }
  return low;
}
export function contentRect(width: number, height: number, sourceWidth: number, sourceHeight: number) {
  if (!(sourceWidth > 0 && sourceHeight > 0)) return { x: 0, y: 0, width, height };
  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  return { x: (width - sourceWidth * scale) / 2, y: (height - sourceHeight * scale) / 2, width: sourceWidth * scale, height: sourceHeight * scale };
}
