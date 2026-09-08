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
  nearestFinitePosition,
  parseArtifactJson,
  resolveClipTiming,
  resolveGate,
  shuttleFramesFrom,
  signedMeters,
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
