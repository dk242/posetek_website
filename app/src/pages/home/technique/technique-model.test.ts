import { describe, expect, it } from "vitest";
import { POSE_EDGES } from "../pitch/pose-model";
import { formatMeasurement, metricForJoint, nearestPhase, projectRecordedFrames, techniqueData } from "./technique-model";

describe("published technique recording fidelity", () => {
  it("retains every captured coordinate, measurement, cue and provenance field", async () => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(techniqueData)));
    expect(Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""))
      .toBe("60b852db742200642f781d81832c7f3a4507cf557f83d1032d39dcd8149bab68");
    expect(techniqueData.frames).toHaveLength(71);
    expect(techniqueData.ball).toHaveLength(71);
    expect(techniqueData.frames.every(frame => frame.length === 33 && frame.flat().every(Number.isFinite))).toBe(true);
    expect(POSE_EDGES.every(edge => edge.every(joint => joint >= 0 && joint < 33))).toBe(true);
  });

  it("maps each saved phase to the exact sampled source frame", () => {
    expect(techniqueData.phases.map(phase => [phase.key, phase.sourceFrame, phase.index])).toEqual([
      ["backswing", 458, 19], ["contact", 472, 26], ["followThrough", 522, 51],
    ]);
    for (const phase of techniqueData.phases) {
      expect(techniqueData.startFrame + phase.index * techniqueData.step).toBe(phase.sourceFrame);
      expect(phase.metrics.every(metric => metric.id.startsWith(phase.key + "."))).toBe(true);
    }
  });

  it("preserves saved reference values and the absent follow-through reference", () => {
    const contact = techniqueData.phases[1];
    expect(contact.metrics.find(metric => metric.id === "contact.plant_foot_ball_offset_x.support"))
      .toMatchObject({ value: -7.95056, reference: 3.6469, unit: "cm", joints: [28] });
    expect(contact.referencePose).toHaveLength(33);
    expect(techniqueData.phases[0].referencePose).toHaveLength(33);
    expect(techniqueData.phases[2].referencePose).toBeNull();
    expect(techniqueData.phases[2].metrics.every(metric => metric.reference === null)).toBe(true);
  });

  it("keeps focus areas attached to their saved contact measurements", () => {
    const chosen = techniqueData.focusAreas.map(focus => {
      const phase = techniqueData.phases.find(phase => phase.key === focus.frameKey)!;
      return focus.metricIds.map(id => phase.metrics.find(metric => metric.id === id)).find(Boolean)?.id;
    });
    expect(chosen).toEqual(["contact.plant_foot_ball_offset_x.support", "contact.arm_abduction.lead"]);
    // The deployed cue also names an unavailable wrist metric. Keep its fallback,
    // rather than inventing a wrist measurement during source recovery.
    expect(techniqueData.focusAreas[1].metricIds).toContain("contact.wrist_trunk_offset.lead");
  });
});

describe("technique inspection and framing", () => {
  it("keeps an explicitly selected measurement when inspecting a shared joint", () => {
    const contact = techniqueData.phases[1];
    expect(metricForJoint(contact, 28, "contact.plant_foot_ball_offset_x.support")?.label).toBe("Plant foot / ball");
    expect(metricForJoint(contact, 28, "contact.knee_angle.support")?.label).toBe("Support knee");
    expect(metricForJoint(contact, 28, "contact.knee_angle.kicking")?.label).toBe("Support knee");
    expect(metricForJoint(contact, 0)).toBeUndefined();
  });

  it("uses the nearest saved phase while scrubbing, preserving tie order", () => {
    expect(nearestPhase(techniqueData.phases, 0).key).toBe("backswing");
    expect(nearestPhase(techniqueData.phases, 23).key).toBe("contact");
    expect(nearestPhase(techniqueData.phases, 70).key).toBe("followThrough");
    expect(nearestPhase(techniqueData.phases, 22.5).key).toBe("backswing");
  });

  it("fits the entire recording into its original padded viewport", () => {
    const view = projectRecordedFrames(techniqueData.frames);
    const points = techniqueData.frames.flat().map(view.point);
    expect(points.every(([x, y]) => x >= 40 - 1e-8 && x <= 560 + 1e-8 && y >= 26 - 1e-8 && y <= 314 + 1e-8)).toBe(true);
    expect(formatMeasurement(-7.95056, "cm")).toBe("-8 cm");
    expect(formatMeasurement(136.25991, "°")).toBe("136.3°");
  });
});
