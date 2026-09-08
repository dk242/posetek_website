import { describe, expect, it, vi } from "vitest";
vi.mock("../../../lib/firebase", () => ({ db: {} }));
vi.mock("../../athlete-portal/lib/loaders", () => ({ submitLlmJob: vi.fn() }));
import { activationParams, PERSONALIZED_ENGINE, personalizedParams, plannerLink, prescriptionSignature, previewEnabled, recentEvidence } from "./personalizedLogic";
import { DEFAULT_INTAKE } from "./planJobs";
describe("personalized preview contract", () => {
  it("uses only recent dated evidence; stale best results cannot dominate", () => {
    const now = Date.now();
    const reps = [
      { _statsDrill: "shooting", velocity: 45, createdAtMillis: now - 181 * 86400000 },
      { _statsDrill: "shooting", velocity: 25, createdAtMillis: now - 1000 },
      { _statsDrill: "shooting", velocity: 50 },
      { _statsDrill: "shooting", velocity: 50, createdAtMillis: now + 86400000 },
    ];
    expect(recentEvidence(reps, now).excluded).toBe(3);
    const params = personalizedParams(reps, { position: "CB" }, 16, DEFAULT_INTAKE);
    expect(params.engineVersion).toBe(PERSONALIZED_ENGINE);
    expect(params.statsProfile.drills[0].metrics[0].bestCanonical).toBe(25);
    expect(params.evidenceWindow).toBeDefined();
    expect(personalizedParams([], {}, null, DEFAULT_INTAKE).evidenceWindow).toBeUndefined();
  });
  it("keeps selection in both directions without an action", () => {
    for (const preview of [true, false]) {
      const url = new URL(plannerLink(preview, "org one", ["player-a", "player-b"], "team one"), "https://test.invalid");
      expect(url.searchParams.get("orgId")).toBe("org one");
      expect(url.searchParams.get("players")).toBe("player-a,player-b");
      expect(url.searchParams.get("teamId")).toBe("team one");
      expect(url.searchParams.has("activate")).toBe(false);
    }
  });
  it("fails closed for absent or malformed preview configuration", () => {
    expect(previewEnabled(null)).toBe(false);
    const config = { globalEnabled: true, programV3Enabled: true, personalizedPlannerEnabled: true,
      capabilities: { generate_personalized_plan: { enabled: true, dailyLimitPerUser: 3 } } };
    expect(previewEnabled(config)).toBe(true);
    expect(previewEnabled({ ...config, personalizedPlannerEnabled: false })).toBe(false);
    expect(previewEnabled({ ...config, globalEnabled: false })).toBe(false);
  });
  it("binds activation to a reviewed ready draft and expected active revision", () => {
    expect(() => activationParams({ status: "activated" })).toThrow();
    const expectedActivePlans = [{ planId: "active", planRevision: 7 }];
    expect(activationParams({ status: "ready", draftId: "draft", comparisonToken: "token", expectedActivePlans }))
      .toEqual({ engineVersion: PERSONALIZED_ENGINE, draftId: "draft", comparisonToken: "token", expectedActivePlans });
  });
  it("compares executable prescriptions rather than generated wording", () => {
    const plan = { weeks: [{ workouts: [{ title: "Old title", blocks: [{ drillId: "sprint", sets: 3, reps: 10, restSeconds: 30 }] }] }] };
    const other = structuredClone(plan); other.weeks[0].workouts[0].title = "New title";
    expect(prescriptionSignature(plan)).toBe(prescriptionSignature(other));
    other.weeks[0].workouts[0].blocks[0].reps = 11;
    expect(prescriptionSignature(plan)).not.toBe(prescriptionSignature(other));
  });
});
