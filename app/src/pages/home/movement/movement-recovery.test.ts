import { afterEach, describe, expect, it, vi } from "vitest";
import { calibrationGridLines, createMovementController, measurementForFrame, type MovementNodes } from "./RecoveredMovement.js";
import recordings from "./recorded-movement.json";
import provenance from "./reference-provenance.json";
import reconstructedPose from "../latest-hero/shooting-pose.json";
import { BALL_POSITION, BALL_RADIUS, POSE_EDGES, SHOOTING_POSE, SUPPORT_FOOT } from "../latest-hero/pose-model";
import type { PoseDemoData } from "../pose-demo";

const canonicalHash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value))))).map(byte => byte.toString(16).padStart(2, "0")).join("");

describe("accepted deployment recording fidelity", () => {
  it("preserves every captured frame, calibration, telemetry value and provenance field", async () => {
    expect(await canonicalHash(recordings)).toBe(provenance.movementDataSha256);
    expect(await canonicalHash(reconstructedPose)).toBe(provenance.reconstructedPoseSha256);
    expect(recordings.sequences.map(sequence => sequence.frames.length)).toEqual([75, 71, 83, 225, 282, 91]);
    expect(recordings.sequences.map(sequence => sequence.calibration?.markers.length ?? 0)).toEqual([2, 0, 0, 2, 0, 1]);
  });

  it("keeps units and the distinction between model, measured and missing values", () => {
    const sprint = recordings.sequences[0];
    expect(measurementForFrame(sprint, 0)).toEqual({ label: "Player speed", value: "3.6", unit: "mph", caption: "Model estimate · this frame" });
    expect(measurementForFrame({ key: "shooting", telemetry: { speed: { subject: "ball", metersPerSecond: [null, .44704] } } }, 0)).toEqual({ label: "Ball speed", value: "—", unit: "mph", caption: "Not available at this frame" });
    expect(measurementForFrame({ key: "shooting", telemetry: { speed: { subject: "ball", metersPerSecond: [null, .44704] } } }, 1)).toEqual({ label: "Ball speed", value: "1.0", unit: "mph", caption: "Measured · this frame" });
    const jump = recordings.sequences[1];
    const apex = jump.verticalJump!.heightMeters.indexOf(Math.max(...jump.verticalJump!.heightMeters));
    expect(measurementForFrame(jump, apex)).toEqual({ label: "COM rise", value: "21.8", unit: "in", caption: "Calibrated height" });
  });

  it("projects supplied calibration grids, leaves absent grids absent, and rejects singular or excessive grids", () => {
    const grid = { homography: [1, 0, 0, 0, 1, 0, 0, 0, 1], xRange: [0, 1], yRange: [0, 1], stepMeters: 1 };
    expect(calibrationGridLines(undefined)).toEqual([]);
    expect(calibrationGridLines({ homography: [1, 0, 0, 0, 1, 0, 0, 0, 1], xRange: [0, 1], yRange: [0, 1], stepMeters: 1 })).toEqual([[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0], [1, 0]], [[0, 1], [1, 1]]]);
    expect(calibrationGridLines({ ...grid, homography: Array(9).fill(0) })).toEqual([]);
    expect(calibrationGridLines({ ...grid, stepMeters: .000001 })).toEqual([]);
  });

  it("uses the newer reconstructed left-footed pose and support-foot ground location", () => {
    expect(SHOOTING_POSE).toHaveLength(33);
    expect(SHOOTING_POSE.every(point => point.length === 3 && point.every(Number.isFinite))).toBe(true);
    expect(reconstructedPose.reconstruction.method).toBe("temporal-median-bilateral-length-fit");
    expect(reconstructedPose.shootingFoot).toBe("left");
    expect(BALL_POSITION).toEqual([-.24619, .15896, .38557]);
    expect(BALL_RADIUS).toBe(.15896);
    expect(SUPPORT_FOOT).toEqual([(SHOOTING_POSE[30][0] + SHOOTING_POSE[32][0]) / 2, 0, (SHOOTING_POSE[30][2] + SHOOTING_POSE[32][2]) / 2]);
    for (const [from, to] of POSE_EDGES) expect(SHOOTING_POSE[from]).not.toEqual(SHOOTING_POSE[to]);
  });
});

function playbackFixture(reduced = false) {
  let visible: (entries: { isIntersecting: boolean }[]) => void = () => {};
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const context = new Proxy({ measureText: () => ({ width: 30 }) }, { get: (object, key) => key in object ? object[key as keyof typeof object] : () => {} });
  const node = () => ({ textContent: "", dataset: {}, style: { setProperty: vi.fn() }, setAttribute: vi.fn() });
  const canvas = { ...node(), width: 0, height: 0, getContext: () => context, getBoundingClientRect: () => ({ width: 640, height: 360 }), animate: vi.fn() };
  const playIcon = { ...node(), textContent: "SVG icons" };
  const measurementValue = node();
  const scrubber = { ...node(), value: "0", max: "1" };
  const intersectionDisconnect = vi.fn(), resizeDisconnect = vi.fn();
  const media = { matches: reduced, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const documentState = { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal("window", { matchMedia: () => media, devicePixelRatio: 1 });
  vi.stubGlobal("document", documentState);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callbacks.set(++nextId, callback); return nextId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: typeof visible) { visible = callback; } observe() {} disconnect() { intersectionDisconnect(); } });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() { resizeDisconnect(); } });
  const data: PoseDemoData = { version: 3, layout: "mediapipe33", fps: 10, sourceAspectRatio: 16 / 9, autoAdvance: true, sequences: ["sprint", "shooting"].map(key => ({ key, title: key, label: key, frames: [[], []], markers: {}, metrics: [] })) };
  const changed = vi.fn();
  const controller = createMovementController(data, { canvas, playIcon, playButton: node(), scrubber, timer: node(), phaseChip: node(), measurementValue } as unknown as MovementNodes, changed)!;
  visible([{ isIntersecting: true }]);
  let time = 1;
  const advance = (ms: number) => { for (let elapsed = 0; elapsed < ms; elapsed += 50) { time += 50; const pending = [...callbacks.values()]; callbacks.clear(); pending.forEach(callback => callback(time)); } };
  return { controller, changed, advance, playIcon, canvas, callbacks, scrubber, setVisible: (value: boolean) => visible([{ isIntersecting: value }]), intersectionDisconnect, resizeDisconnect, media, documentState };
}

afterEach(() => vi.unstubAllGlobals());

describe("recovered movement playback lifecycle", () => {
  it("wraps automatically, suspends offscreen and while inactive, and releases observers", () => {
    const f = playbackFixture();
    f.advance(900); expect(f.changed.mock.lastCall).toEqual([1]);
    f.advance(900); expect(f.changed.mock.lastCall).toEqual([0]);
    f.setVisible(false); expect(f.callbacks.size).toBe(0);
    const count = f.changed.mock.calls.length;
    f.advance(2000); expect(f.changed).toHaveBeenCalledTimes(count);
    f.setVisible(true); expect(f.callbacks.size).toBe(1);
    f.controller.setActive(false); expect(f.callbacks.size).toBe(0);
    f.controller.setActive(true); expect(f.callbacks.size).toBe(1);
    f.controller.destroy();
    expect(f.callbacks.size).toBe(0);
    expect(f.intersectionDisconnect).toHaveBeenCalledOnce();
    expect(f.resizeDisconnect).toHaveBeenCalledOnce();
    expect(f.media.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    expect(f.documentState.removeEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });

  it("retains user pause on carousel navigation and scrub, then resumes explicitly", () => {
    const f = playbackFixture();
    f.controller.togglePlay(); f.controller.stepSequence(-1);
    expect(f.changed.mock.lastCall).toEqual([1]);
    f.advance(2000); expect(f.changed.mock.lastCall).toEqual([1]);
    expect(f.playIcon.dataset).toEqual({ playing: "false" });
    f.controller.scrub(1); expect(f.scrubber.value).toBe("1");
    f.controller.togglePlay(); expect(f.playIcon.dataset).toEqual({ playing: "true" });
    f.advance(900); expect(f.changed.mock.lastCall).toEqual([0]);
    expect(f.playIcon.textContent).toBe("SVG icons");
    f.controller.destroy();
  });

  it("requires explicit play under reduced motion and suppresses slide effects", () => {
    const f = playbackFixture(true);
    f.advance(2000); expect(f.changed).toHaveBeenCalledTimes(1);
    f.controller.stepSequence(1); expect(f.canvas.animate).not.toHaveBeenCalled();
    expect(f.callbacks.size).toBe(0);
    f.controller.togglePlay(); expect(f.callbacks.size).toBe(1);
    f.controller.destroy();
  });
});
