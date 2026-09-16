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
