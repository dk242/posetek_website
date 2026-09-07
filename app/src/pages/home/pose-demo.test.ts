import { describe, expect, it } from "vitest";
import poseDemoData from "./landing-pose-demo-data.json";
import {
  END_HOLD_MS,
  INITIAL_VIEWPORT,
  MAX_FRAME_DELTA_MS,
  MEDIAPIPE33_EDGES,
  advanceFrame,
  backingStoreSize,
  broadJumpLabelY,
  changeOfDirectionPhaseRanges,
  clampFrame,
  fitViewport,
  formatTime,
  frameDelta,
  hipCenter,
  isPoseDemoData,
  lastFrameIndex,
  mapPoint,
  marker,
  phaseChipText,
  phaseForBroadJump,
  phaseForChangeOfDirection,
  phaseForFrame,
  restingFrame,
  scrubberValueText,
  telemetryFor,
  timerText,
  totalSeconds,
  trailRange,
  validPoint,
  wrapSequenceIndex,
  type PoseDemoData,
  type PoseSequence,
} from "./pose-demo";

const DATA: PoseDemoData = poseDemoData;
const SIXTEEN_NINE = 16 / 9;

function sequence(overrides: Partial<PoseSequence>): PoseSequence {
  return { key: "changeOfDirection", title: "", label: "", frames: [], markers: {}, metrics: [], ...overrides };
}

const COD = sequence({
  key: "changeOfDirection",
  frames: new Array(282).fill([]),
  markers: { start: 0, startEnd: 119, turn: 148, turnEnd: 184, end: 281 },
  metrics: [["Start", "1.99 s"], ["Turn", "1.08 s"], ["End", "1.61 s"], ["Total", "4.68 s"]],
});

const BROAD_JUMP = sequence({
  key: "broadJump",
  frames: new Array(83).fill([]),
  markers: { takeoff: 30, landing: 52 },
  metrics: [["Distance", "6.22 ft"], ["Flight", "0.37 s"], ["Takeoff", "0.50 s"], ["Landing", "0.87 s"]],
});

describe("isPoseDemoData", () => {
  it("accepts the mediapipe33 layout with a sequences array", () => {
    expect(isPoseDemoData({ layout: "mediapipe33", sequences: [] })).toBe(true);
  });

  it("rejects what the legacy guard rejected", () => {
    expect(isPoseDemoData(null)).toBe(false);
    expect(isPoseDemoData(undefined)).toBe(false);
    expect(isPoseDemoData({ layout: "coco17", sequences: [] })).toBe(false);
    expect(isPoseDemoData({ layout: "mediapipe33", sequences: "nope" })).toBe(false);
  });
});

describe("formatTime", () => {
  it("formats m:ss.ss with zero padding", () => {
    expect(formatTime(0)).toBe("0:00.00");
    expect(formatTime(4.6833)).toBe("0:04.68");
    expect(formatTime(65.5)).toBe("1:05.50");
    expect(formatTime(9.999)).toBe("0:10.00");
  });

  it("clamps negatives and NaN to zero", () => {
    expect(formatTime(-3)).toBe("0:00.00");
    expect(formatTime(Number.NaN)).toBe("0:00.00");
  });
});

describe("fitViewport", () => {
  it("letterboxes a wide canvas horizontally", () => {
    const view = fitViewport(1000, 450, 1, SIXTEEN_NINE);
    expect(view.scale).toBe(450);
    expect(view.offsetX).toBeCloseTo(100, 10);
    expect(view.offsetY).toBe(0);
    expect(view.ratio).toBe(1);
  });

  it("letterboxes a tall canvas vertically", () => {
    const view = fitViewport(800, 900, 1, SIXTEEN_NINE);
    expect(view.scale).toBe(450);
    expect(view.offsetX).toBeCloseTo(0, 10);
    expect(view.offsetY).toBe(225);
  });

  it("caps the device pixel ratio at 2 and falls back to 1", () => {
    expect(fitViewport(100, 100, 3, SIXTEEN_NINE).ratio).toBe(2);
    expect(fitViewport(100, 100, 0, SIXTEEN_NINE).ratio).toBe(1);
  });

  it("never lets the CSS box collapse below 1px", () => {
    const view = fitViewport(0, 0, 1, SIXTEEN_NINE);
    expect(view.width).toBe(1);
    expect(view.height).toBe(1);
  });

  it("rounds the backing store to whole pixels", () => {
    expect(backingStoreSize(fitViewport(333.4, 187.6, 2, SIXTEEN_NINE))).toEqual({ width: 667, height: 375 });
  });
});

describe("mapPoint", () => {
  const view = { ...INITIAL_VIEWPORT, width: 1000, height: 450, scale: 450, offsetX: 100, offsetY: 0 };

  it("maps normalized source points into the letterboxed content box", () => {
    expect(mapPoint([0.5, 0.5], view, SIXTEEN_NINE)).toEqual({ x: 500, y: 225 });
    expect(mapPoint([0, 0], view, SIXTEEN_NINE)).toEqual({ x: 100, y: 0 });
    expect(mapPoint([1, 1], view, SIXTEEN_NINE)).toEqual({ x: 900, y: 450 });
  });

  it("returns null for missing or non-finite points", () => {
    expect(mapPoint(null, view, SIXTEEN_NINE)).toBeNull();
    expect(mapPoint(undefined, view, SIXTEEN_NINE)).toBeNull();
    expect(mapPoint([Number.NaN, 0.2], view, SIXTEEN_NINE)).toBeNull();
    expect(mapPoint([0.2, Number.POSITIVE_INFINITY], view, SIXTEEN_NINE)).toBeNull();
  });
});

describe("validPoint / hipCenter", () => {
  it("returns the landmark only when it is an array", () => {
    expect(validPoint([[0.1, 0.2], null], 0)).toEqual([0.1, 0.2]);
    expect(validPoint([[0.1, 0.2], null], 1)).toBeNull();
    expect(validPoint([[0.1, 0.2]], 5)).toBeNull();
    expect(validPoint(undefined, 0)).toBeNull();
  });

  it("averages landmarks 23 and 24", () => {
    const frame = new Array(33).fill(null);
    frame[23] = [0.2, 0.4];
    frame[24] = [0.4, 0.8];
    expect(hipCenter(frame)).toEqual([0.30000000000000004, 0.6000000000000001]);
  });

  it("is null when either hip is missing", () => {
    const frame = new Array(33).fill(null);
    frame[23] = [0.2, 0.4];
    expect(hipCenter(frame)).toBeNull();
    expect(hipCenter(undefined)).toBeNull();
  });
});

describe("phase lookup", () => {
  it("splits change of direction at the inclusive startEnd / turnEnd markers", () => {
    expect(phaseForChangeOfDirection(COD, 0)).toEqual({ title: "Start", color: "#66c2ff" });
    expect(phaseForChangeOfDirection(COD, 119)).toEqual({ title: "Start", color: "#66c2ff" });
    expect(phaseForChangeOfDirection(COD, 120)).toEqual({ title: "Turn", color: "#ffc969" });
    expect(phaseForChangeOfDirection(COD, 184)).toEqual({ title: "Turn", color: "#ffc969" });
    expect(phaseForChangeOfDirection(COD, 185)).toEqual({ title: "End", color: "#71d39b" });
  });

  it("splits the broad jump before takeoff (exclusive) and through landing (inclusive)", () => {
    expect(phaseForBroadJump(BROAD_JUMP, 29)).toEqual({ title: "Load", color: "#66c2ff" });
    expect(phaseForBroadJump(BROAD_JUMP, 30)).toEqual({ title: "Flight", color: "#b7f34a" });
    expect(phaseForBroadJump(BROAD_JUMP, 52)).toEqual({ title: "Flight", color: "#b7f34a" });
    expect(phaseForBroadJump(BROAD_JUMP, 53)).toEqual({ title: "Landing", color: "#ffc969" });
  });

  it("reads a marker the sequence does not carry as NaN, so every comparison is false like legacy undefined", () => {
    expect(marker(COD, "startEnd")).toBe(119);
    expect(marker(COD, "takeoff")).toBeNaN();
    const bare = sequence({ markers: {} });
    expect(phaseForChangeOfDirection(bare, 0).title).toBe("End");
    expect(phaseForBroadJump(bare, 0).title).toBe("Landing");
  });

  it("dispatches on the sequence key", () => {
    expect(phaseForFrame(BROAD_JUMP, 0).title).toBe("Load");
    expect(phaseForFrame(COD, 0).title).toBe("Start");
  });

  it("builds the three hip-trail ranges from the markers", () => {
    expect(changeOfDirectionPhaseRanges(COD)).toEqual([
      { start: 0, end: 119, color: "#66c2ff" },
      { start: 120, end: 184, color: "#ffc969" },
      { start: 185, end: 281, color: "#71d39b" },
    ]);
  });
});

describe("label text", () => {
  it("renders the timer as elapsed / total", () => {
    expect(timerText(0, COD, 60)).toBe("0:00.00 / 0:04.68");
    expect(timerText(148, COD, 60)).toBe("0:02.47 / 0:04.68");
    expect(timerText(82, BROAD_JUMP, 60)).toBe("0:01.37 / 0:01.37");
  });

  it("never reports a negative total for an empty sequence", () => {
    expect(totalSeconds(sequence({ frames: [] }), 60)).toBe(0);
  });

  it("renders the phase chip and aria-valuetext", () => {
    const phase = { title: "Start", color: "#66c2ff" };
    expect(phaseChipText(phase, 0)).toBe("Start · 0.00 s");
    expect(phaseChipText(phase, 2.4666)).toBe("Start · 2.47 s");
    expect(scrubberValueText(phase, 2.4666)).toBe("Start, 2.47 seconds");
  });
});

describe("sequence selection", () => {
  it("wraps the sequence index in both directions", () => {
    expect(wrapSequenceIndex(2, 2)).toBe(0);
    expect(wrapSequenceIndex(1, 2)).toBe(1);
    expect(wrapSequenceIndex(-1, 2)).toBe(1);
  });

  it("rests on frame 0 unless reduced motion without autoplay", () => {
    expect(restingFrame(COD, false, false)).toBe(0);
    expect(restingFrame(COD, true, true)).toBe(0);
    expect(restingFrame(COD, true, false)).toBe(148); // markers.turn
    expect(restingFrame(BROAD_JUMP, true, false)).toBe(30); // markers.takeoff
  });

  it("derives the telemetry drill / result / result label", () => {
    expect(telemetryFor(COD)).toEqual({ drill: "Agility", result: "4.68 s", resultLabel: "Total" });
    expect(telemetryFor(BROAD_JUMP)).toEqual({ drill: "Broad jump", result: "6.22 ft", resultLabel: "Distance" });
  });

  it("clamps scrubber input to the frame range", () => {
    expect(clampFrame("7", 10)).toBe(7);
    expect(clampFrame("15", 10)).toBe(10);
    expect(clampFrame("-3", 10)).toBe(0);
    expect(clampFrame("abc", 10)).toBe(0);
    expect(clampFrame("", 10)).toBe(0);
  });
});

describe("frame timing", () => {
  it("caps the frame delta at 100ms", () => {
    expect(MAX_FRAME_DELTA_MS).toBe(100);
    expect(frameDelta(1016, 1000)).toBe(16);
    expect(frameDelta(1250, 1000)).toBe(100);
  });

  it("holds the last frame for 650ms", () => {
    expect(END_HOLD_MS).toBe(650);
  });

  it("accumulates fractional frames at 60fps", () => {
    const first = advanceFrame(0, 0, 10, 60, 281);
    expect(first).toEqual({ accumulator: 0.6, frame: 0, advanced: false });
    const second = advanceFrame(first.frame, first.accumulator, 10, 60, 281);
    expect(second.advanced).toBe(true);
    expect(second.frame).toBe(1);
    expect(second.accumulator).toBeCloseTo(0.2, 10);
  });

  it("advances several frames after a long delta and clamps at the last frame", () => {
    expect(advanceFrame(0, 0, 100, 60, 281)).toEqual({ accumulator: 0, frame: 6, advanced: true });
    expect(advanceFrame(280, 0, 100, 60, 281).frame).toBe(281);
  });
});

describe("overlay geometry", () => {
  it("trails the last 24 frames", () => {
    expect(trailRange(5)).toEqual({ start: 0, end: 6 });
    expect(trailRange(100)).toEqual({ start: 76, end: 101 });
  });

  it("keeps the distance label above the ground line but below the top edge", () => {
    expect(broadJumpLabelY(10, 100)).toBe(83);
    expect(broadJumpLabelY(10, 20)).toBe(32);
  });

  it("draws 26 skeleton edges inside the 33-landmark layout", () => {
    expect(MEDIAPIPE33_EDGES).toHaveLength(26);
    MEDIAPIPE33_EDGES.forEach(([a, b]) => {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(33);
    });
  });
});

describe("bundled demo data", () => {
  it("is the mediapipe33 recording the legacy page shipped", () => {
    expect(isPoseDemoData(DATA)).toBe(true);
    expect(DATA.fps).toBe(60);
    expect(DATA.sourceAspectRatio).toBeCloseTo(SIXTEEN_NINE, 12);
    expect(DATA.sequences.map(item => item.key)).toEqual(["changeOfDirection", "broadJump"]);
    DATA.sequences.forEach(item => item.frames.forEach(frame => expect(frame).toHaveLength(33)));
  });

  it("reproduces the legacy static markup for the first sequence", () => {
    const first = DATA.sequences[0];
    expect(first.title).toBe("Change of Direction");
    expect(first.label).toBe("Agility · recorded rep");
    expect(lastFrameIndex(first)).toBe(281); // <input max="281">
    expect(timerText(0, first, DATA.fps)).toBe("0:00.00 / 0:04.68");
    expect(phaseChipText(phaseForFrame(first, 0), 0)).toBe("Start · 0.00 s");
    expect(first.metrics).toEqual([["Start", "1.99 s"], ["Turn", "1.08 s"], ["End", "1.61 s"], ["Total", "4.68 s"]]);
    expect(telemetryFor(first)).toEqual({ drill: "Agility", result: "4.68 s", resultLabel: "Total" });
  });

  it("carries the broad-jump overlays the canvas needs", () => {
    const jump = DATA.sequences[1];
    expect(jump.overlays).toBeDefined();
    expect(jump.overlays?.com).toHaveLength(jump.frames.length);
    expect(jump.overlays?.foot).toHaveLength(jump.frames.length);
    expect(jump.markers).toEqual({ takeoff: 30, landing: 52 });
    expect(telemetryFor(jump)).toEqual({ drill: "Broad jump", result: "6.22 ft", resultLabel: "Distance" });
  });
});
