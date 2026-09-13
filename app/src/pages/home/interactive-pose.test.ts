import { describe, expect, it } from "vitest";
import { phaseForFrame, restingFrame, telemetryFor, totalSeconds, type PoseDemoData, type PoseSequence } from "./pose-demo";
import { POSE_EDGES, STANDING_POSE } from "./pitch/pose-model";
import thumbnails from "./pose-thumbnails.json";
import recordings from "./pose-recordings.json";
import data from "./landing-pose-demo-data.json";

describe("interactive pose", () => {
  it("draws 33 finite landmarks with valid, nonzero bone connections", () => {
    expect(STANDING_POSE).toHaveLength(33);
    expect(STANDING_POSE.every(point => point.length === 3 && point.every(Number.isFinite))).toBe(true);
    for (const [a,b] of POSE_EDGES) {
      expect(STANDING_POSE[a]).toBeDefined(); expect(STANDING_POSE[b]).toBeDefined();
      expect(STANDING_POSE[a]).not.toEqual(STANDING_POSE[b]);
    }
  });
  it("only links cards to recordings that are actually bundled", () => {
    expect([...recordings].sort()).toEqual(data.sequences.map(sequence=>sequence.key).sort());
  });
  it("keeps all six clips finite, playable and within their recorded timing", () => {
    const clips: PoseDemoData = data;
    expect(clips.autoAdvance).toBe(false);
    for (const sequence of clips.sequences) {
      const fps = sequence.fps ?? clips.fps;
      expect(fps).toBeGreaterThan(0);
      expect(totalSeconds(sequence, fps)).toBeGreaterThan(1);
      expect(totalSeconds(sequence, fps)).toBeLessThan(8);
      expect(restingFrame(sequence, true, false)).toBeLessThan(sequence.frames.length);
      for (const frame of sequence.frames) {
        expect(frame).toHaveLength(33);
        for (const point of frame) if (point) {
          expect(point).toHaveLength(2);
          expect(point.every(Number.isFinite)).toBe(true);
        }
      }
      for (const phase of sequence.phases ?? []) expect(phase.from).toBeLessThan(sequence.frames.length);
      if (sequence.ball) {
        expect(sequence.ball).toHaveLength(sequence.frames.length);
        for (const ball of sequence.ball) if (ball) expect(ball.radius).toBeGreaterThan(0);
      }
    }
    expect(JSON.stringify(clips)).not.toMatch(/https?:|token=|playerDocId|repId|@|Spadorcio/);
  });
  it("reports the selected new drill's result instead of an agility result", () => {
    expect(telemetryFor(data.sequences[0])).toEqual({drill:"Sprint",result:"12.5 mph",resultLabel:"Top speed"});
  });
  const clip: PoseSequence = { key:"shooting", title:"Shooting", label:"Recorded rep", frames:Array.from({length:90},()=>[]), markers:{}, metrics:[] };
  it("does not invent agility phases for a different drill", () => {
    expect(phaseForFrame(clip,45).title).toBe("Recorded movement");
    const withPhases = { ...clip, phases:[{from:0,title:"Approach",color:"blue"},{from:45,title:"Strike",color:"lime"}] };
    expect(phaseForFrame(withPhases,44).title).toBe("Approach");
    expect(phaseForFrame(withPhases,45).title).toBe("Strike");
  });
  it("keeps a new drill's reduced-motion resting frame inside the clip", () => {
    expect(restingFrame(clip,true,false)).toBe(44);
    expect(restingFrame({...clip,previewFrame:52},true,false)).toBe(52);
    expect(restingFrame({...clip,previewFrame:900},true,false)).toBe(89);
    expect(restingFrame({...clip,previewFrame:52},true,true)).toBe(0);
  });
});

describe("recording fidelity", () => {
  const clips: PoseDemoData = data;
  it("uses actual recording frames for all six card snapshots", () => {
    for (const sequence of clips.sequences) {
      const snapshot = thumbnails[sequence.key as keyof typeof thumbnails];
      expect(snapshot.points).toEqual(sequence.frames[snapshot.frameIndex]);
      expect(snapshot.ball).toEqual(sequence.ball?.[snapshot.frameIndex] ?? null);
    }
  });
  it("keeps horizontal travel in native sprint and dribbling frames", () => {
    for (const key of ["sprint", "dribbling"]) {
      const sequence = clips.sequences.find(s=>s.key===key)!;
      const hips = sequence.frames.map(f=>(f[23]![0]+f[24]![0])/2);
      expect(Math.max(...hips)-Math.min(...hips)).toBeGreaterThan(.4);
    }
  });
  it("shows calibrated upward COM rise and aligns jump overlays with playback", () => {
    const jump = clips.sequences.find(s=>s.key==="jump")!;
    const overlay = jump.verticalJump!;
    expect(overlay.com).toHaveLength(jump.frames.length);
    expect(overlay.heightMeters).toHaveLength(jump.frames.length);
    expect(overlay.heightMeters.every(h=>h>=0 && Number.isFinite(h))).toBe(true);
    expect(overlay.heightMeters[20]).toBe(0); // Deep countermovement is below the standing baseline.
    expect(overlay.takeoff).toBeLessThan(overlay.apex);
    expect(overlay.peakMeters).toBeCloseTo(.554633,4);
    expect(jump.metrics[0][1]).toBe("21.8 in");
  });
  it("tracks the ball across the dribble while retaining occlusion gaps", () => {
    const clip = clips.sequences.find(s=>s.key==="dribbling")!;
    const balls = clip.ball!.filter(p=>p!==null);
    expect(balls.length / clip.frames.length).toBeGreaterThan(.95);
    expect(Math.max(...balls.map(p=>p.x))-Math.min(...balls.map(p=>p.x))).toBeGreaterThan(.7);
    expect(clip.ball![(603-71)/4]).toBeNull();
    expect(clip.ball![0]!.x).toBeCloseTo(238/1280,3);
    expect(clip.ball!.at(-1)!.x).toBeLessThan(.15);
  });
});
