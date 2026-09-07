// The "next workout" rule and the derived week figures — TRAINING_PROGRAM_V3
// §7, §4 and §13. These cases mirror the sequences 01A hand-modelled: resume
// beats order, an early-ended log still finishes its slot, skipped weeks are
// never back-filled, ad-hoc work never enters `next`, and an admin reorder
// changes `order` without changing `workoutId`.

import { describe, expect, it } from "vitest";
import {
  actualMinutesByDomain,
  currentWeekNumber,
  daysBetween,
  derivedTargets,
  localDayString,
  nextWorkout,
  planLogId,
  scheduledExposures,
  weekDrillIds,
  weekTransitionMinutes,
  weekWindow,
  workoutStates,
} from "./planV3";
import { planSchemaVersion, isV3Plan } from "./types";

function block(blockId: string, order: number, drillId: string, domain: string, minutes: number) {
  return { blockId, order, kind: "main", drillId, domain, sets: 3, reps: 8, repUnit: "reps", perSide: false, restSeconds: 45, restScope: "sets", restBetweenSetsSeconds: null, familiarizationReps: 0, estimatedMinutes: minutes, whyIncluded: "" };
}

function workout(workoutId: string, order: number, blocks: ReturnType<typeof block>[]) {
  return { workoutId, order, title: workoutId, intent: "", focusDomains: [], budgetMinutes: 60, estimatedMinutes: 0, blocks, revision: 1, editedBy: "generator" as const };
}

const PLAN = {
  schemaVersion: 3 as const,
  planId: "plan1",
  status: "active",
  startDate: "2026-09-07", // a Monday
  timezone: "America/Los_Angeles",
  horizonWeeks: 3,
  sessionsPerWeek: 2,
  minutesPerSession: 60,
  weeks: [
    {
      weekNumber: 1,
      workouts: [
        workout("w1s1", 1, [block("b1", 1, "DRB-006", "dribbling", 6), block("b2", 2, "PAS-003", "passing", 9)]),
        workout("w1s2", 2, [block("b1", 1, "SPD-002", "speed", 5), block("b2", 2, "DRB-006", "dribbling", 7)]),
      ],
    },
    { weekNumber: 2, workouts: [workout("w2s1", 1, [block("b1", 1, "SHT-004", "shooting", 12)])] },
    { weekNumber: 3, workouts: [workout("w3s1", 1, [block("b1", 1, "AGL-002", "agility", 8)])] },
  ],
};

const IN_WEEK_1 = new Date("2026-09-09T18:00:00Z");
const IN_WEEK_2 = new Date("2026-09-16T18:00:00Z");

describe("schema branching", () => {
  it("branches on schemaVersion first", () => {
    expect(planSchemaVersion(PLAN)).toBe(3);
    expect(isV3Plan(PLAN)).toBe(true);
    expect(planSchemaVersion({ schemaVersion: 1 })).toBe(1);
    expect(planSchemaVersion({ schemaVersion: 2 })).toBe(1);
    expect(planSchemaVersion({})).toBe(1);
    expect(planSchemaVersion({ schemaVersion: 4 })).toBe(0); // unreadable, never a crash
  });
});

describe("calendar arithmetic", () => {
  it("uses calendar dates in the plan's timezone, not elapsed seconds", () => {
    // 2026-11-01 is the US DST fall-back. 08:00 UTC is still Oct 31 in Los Angeles.
    expect(localDayString(new Date("2026-11-01T06:30:00Z"), "America/Los_Angeles")).toBe("2026-10-31");
    expect(daysBetween("2026-10-25", "2026-11-01")).toBe(7);
  });

  it("computes half-open week windows from startDate", () => {
    expect(weekWindow(PLAN, 1)).toEqual({ start: "2026-09-07", end: "2026-09-14" });
    expect(weekWindow(PLAN, 3)).toEqual({ start: "2026-09-21", end: "2026-09-28" });
    expect(weekWindow(PLAN, 0)).toBeNull();
  });

  it("clamps the current week to the horizon", () => {
    expect(currentWeekNumber(PLAN, IN_WEEK_1)).toBe(1);
    expect(currentWeekNumber(PLAN, IN_WEEK_2)).toBe(2);
    expect(currentWeekNumber(PLAN, new Date("2027-01-01T18:00:00Z"))).toBe(3);
    expect(currentWeekNumber(PLAN, new Date("2026-01-01T18:00:00Z"))).toBe(1);
  });
});

describe("nextWorkout", () => {
  it("is the first workout of the current week when nothing is logged", () => {
    expect(nextWorkout(PLAN, [], IN_WEEK_1)).toMatchObject({ weekNumber: 1, reason: "next" });
    expect(nextWorkout(PLAN, [], IN_WEEK_1)!.workout.workoutId).toBe("w1s1");
  });

  it("resumes an in-progress workout ahead of an earlier unfinished one", () => {
    const logs = [{ id: planLogId("plan1", "w1s2"), planId: "plan1", workoutId: "w1s2", source: "plan", startedAt: 1, endedAt: null }];
    const next = nextWorkout(PLAN, logs, IN_WEEK_1)!;
    expect(next.workout.workoutId).toBe("w1s2");
    expect(next.reason).toBe("resume");
  });

  it("treats an early-ended log as a finished slot", () => {
    const logs = [{ id: planLogId("plan1", "w1s1"), planId: "plan1", workoutId: "w1s1", source: "plan", endedAt: 2, endReason: "endedEarly" }];
    expect(nextWorkout(PLAN, logs, IN_WEEK_1)!.workout.workoutId).toBe("w1s2");
  });

  it("never back-fills a skipped week", () => {
    // Week 1 was never done; in week 2 the next workout is week 2's, not w1s1.
    expect(nextWorkout(PLAN, [], IN_WEEK_2)!.workout.workoutId).toBe("w2s1");
  });

  it("falls through to a later week once the current week is finished", () => {
    const logs = [
      { id: planLogId("plan1", "w2s1"), planId: "plan1", workoutId: "w2s1", source: "plan", endedAt: 3, endReason: "completed" },
    ];
    expect(nextWorkout(PLAN, logs, IN_WEEK_2)!.workout.workoutId).toBe("w3s1");
  });

  it("returns null when every remaining slot is finished", () => {
    const logs = ["w2s1", "w3s1"].map(id => ({ id: planLogId("plan1", id), planId: "plan1", workoutId: id, source: "plan", endedAt: 4, endReason: "completed" }));
    expect(nextWorkout(PLAN, logs, IN_WEEK_2)).toBeNull();
  });

  it("ignores ad-hoc logs and other plans' logs", () => {
    const logs = [
      { id: "adhoc1", planId: "plan1", workoutId: "adhoc1", source: "adhoc", endedAt: 5, endReason: "completed" },
      { id: planLogId("plan9", "w1s1"), planId: "plan9", workoutId: "w1s1", source: "plan", endedAt: 5, endReason: "completed" },
    ];
    expect(nextWorkout(PLAN, logs, IN_WEEK_1)!.workout.workoutId).toBe("w1s1");
    expect(workoutStates("plan1", logs).size).toBe(0);
  });

  it("has no next workout for an inactive plan", () => {
    expect(nextWorkout({ ...PLAN, status: "superseded" }, [], IN_WEEK_1)).toBeNull();
  });

  it("follows an admin reorder, which changes order and never workoutId", () => {
    const reordered = {
      ...PLAN,
      weeks: [
        { weekNumber: 1, workouts: [{ ...PLAN.weeks[0].workouts[0], order: 2 }, { ...PLAN.weeks[0].workouts[1], order: 1 }] },
        ...PLAN.weeks.slice(1),
      ],
    };
    expect(nextWorkout(reordered, [], IN_WEEK_1)!.workout.workoutId).toBe("w1s2");
  });
});

describe("derived week figures", () => {
  const week = PLAN.weeks[0];

  it("counts one exposure per workout containing the domain, not per block", () => {
    const threeInOne = { weekNumber: 1, workouts: [workout("w1s1", 1, [
      block("b1", 1, "DRB-006", "dribbling", 5),
      block("b2", 2, "DRB-007", "dribbling", 5),
      block("b3", 3, "DRB-008", "dribbling", 5),
    ])] };
    expect(derivedTargets(threeInOne)).toEqual([{ domain: "dribbling", exposures: 1 }]);
  });

  it("sums minutes per domain and keeps transitions as overhead", () => {
    expect(actualMinutesByDomain(week)).toEqual({ dribbling: 13, passing: 9, speed: 5 });
    expect(weekTransitionMinutes(week)).toBe(2); // two workouts × (2 blocks − 1)
  });

  it("lists this week's distinct drills in first-appearance order", () => {
    expect(weekDrillIds(week)).toEqual(["DRB-006", "PAS-003", "SPD-002"]);
  });
});

describe("scheduledExposures", () => {
  const week = PLAN.weeks[0];

  it("counts distinct workouts, not blocks", () => {
    expect(scheduledExposures(week, "DRB-006")).toBe(2);
    expect(scheduledExposures(week, "PAS-003")).toBe(1);
  });

  it("is replacement-aware, so editing a workout that already has the drill is not double-counted", () => {
    const replacement = { workoutId: "w1s2", blocks: [{ drillId: "DRB-006" }, { drillId: "DRB-006" }] };
    expect(scheduledExposures(week, "DRB-006", replacement)).toBe(2);
  });

  it("drops the exposure when the target workout removes the drill", () => {
    const replacement = { workoutId: "w1s2", blocks: [{ drillId: "SPD-002" }] };
    expect(scheduledExposures(week, "DRB-006", replacement)).toBe(1);
  });
});
