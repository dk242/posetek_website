import { describe, expect, it } from "vitest";
import { emptyTrainingContext, filmingProgress, sourceLink, trainingContextIssues } from "./wholeBodyTraining";
import { normalizeCatalogDrill } from "../../../lib/contracts/drillV2";
describe("whole-body training UI boundaries", () => {
  it("does not infer schedule, equipment or supervision clearance from an empty intake", () => {
    const empty = emptyTrainingContext(); expect(empty.supervision).toBe("unconfirmed"); expect(trainingContextIssues(empty, 2)).toHaveLength(4); expect(empty).not.toHaveProperty("clearance");
  });
  it("requires exact session count and explicit confirmation of no outside commitments", () => {
    const context = { ...emptyTrainingContext(), startDate: "2026-09-21", sessionDays: [1, 3], scheduleConfirmed: true, equipmentConfirmed: true };
    expect(trainingContextIssues(context, 2)).toEqual([]);
    expect(trainingContextIssues({ ...context, sessionDays: [1, 1] }, 2)).toContain("Choose 2 training days to match the weekly commitment.");
    expect(trainingContextIssues({ ...context, externalSchedule: [{ day: 2, activity: "match", durationMinutes: 0, effort: "hard" }] }, 2)).toContain("Outside sessions need a duration between 1 and 360 minutes.");
  });
  it("distinguishes uploaded clips from approved clips and ignores optional bird's-eye media", () => {
    expect(filmingProgress({ primaryDemo: { storagePath: "a", status: "pending" }, teachingDetail: { storagePath: "b", status: "approved" }, birdsEye: { storagePath: "c", status: "approved" } })).toEqual({ uploaded: 2, approved: 1 });
  });
  it("only offers safe HTTPS research links", () => { expect(sourceLink("https://pubmed.ncbi.nlm.nih.gov/24055781/")).toContain("pubmed"); expect(sourceLink("javascript:alert(1)")).toBeUndefined(); });
  it("preserves gym tokens and policy markers without importing private authoring", () => {
    const drill = normalizeCatalogDrill("STR-601", { schemaVersion: 2, equipment: ["dumbbells", "weightPlates"], productionBatchId: "whole-body-2026-09", trainingPolicy: { version: "whole-body-v1" }, sources: [{ private: true }] });
    expect(drill.equipment).toEqual(["dumbbells", "weightPlates"]); expect(drill.trainingPolicy?.version).toBe("whole-body-v1"); expect(drill).not.toHaveProperty("sources");
  });
});
