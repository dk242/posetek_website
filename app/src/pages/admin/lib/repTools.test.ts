// The math the rep tools push into an athlete's record. Each case mirrors a
// rule in the phone's CodProcessingMath so a web re-derivation and an
// on-device derivation of the same marks agree.

import { describe, expect, it } from "vitest";
import {
  annotationFrames,
  buildRevisionPayload,
  deriveApexFrame,
  deriveEndFrame,
  derivePhaseBoundaries,
  deriveShuttleMetrics,
  diffFields,
  formatFieldValue,
  hipTrackFromPose,
  inferStartingSide,
  interpolateTrack,
  measurementInputsChanged,
  nearestFinitePosition,
  isLabelOnlyEdit,
  parseArtifactJson,
  resolveClipTiming,
  resolveGate,
  revisionPreviewFields,
  shuttleFramesFrom,
  signedMeters,
  stringFieldValues,
  toolSpecFor,
  trackToSignedMeters,
} from "./repTools";
import type { Gate } from "./repTools";

const gate: Gate = { leftX: 0.2, rightX: 0.8, markerDistance: 10, source: "metadata.arucoGate", distanceSource: "aruco_pose", geometryTrusted: true };

describe("artifact JSON", () => {
  it("tolerates the phone's bare NaN and Infinity tokens", () => {
    expect(parseArtifactJson('{"a": [1, NaN, -Infinity], "b": NaN}')).toEqual({ a: [1, null, null], b: null });
    expect(parseArtifactJson('{"name": "NaN"}')).toEqual({ name: "NaN" });
    expect(parseArtifactJson("")).toBeNull();
  });
});

describe("clip timing", () => {
  it("prefers the measured fps and frame count from metadata", () => {
    const timing = resolveClipTiming({ metadata: { framesPerSecond: 119.88, totalFrames: 480 }, reprocessContext: null, poseFrameCount: 470, videoDuration: 4 });
    expect(timing).toEqual({ fps: 119.88, fpsSource: "metadata", totalFrames: 480, totalFramesSource: "metadata" });
  });
  it("falls back to the sidecar, then pose over duration, then 60", () => {
    expect(resolveClipTiming({ metadata: {}, reprocessContext: { capture: { clipFramesPerSecondUsed: 120 } }, poseFrameCount: 0, videoDuration: null }).fps).toBe(120);
    const derived = resolveClipTiming({ metadata: {}, reprocessContext: {}, poseFrameCount: 240, videoDuration: 2 });
    expect(derived.fps).toBe(120);
    expect(derived.fpsSource).toBe("pose+duration");
    expect(derived.totalFrames).toBe(240);
    const bare = resolveClipTiming({ metadata: null, reprocessContext: null, poseFrameCount: 0, videoDuration: 3 });
    expect(bare.fps).toBe(60);
    expect(bare.totalFrames).toBe(180);
    expect(bare.totalFramesSource).toBe("duration");
  });
});

describe("the gate", () => {
  it("uses metadata's arucoGate when present", () => {
    const resolved = resolveGate({ metadata: { arucoGate: { startXNorm: 0.3, stopXNorm: 0.7 }, markerDistance: 9, markerDistanceSource: "manual" }, rep: {}, arucoCorners: null, markerConfig: null });
    expect(resolved).toMatchObject({ leftX: 0.3, rightX: 0.7, markerDistance: 9, source: "metadata.arucoGate", distanceSource: "manual" });
  });
  it("falls back to session marker centers only when the geometry is trusted", () => {
    const corners = { markers: [{ centerNormalized: { x: 0.75 } }, { centerNormalized: { x: 0.25 } }] };
    const trusted = resolveGate({ metadata: { markerDistance: 10 }, rep: {}, arucoCorners: corners, markerConfig: null });
    expect(trusted).toMatchObject({ leftX: 0.25, rightX: 0.75, source: "session.aruco_corners" });
    const untrusted = resolveGate({ metadata: { markerDistance: 10, calibrationGeometryTrusted: false }, rep: {}, arucoCorners: corners, markerConfig: { startMarker: { x: 0.1 }, endMarker: { x: 0.9 } } });
    expect(untrusted).toMatchObject({ leftX: 0.1, rightX: 0.9, source: "session.marker_config", geometryTrusted: false });
  });
  it("reads a manual separation from the marker config as a string", () => {
    const resolved = resolveGate({ metadata: {}, rep: {}, arucoCorners: null, markerConfig: { startMarker: { x: 0.2 }, endMarker: { x: 0.8 }, markerSeparationMeters: "9.144" } });
    expect(resolved.markerDistance).toBeCloseTo(9.144);
    expect(resolved.distanceSource).toBe("manual");
  });
  it("is unavailable without a marker distance", () => {
    expect(resolveGate({ metadata: { arucoGate: { startXNorm: 0.3, stopXNorm: 0.7 } }, rep: {}, arucoCorners: null, markerConfig: null }).source).toBe("unavailable");
  });
});

describe("meters", () => {
  it("is zero at the start marker and positive toward the far marker on either side", () => {
    expect(signedMeters(0.2, gate, "left")).toBeCloseTo(0);
    expect(signedMeters(0.8, gate, "left")).toBeCloseTo(10);
    expect(signedMeters(0.8, gate, "right")).toBeCloseTo(0);
    expect(signedMeters(0.2, gate, "right")).toBeCloseTo(10);
    expect(signedMeters(0.5, gate, "left")).toBeCloseTo(5);
  });
  it("infers the starting side from the first tracked point, else the gate side", () => {
    expect(inferStartingSide([null, { x: 0.25, y: 0.5 }], gate, "right")).toBe("left");
    expect(inferStartingSide([{ x: 0.9, y: 0.5 }], gate, null)).toBe("right");
    expect(inferStartingSide([], gate, "right")).toBe("right");
    expect(inferStartingSide([], gate, "up")).toBeNull();
  });
  it("converts a whole track, leaving gaps null", () => {
    const track = trackToSignedMeters([{ x: 0.2, y: 0 }, null, { x: 0.5, y: 0 }], gate, "left");
    expect(track[0]).toBeCloseTo(0);
    expect(track[1]).toBeNull();
    expect(track[2]).toBeCloseTo(5);
  });
});

describe("annotation tracks", () => {
  it("visits every stride-th frame and always the last", () => {
    expect(annotationFrames(10, 20, 3)).toEqual([10, 13, 16, 19, 20]);
    expect(annotationFrames(0, 6, 3)).toEqual([0, 3, 6]);
    expect(annotationFrames(5, 4, 3)).toEqual([]);
    expect(annotationFrames(0, 2, 0)).toEqual([0, 1, 2]);
  });
  it("interpolates the skipped frames linearly and stays null outside the marks", () => {
    const track = interpolateTrack([{ frame: 6, x: 0.7, y: 0.4 }, { frame: 3, x: 0.4, y: 0.1 }, { frame: 9, x: 0.1, y: 0.1 }], 12);
    expect(track[0]).toBeNull();
    expect(track[2]).toBeNull();
    expect(track[3]).toEqual({ x: 0.4, y: 0.1 });
    expect(track[4]!.x).toBeCloseTo(0.5);
    expect(track[5]!.y).toBeCloseTo(0.3);
    expect(track[6]).toEqual({ x: 0.7, y: 0.4 });
    expect(track[8]!.x).toBeCloseTo(0.3);
    expect(track[9]).toEqual({ x: 0.1, y: 0.1 });
    expect(track[10]).toBeNull();
    expect(track).toHaveLength(12);
  });
  it("keeps the last mark for a frame and drops out-of-range marks", () => {
    const track = interpolateTrack([{ frame: 2, x: 0.1, y: 0.1 }, { frame: 2, x: 0.9, y: 0.9 }, { frame: 40, x: 0, y: 0 }], 5);
    expect(track[2]).toEqual({ x: 0.9, y: 0.9 });
    expect(track.filter(Boolean)).toHaveLength(1);
  });
  it("reads the hip midpoint from pose.json, skipping low-visibility frames", () => {
    const row = (x: number, y: number, v = 1) => [x, y, 0, v];
    const frame = new Array(33).fill(null).map(() => row(0, 0));
    frame[23] = row(0.4, 0.6);
    frame[24] = row(0.6, 0.8);
    const hidden = frame.map(r => [...r]);
    hidden[23] = row(0.4, 0.6, 0.05);
    expect(hipTrackFromPose([frame, null, hidden, []])).toEqual([{ x: 0.5, y: 0.7 }, null, null, null]);
  });
});

describe("shuttle event derivation", () => {
  // x in meters per frame: out to 10 m at frame 6, back through zero at frame 12.
  const x = [0, 0, 1, 4, 7, 9.5, 10, 9.4, 8, 5, 2, 0.5, -0.2, -0.5];
  it("finds the apex as the argmax from the start frame", () => {
    expect(deriveApexFrame(x, 1)).toBe(6);
    expect(deriveApexFrame([null, null], 0)).toBeNull();
  });
  it("finds the end as the first crossing back through zero after the apex", () => {
    expect(deriveEndFrame(x, 6)).toBe(12);
    expect(deriveEndFrame([0, 5, 10, 8, 3, 1], 2)).toBeNull();
  });
  it("bounds the turn phase at 90% of the marker distance either side of the apex", () => {
    // 9.5 at frame 5 is the first ≥ 9 m outbound; 9.4 at frame 7 is still past 9 m, so the turn ends at frame 8 (8 m).
    expect(derivePhaseBoundaries(x, 1, 6, 10)).toEqual({ phase1EndFrame: 5, phase2EndFrame: 8 });
  });
  it("searches ±15 frames for a finite position", () => {
    const sparse: (number | null)[] = new Array(40).fill(null);
    sparse[10] = 3;
    expect(nearestFinitePosition(sparse, 10)).toBe(3);
    expect(nearestFinitePosition(sparse, 20)).toBe(3);
    expect(nearestFinitePosition(sparse, 30)).toBeNull();
    expect(nearestFinitePosition(sparse, -1)).toBeNull();
  });
  it("reads frames from metadata first, then the rep document", () => {
    expect(shuttleFramesFrom({ startFrame: 4, endFrame: "40" }, { startFrame: 1, apexFrame: 20 })).toEqual({ startFrame: 4, apexFrame: 20, phase1EndFrame: null, phase2EndFrame: null, endFrame: 40 });
  });
});

describe("shuttle metrics", () => {
  const original = { totalTime: null, totalDistance: 17, outboundDistance: 9, returnDistance: 8, avgBallDistance: 0.4 };
  it("derives every time from frames over fps, with percentages of the phase sum", () => {
    const { metrics, derived, notes } = deriveShuttleMetrics({
      frames: { startFrame: 100, phase1EndFrame: 220, apexFrame: 250, phase2EndFrame: 280, endFrame: 400 },
      fps: 120, original, comMeters: null, ballMeters: null, dribbling: false,
    });
    expect(metrics.totalTime).toBeCloseTo(2.5);
    expect(metrics.phase1Time).toBeCloseTo(1);
    expect(metrics.phase2Time).toBeCloseTo(0.5);
    expect(metrics.phase3Time).toBeCloseTo(1);
    expect(metrics.phase1Percent).toBeCloseTo(40);
    expect(metrics.phase2Percent).toBeCloseTo(20);
    expect(metrics.phase3Percent).toBeCloseTo(40);
    // No track: the original distances survive untouched.
    expect(metrics.totalDistance).toBe(17);
    expect(metrics.outboundDistance).toBe(9);
    expect(derived).not.toContain("totalDistance");
    expect(notes.some(note => /Distances kept/.test(note))).toBe(true);
  });
  it("nulls the times when the frames are not ordered, like the phone", () => {
    const { metrics } = deriveShuttleMetrics({
      frames: { startFrame: 100, phase1EndFrame: 90, apexFrame: 250, phase2EndFrame: 280, endFrame: 400 },
      fps: 120, original, comMeters: null, ballMeters: null, dribbling: false,
    });
    expect(metrics.totalTime).toBeCloseTo(2.5);
    expect(metrics.phase1Time).toBeNull();
    expect(metrics.phase2Percent).toBeNull();
  });
  it("nulls the total time without an end after the start", () => {
    const { metrics } = deriveShuttleMetrics({ frames: { startFrame: 10, phase1EndFrame: null, apexFrame: null, phase2EndFrame: null, endFrame: null }, fps: 120, original, comMeters: null, ballMeters: null, dribbling: false });
    expect(metrics.totalTime).toBeNull();
  });
  it("derives distances from the track at the start, apex and end frames", () => {
    const com = [0, 0.1, 2, 5, 8, 9.7, 9.9, 9.5, 7, 4, 1, 0.1, -0.1];
    const { metrics, derived } = deriveShuttleMetrics({
      frames: { startFrame: 0, phase1EndFrame: 5, apexFrame: 6, phase2EndFrame: 7, endFrame: 12 },
      fps: 10, original, comMeters: com, ballMeters: null, dribbling: false,
    });
    expect(metrics.outboundDistance).toBeCloseTo(9.9);
    expect(metrics.returnDistance).toBeCloseTo(10);
    expect(metrics.totalDistance).toBeCloseTo(19.9);
    expect(derived).toContain("totalDistance");
  });
  it("averages the ball-to-athlete gap for dribbling over the window", () => {
    const com = [0, 1, 2, 3, 4];
    const ball = [0.5, 1.5, null, 3.4, 4.1];
    const { metrics } = deriveShuttleMetrics({
      frames: { startFrame: 0, phase1EndFrame: 1, apexFrame: 2, phase2EndFrame: 3, endFrame: 4 },
      fps: 10, original, comMeters: com, ballMeters: ball, dribbling: true,
    });
    expect(metrics.avgBallDistance).toBeCloseTo((0.5 + 0.5 + 0.4 + 0.1) / 4);
    const kept = deriveShuttleMetrics({ frames: { startFrame: 0, phase1EndFrame: 1, apexFrame: 2, phase2EndFrame: 3, endFrame: 4 }, fps: 10, original, comMeters: com, ballMeters: null, dribbling: true });
    expect(kept.metrics.avgBallDistance).toBe(0.4);
  });
});

describe("the preview and the payload", () => {
  it("diffs numbers with a tolerance and everything else strictly", () => {
    const rows = diffFields({ a: 1, b: 2, c: "left", d: null }, { a: 1.00000000001, b: 3, c: "right", d: 4 }, ["a", "b", "c", "d", "e"]);
    expect(rows.map(row => row.changed)).toEqual([false, true, true, true, false]);
    expect(rows[4]).toEqual({ key: "e", before: null, after: null, changed: false });
  });
  it("formats by field kind", () => {
    expect(formatFieldValue("startFrame", 12)).toBe("12");
    expect(formatFieldValue("totalTime", 2.5)).toBe("2.500 s");
    expect(formatFieldValue("phase2Percent", 20)).toBe("20.0 %");
    expect(formatFieldValue("totalDistance", 19.9)).toBe("19.900 m");
    expect(formatFieldValue("gateStartSide", "left")).toBe("left");
    expect(formatFieldValue("anything", null)).toBe("—");
  });
  it("drops undefined fields, nulls non-finite numbers, and mirrors fields into metadata", () => {
    const payload = buildRevisionPayload({
      playerId: "p", repId: "r", drill: "changeOfDirection",
      fields: { totalTime: 2.5, endFrame: 400, avgBallDistance: undefined, totalDistance: Number.NaN },
      metadataExtras: { failedSteps: [], processingStatus: "complete" },
      annotations: { schemaVersion: 1 },
      note: "  fixed the end frame  ",
    });
    expect(payload.fields).toEqual({ totalTime: 2.5, endFrame: 400, totalDistance: null });
    expect(payload.metadata).toEqual({ totalTime: 2.5, endFrame: 400, totalDistance: null, failedSteps: [], processingStatus: "complete" });
    expect(payload.note).toBe("fixed the end frame");
  });
});

describe("recorded-rep foot edits", () => {
  it.each([ ["dribbling", "dribble_foot"], ["shooting", "strike_foot"] ])("exposes and seeds the %s foot, including an explicit clear", (drill, key) => {
    const spec = toolSpecFor(drill)!;
    expect(spec.stringFields?.find(field => field.key === key)?.options.map(option => option.value)).toEqual(["left", "right"]);
    expect(stringFieldValues(spec, { [key]: "right" }, { [key]: "left" })).toEqual({ [key]: "right" });
    expect(stringFieldValues(spec, {}, { [key]: "left" })).toEqual({ [key]: "left" });
    expect(stringFieldValues(spec, { [key]: null }, { [key]: "left" })).toEqual({ [key]: null });
    expect(stringFieldValues(spec, {}, {})).toEqual({ [key]: null });
    // Legacy values remain unchanged until the admin makes an explicit selection.
    expect(stringFieldValues(spec, { [key]: "unknown" }, {})).toEqual({ [key]: "unknown" });
  });

  it.each([ ["dribbling", "dribble_foot"], ["shooting", "strike_foot"] ])("saves, replaces, and clears %s foot in both documents", (drill, key) => {
    const spec = toolSpecFor(drill)!;
    for (const [before, after] of [[null, "left"], ["left", "right"], ["right", null]]) {
      const original = { [key]: before, totalTime: 4, totalDistance: 20, velocity: 25 };
      const preview = revisionPreviewFields({ spec, original, frames: {}, numbers: {}, strings: { [key]: after }, derivation: null, side: null, measurementsEdited: false });
      const diff = diffFields(original, preview, [...spec.frameFields, ...spec.numberFields, ...(spec.stringFields ?? [])].map(field => field.key));
      expect(diff.filter(row => row.changed)).toEqual([{ key, before, after, changed: true }]);
      expect(isLabelOnlyEdit(spec, diff, false)).toBe(true);
      const fields = Object.fromEntries(diff.filter(row => row.changed).map(row => [row.key, row.after]));
      const payload = buildRevisionPayload({ playerId: "p", repId: "r", drill, fields, metadataExtras: {}, annotations: null, note: "" });
      expect(payload.fields).toEqual({ [key]: after });
      expect(payload.metadata).toEqual({ [key]: after });
      expect(payload.annotations).toBeNull();
    }
  });

  it("preserves retained shuttle distances and the assigned foot while editing timing", () => {
    const spec = toolSpecFor("dribbling")!;
    const original = { dribble_foot: "left", totalTime: 3, totalDistance: 20, outboundDistance: 10, returnDistance: 10, markerDistance: 10, avgBallDistance: 0.4 };
    const frames = { startFrame: 0, phase1EndFrame: 50, apexFrame: 60, phase2EndFrame: 70, endFrame: 120 };
    const derivation = deriveShuttleMetrics({ frames, fps: 60, original, comMeters: null, ballMeters: null, dribbling: true });
    const preview = revisionPreviewFields({ spec, original, frames, numbers: {}, strings: { dribble_foot: "left" }, derivation, side: null, measurementsEdited: true });
    expect(preview).toMatchObject({ dribble_foot: "left", totalTime: 2, totalDistance: 20, outboundDistance: 10, returnDistance: 10, avgBallDistance: 0.4 });
    const diff = diffFields(original, preview, [...spec.numberFields, ...(spec.stringFields ?? [])].map(field => field.key));
    expect(diff.filter(row => row.changed).map(row => row.key)).not.toContain("dribble_foot");
    expect(isLabelOnlyEdit(spec, diff, true)).toBe(false);
  });

  it("keeps original shuttle metrics on a foot-only edit even when artifacts cannot reproduce them", () => {
    const spec = toolSpecFor("dribbling")!;
    const original = { dribble_foot: null, totalTime: 4, totalDistance: 20, phase1Time: 1.5, phase2Time: 1, phase3Time: 1.5 };
    const frames = { startFrame: null, phase1EndFrame: null, apexFrame: null, phase2EndFrame: null, endFrame: null };
    const derivation = deriveShuttleMetrics({ frames, fps: 60, original, comMeters: null, ballMeters: null, dribbling: true });
    expect(derivation.metrics.totalTime).toBeNull();
    const preview = revisionPreviewFields({ spec, original, frames, numbers: {}, strings: { dribble_foot: "right" }, derivation, side: "left", measurementsEdited: false });
    expect(preview).toMatchObject({ dribble_foot: "right", totalTime: 4, totalDistance: 20, phase1Time: 1.5, phase2Time: 1, phase3Time: 1.5 });
    expect(preview).not.toHaveProperty("gateStartSide");
  });

  it("saves new annotations with a foot change even when the aggregate measurements stay identical", () => {
    const spec = toolSpecFor("dribbling")!;
    const diff = diffFields({ dribble_foot: "left", totalTime: 4 }, { dribble_foot: "right", totalTime: 4 }, ["dribble_foot", "totalTime"]);
    expect(isLabelOnlyEdit(spec, diff, false)).toBe(true);
    expect(isLabelOnlyEdit(spec, diff, true)).toBe(false);
    const annotations = { com: [{ frame: 10, x: 0.2, y: 0.5 }] };
    const payload = buildRevisionPayload({ playerId: "p", repId: "r", drill: "dribbling", fields: { dribble_foot: "right" }, metadataExtras: {}, annotations: isLabelOnlyEdit(spec, diff, true) ? null : annotations, note: "" });
    expect(payload.annotations).toEqual(annotations);
  });

  it("preserves legacy phase metrics after a same-value or reverted frame edit followed by a foot edit", () => {
    const spec = toolSpecFor("dribbling")!;
    const original = { dribble_foot: null, startFrame: 0, endFrame: 240, totalTime: 4, phase1Time: 1.5, phase2Time: 1, phase3Time: 1.5 };
    const frames = { startFrame: 0, endFrame: 240, phase1EndFrame: null, apexFrame: null, phase2EndFrame: null };
    const initial = { frames, numbers: {}, comMarks: [], ballMarks: [], comSource: "none", ballSource: "none", sideOverride: "auto" };
    const changed = { ...initial, frames: { ...frames, endFrame: 300 } };
    expect(measurementInputsChanged(initial, changed)).toBe(true);
    const reverted = { ...changed, frames: { ...changed.frames, endFrame: 240 } };
    const sameValue = { ...initial, frames: { ...frames, startFrame: 0 } };
    const derivation = deriveShuttleMetrics({ frames, fps: 60, original, comMeters: null, ballMeters: null, dribbling: true });
    expect(derivation.metrics.phase1Time).toBeNull();
    for (const current of [sameValue, reverted]) {
      const measurementsEdited = measurementInputsChanged(initial, current);
      expect(measurementsEdited).toBe(false);
      const preview = revisionPreviewFields({ spec, original, frames: current.frames, numbers: {}, strings: { dribble_foot: "left" }, derivation, side: null, measurementsEdited });
      expect(preview).toMatchObject({ dribble_foot: "left", phase1Time: 1.5, phase2Time: 1, phase3Time: 1.5 });
    }
  });

  it("compares annotation coordinates and numeric values rather than object references", () => {
    const initial = { frames: {}, numbers: { velocity: "25" }, comMarks: [{ frame: 1, x: 0.2, y: 0.5 }], ballMarks: [], comSource: "annotated", ballSource: "none", sideOverride: "auto" };
    const equal = { ...initial, numbers: { velocity: "25.0" }, comMarks: [{ frame: 1, x: 0.2, y: 0.5 }] };
    expect(measurementInputsChanged(initial, equal)).toBe(false);
    expect(measurementInputsChanged(initial, { ...equal, comMarks: [{ frame: 1, x: 0.25, y: 0.5 }] })).toBe(true);
    expect(measurementInputsChanged(initial, { ...equal, sideOverride: "left" })).toBe(true);
  });
});

// MARK: - Kicks: the annotation range and the ball fit

import {
  DEFAULT_MARKER_LENGTH_METERS,
  KICK_FIT_WINDOW_FRAMES,
  defaultAnnotationRange,
  deriveContactFrame,
  deriveKickMetrics,
  kickArtifacts,
  linearFit,
  metersPerPixelFromCorners,
  resolveKickScale,
} from "./repTools";
import type { KickScale, Point } from "./repTools";

const shooting = toolSpecFor("shooting");
const cod = toolSpecFor("changeOfDirection");

describe("annotation range defaults", () => {
  it("covers the resting ball and the phone's fit window for a kick", () => {
    expect(defaultAnnotationRange(shooting, { contact_frame: 100 }, 500)).toEqual({ from: 90, to: 160 });
    expect(defaultAnnotationRange(shooting, { contact_frame: 5 }, 40)).toEqual({ from: 0, to: 40 });
    expect(defaultAnnotationRange(shooting, { contact_frame: null }, 500)).toEqual({ from: 0, to: 500 });
    expect(KICK_FIT_WINDOW_FRAMES).toBe(60);
  });
  it("uses start → end for the shuttle drills and the whole clip otherwise", () => {
    expect(defaultAnnotationRange(cod, { startFrame: 30, endFrame: 400 }, 900)).toEqual({ from: 30, to: 400 });
    expect(defaultAnnotationRange(cod, { startFrame: null, endFrame: null }, 900)).toEqual({ from: 0, to: 900 });
    expect(defaultAnnotationRange(cod, { startFrame: 400, endFrame: 30 }, 900)).toEqual({ from: 30, to: 400 });
    expect(defaultAnnotationRange(toolSpecFor("sprint"), { startFrame: 30 }, 200)).toEqual({ from: 0, to: 200 });
    expect(defaultAnnotationRange(null, {}, 10)).toEqual({ from: 0, to: 10 });
  });
});

describe("kick scale", () => {
  it("recomputes meters per pixel from the marker corners the way the phone does", () => {
    const square = [[100, 100], [200, 100], [200, 200], [100, 200]];
    expect(metersPerPixelFromCorners(square)).toBeCloseTo(DEFAULT_MARKER_LENGTH_METERS / 100, 9);
    expect(metersPerPixelFromCorners([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }], 0.1)).toBeCloseTo(0.002);
    expect(metersPerPixelFromCorners([[0, 0], [1, 1]])).toBeNull();
    expect(metersPerPixelFromCorners(square, 0)).toBeNull();
  });
  it("prefers metadata's m_per_px, then its marker corners, then reports unavailable", () => {
    expect(resolveKickScale({ m_per_px: 0.0021, frameWidth: 1920 }, 1080)).toEqual({ metersPerPixel: 0.0021, frameWidth: 1920, source: "metadata.m_per_px" });
    const fromCorners = resolveKickScale({ arucoMarkers: [{ cornersPixels: [[0, 0], [100, 0], [100, 100], [0, 100]] }], aruco_marker_length_m: 0.2 }, 1920);
    expect(fromCorners.metersPerPixel).toBeCloseTo(0.002);
    expect(fromCorners.frameWidth).toBe(1920);
    expect(fromCorners.source).toBe("metadata.arucoMarkers");
    expect(resolveKickScale({}, null)).toEqual({ metersPerPixel: null, frameWidth: null, source: "unavailable" });
  });
});

describe("kick contact and fit", () => {
  const still: Point = { x: 0.4, y: 0.8 };
  const track: (Point | null)[] = new Array(200).fill(null);
  for (let f = 90; f < 100; f++) track[f] = still;
  // From frame 100 the ball moves +0.01 in x and −0.005 in y per frame.
  for (let f = 100; f < 200; f++) track[f] = { x: 0.4 + 0.01 * (f - 99), y: 0.8 - 0.005 * (f - 99) };
  const scale: KickScale = { metersPerPixel: 0.002, frameWidth: 1920, source: "metadata.m_per_px" };

  it("finds the contact frame as the last frame the ball is at rest", () => {
    expect(deriveContactFrame(track, 90)).toBe(99);
    expect(deriveContactFrame(track, 150)).toBe(150);
    expect(deriveContactFrame(new Array(5).fill(still), 0)).toBeNull();
    expect(deriveContactFrame([], 0)).toBeNull();
  });
  it("fits a line", () => {
    expect(linearFit([0, 1, 2], [1, 3, 5])).toEqual({ slope: 2, intercept: 1 });
    expect(linearFit([2, 2], [1, 3])).toEqual({ slope: 0, intercept: 2 });
  });
  it("derives velocity and launch angle from the slope, scaled by the marker", () => {
    const { metrics, derived, fit, notes } = deriveKickMetrics({ ballTrack: track, contactFrame: 99, fps: 240, scale, original: { velocity: 1, launch_angle: 1 } });
    // 0.01 × 240 = 2.4 widths/s, 0.005 × 240 = 1.2 heights/s → hypot 2.683 → × 1920 px × 0.002 m/px.
    expect(fit).not.toBeNull();
    expect(fit!.vxNorm).toBeCloseTo(2.4);
    expect(fit!.vyNorm).toBeCloseTo(-1.2);
    expect(metrics.velocity).toBeCloseTo(Math.hypot(2.4, 1.2) * 1920 * 0.002, 6);
    expect(metrics.launch_angle).toBeCloseTo((Math.atan2(1.2, 2.4) * 180) / Math.PI, 6);
    expect(derived).toEqual(["velocity", "launch_angle"]);
    expect(fit!.resultsValid).toBe(true);
    expect(fit!.windowStart).toBe(99);
    expect(fit!.windowEnd).toBe(159);
    expect(fit!.samples).toBe(61);
    expect(notes).toEqual([]);
  });
  it("measures the launch angle against the direction of travel and reports that direction", () => {
    const forward = deriveKickMetrics({ ballTrack: track, contactFrame: 99, fps: 240, scale, original: {} });
    expect(forward.fit!.direction).toBe("left_to_right");
    const mirrored = track.map(point => (point ? { x: 1 - point.x, y: point.y } : null));
    const backward = deriveKickMetrics({ ballTrack: mirrored, contactFrame: 99, fps: 240, scale, original: {} });
    expect(backward.metrics.launch_angle).toBeCloseTo((Math.atan2(1.2, 2.4) * 180) / Math.PI, 6);
    expect(backward.metrics.velocity).toBeCloseTo(forward.metrics.velocity as number, 9);
    expect(backward.fit!.direction).toBe("right_to_left");
    expect(backward.notes.some(note => /right to left/.test(note))).toBe(true);
    // A ball kicked downward still gets a positive angle, as on the phone.
    const down = track.map(point => (point ? { x: point.x, y: 1.6 - point.y } : null));
    expect(deriveKickMetrics({ ballTrack: down, contactFrame: 99, fps: 240, scale, original: {} }).metrics.launch_angle).toBeCloseTo(26.565, 2);
  });
  it("respects the fit window", () => {
    const { fit } = deriveKickMetrics({ ballTrack: track, contactFrame: 99, fps: 240, windowFrames: 20, scale, original: {} });
    expect(fit!.windowEnd).toBe(119);
    expect(fit!.samples).toBe(21);
  });
  it("keeps the original velocity but derives the angle without a marker scale", () => {
    const { metrics, derived, notes } = deriveKickMetrics({ ballTrack: track, contactFrame: 99, fps: 240, scale: { metersPerPixel: null, frameWidth: 1920, source: "unavailable" }, original: { velocity: 22.5 } });
    expect(metrics.velocity).toBe(22.5);
    expect(metrics.launch_angle).toBeCloseTo(26.565, 2);
    expect(derived).toEqual(["launch_angle"]);
    expect(notes.some(note => /No marker scale/.test(note))).toBe(true);
  });
  it("nulls both values when the fitted speed exceeds the phone's 100 mph limit", () => {
    const { metrics, fit, notes } = deriveKickMetrics({ ballTrack: track, contactFrame: 99, fps: 240, scale: { ...scale, metersPerPixel: 0.02 }, original: { velocity: 22.5, launch_angle: 10 } });
    expect(metrics).toEqual({ velocity: null, launch_angle: null });
    expect(fit!.resultsValid).toBe(false);
    expect(notes.some(note => /validity limit/.test(note))).toBe(true);
  });
  it("keeps the originals with a note when there is no ball track or no contact frame", () => {
    expect(deriveKickMetrics({ ballTrack: null, contactFrame: 99, fps: 240, scale, original: { velocity: 22.5, launch_angle: 10 } })).toMatchObject({ metrics: { velocity: 22.5, launch_angle: 10 }, derived: [], fit: null });
    expect(deriveKickMetrics({ ballTrack: track, contactFrame: null, fps: 240, scale, original: { velocity: 22.5 } })).toMatchObject({ metrics: { velocity: 22.5 }, derived: [], fit: null });
    const sparse = deriveKickMetrics({ ballTrack: [still], contactFrame: 0, fps: 240, scale, original: {} });
    expect(sparse.metrics).toEqual({ velocity: null, launch_angle: null });
    expect(sparse.derived).toEqual(["velocity", "launch_angle"]);
  });
  it("rebuilds the ball artifacts the phone's viewer reads", () => {
    const built = kickArtifacts({ ballTrack: track, contactFrame: 99, transitionFrame: 40, direction: "left_to_right", windowEnd: 101, metrics: { velocity: 10, launch_angle: 26.6 }, resultsValid: true });
    expect(built["ball_trajectory.json"]).toMatchObject({ t_values: [99, 100, 101], contact_frame: 99, transition_frame: 40, direction: "left_to_right" });
    expect(built["ball_trajectory.json"].x_values.map((v: number) => Number(v.toFixed(6)))).toEqual([0.4, 0.41, 0.42]);
    expect(built["ball_trajectory.json"].y_values.map((v: number) => Number(v.toFixed(6)))).toEqual([0.8, 0.795, 0.79]);
    expect(built["ball_information.json"].ball_speed_ms).toBe(10);
    expect(built["ball_information.json"].ball_speed_mph).toBeCloseTo(22.369, 3);
    expect(built["ball_information.json"].contact_frame).toBe(99);
    const invalid = kickArtifacts({ ballTrack: track, contactFrame: 99, transitionFrame: null, direction: null, windowEnd: 100, metrics: { velocity: null, launch_angle: null }, resultsValid: false });
    expect(invalid["ball_information.json"]).toEqual({ ball_speed_ms: null, ball_speed_mph: null, launch_angle: null, contact_frame: null });
  });
  it("puts the fitted values, not the typed ones, into the preview", () => {
    const kick = deriveKickMetrics({ ballTrack: track, contactFrame: 99, fps: 240, scale, original: { velocity: 1, launch_angle: 1 } });
    const preview = revisionPreviewFields({ spec: shooting, original: { velocity: 1, launch_angle: 1, contact_frame: 90 }, frames: { contact_frame: 99, transition_frame: null }, numbers: { velocity: "5", launch_angle: "5" }, strings: { strike_foot: null }, derivation: null, kick, side: null, measurementsEdited: true });
    expect(preview.velocity).toBeCloseTo(kick.metrics.velocity as number);
    expect(preview.contact_frame).toBe(99);
    expect(preview.strike_foot).toBeNull();
    expect(preview.direction).toBe("left_to_right");
  });
  it("counts a changed fit window as a measurement edit", () => {
    const base = { frames: {}, numbers: {}, comMarks: [], ballMarks: [], comSource: "none", ballSource: "none", sideOverride: "auto", window: 60 };
    expect(measurementInputsChanged(base, { ...base })).toBe(false);
    expect(measurementInputsChanged(base, { ...base, window: 30 })).toBe(true);
  });
});
