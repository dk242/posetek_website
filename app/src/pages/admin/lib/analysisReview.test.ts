import { describe, expect, it } from "vitest";
import { annotationPoint, eligibleEvidence, feedbackFromResult, manualArtifactsChanged, phaseFrame, poseJoint, reliableFoot, reorderedFocus, sourceEvidence } from "./analysisReview";
describe("expert review helpers", () => {
  it("keeps no priorities valid and never invents cues", () => {
    expect(feedbackFromResult({ focusAreas: [] })).toEqual({ summary: "", focusAreas: [] });
    expect(feedbackFromResult(null).focusAreas).toEqual([]);
  });
  it("connects single-rep observations and preserves bilateral evidence citations", () => {
    expect(feedbackFromResult({ observations: [{ id: "o1", observation: "observed" }], focusAreas: [{ observationId: "o1", title: "Title", rank: 1, cue: "cue", metricIds: ["m1"] }] }).focusAreas[0]).toMatchObject({ observation: "observed", evidenceIds: ["m1"] });
    expect(feedbackFromResult({ focusAreas: [{ rank: 1, observation: "paired", evidenceIds: ["d1"] }] }).focusAreas[0].evidenceIds).toEqual(["d1"]);
  });
  it("reorders priorities consecutively without changing source rows", () => {
    const rows = feedbackFromResult({ focusAreas: [{ rank: 1, title: "One" }, { rank: 2, title: "Two" }] }).focusAreas;
    expect(reorderedFocus(rows, 1, -1).map(row => [row.title, row.rank])).toEqual([["Two", 1], ["One", 2]]);
    expect(rows[0].title).toBe("One");
  });
  it("keeps travel direction distinct from a verified stored foot", () => {
    expect(reliableFoot({ direction: "left_to_right" })).toBeNull();
    expect(reliableFoot({ strike_foot: "right" })).toBe("right");
    expect(reliableFoot({ strike_foot: null })).toBeNull();
  });
  it("resolves exact phase frames and rejects missing and unreliable landmarks", () => {
    expect(phaseFrame({ keyFrames: { contact: 0 } }, { contact_frame: 15 }, "contact")).toBe(0);
    expect(phaseFrame(null, {}, "followThrough")).toBeNull();
    expect(annotationPoint([0.2, 0.3, 0, 0.01])).toBeNull();
    expect(annotationPoint([NaN, 0.3])).toBeNull();
  });
  it("uses explicit temporal eligibility and maps COCO joints to physical limbs", () => {
    const result = { metrics: [{ id: "static", valid: true }], evidence: { rows: [{ id: "event", eligible: true }, { id: "static", eligible: false, valid: true }] } };
    expect(sourceEvidence(result).filter(eligibleEvidence).map(row => row.id)).toEqual(["event"]);
    const pose = Array.from({ length: 17 }, (_, index) => [index / 20, 0.5]);
    expect(poseJoint(pose, 11)?.x).toBe(5 / 20);
    expect(poseJoint(pose, 23)?.x).toBe(11 / 20);
    expect(poseJoint(pose, 31)).toBeNull();
    expect(poseJoint(pose.slice(0, 10), 11)).toBeNull();
  });
  it("detects a changed manual source before existing annotations are reused", () => {
    const previous = { source: { mode: "manual" }, manualSource: { r1: { artifacts: { "pose.json": { generation: "1", md5Hash: "a" } } } } };
    expect(manualArtifactsChanged(previous, { r1: { identities: { "pose.json": { generation: "1", md5Hash: "a" } } } })).toBe(false);
    expect(manualArtifactsChanged(previous, { r1: { identities: { "pose.json": { generation: "2", md5Hash: "b" } } } })).toBe(true);
  });
});
