// The rep tools' pure core: how admin annotations become a re-derived rep.
//
// Change of direction and dribbling are re-derived exactly the way the phone
// derives them (KickAI/DrillProcessing/CodProcessingMath.swift):
//   - every time is `frames / fps`, with fps = metadata.framesPerSecond;
//   - the turn is `apexFrame` (argmax of signed x), phase 1 ends at the first
//     frame ≥ 90% of the marker distance, phase 2 ends at the first frame after
//     the apex ≤ 90% of it;
//   - distances come from the gate: x_m = (x − leftGate)/(rightGate − leftGate)
//     × markerDistance, signed so x = 0 at the start marker and positive
//     toward the far marker; outbound = apexX − startX, return = apexX − endX;
//   - dribbling's avgBallDistance = mean |ball.x − com.x| in meters over the
//     start…end window.
// Everything here is deterministic and unit-tested; the components only
// collect clicks and render what these functions return.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type DrillKey = "changeOfDirection" | "dribbling" | "sprint" | "jump" | "broadJump" | "shooting" | "freeRecord";

export interface Point { x: number; y: number }
export interface Mark { frame: number; x: number; y: number }

// MARK: - JSON the phone writes

/**
 * The phone's `PythonCompatibleJSON` can emit bare `NaN` / `Infinity` tokens,
 * which strict JSON.parse rejects. Replace them with null before parsing.
 */
export function parseArtifactJson(text: string | null | undefined): any {
  if (!text) return null;
  const cleaned = text.replace(/(?<=[[,:\s])-?(?:NaN|Infinity)(?=[\],}\s])/g, "null");
  return JSON.parse(cleaned);
}

export const num = (value: unknown): number | null => {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

export const int = (value: unknown): number | null => {
  const parsed = num(value);
  return parsed === null ? null : Math.round(parsed);
};

// MARK: - Frame rate and frame count

export interface ClipTiming {
  fps: number;
  fpsSource: "metadata" | "reprocessContext" | "pose+duration" | "default";
  totalFrames: number;
  totalFramesSource: "metadata" | "pose" | "duration" | "default";
}

export function resolveClipTiming(input: {
  metadata: any;
  reprocessContext: any;
  poseFrameCount: number;
  videoDuration: number | null;
}): ClipTiming {
  const { metadata, reprocessContext, poseFrameCount, videoDuration } = input;
  let fps = num(metadata?.framesPerSecond);
  let fpsSource: ClipTiming["fpsSource"] = "metadata";
  if (fps === null || fps <= 0) {
    fps = num(reprocessContext?.capture?.clipFramesPerSecondUsed) ?? num(reprocessContext?.capture?.requestedFPS);
    fpsSource = "reprocessContext";
  }
  if (fps === null || fps <= 0) {
    if (poseFrameCount > 1 && videoDuration && videoDuration > 0) {
      fps = poseFrameCount / videoDuration;
      fpsSource = "pose+duration";
    } else {
      fps = 60;
      fpsSource = "default";
    }
  }
  let totalFrames = int(metadata?.totalFrames);
  let totalFramesSource: ClipTiming["totalFramesSource"] = "metadata";
  if (totalFrames === null || totalFrames <= 0) {
    if (poseFrameCount > 0) { totalFrames = poseFrameCount; totalFramesSource = "pose"; }
    else if (videoDuration && videoDuration > 0) { totalFrames = Math.max(1, Math.round(videoDuration * fps)); totalFramesSource = "duration"; }
    else { totalFrames = 1; totalFramesSource = "default"; }
  }
  return { fps, fpsSource, totalFrames, totalFramesSource };
}

export const frameToSeconds = (frame: number, fps: number): number => frame / fps;

// MARK: - The gate (pixel → meters)

export interface Gate {
  /** Normalized x of the two gate points, left < right. */
  leftX: number;
  rightX: number;
  markerDistance: number;
  source: "metadata.arucoGate" | "session.aruco_corners" | "session.marker_config" | "unavailable";
  distanceSource: string | null;
  geometryTrusted: boolean;
}

/**
 * The gate the phone used, in priority order: the `arucoGate` block newer reps
 * write into metadata.json; else the session-root `aruco_corners.json` marker
 * centers, usable only when `calibrationGeometryTrusted` is not false; else the
 * tapped points in `{drill}_marker.json`. The marker distance is metadata's
 * `markerDistance` (what the phone actually used), else the rep doc's, else the
 * marker config's `markerSeparationMeters`.
 */
export function resolveGate(input: {
  metadata: any;
  rep: any;
  arucoCorners: any;
  markerConfig: any;
}): Gate {
  const { metadata, rep, arucoCorners, markerConfig } = input;
  const geometryTrusted = metadata?.calibrationGeometryTrusted !== false;
  const recorded = num(metadata?.markerDistance) ?? num(rep?.markerDistance);
  const markerDistance = recorded ?? num(markerConfig?.markerSeparationMeters);
  const distanceSource = typeof metadata?.markerDistanceSource === "string"
    ? metadata.markerDistanceSource
    : recorded === null && markerDistance !== null ? "manual" : null;
  const unavailable: Gate = { leftX: 0, rightX: 1, markerDistance: markerDistance ?? 0, source: "unavailable", distanceSource, geometryTrusted };
  if (markerDistance === null || markerDistance <= 0) return unavailable;

  const gate = metadata?.arucoGate;
  const startX = num(gate?.startXNorm);
  const stopX = num(gate?.stopXNorm);
  if (startX !== null && stopX !== null && stopX > startX) {
    return { leftX: startX, rightX: stopX, markerDistance, source: "metadata.arucoGate", distanceSource, geometryTrusted };
  }

  const markers = Array.isArray(arucoCorners?.markers) ? arucoCorners.markers : [];
  const centers = markers
    .map((marker: any) => num(marker?.centerNormalized?.x) ?? num(Array.isArray(marker?.centerNormalized) ? marker.centerNormalized[0] : null))
    .filter((x: number | null): x is number => x !== null);
  if (geometryTrusted && centers.length >= 2) {
    const leftX = Math.min(...centers);
    const rightX = Math.max(...centers);
    if (rightX > leftX) return { leftX, rightX, markerDistance, source: "session.aruco_corners", distanceSource, geometryTrusted };
  }

  const a = num(markerConfig?.startMarker?.x) ?? num(markerConfig?.leftMarkerX);
  const b = num(markerConfig?.endMarker?.x) ?? num(markerConfig?.rightMarkerX);
  if (a !== null && b !== null && a !== b) {
    return { leftX: Math.min(a, b), rightX: Math.max(a, b), markerDistance, source: "session.marker_config", distanceSource, geometryTrusted };
  }
  return unavailable;
}

export type StartingSide = "left" | "right";

/** The phone infers the side from the first tracked point against the gate midpoint. */
export function inferStartingSide(track: (Point | null)[], gate: Gate, fallback: string | null | undefined): StartingSide | null {
  const first = track.find(point => point !== null) ?? null;
  if (first) return first.x < (gate.leftX + gate.rightX) / 2 ? "left" : "right";
  return fallback === "left" || fallback === "right" ? fallback : null;
}

/** SprintProcessingMath.convertCOMToMeters + the direction sign: 0 at the start marker. */
export function signedMeters(x: number, gate: Gate, side: StartingSide): number {
  const leftBased = ((x - gate.leftX) / (gate.rightX - gate.leftX)) * gate.markerDistance;
  return side === "right" ? gate.markerDistance - leftBased : leftBased;
}

export function trackToSignedMeters(track: (Point | null)[], gate: Gate, side: StartingSide): (number | null)[] {
  return track.map(point => (point ? signedMeters(point.x, gate, side) : null));
}

// MARK: - Annotation tracks

/**
 * Linear interpolation between annotated frames; null outside the annotated
 * span. With a stride of 3 the admin marks every third frame and the two in
 * between are filled in here.
 */
export function interpolateTrack(marks: Mark[], totalFrames: number): (Point | null)[] {
  const byFrame = new Map<number, Mark>();
  for (const mark of marks) {
    if (Number.isInteger(mark.frame) && mark.frame >= 0 && mark.frame < totalFrames) byFrame.set(mark.frame, mark);
  }
  const keys = [...byFrame.keys()].sort((a, b) => a - b);
  const track: (Point | null)[] = new Array(totalFrames).fill(null);
  if (!keys.length) return track;
  for (let i = 0; i < keys.length; i++) {
    const a = byFrame.get(keys[i])!;
    track[a.frame] = { x: a.x, y: a.y };
    if (i + 1 < keys.length) {
      const b = byFrame.get(keys[i + 1])!;
      const span = b.frame - a.frame;
      for (let f = a.frame + 1; f < b.frame; f++) {
        const t = (f - a.frame) / span;
        track[f] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
    }
  }
  return track;
}

/** The frames an annotation pass visits: first, first+stride, …, and always the last. */
export function annotationFrames(first: number, last: number, stride: number): number[] {
  const step = Math.max(1, Math.round(stride));
  const frames: number[] = [];
  if (last < first) return frames;
  for (let f = first; f <= last; f += step) frames.push(f);
  if (frames[frames.length - 1] !== last) frames.push(last);
  return frames;
}

/** The hip midpoint per frame of a MediaPipe pose.json — what the phone's viewer calls the body center. */
export function hipTrackFromPose(pose: any): (Point | null)[] {
  const frames = Array.isArray(pose) ? pose : Array.isArray(pose?.frames) ? pose.frames : [];
  return frames.map((frame: any) => {
    if (!Array.isArray(frame) || frame.length < 25) return null;
    const read = (index: number): Point | null => {
      const row = frame[index];
      if (!Array.isArray(row) || row.length < 2) return null;
      const x = num(row[0]);
      const y = num(row[1]);
      const visibility = num(row[3]);
      if (x === null || y === null || (visibility !== null && visibility < 0.1)) return null;
      return { x, y };
    };
    const left = read(23);
    const right = read(24);
    return left && right ? { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 } : null;
  });
}

// MARK: - Change of direction / dribbling re-derivation

export interface ShuttleFrames {
  startFrame: number | null;
  apexFrame: number | null;
  phase1EndFrame: number | null;
  phase2EndFrame: number | null;
  endFrame: number | null;
}

export const SHUTTLE_FRAME_KEYS: (keyof ShuttleFrames)[] = ["startFrame", "phase1EndFrame", "apexFrame", "phase2EndFrame", "endFrame"];

export function shuttleFramesFrom(metadata: any, rep: any): ShuttleFrames {
  const pick = (key: keyof ShuttleFrames) => int(metadata?.[key]) ?? int(rep?.[key]);
  return {
    startFrame: pick("startFrame"),
    apexFrame: pick("apexFrame"),
    phase1EndFrame: pick("phase1EndFrame"),
    phase2EndFrame: pick("phase2EndFrame"),
    endFrame: pick("endFrame"),
  };
}

const PHASE_DISTANCE_FRACTION = 0.9;

/** CodProcessingMath.apexFrame — argmax of signed x from the start frame to the end of the clip. */
export function deriveApexFrame(positionMeters: (number | null)[], startFrame: number): number | null {
  let best: number | null = null;
  let bestValue = -Infinity;
  for (let f = Math.max(0, startFrame); f < positionMeters.length; f++) {
    const value = positionMeters[f];
    if (value !== null && value > bestValue) { bestValue = value; best = f; }
  }
  return best;
}

/** CodProcessingMath.computeReturnEndFrame — first frame at/after the apex crossing back through x = 0. */
export function deriveEndFrame(positionMeters: (number | null)[], apexFrame: number): number | null {
  let previous: number | null = null;
  for (let f = Math.max(0, apexFrame); f < positionMeters.length; f++) {
    const value = positionMeters[f];
    if (value === null) continue;
    if (previous !== null && previous > 0 && value <= 0) return f;
    previous = value;
  }
  return null;
}

/** CodProcessingMath.phaseBoundaries — the 90%-of-marker-distance crossings either side of the apex. */
export function derivePhaseBoundaries(positionMeters: (number | null)[], startFrame: number, apexFrame: number, markerDistance: number): { phase1EndFrame: number | null; phase2EndFrame: number | null } {
  const threshold = PHASE_DISTANCE_FRACTION * markerDistance;
  let phase1EndFrame: number | null = null;
  for (let f = Math.max(0, startFrame); f <= apexFrame && f < positionMeters.length; f++) {
    const value = positionMeters[f];
    if (value !== null && value >= threshold) { phase1EndFrame = f; break; }
  }
  let phase2EndFrame: number | null = null;
  for (let f = apexFrame + 1; f < positionMeters.length; f++) {
    const value = positionMeters[f];
    if (value !== null && value <= threshold) { phase2EndFrame = f; break; }
  }
  return { phase1EndFrame, phase2EndFrame };
}

/** CodProcessingMath.nearestFinitePosition — the value at the frame, else the nearest within ±15 frames. */
export function nearestFinitePosition(positionMeters: (number | null)[], frame: number, radius = 15): number | null {
  if (frame < 0 || frame >= positionMeters.length) return null;
  const at = positionMeters[frame];
  if (at !== null && at !== undefined) return at;
  for (let d = 1; d <= radius; d++) {
    const before = positionMeters[frame - d];
    if (frame - d >= 0 && before !== null && before !== undefined) return before;
    const after = positionMeters[frame + d];
    if (frame + d < positionMeters.length && after !== null && after !== undefined) return after;
  }
  return null;
}

export interface ShuttleMetrics {
  totalTime: number | null;
  phase1Time: number | null;
  phase2Time: number | null;
  phase3Time: number | null;
  phase1Percent: number | null;
  phase2Percent: number | null;
  phase3Percent: number | null;
  totalDistance: number | null;
  outboundDistance: number | null;
  returnDistance: number | null;
  avgBallDistance: number | null;
}

export const SHUTTLE_METRIC_KEYS: (keyof ShuttleMetrics)[] = [
  "totalTime", "phase1Time", "phase2Time", "phase3Time", "phase1Percent", "phase2Percent", "phase3Percent",
  "totalDistance", "outboundDistance", "returnDistance", "avgBallDistance",
];

export interface ShuttleDerivation {
  metrics: ShuttleMetrics;
  /** Which metrics were re-derived here (the rest keep the original values). */
  derived: (keyof ShuttleMetrics)[];
  notes: string[];
}

/**
 * Re-derive the shuttle metrics from the frame marks and, when a track in
 * meters is available, the distances. A missing track leaves the original
 * distance values in place rather than nulling them.
 */
export function deriveShuttleMetrics(input: {
  frames: ShuttleFrames;
  fps: number;
  original: Partial<ShuttleMetrics>;
  comMeters: (number | null)[] | null;
  ballMeters: (number | null)[] | null;
  dribbling: boolean;
}): ShuttleDerivation {
  const { frames, fps, original, comMeters, ballMeters, dribbling } = input;
  const metrics: ShuttleMetrics = {
    totalTime: num(original.totalTime), phase1Time: num(original.phase1Time), phase2Time: num(original.phase2Time), phase3Time: num(original.phase3Time),
    phase1Percent: num(original.phase1Percent), phase2Percent: num(original.phase2Percent), phase3Percent: num(original.phase3Percent),
    totalDistance: num(original.totalDistance), outboundDistance: num(original.outboundDistance), returnDistance: num(original.returnDistance),
    avgBallDistance: num(original.avgBallDistance),
  };
  const derived: (keyof ShuttleMetrics)[] = [];
  const notes: string[] = [];
  const { startFrame, apexFrame, phase1EndFrame, phase2EndFrame, endFrame } = frames;

  // Timing — CodProcessingMath.repMetrics / CodPhaseDurations, all-or-nothing like the phone.
  if (fps > 0 && startFrame !== null && endFrame !== null && endFrame > startFrame) {
    metrics.totalTime = (endFrame - startFrame) / fps;
  } else {
    metrics.totalTime = null;
    notes.push("No total time: the end frame must come after the start frame.");
  }
  derived.push("totalTime");
  const orderedPhases = startFrame !== null && phase1EndFrame !== null && phase2EndFrame !== null && endFrame !== null
    && startFrame <= phase1EndFrame && phase1EndFrame <= phase2EndFrame && phase2EndFrame <= endFrame;
  if (fps > 0 && orderedPhases) {
    metrics.phase1Time = (phase1EndFrame! - startFrame!) / fps;
    metrics.phase2Time = (phase2EndFrame! - phase1EndFrame!) / fps;
    metrics.phase3Time = (endFrame! - phase2EndFrame!) / fps;
    const total = metrics.phase1Time + metrics.phase2Time + metrics.phase3Time;
    metrics.phase1Percent = total > 0 ? (metrics.phase1Time / total) * 100 : null;
    metrics.phase2Percent = total > 0 ? (metrics.phase2Time / total) * 100 : null;
    metrics.phase3Percent = total > 0 ? (metrics.phase3Time / total) * 100 : null;
  } else {
    metrics.phase1Time = metrics.phase2Time = metrics.phase3Time = null;
    metrics.phase1Percent = metrics.phase2Percent = metrics.phase3Percent = null;
    notes.push("No phase times: start ≤ turn start ≤ turn end ≤ end must hold.");
  }
  derived.push("phase1Time", "phase2Time", "phase3Time", "phase1Percent", "phase2Percent", "phase3Percent");

  // Distances — only when a track in meters exists.
  if (comMeters && startFrame !== null && endFrame !== null && endFrame > startFrame) {
    const startX = nearestFinitePosition(comMeters, startFrame);
    const endX = nearestFinitePosition(comMeters, endFrame);
    const apexX = apexFrame !== null ? nearestFinitePosition(comMeters, apexFrame) : null;
    if (startX !== null && endX !== null && apexX !== null) {
      metrics.outboundDistance = Math.max(0, apexX - startX);
      metrics.returnDistance = Math.max(0, apexX - endX);
      metrics.totalDistance = metrics.outboundDistance + metrics.returnDistance;
    } else {
      metrics.outboundDistance = metrics.returnDistance = metrics.totalDistance = null;
      notes.push("No distances: the track has no position near the start, turn or end frame.");
    }
    derived.push("totalDistance", "outboundDistance", "returnDistance");
  } else if (!comMeters) {
    notes.push("Distances kept from the original: no athlete track was annotated or derived.");
  }

  // Dribbling — mean |ball.x − com.x| over the active window.
  if (dribbling && comMeters && ballMeters) {
    const first = startFrame ?? 0;
    const last = endFrame ?? Math.min(comMeters.length, ballMeters.length) - 1;
    const distances: number[] = [];
    for (let f = first; f <= last; f++) {
      const com = comMeters[f];
      const ball = ballMeters[f];
      if (com !== null && com !== undefined && ball !== null && ball !== undefined) distances.push(Math.abs(ball - com));
    }
    metrics.avgBallDistance = distances.length ? distances.reduce((a, b) => a + b, 0) / distances.length : null;
    derived.push("avgBallDistance");
    if (!distances.length) notes.push("No ball distance: the ball and athlete tracks never overlap in the window.");
  } else if (dribbling && !ballMeters) {
    notes.push("Ball distance kept from the original: the ball was not annotated.");
  }

  return { metrics, derived, notes };
}

// MARK: - The diff shown before pushing

export interface FieldChange {
  key: string;
  before: number | string | null;
  after: number | string | null;
  changed: boolean;
}

export function diffFields(before: Record<string, any>, after: Record<string, any>, keys: string[]): FieldChange[] {
  return keys.map(key => {
    const a = before[key] ?? null;
    const b = after[key] ?? null;
    const changed = typeof a === "number" && typeof b === "number" ? Math.abs(a - b) > 1e-9 : a !== b;
    return { key, before: a, after: b, changed };
  });
}

export function formatFieldValue(key: string, value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (/[Ff]rame$/.test(key)) return String(value);
  if (/Percent$/.test(key)) return `${value.toFixed(1)} %`;
  if (/Time$/.test(key) || /Seconds$/.test(key) || key === "time_to_max_velocity") return `${value.toFixed(3)} s`;
  if (/Distance$/.test(key) || key === "distance" || key === "jumpHeight") return `${value.toFixed(3)} m`;
  return String(Math.round(value * 1000) / 1000);
}

// MARK: - Per-drill descriptors (what the tools can edit)

export interface FrameFieldSpec { key: string; label: string; hint?: string }
export interface NumberFieldSpec { key: string; label: string; unit?: string }

export interface DrillToolSpec {
  key: DrillKey;
  /** Event frames the admin can scrub to and set. */
  frameFields: FrameFieldSpec[];
  /** Numeric result fields shown in the before/after table (and editable directly for non-shuttle drills). */
  numberFields: NumberFieldSpec[];
  /** True for the two shuttle drills whose metrics this module re-derives. */
  rederive: boolean;
  ball: boolean;
}

const SHUTTLE_FRAME_FIELDS: FrameFieldSpec[] = [
  { key: "startFrame", label: "Start", hint: "Last quiet frame before the athlete leaves the start marker." },
  { key: "phase1EndFrame", label: "Turn start", hint: "First frame at 90% of the way to the far marker." },
  { key: "apexFrame", label: "Turn (apex)", hint: "The farthest point of the outbound leg." },
  { key: "phase2EndFrame", label: "Turn end", hint: "First frame back inside 90% of the way on the return." },
  { key: "endFrame", label: "End", hint: "The frame the athlete crosses back over the start marker." },
];

const SHUTTLE_NUMBER_FIELDS: NumberFieldSpec[] = [
  { key: "totalTime", label: "Total time", unit: "s" },
  { key: "phase1Time", label: "Outbound", unit: "s" },
  { key: "phase2Time", label: "Turn", unit: "s" },
  { key: "phase3Time", label: "Return", unit: "s" },
  { key: "phase1Percent", label: "Outbound share", unit: "%" },
  { key: "phase2Percent", label: "Turn share", unit: "%" },
  { key: "phase3Percent", label: "Return share", unit: "%" },
  { key: "totalDistance", label: "Total distance", unit: "m" },
  { key: "outboundDistance", label: "Outbound distance", unit: "m" },
  { key: "returnDistance", label: "Return distance", unit: "m" },
  { key: "markerDistance", label: "Marker distance", unit: "m" },
];

export const DRILL_TOOL_SPECS: Record<string, DrillToolSpec> = {
  changeOfDirection: { key: "changeOfDirection", frameFields: SHUTTLE_FRAME_FIELDS, numberFields: SHUTTLE_NUMBER_FIELDS, rederive: true, ball: false },
  dribbling: {
    key: "dribbling",
    frameFields: SHUTTLE_FRAME_FIELDS,
    numberFields: [...SHUTTLE_NUMBER_FIELDS, { key: "avgBallDistance", label: "Avg ball distance", unit: "m" }],
    rederive: true,
    ball: true,
  },
  sprint: {
    key: "sprint",
    frameFields: [{ key: "startFrame", label: "Start" }, { key: "endFrame", label: "Finish" }],
    numberFields: [
      { key: "max_velocity", label: "Top speed", unit: "m/s" },
      { key: "average_velocity", label: "Average speed", unit: "m/s" },
      { key: "max_acceleration", label: "Max acceleration", unit: "m/s²" },
      { key: "time_to_max_velocity", label: "Time to top speed", unit: "s" },
      { key: "totalTime", label: "Total time", unit: "s" },
      { key: "distance", label: "Distance", unit: "m" },
    ],
    rederive: false,
    ball: false,
  },
  jump: {
    key: "jump",
    frameFields: [{ key: "takeoffFrame", label: "Takeoff" }, { key: "peakFrame", label: "Peak" }, { key: "landingFrame", label: "Landing" }],
    numberFields: [{ key: "jumpHeight", label: "Jump height", unit: "m" }],
    rederive: false,
    ball: false,
  },
  broadJump: {
    key: "broadJump",
    frameFields: [{ key: "takeoffFrame", label: "Takeoff" }, { key: "landingFrame", label: "Landing" }],
    numberFields: [{ key: "broadJumpDistance", label: "Distance", unit: "m" }, { key: "jumpHeight", label: "Peak height", unit: "m" }],
    rederive: false,
    ball: false,
  },
  shooting: {
    key: "shooting",
    frameFields: [{ key: "contact_frame", label: "Contact" }, { key: "transition_frame", label: "Transition" }],
    numberFields: [{ key: "velocity", label: "Ball velocity", unit: "m/s" }, { key: "launch_angle", label: "Launch angle", unit: "°" }],
    rederive: false,
    ball: true,
  },
};

export function toolSpecFor(drillKey: string): DrillToolSpec | null {
  return DRILL_TOOL_SPECS[drillKey] ?? null;
}

// MARK: - The payload the callable receives

export interface RevisionPayload {
  playerId: string;
  repId: string;
  drill: string;
  fields: Record<string, number | string | null>;
  metadata: Record<string, any>;
  annotations: Record<string, any>;
  note: string;
}

export function buildRevisionPayload(input: {
  playerId: string;
  repId: string;
  drill: string;
  fields: Record<string, number | string | null | undefined>;
  metadataExtras: Record<string, any>;
  annotations: Record<string, any>;
  note: string;
}): RevisionPayload {
  const fields: Record<string, number | string | null> = {};
  for (const [key, value] of Object.entries(input.fields)) {
    if (value === undefined) continue;
    fields[key] = typeof value === "number" && !Number.isFinite(value) ? null : value;
  }
  return {
    playerId: input.playerId,
    repId: input.repId,
    drill: input.drill,
    fields,
    metadata: { ...fields, ...input.metadataExtras },
    annotations: input.annotations,
    note: input.note.trim().slice(0, 2000),
  };
}
