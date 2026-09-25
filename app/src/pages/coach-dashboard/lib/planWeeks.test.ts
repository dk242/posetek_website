// The coach week editor saves through the gateway's `save_plan_weeks` job; the
// browser never writes `trainingPlans` (the rules cutover closes that path).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  submit: vi.fn(),
  listener: null as null | ((snapshot: any) => void),
  unsubscribed: 0,
  auth: { currentUser: { uid: "coach1" } as null | { uid: string } },
  planWrites: 0,
}));
vi.mock("../../../lib/firebase", () => ({
  default: {},
  auth: f.auth,
  cloud: {},
  db: { collection: () => { f.planWrites++; throw new Error("the browser must not touch Firestore directly"); }, runTransaction: () => { f.planWrites++; } },
}));
vi.mock("../../../lib/organization-data", () => ({ getClubContext: vi.fn() }));
vi.mock("../../../lib/identity", () => ({ findCoach: vi.fn() }));
vi.mock("../../athlete-portal/lib/loaders", () => ({ submitLlmJob: f.submit }));
import { savePlanWeeks } from "./data";

const WEEKS = [{ weekNumber: 1, drills: [{ drillId: "DRB-001", sets: 4 }] }];

beforeEach(() => {
  f.listener = null; f.unsubscribed = 0; f.planWrites = 0; f.auth.currentUser = { uid: "coach1" };
  f.submit.mockReset().mockResolvedValue({
    onSnapshot: (next: (snapshot: any) => void) => { f.listener = next; return () => { f.unsubscribed++; }; },
  });
});

async function settle(job: any) {
  await vi.waitFor(() => expect(f.listener).not.toBeNull());
  f.listener!({ data: () => job });
}

describe("savePlanWeeks", () => {
  it("files one save_plan_weeks job with exactly the plan id and weeks, and resolves when it completes", async () => {
    const saving = savePlanWeeks("player1", "plan1", WEEKS);
    await settle({ status: "running" });
    f.listener!({ data: () => ({ status: "complete", result: { planId: "plan1", weekCount: 1 } }) });
    await expect(saving).resolves.toBeUndefined();
    expect(f.submit).toHaveBeenCalledWith("player1", "save_plan_weeks", { planId: "plan1", weeks: WEEKS });
    expect(f.unsubscribed).toBe(1);
    expect(f.planWrites).toBe(0);
  });

  it("shows the gateway's refusal, such as a v3 plan or a coach who lost access", async () => {
    const saving = savePlanWeeks("player1", "plan1", WEEKS);
    await settle({ status: "failed", error: { code: "invalid_request", detail: "This athlete is on a version 3 plan." } });
    await expect(saving).rejects.toThrow("This athlete is on a version 3 plan.");
  });

  it("refuses to submit while signed out", async () => {
    f.auth.currentUser = null;
    await expect(savePlanWeeks("player1", "plan1", WEEKS)).rejects.toThrow(/signed out/);
    expect(f.submit).not.toHaveBeenCalled();
  });
});
