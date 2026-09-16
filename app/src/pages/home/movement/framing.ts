type Point = readonly number[];
interface Recording {
  frames: Point[][];
  ball?: ({ x: number; y: number; radius?: number } | null)[];
  calibration?: { markers: { corners: Point[] }[]; baseline?: { start: Point; end: Point } };
  verticalJump?: { groundY: number; baselineY: number };
  overlays?: { groundY: number; takeoffX: number; landingX: number };
}

/** Fit the entire rep once, in source-image units. Never stretch body axes. */
export function recordingBounds(recording: Recording, aspect: number) {
  const points: Point[] = recording.frames.flat().filter(p => p?.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  for (const marker of recording.calibration?.markers ?? []) points.push(...marker.corners);
  const baseline = recording.calibration?.baseline;
  if (baseline) points.push(baseline.start, baseline.end);
  for (const ball of recording.ball ?? []) if (ball) {
    const r = ball.radius ?? 0;
    points.push([ball.x - r / aspect, ball.y - r], [ball.x + r / aspect, ball.y + r]);
  }
  if (recording.verticalJump) points.push([.5, recording.verticalJump.groundY], [.5, recording.verticalJump.baselineY]);
  if (recording.overlays) points.push([recording.overlays.takeoffX, recording.overlays.groundY], [recording.overlays.landingX, recording.overlays.groundY]);
  const valid = points.filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (!valid.length) return { minX: 0, maxX: aspect, minY: 0, maxY: 1 };
  return { minX: Math.min(...valid.map(p => p[0] * aspect)), maxX: Math.max(...valid.map(p => p[0] * aspect)), minY: Math.min(...valid.map(p => p[1])), maxY: Math.max(...valid.map(p => p[1])) };
}

export function fitRecording(width: number, height: number, ratio: number, bounds: ReturnType<typeof recordingBounds>) {
  const scale = Math.min(Math.max(1, width - 44) / Math.max(.01, bounds.maxX - bounds.minX), Math.max(1, height - 76) / Math.max(.01, bounds.maxY - bounds.minY));
  return { width, height, ratio: Math.min(2, ratio || 1), scale, offsetX: width / 2 - (bounds.minX + bounds.maxX) / 2 * scale, offsetY: height / 2 - (bounds.minY + bounds.maxY) / 2 * scale };
}
