/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, expect, it } from "vitest";
import {
  allBlocksAccounted,
  blockDoseLine,
  blockLogRow,
  blockStatus,
  buildWeekProgress,
  currentWeekNumber,
  daysLeftInWeek,
  domainExposures,
  domainName,
  domainShortName,
  doseLine,
  elapsedString,
  endReasonFor,
  focusChoices,
  humanized,
  initialPageIndex,
  prescriptionDoseLine,
  restString,
  skippedLogRow,
  targetSets,
  todaysWorkout,
  weekBudgetMinutes,
  weekWindow,
  workoutStatus,
  END_REASON_COMPLETED,
  END_REASON_ENDED_EARLY,
  STATUS_DONE,
  STATUS_PARTIAL,
  STATUS_SKIPPED,
  SKIP_REASON_PAIN,
} from "./training";

const dayString = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const daysAgo = (days: number) => {
  const now = new Date();
  return dayString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
};

const block = (over: Partial<any> = {}): any => ({
  blockId: "b1",
  order: 1,
  kind: "main",
  drillId: "SPD-010",
  name: "Acceleration starts",
  domain: "linearSpeed",
  sets: 3,
  reps: 4,
  repUnit: "reps",
  restSeconds: 60,
  estimatedMinutes: 8,
  ...over,
});

describe("humanized / domain display", () => {
  it("splits camelCase ids into sentence case", () => {
    expect(humanized("linearSpeed")).toBe("Linear speed");
    expect(humanized("passingReceiving")).toBe("Passing receiving");
    expect(humanized("")).toBe("");
  });

  it("prefers the known name, falling back to the humanized id", () => {
    expect(domainName("codAgility")).toBe("Change of direction");
    expect(domainName("someNewDomain")).toBe("Some new domain");
  });

  it("uses short names for tight chrome and falls back to the full name", () => {
    expect(domainShortName("codAgility")).toBe("Agility");
    expect(domainShortName("someNewDomain")).toBe("Some new domain");
  });
});

describe("doseLine", () => {
  it("formats sets × reps with rest", () => {
    expect(doseLine({ sets: 3, reps: 4, repUnit: "reps", restSeconds: 60 })).toBe("3 × 4 reps · 60s rest");
  });

  it("singularizes a one-rep dose", () => {
    expect(doseLine({ sets: 2, reps: 1, repUnit: "reps", restSeconds: 0 })).toBe("2 × 1 rep");
  });

  it("degrades to whatever the plan actually specified", () => {
    expect(doseLine({ reps: 30, repUnit: "seconds" })).toBe("30 sec");
    expect(doseLine({ sets: 1 })).toBe("1 set");
    expect(doseLine({})).toBe("As prescribed");
  });

  it("passes unknown rep units through verbatim", () => {
    expect(doseLine({ reps: 12, repUnit: "contacts" })).toBe("12 contacts");
  });

  it("appends weekly frequency for a prescription and minutes for a block", () => {
    expect(prescriptionDoseLine({ sets: 3, reps: 4, repUnit: "reps", frequencyPerWeek: 2 })).toBe("3 × 4 reps · 2×/week");
    expect(blockDoseLine(block())).toBe("3 × 4 reps · 60s rest · ~8 min");
  });
});

describe("plan week windows", () => {
  const plan = { startDate: "2026-03-02", horizonWeeks: 6, weeks: [] };

  it("builds a half-open seven-day window per week", () => {
    const window = weekWindow(plan, 2)!;
    expect(dayString(window.start)).toBe("2026-03-09");
    expect(dayString(window.end)).toBe("2026-03-16");
  });

  it("rejects a non-positive week or an unparseable start date", () => {
    expect(weekWindow(plan, 0)).toBeNull();
    expect(weekWindow({ startDate: "not-a-date" }, 1)).toBeNull();
  });

  it("clamps the current week to the horizon", () => {
    expect(currentWeekNumber({ startDate: daysAgo(0), horizonWeeks: 6 })).toBe(1);
    expect(currentWeekNumber({ startDate: daysAgo(15), horizonWeeks: 6 })).toBe(3);
    expect(currentWeekNumber({ startDate: daysAgo(100), horizonWeeks: 6 })).toBe(6);
    expect(currentWeekNumber({ startDate: daysAgo(-5), horizonWeeks: 6 })).toBe(1);
    expect(currentWeekNumber({ startDate: "not-a-date", horizonWeeks: 6 })).toBe(1);
  });

  it("counts days left in the week, clamped at zero", () => {
    const now = new Date(2026, 2, 4);
    expect(daysLeftInWeek(plan, 1, now)).toBe(5);
    expect(daysLeftInWeek(plan, 1, new Date(2026, 2, 20))).toBe(0);
  });
});

describe("todaysWorkout", () => {
  const now = new Date(2026, 2, 4, 18, 0, 0);
  const at = (date: Date) => ({ toDate: () => date });

  it("picks the newest workout generated today for the week", () => {
    const workouts = [
      { id: "morning", weekNumber: 2, generatedAt: at(new Date(2026, 2, 4, 8, 0)) },
      { id: "afternoon", weekNumber: 2, generatedAt: at(new Date(2026, 2, 4, 16, 0)) },
    ];
    expect(todaysWorkout(workouts, 2, now).id).toBe("afternoon");
  });

  it("ignores yesterday's workout — its answers expired at midnight", () => {
    const workouts = [{ id: "stale", weekNumber: 2, generatedAt: at(new Date(2026, 2, 3, 23, 0)) }];
    expect(todaysWorkout(workouts, 2, now)).toBeNull();
  });

  it("ignores another week's workout and one with no generatedAt", () => {
    const workouts = [
      { id: "otherWeek", weekNumber: 3, generatedAt: at(new Date(2026, 2, 4, 9, 0)) },
      { id: "undated", weekNumber: 2, generatedAt: null },
    ];
    expect(todaysWorkout(workouts, 2, now)).toBeNull();
  });
});

describe("buildWeekProgress", () => {
  const plan = {
    startDate: "2026-03-02",
    horizonWeeks: 6,
    intake: { daysPerWeek: 3, minutesPerSession: 60 },
    weeks: [
      {
        weekNumber: 1,
        targets: [
          { domain: "linearSpeed", exposures: 2 },
          { domain: "shooting", exposures: 1 },
        ],
        drills: [
          { drillId: "SPD-010", frequencyPerWeek: 2 },
          { drillId: "SHT-004", frequencyPerWeek: 1 },
        ],
      },
    ],
  };

  const millis = (day: number, hour = 12) => new Date(2026, 2, day, hour).valueOf();
  const stamp = (day: number, hour = 12) => ({ toDate: () => new Date(2026, 2, day, hour) });

  it("counts non-skipped log blocks as exposures and skips skipped ones", () => {
    const logs = [{
      weekNumber: 1,
      startedAt: stamp(3, 10),
      endedAt: stamp(3, 11),
      blocks: [
        { blockId: "a", drillId: "SPD-010", domain: "linearSpeed", status: STATUS_DONE, setsCompleted: 3 },
        { blockId: "b", drillId: "SHT-004", domain: "shooting", status: STATUS_SKIPPED, setsCompleted: 0 },
      ],
    }];
    const progress = buildWeekProgress({ plan, weekNumber: 1, logs });
    expect(progress.domainProgress).toEqual([
      { domain: "linearSpeed", exposuresDone: 1, exposuresTarget: 2, isMet: false },
      { domain: "shooting", exposuresDone: 0, exposuresTarget: 1, isMet: false },
    ]);
    expect(progress.drillProgress[0].state).toEqual({ kind: "partial", completed: 1, target: 2 });
    expect(progress.drillProgress[1].state).toEqual({ kind: "notStarted" });
    expect(progress.minutesTrained).toBe(60);
  });

  it("credits free-recorded reps once per recording session", () => {
    const reps = [
      { id: "r1", repType: "sprint", createdAtMillis: millis(3), sessionFolder: "session1" },
      { id: "r2", repType: "sprint", createdAtMillis: millis(3, 13), sessionFolder: "session1" },
      { id: "r3", repType: "side_kick", createdAtMillis: millis(4), sessionFolder: "session2" },
    ];
    const progress = buildWeekProgress({ plan, weekNumber: 1, logs: [], reps });
    expect(progress.domainProgress[0].exposuresDone).toBe(1);
    expect(progress.domainProgress[1]).toEqual({ domain: "shooting", exposuresDone: 1, exposuresTarget: 1, isMet: true });
  });

  it("ignores reps outside the week window", () => {
    const reps = [{ id: "r1", repType: "sprint", createdAtMillis: millis(20), sessionFolder: "session9" }];
    expect(buildWeekProgress({ plan, weekNumber: 1, logs: [], reps }).domainProgress[0].exposuresDone).toBe(0);
  });

  it("does not double-count a session an in-week log already claims", () => {
    const logs = [{
      weekNumber: 1,
      linkedTrainingSessionId: "s1",
      startedAt: stamp(3, 10),
      blocks: [{ blockId: "a", drillId: "SPD-010", domain: "linearSpeed", status: STATUS_DONE, setsCompleted: 3 }],
    }];
    const reps = [{ id: "r1", repType: "sprint", createdAtMillis: millis(3), sessionFolder: "session1" }];
    const sessions = [{ id: "s1", startedAtMillis: millis(3, 10), endedAtMillis: millis(3, 11), sessionRepIds: ["r1"] }];
    const progress = buildWeekProgress({ plan, weekNumber: 1, logs, reps, sessions });
    expect(progress.domainProgress[0].exposuresDone).toBe(1);
    // The claimed session's minutes belong to the log, not to a second bucket.
    expect(progress.minutesTrained).toBe(0);
  });

  it("marks a drill done once its weekly frequency is met", () => {
    const logs = [
      { weekNumber: 1, blocks: [{ blockId: "a", drillId: "SPD-010", domain: "linearSpeed", status: STATUS_DONE }] },
      { weekNumber: 1, blocks: [{ blockId: "b", drillId: "SPD-010", domain: "linearSpeed", status: STATUS_PARTIAL }] },
    ];
    const progress = buildWeekProgress({ plan, weekNumber: 1, logs });
    expect(progress.drillProgress[0].state).toEqual({ kind: "done", completed: 2, target: 2 });
  });

  it("returns an empty progress for a week the plan does not have", () => {
    expect(buildWeekProgress({ plan, weekNumber: 9, logs: [] })).toEqual({
      weekNumber: 9, domainProgress: [], drillProgress: [], minutesTrained: 0,
    });
  });
});

describe("weekBudgetMinutes", () => {
  it("prefers the v2 per-domain allocation total", () => {
    const week = { allocations: [{ domain: "linearSpeed", minutes: 45 }, { domain: "shooting", minutes: 30 }] };
    expect(weekBudgetMinutes({ intake: { daysPerWeek: 3, minutesPerSession: 60 } }, week)).toBe(75);
  });

  it("falls back to the intake's stated availability on v1 plans", () => {
    expect(weekBudgetMinutes({ intake: { daysPerWeek: 3, minutesPerSession: 60 } }, { allocations: [] })).toBe(180);
  });
});

describe("workout player rules", () => {
  const blocks = [block({ blockId: "b1", order: 1 }), block({ blockId: "b2", order: 2, sets: 0 })];

  it("guarantees at least one target set even when the dose omits sets", () => {
    expect(targetSets(blocks[0])).toBe(3);
    expect(targetSets(blocks[1])).toBe(1);
  });

  it("marks a row done only at the target and clamps overshoot", () => {
    expect(blockLogRow(blocks[0], 2)).toMatchObject({ setsCompleted: 2, status: STATUS_PARTIAL, estimatedMinutes: 8 });
    expect(blockLogRow(blocks[0], 3)).toMatchObject({ setsCompleted: 3, status: STATUS_DONE });
    expect(blockLogRow(blocks[0], 9)).toMatchObject({ setsCompleted: 3, status: STATUS_DONE });
  });

  it("preserves completed sets when a block is skipped", () => {
    expect(skippedLogRow(blocks[0], 2, SKIP_REASON_PAIN)).toMatchObject({
      setsCompleted: 2, status: STATUS_SKIPPED, skipReason: SKIP_REASON_PAIN,
    });
  });

  it("resumes at the first block without an outcome", () => {
    const log = { blocks: [{ blockId: "b1", status: STATUS_DONE }] };
    expect(initialPageIndex(blocks, log)).toBe(1);
    expect(initialPageIndex(blocks, null)).toBe(0);
  });

  it("resumes at the last block when everything is accounted for", () => {
    const log = { blocks: [{ blockId: "b1", status: STATUS_DONE }, { blockId: "b2", status: STATUS_SKIPPED }] };
    expect(initialPageIndex(blocks, log)).toBe(1);
    expect(allBlocksAccounted(blocks, log)).toBe(true);
    expect(endReasonFor(blocks, log)).toBe(END_REASON_COMPLETED);
  });

  it("calls a half-finished session ended early", () => {
    const log = { blocks: [{ blockId: "b1", status: STATUS_PARTIAL }] };
    expect(allBlocksAccounted(blocks, log)).toBe(false);
    expect(endReasonFor(blocks, log)).toBe(END_REASON_ENDED_EARLY);
    expect(blockStatus(blocks[0], log)).toBe(STATUS_PARTIAL);
  });

  it("counts done and partial blocks as this session's domain exposures", () => {
    const log = {
      blocks: [
        { blockId: "b1", status: STATUS_DONE },
        { blockId: "b2", status: STATUS_SKIPPED },
      ],
    };
    expect(domainExposures(blocks, log)).toEqual([{ domain: "linearSpeed", count: 1 }]);
  });
});

describe("workoutStatus", () => {
  it("reserves Completed for a completed end reason", () => {
    expect(workoutStatus({ endReason: END_REASON_COMPLETED }).line).toBe("Completed");
    expect(workoutStatus({ endReason: END_REASON_ENDED_EARLY }).line).toBe("Ended early");
    expect(workoutStatus({ startedAt: {} }).line).toBe("In progress");
    expect(workoutStatus(null).line).toBe("Ready when you are");
  });
});

describe("focusChoices", () => {
  it("lists this week's domains in plan order, deduped", () => {
    const week = {
      targets: [{ domain: "linearSpeed" }, { domain: "shooting" }],
      drills: [{ domain: "shooting" }, { domain: "dribbling" }],
    };
    expect(focusChoices(week)).toEqual(["linearSpeed", "shooting", "dribbling"]);
    expect(focusChoices(null)).toEqual([]);
  });
});

describe("clock formatting", () => {
  it("formats elapsed time, adding hours only when needed", () => {
    expect(elapsedString(0, 65_000)).toBe("1:05");
    expect(elapsedString(0, 3_725_000)).toBe("1:02:05");
    expect(elapsedString(1000, 0)).toBe("0:00");
  });

  it("formats a rest countdown", () => {
    expect(restString(90)).toBe("1:30");
    expect(restString(5)).toBe("0:05");
  });
});
