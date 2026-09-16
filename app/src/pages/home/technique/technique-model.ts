import capturedData from "./technique-data.json";

export type TechniquePoint = number[];
export interface TechniqueMetric {
  id: string;
  label: string;
  value: number;
  unit: string;
  reference: number | null;
  joints: number[];
}
export interface TechniquePhase {
  key: string;
  title: string;
  sourceFrame: number;
  index: number;
  metrics: TechniqueMetric[];
  referencePose: TechniquePoint[] | null;
}
export interface TechniqueData {
  fps: number;
  startFrame: number;
  step: number;
  frames: TechniquePoint[][];
  ball: ({ x: number; y: number; radius: number } | null)[];
  phases: TechniquePhase[];
  focusAreas: {
    title: string;
    cue: string;
    frameKey: string;
    joints: number[];
    metricIds: string[];
  }[];
  source: Record<string, string>;
}

/** Exact published coordinates, saved measurements, and analysis provenance. */
export const techniqueData: TechniqueData = capturedData;

/** Display-only similarity transform: contact plant-foot anchor, uniform torso scale.
 * Saved references have no ball boxes; use the mobile viewer's plant-foot fallback.
 * Never warp joints or modify the recorded measurements to make poses agree.
 */
export function alignReference(reference: TechniquePoint[], playerContact: TechniquePoint[], referenceContact: TechniquePoint[]) {
  const aspect = 16 / 9;
  const midpoint = (p: TechniquePoint[], a: number, b: number) => [(p[a][0] + p[b][0]) / 2 * aspect, (p[a][1] + p[b][1]) / 2];
  const torso = (p: TechniquePoint[]) => { const h = midpoint(p, 23, 24), s = midpoint(p, 11, 12); return Math.hypot(h[0] - s[0], h[1] - s[1]); };
  const plant = (p: TechniquePoint[]) => p[27][1] > p[28][1] ? 27 : 28;
  const playerPlant = plant(playerContact), proPlant = plant(referenceContact);
  const target = playerContact[playerPlant], anchor = referenceContact[proPlant];
  const scale = torso(playerContact) / Math.max(.001, torso(referenceContact));
  const direction = (p: TechniquePoint[], planted: number) => p[planted === 27 ? 28 : 27][0] - p[planted][0];
  const mirror = direction(playerContact, playerPlant) * direction(referenceContact, proPlant) < 0 ? -1 : 1;
  return reference.map(p => [target[0] + (p[0] - anchor[0]) * scale * mirror, target[1] + (p[1] - anchor[1]) * scale]);
}

/** Preserve the deployed 16:9 projection and its whole-recording fit. */
export function projectRecordedFrames(frames: TechniquePoint[][], width = 600, height = 340) {
  const points = frames.flat().filter(point => point.length >= 2 && point.slice(0, 2).every(Number.isFinite));
  const xs = points.map(point => point[0] * 16 / 9);
  const ys = points.map(point => point[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((width - 80) / Math.max(maxX - minX, .01), (height - 52) / Math.max(maxY - minY, .01));
  const offsetX = width / 2 - (minX + maxX) / 2 * scale;
  const offsetY = height / 2 - (minY + maxY) / 2 * scale;
  return { scale, point: (point: TechniquePoint) => [point[0] * 16 / 9 * scale + offsetX, point[1] * scale + offsetY] };
}

export function nearestPhase(phases: TechniquePhase[], frameIndex: number) {
  return phases.reduce((nearest, phase) => Math.abs(phase.index - frameIndex) < Math.abs(nearest.index - frameIndex) ? phase : nearest, phases[0]);
}

/** Prefer the selected measurement when a joint belongs to more than one. */
export function metricForJoint(phase: TechniquePhase, joint: number, selectedId?: string) {
  return phase.metrics.find(metric => metric.id === selectedId && metric.joints.includes(joint))
    ?? phase.metrics.find(metric => metric.joints.includes(joint));
}

export function formatMeasurement(value: number, unit: string) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}${unit === "°" ? "°" : " cm"}`;
}
