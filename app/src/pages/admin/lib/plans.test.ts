import { beforeEach, describe, expect, it, vi } from "vitest";
import { draftFromWorkout, setDose } from "./editor";
import { saveWorkoutEdit, type SaveWorkoutEdit } from "./plans";
import { NO_FEEDBACK_RATIONALE } from "./rationale";
const harness = vi.hoisted(() => ({ submit: vi.fn(), uid: "admin-test", stop: vi.fn(), outcome: {} as Record<string, unknown> }));
vi.mock("../../../lib/firebase", () => ({ auth: { get currentUser() { return harness.uid ? { uid: harness.uid } : null; } }, db: {} }));
vi.mock("../../athlete-portal/lib/loaders", () => ({ submitLlmJob: harness.submit }));
let input: SaveWorkoutEdit;
beforeEach(() => {
  harness.uid = "admin-test"; harness.submit.mockReset(); harness.stop.mockReset();
  harness.outcome = { status: "complete", result: { adjustmentId: "plan1_r2", newPlanRevision: 2, newWorkoutRevision: 2 } };
  harness.submit.mockImplementation(async () => ({ id: "job1", onSnapshot: (callback: (value: unknown) => void) => { queueMicrotask(() => callback({ data: () => harness.outcome })); return harness.stop; } }));
  input = { playerId: "player1", planId: "plan1", draft: draftFromWorkout("plan1", 1, {
    workoutId: "w1s1", title: "Strength", revision: 1, scheduledDate: "2026-09-22", blocks: [{
      blockId: "b1", drillId: "STR-601", domain: "strength", sets: 2, reps: 8,
      trainingPolicyVersion: "whole-body-v1", loadingInstructions: "Coach selected 4 kg. No independent increase.",
      trainingRationale: { reason: "General physical preparation" },
    }],
  }, 1), rationale: "Reduce session volume.", warningsOverridden: [],
    frequency: { scheduleExists: true, scheduleRevision: 4, extraExposures: {} }, setting: "solo", equipment: ["dumbbells"],
    generatorIntent: null, generatorCheck: null, generationContextRef: null };
});
describe("server-validated workout saves", () => {
  it("submits immutable revision guards and retains loading, rationale and scheduled date through dose editing", async () => {
    input.draft = setDose(input.draft, "b1", { sets: 3 });
    await expect(saveWorkoutEdit(input)).resolves.toEqual({ adjustmentId: "plan1_r2", newPlanRevision: 2, newWorkoutRevision: 2 });
    expect(harness.submit).toHaveBeenCalledWith("player1", "save_workout_edit", expect.objectContaining({
      planId: "plan1", workoutId: "w1s1", expectedPlanRevision: 1, expectedWorkoutRevision: 1, expectedScheduleRevision: 4,
      workout: expect.objectContaining({ scheduledDate: "2026-09-22", blocks: [expect.objectContaining({
        blockId: "b1", sets: 3, trainingPolicyVersion: "whole-body-v1", loadingInstructions: "Coach selected 4 kg. No independent increase.", trainingRationale: { reason: "General physical preparation" },
      })] }),
    })); expect(harness.stop).toHaveBeenCalledOnce();
  });
  it("surfaces rejected clearance instead of treating submission as a successful save", async () => {
    harness.outcome = { status: "failed", error: { detail: "Readiness expired. Obtain a new review." } }; await expect(saveWorkoutEdit(input)).rejects.toThrow("Readiness expired");
  });
  it("passes an explicit no-feedback choice without sending stale text", async () => {
    await saveWorkoutEdit({ ...input, noFeedback: true }); expect(harness.submit.mock.calls[0][2].rationale).toBe(NO_FEEDBACK_RATIONALE);
  });
  it.each(["", "  ", "ab", "x".repeat(2001)])("rejects invalid rationale before submission (%#)", async rationale => {
    await expect(saveWorkoutEdit({ ...input, rationale })).rejects.toMatchObject({ code: "validation" }); expect(harness.submit).not.toHaveBeenCalled();
  });
  it("rejects signed-out saves before submission", async () => {
    harness.uid = ""; await expect(saveWorkoutEdit(input)).rejects.toMatchObject({ code: "signedOut" }); expect(harness.submit).not.toHaveBeenCalled();
  });
});
