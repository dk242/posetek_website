import { describe, expect, it } from "vitest";
import { annotationPoint, comparisonTime, eligibleEvidence, feedbackFromResult, manualArtifactsChanged, phaseFrame, poseJoint, reliableFoot, reorderedFocus, selectComparisonPair, sourceEvidence, validSavedComparisons } from "./analysisReview";
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

describe("saved comparison selection", () => {
  const reps = [
    { id: "new-left", strike_foot: "left" }, { id: "new-right", strike_foot: "right" },
    { id: "old-left", strike_foot: "left" }, { id: "old-right", strike_foot: "right" },
    { id: "unassigned", direction: "left_to_right" },
  ];
  const saved = { comparisonId: "saved", leftRepId: "old-left", rightRepId: "old-right", generatedAt: "2026-09-08T19:00:00Z" };
  it("defaults to the latest saved pair even when newer individual kicks come first", () => {
    expect(selectComparisonPair(reps, [saved])).toEqual({ leftId: "old-left", rightId: "old-right" });
  });
  it("sorts valid saved pairs by generation time without changing the source array", () => {
    const newest = { ...saved, comparisonId: "newest", leftRepId: "new-left", generatedAt: { seconds: Date.parse("2026-09-08T20:00:00Z") / 1000 } };
    const pairs = [saved, newest];
    expect(validSavedComparisons(reps, pairs).map(row => row.comparisonId)).toEqual(["newest", "saved"]);
    expect(pairs[0]).toBe(saved);
    expect(comparisonTime({ generatedAt: { toMillis: () => 123 } })).toBe(123);
    expect(comparisonTime({ generatedAt: "unknown" })).toBe(0);
  });
  it("never uses saved IDs to bypass the loaded kick list or explicit foot labels", () => {
    const invalid = [
      { ...saved, comparisonId: "missing", leftRepId: "not-a-loaded-kick" },
      { ...saved, comparisonId: "unassigned", leftRepId: "unassigned" },
      { ...saved, comparisonId: "swapped", leftRepId: "old-right", rightRepId: "old-left" },
      { ...saved, comparisonId: "same", rightRepId: "old-left" },
      { ...saved, comparisonId: "" },
    ];
    expect(validSavedComparisons(reps, [...invalid, saved])).toEqual([saved]);
    expect(selectComparisonPair(reps, invalid)).toEqual({ leftId: "new-left", rightId: "new-right" });
  });
  it("preserves current manual and saved selections when results reload", () => {
    const current = { leftId: "new-left", rightId: "old-right" };
    expect(selectComparisonPair(reps, [saved], current)).toEqual(current);
    expect(selectComparisonPair(reps, [saved], { leftId: "", rightId: "" })).toEqual({ leftId: "", rightId: "" });
    expect(selectComparisonPair(reps, [saved], { leftId: "new-left", rightId: "" })).toEqual({ leftId: "new-left", rightId: "" });
  });
  it("replaces an invalid selection with a valid saved pair after source changes", () => {
    expect(selectComparisonPair(reps, [saved], { leftId: "deleted", rightId: "new-right" })).toEqual({ leftId: "old-left", rightId: "old-right" });
    expect(selectComparisonPair([], [saved])).toEqual({ leftId: "", rightId: "" });
  });
});
