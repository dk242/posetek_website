import { describe, expect, it } from "vitest";
import { contentRect, frameAtTime, poseFrames, poseTimeline } from "./pose-playback";

describe("pose coordinate contract", () => {
  it("uses COCO confidence while retaining MediaPipe depth and legacy coordinates", () => {
    expect(poseFrames([Array.from({ length: 17 }, () => [.2, .3, .01])])[0].every(point => point.x === null)).toBe(true);
    expect(poseFrames([[[.2, .3, .01]]], { keypointLayout: "coco17" })[0][0].x).toBeNull();
    expect(poseFrames([[[.2, .3, -.5]]], { keypointLayout: "mediapipe33" })[0][0].x).toBe(.2);
    expect(poseFrames([[[.2, .3]]])[0][0].x).toBe(.2);
    for (const visibility of [null, false, "", NaN, Infinity, 1.1]) {
      expect(poseFrames([[[.2, .3, 0, visibility], { x: .2, y: .3, visibility }]])[0].every(point => point.x === null)).toBe(true);
    }
  });
  it("invalid and invisible points cannot create upper-left lines", () => {
    const points = poseFrames([[[null, null], ["", .2], [false, .2], [.2, .3, 0, .01], [-.1, .5], [1.1, .5], [0, 0, 0, 1]]])[0];
    for (const point of points.slice(0, -1)) expect(point.x).toBeNull();
    expect(points.at(-1)).toMatchObject({ x: 0, y: 0 });
  });
  it("normalizes declared pixel coordinates and preserves empty frames", () => {
    expect(poseFrames({ frames: [{ landmarks: [{ x: 320, y: 180, confidence: .9 }] }, null] },
      { coordinateSpace: "pixels", videoWidth: 640, videoHeight: 360 })).toEqual([[{ x: .5, y: .5, visibility: .9 }], []]);
    expect(poseFrames([[[320, 180]]])[0][0].x).toBeNull();
    expect(poseFrames([[[320, 180]]], { coordinateSpace: "pixels" })[0][0].x).toBeNull();
  });
  it("letterboxes the same content rectangle as object-fit contain", () => {
    expect(contentRect(400, 300, 1920, 1080)).toEqual({ x: 0, y: 37.5, width: 400, height: 225 });
    expect(contentRect(400, 300, 1080, 1920)).toEqual({ x: 115.625, y: 0, width: 168.75, height: 300 });
  });
});
describe("pose timing contract", () => {
  it.each([30, 60, 120])("uses declared %i fps, never video-duration stretching", fps => {
    const clock = poseTimeline({ framesPerSecond: fps, videoStartTimeSeconds: 2 }, fps + 1);
    expect(clock.times[0]).toBe(2); expect(clock.times.at(-1)).toBe(3);
    expect(frameAtTime(clock, 2.5)).toBe(fps / 2); expect(frameAtTime(clock, 100)).toBe(fps);
  });
  it("prefers validated per-frame timestamps for variable frame rate", () => {
    const clock = poseTimeline({ frameTimestampsSeconds: [0, .01, .06, .09], framesPerSecond: 120 }, 4);
    expect(clock.source).toBe("timestamps"); expect(frameAtTime(clock, .05)).toBe(1); expect(frameAtTime(clock, .06)).toBe(2);
  });
  it("accepts native millisecond PTS without rebasing or discarding dropped-frame slots", () => {
    const clock = poseTimeline({ frameTimestampsMs: [1500, 1510, 1560, 1590], fps: 120 }, 4);
    expect(clock.times).toEqual([1.5, 1.51, 1.56, 1.59]);
    expect(frameAtTime(clock, 1.55)).toBe(1);
    expect(poseTimeline({ frameTimestampsMs: [0, 86400001] }, 2).source).toBe("unavailable");
    expect(poseTimeline({ frameTimestampsMs: [0, 0] }, 2).source).toBe("unavailable");
  });
  it("rejects missing/invalid timing without inventing 30 or 120 fps", () => {
    for (const meta of [{}, { fps: 0 }, { fps: -1 }, { fps: false }, { frameTimestamps: [0, null] }, { frameTimestamps: [1, 0] }]) expect(poseTimeline(meta, 2).source).toBe("unavailable");
    expect(frameAtTime(poseTimeline({}, 0), 10)).toBe(0);
  });
});
