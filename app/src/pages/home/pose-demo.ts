// Pure logic ported from legacy landing-pose-demo.js (the hero's recorded
// MediaPipe pose playback). Everything here is DOM-free so it can be unit
// tested; the imperative canvas/animation half lives in use-pose-demo.ts.
// Numeric output mirrors the legacy script exactly (toFixed digits, padding,
// clamps, the 100ms delta cap and the 650ms end hold).

/** `[x, y]` normalized to the source video frame (0–1 on both axes). */
export type PosePoint = number[];
/** One frame: 33 MediaPipe landmarks. Legacy tolerated holes, so entries may be null. */
export type PoseFrame = (PosePoint | null)[];

export interface PosePhase {
  title: string;
  color: string;
}

export interface PoseOverlays {
  groundY: number;
  takeoffX: number;
  landingX: number;
  com: (PosePoint | null)[];
  foot: (PosePoint | null)[];
}

/** changeOfDirection carries start/startEnd/turn/turnEnd/end; broadJump carries takeoff/landing. */
export interface PoseMarkers {
  start?: number;
  startEnd?: number;
  turn?: number;
  turnEnd?: number;
  end?: number;
  takeoff?: number;
  landing?: number;
}

export type PoseMarkerName = keyof PoseMarkers;

export interface PoseSequence {
  key: string;
  title: string;
  label: string;
  frames: PoseFrame[];
  markers: PoseMarkers;
  /** `[label, value]` pairs rendered into the metric grid. */
  metrics: string[][];
  overlays?: PoseOverlays;
  fps?: number;
  sourceAspectRatio?: number;
  previewFrame?: number;
  phases?: (PosePhase & { from: number })[];
  ball?: ({ x: number; y: number; radius: number } | null)[];
}

export interface PoseDemoData {
  version: number;
  layout: string;
  fps: number;
  sourceAspectRatio: number;
  sequences: PoseSequence[];
  autoAdvance?: boolean;
}

export interface PoseViewport {
  width: number;
  height: number;
  ratio: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

/** Legacy initial `state.viewport` before the first resize. */
export const INITIAL_VIEWPORT: PoseViewport = { width: 1, height: 1, ratio: 1, scale: 1, offsetX: 0, offsetY: 0 };

/** Legacy `mediaPipe33Edges` — the skeleton bones drawn between landmark indices. */
export const MEDIAPIPE33_EDGES: ReadonlyArray<readonly [number, number]> = [
  [11, 12], [12, 24], [24, 23], [23, 11],
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
];

/** Legacy: a finished sequence holds its last frame this long before advancing. */
export const END_HOLD_MS = 650;
/** Legacy: `Math.min(100, timestamp - lastTimestamp)` — a tab that was throttled doesn't skip ahead. */
export const MAX_FRAME_DELTA_MS = 100;
/** Legacy: `Math.min(2, window.devicePixelRatio || 1)`. */
export const MAX_DEVICE_PIXEL_RATIO = 2;
/** Legacy: broad-jump COM/foot trails show the last 24 frames. */
export const TRAIL_FRAMES = 24;

/** Legacy guard: `!data || data.layout !== "mediapipe33" || !Array.isArray(data.sequences)` → no-op. */
export function isPoseDemoData(data: unknown): data is PoseDemoData {
  if (!data || typeof data !== "object") return false;
  const candidate = data as { layout?: unknown; sequences?: unknown };
  return candidate.layout === "mediapipe33" && Array.isArray(candidate.sequences);
}

/** Legacy `formatTime`: `m:ss.ss`, never negative or NaN. */
export function formatTime(seconds: number): string {
  const safe = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${minutes}:${remainder.toFixed(2).padStart(5, "0")}`;
}

/**
 * Legacy `resizeCanvas` math: letterbox the 16:9 source inside the canvas's
 * CSS box, capping the backing-store ratio at 2.
 */
export function fitViewport(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  sourceAspectRatio: number,
): PoseViewport {
  const ratio = Math.min(MAX_DEVICE_PIXEL_RATIO, devicePixelRatio || 1);
  const width = Math.max(1, cssWidth);
  const height = Math.max(1, cssHeight);
  const scale = Math.min(width / sourceAspectRatio, height);
  return {
    width,
    height,
    ratio,
    scale,
    offsetX: (width - sourceAspectRatio * scale) / 2,
    offsetY: (height - scale) / 2,
  };
}

/** Canvas backing-store size for a viewport (`Math.round(css * ratio)`). */
export function backingStoreSize(view: PoseViewport): { width: number; height: number } {
  return { width: Math.round(view.width * view.ratio), height: Math.round(view.height * view.ratio) };
}

/** Legacy `mapPoint`: normalized source point → CSS-pixel canvas point, or null when unusable. */
export function mapPoint(
  point: PosePoint | null | undefined,
  view: PoseViewport,
  sourceAspectRatio: number,
): CanvasPoint | null {
  if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) return null;
  const contentHeight = view.scale;
  const contentWidth = sourceAspectRatio * view.scale;
  return {
    x: view.offsetX + point[0] * contentWidth,
    y: view.offsetY + point[1] * contentHeight,
  };
}

/** Legacy `validPoint`: `Array.isArray(frame?.[index]) ? frame[index] : null`. */
export function validPoint(frame: PoseFrame | undefined, index: number): PosePoint | null {
  const point = frame?.[index];
  return Array.isArray(point) ? point : null;
}

/** Legacy `hipCenter`: midpoint of landmarks 23 and 24, or null if either is missing. */
export function hipCenter(frame: PoseFrame | undefined): PosePoint | null {
  const left = validPoint(frame, 23);
  const right = validPoint(frame, 24);
  if (!left || !right) return null;
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
}

/**
 * Legacy read markers straight off the object, so a marker a sequence doesn't
 * carry was `undefined`: every comparison against it is false and arithmetic
 * yields NaN. NaN reproduces both behaviors behind a numeric type.
 */
export function marker(sequence: PoseSequence, name: PoseMarkerName): number {
  return sequence.markers[name] ?? Number.NaN;
}

export function phaseForChangeOfDirection(sequence: PoseSequence, frameIndex: number): PosePhase {
  if (frameIndex <= marker(sequence, "startEnd")) return { title: "Start", color: "#66c2ff" };
  if (frameIndex <= marker(sequence, "turnEnd")) return { title: "Turn", color: "#ffc969" };
  return { title: "End", color: "#71d39b" };
}

export function phaseForBroadJump(sequence: PoseSequence, frameIndex: number): PosePhase {
  if (frameIndex < marker(sequence, "takeoff")) return { title: "Load", color: "#66c2ff" };
  if (frameIndex <= marker(sequence, "landing")) return { title: "Flight", color: "#b7f34a" };
  return { title: "Landing", color: "#ffc969" };
}

/** Phase lookup dispatch used by `updateDynamicLabels`. */
export function phaseForFrame(sequence: PoseSequence, frameIndex: number): PosePhase {
  if (sequence.phases?.length) {
    const phase = [...sequence.phases].reverse().find(phase => phase.from <= frameIndex) || sequence.phases[0];
    return { title: phase.title, color: phase.color };
  }
  if (sequence.key === "broadJump") return phaseForBroadJump(sequence, frameIndex);
  if (sequence.key === "changeOfDirection") return phaseForChangeOfDirection(sequence, frameIndex);
  return { title: "Recorded movement", color: "#b7f34a" };
}

/** Legacy change-of-direction hip-trail ranges (inclusive frame bounds, one color per phase). */
export function changeOfDirectionPhaseRanges(
  sequence: PoseSequence,
): { start: number; end: number; color: string }[] {
  const startEnd = marker(sequence, "startEnd");
  const turnEnd = marker(sequence, "turnEnd");
  return [
    { start: 0, end: startEnd, color: "#66c2ff" },
    { start: startEnd + 1, end: turnEnd, color: "#ffc969" },
    { start: turnEnd + 1, end: marker(sequence, "end"), color: "#71d39b" },
  ];
}

/** `slice` bounds for the broad-jump COM/foot trails: the last 24 frames up to and including `frame`. */
export function trailRange(frame: number): { start: number; end: number } {
  return { start: Math.max(0, frame - TRAIL_FRAMES), end: frame + 1 };
}

/** Legacy: the distance label sits 17px above the ground line but never within 22px of the top. */
export function broadJumpLabelY(viewportOffsetY: number, groundLineY: number): number {
  return Math.max(viewportOffsetY + 22, groundLineY - 17);
}

export function lastFrameIndex(sequence: PoseSequence): number {
  return sequence.frames.length - 1;
}

export function elapsedSeconds(frame: number, fps: number): number {
  return frame / fps;
}

/** Legacy: `Math.max(0, (frames.length - 1) / fps)`. */
export function totalSeconds(sequence: PoseSequence, fps: number): number {
  return Math.max(0, lastFrameIndex(sequence) / fps);
}

/** `poseTimer` text, e.g. `0:00.00 / 0:04.68`. */
export function timerText(frame: number, sequence: PoseSequence, fps: number): string {
  return `${formatTime(elapsedSeconds(frame, fps))} / ${formatTime(totalSeconds(sequence, fps))}`;
}

/** `posePhaseChip` text, e.g. `Start · 0.00 s`. */
export function phaseChipText(phase: PosePhase, elapsed: number): string {
  return `${phase.title} · ${elapsed.toFixed(2)} s`;
}

/** Scrubber `aria-valuetext`, e.g. `Start, 0.00 seconds`. */
export function scrubberValueText(phase: PosePhase, elapsed: number): string {
  return `${phase.title}, ${elapsed.toFixed(2)} seconds`;
}

/** Legacy `selectSequence` wrap: `(index + count) % count` (so -1 is the last sequence). */
export function wrapSequenceIndex(index: number, count: number): number {
  return (index + count) % count;
}

/**
 * Frame a freshly selected sequence rests on. Legacy: frame 0, except under
 * reduced motion without autoplay, where it parks on the most telling frame
 * (takeoff for the broad jump, the turn for change of direction).
 */
export function restingFrame(sequence: PoseSequence, reducedMotion: boolean, autoplay: boolean): number {
  if (!reducedMotion || autoplay) return 0;
  if (sequence.previewFrame !== undefined) return clampFrame(sequence.previewFrame, lastFrameIndex(sequence));
  const frame = marker(sequence, sequence.key === "broadJump" ? "takeoff" : "turn");
  return Number.isFinite(frame) ? frame : Math.floor(Math.max(0,lastFrameIndex(sequence)) / 2);
}

/** A new object is issued for every Watch rep click, including repeated drills. */
export interface PoseDemoRequest { key: string }

export interface PoseTelemetry {
  drill: string;
  result: string;
  resultLabel: string;
}

/** The telemetry board's drill/result cells for a sequence (legacy `selectSequence`). */
export function telemetryFor(sequence: PoseSequence): PoseTelemetry {
  if (sequence.key !== "broadJump" && sequence.key !== "changeOfDirection") {
    const [resultLabel = "Result", result = "—"] = sequence.metrics[0] || [];
    return { drill: sequence.title, result, resultLabel };
  }
  const isBroadJump = sequence.key === "broadJump";
  return {
    drill: isBroadJump ? "Broad jump" : "Agility",
    result: isBroadJump ? sequence.metrics[0][1] : sequence.metrics[sequence.metrics.length - 1][1],
    resultLabel: isBroadJump ? "Distance" : "Total",
  };
}

/** Legacy scrubber input: `Math.max(0, Math.min(lastFrame, Number(value) || 0))`. */
export function clampFrame(value: unknown, lastFrame: number): number {
  return Math.max(0, Math.min(lastFrame, Number(value) || 0));
}

/** Legacy tick: elapsed ms since the last frame, capped at 100. */
export function frameDelta(timestamp: number, lastTimestamp: number): number {
  return Math.min(MAX_FRAME_DELTA_MS, timestamp - lastTimestamp);
}

export interface FrameAdvance {
  accumulator: number;
  frame: number;
  advanced: boolean;
}

/**
 * Legacy tick frame timing: accumulate `delta * fps / 1000` frames, advance by
 * the whole part (clamped to the last frame) and keep the fractional remainder.
 */
export function advanceFrame(
  frame: number,
  accumulator: number,
  deltaMs: number,
  fps: number,
  lastFrame: number,
): FrameAdvance {
  const next = accumulator + deltaMs * fps / 1000;
  const advance = Math.floor(next);
  if (advance <= 0) return { accumulator: next, frame, advanced: false };
  return { accumulator: next - advance, frame: Math.min(lastFrame, frame + advance), advanced: true };
}
