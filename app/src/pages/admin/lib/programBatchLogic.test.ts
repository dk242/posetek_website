import { describe, expect, it } from "vitest";
import {
  applyLevel,
  describeBatch,
  isFullyTested,
  runBatch,
  selectable,
  sortRoster,
  testedDrills,
  MEASURED_DRILL_KEYS,
} from "./programBatchLogic";
import type { AthleteEvidence } from "./programBatchLogic";

const evidence = (overrides: Partial<AthleteEvidence> = {}): AthleteEvidence => ({
  tested: [...MEASURED_DRILL_KEYS],
  repCount: 12,
  age: 16,
  ageStale: false,
  position: "CB",
  activePlanVersion: null,
  ...overrides,
});

describe("testedDrills", () => {
  it("reads the stats tag first and falls back to repType", () => {
    const reps = [
      { _statsDrill: "shooting", repType: "side_kick" },
      { repType: "sprint" },
      { drillType: "jump" },
      { _statsDrill: "freeRecord" },
      { repType: "side_kick" },
    ];
    expect(testedDrills(reps)).toEqual(["shooting", "sprint", "jump"]);
    expect(isFullyTested(reps)).toBe(false);
  });

  it("is fully tested only with every measured drill present", () => {
    const reps = MEASURED_DRILL_KEYS.map(key => ({ _statsDrill: key }));
    expect(isFullyTested(reps)).toBe(true);
    expect(isFullyTested(reps.slice(1))).toBe(false);
    expect(isFullyTested([])).toBe(false);
  });
});

describe("selectable", () => {
  it("blocks an athlete whose evidence has not loaded", () => {
    expect(selectable(null).ok).toBe(false);
    expect(selectable(undefined).ok).toBe(false);
  });

  it("blocks an athlete with no age, naming the safety default", () => {
    const result = selectable(evidence({ age: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/age/i);
  });

  it("allows an athlete with an age even when position or tests are missing", () => {
    expect(selectable(evidence({ position: null, tested: [] })).ok).toBe(true);
    expect(selectable(evidence({ ageStale: true })).ok).toBe(true);
  });
});

describe("applyLevel", () => {
  const params = { planVersion: 3, intake: { horizonWeeks: 2, level: "club" } };

  it("returns the same params for auto", () => {
    expect(applyLevel(params, "auto")).toBe(params);
  });

  it("overrides the level without mutating the input", () => {
    const result = applyLevel(params, "performance");
    expect(result.intake.level).toBe("performance");
    expect(result.intake.horizonWeeks).toBe(2);
    expect(params.intake.level).toBe("club");
  });
});

describe("describeBatch", () => {
  it("spells out athletes, horizon, sessions and weekly minutes", () => {
    expect(describeBatch(11, { horizonWeeks: 2, sessionsPerWeek: 2, minutesPerSession: 60 }))
      .toBe("11 athletes × 2 weeks × 2 sessions of 60 min (120 min a week each).");
    expect(describeBatch(1, { horizonWeeks: 1, sessionsPerWeek: 1, minutesPerSession: 30 }))
      .toBe("1 athlete × 1 week × 1 session of 30 min (30 min a week each).");
  });
});

describe("runBatch", () => {
  it("never exceeds the concurrency and finishes every item", async () => {
    let inFlight = 0;
    let peak = 0;
    const done: number[] = [];
    await runBatch([1, 2, 3, 4, 5, 6, 7], 3, async item => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise(resolve => setTimeout(resolve, 2));
      inFlight -= 1;
      done.push(item);
    });
    expect(peak).toBe(3);
    expect(done.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("keeps going after one item rejects", async () => {
    const done: string[] = [];
    await runBatch(["a", "b", "c"], 1, async item => {
      if (item === "b") throw new Error("engine down");
      done.push(item);
    });
    expect(done).toEqual(["a", "c"]);
  });

  it("handles an empty batch", async () => {
    await expect(runBatch([], 3, async () => {})).resolves.toBeUndefined();
  });
});

describe("sortRoster", () => {
  it("groups by team name, then athlete name, with team-less athletes last", () => {
    const names = new Map([["t-rob", "Boys — Coach Rob"], ["t-niall", "Boys — Coach Niall"]]);
    const players = [
      { id: "1", name: "Zed", teamId: "t-niall" },
      { id: "2", name: "Amy", teamId: null },
      { id: "3", name: "Bob", teamId: "t-rob" },
      { id: "4", name: "Al", teamId: "t-niall" },
    ];
    expect(sortRoster(players, names).map(player => player.id)).toEqual(["4", "1", "3", "2"]);
  });
});
