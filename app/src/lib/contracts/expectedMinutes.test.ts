// The expected-time formula against the SHARED fixture. The same 27 block rows
// and 3 workout rows are asserted in KickAITests/Fixtures (Swift) and
// Services/agent-gateway/tests/fixtures (Python); the file is copied verbatim
// and never edited in one repo alone.
//
// Two rows are NEGATIVE-INPUT cases per DRILL_CATALOG_V2_CONTRACT §11: their
// arithmetic is historical and correct, but the inputs may not be prescribed.
// 01A required rejection assertions for exactly these two before the file is
// used as an acceptance fixture.

import { describe, expect, it } from "vitest";
import fixture from "./__fixtures__/expected_minutes_fixture.json";
import {
  MAX_BLOCK_DECISECONDS,
  WORK_DECISECONDS_PER_UNIT,
  blockDeciseconds,
  blockEstimatedMinutes,
  blockInputErrors,
  catalogTimeDefaults,
  minutesFromDeciseconds,
  workoutEstimatedMinutes,
} from "./expectedMinutes";
import type { BlockTimeInput } from "./expectedMinutes";

const REJECTED_CASE_IDS = new Set(["seconds-per-rep-rest", "max-clamp"]);

interface FixtureBlock {
  id: string;
  description: string;
  input: BlockTimeInput;
  expected: { deciseconds: number; estimatedMinutes: number };
}

const blocks = fixture.blocks as unknown as FixtureBlock[];
const byId = new Map(blocks.map(row => [row.id, row]));

describe("shared fixture", () => {
  it("carries the 27 block rows and 3 workout rows the contract names", () => {
    expect(blocks).toHaveLength(27);
    expect(fixture.workouts).toHaveLength(3);
  });

  it("agrees with the constants this implementation uses", () => {
    expect(fixture.constants.workDecisecondsPerUnit).toEqual(WORK_DECISECONDS_PER_UNIT);
    expect(fixture.constants.transitionSecondsBetweenBlocks).toBe(60);
    expect(fixture.constants.minBlockMinutes).toBe(1);
    expect(fixture.constants.maxBlockMinutes).toBe(90);
  });
});

describe("blockDeciseconds / blockEstimatedMinutes", () => {
  for (const row of blocks) {
    it(`${row.id} — ${row.description}`, () => {
      expect(blockDeciseconds(row.input)).toBe(row.expected.deciseconds);
      expect(blockEstimatedMinutes(row.input)).toBe(row.expected.estimatedMinutes);
    });
  }
});

describe("input validity (catalog §11)", () => {
  for (const row of blocks) {
    if (REJECTED_CASE_IDS.has(row.id)) continue;
    it(`${row.id} is a legal prescription`, () => {
      expect(blockInputErrors(row.input)).toEqual([]);
    });
  }

  // A timed drill's `reps` is the length of ONE continuous set, so there is no
  // separate effort to rest between: this row's arithmetic is right and its
  // prescription is not.
  it("refuses seconds-per-rep-rest: per-rep rest on a duration unit", () => {
    const row = byId.get("seconds-per-rep-rest")!;
    const errors = blockInputErrors(row.input);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(" ")).toMatch(/one continuous set/);
    // The historical arithmetic is unchanged — only acceptance is refused.
    expect(blockDeciseconds(row.input)).toBe(1760);
  });

  // 1 × 100 minutes is 100 real minutes; the 90-minute clamp must not turn it
  // into a permitted 90-minute prescription.
  it("refuses max-clamp: real work beyond the 90-minute ceiling", () => {
    const row = byId.get("max-clamp")!;
    expect(blockDeciseconds(row.input)).toBe(60000);
    expect(blockDeciseconds(row.input)).toBeGreaterThan(MAX_BLOCK_DECISECONDS);
    expect(blockInputErrors(row.input).join(" ")).toMatch(/over the 90-minute limit/);
    // The display clamp itself still behaves as the fixture records.
    expect(blockEstimatedMinutes(row.input)).toBe(90);
  });

  it("rejects non-integer, boolean and negative inputs", () => {
    const base: BlockTimeInput = {
      sets: 2, reps: 4, repUnit: "reps", perSide: false,
      restSeconds: 30, restScope: "sets", restBetweenSetsSeconds: null, familiarizationReps: 0,
    };
    expect(blockInputErrors({ ...base, sets: 2.5 })).not.toEqual([]);
    expect(blockInputErrors({ ...base, sets: 0 })).not.toEqual([]);
    expect(blockInputErrors({ ...base, reps: true as unknown as number })).not.toEqual([]);
    expect(blockInputErrors({ ...base, restSeconds: -1 })).not.toEqual([]);
    expect(blockInputErrors({ ...base, familiarizationReps: -2 })).not.toEqual([]);
    expect(blockInputErrors({ ...base, repUnit: "laps" })).not.toEqual([]);
    expect(blockInputErrors({ ...base, restScope: "workouts" as unknown as "sets" })).not.toEqual([]);
    expect(blockInputErrors({ ...base, perSide: 1 as unknown as boolean })).not.toEqual([]);
  });

  it("refuses familiarization reps on a distance unit", () => {
    const errors = blockInputErrors({
      sets: 3, reps: 20, repUnit: "meters", perSide: false,
      restSeconds: 30, restScope: "sets", restBetweenSetsSeconds: null, familiarizationReps: 2,
    });
    expect(errors.join(" ")).toMatch(/counted units/);
  });
});

describe("workoutEstimatedMinutes", () => {
  for (const workout of fixture.workouts as { id: string; description: string; blockCaseIds: string[]; expected: { blockMinutes: number[]; transitionMinutes: number; estimatedMinutes: number } }[]) {
    it(`${workout.id} — ${workout.description}`, () => {
      const minutes = workout.blockCaseIds.map(id => blockEstimatedMinutes(byId.get(id)!.input));
      expect(minutes).toEqual(workout.expected.blockMinutes);
      expect(workoutEstimatedMinutes(minutes)).toBe(workout.expected.estimatedMinutes);
    });
  }
});

describe("minutesFromDeciseconds", () => {
  it("ceilings, floors at 1 and caps at 90", () => {
    expect(minutesFromDeciseconds(0)).toBe(1);
    expect(minutesFromDeciseconds(1)).toBe(1);
    expect(minutesFromDeciseconds(600)).toBe(1);
    expect(minutesFromDeciseconds(601)).toBe(2);
    expect(minutesFromDeciseconds(54000)).toBe(90);
    expect(minutesFromDeciseconds(60000)).toBe(90);
  });
});

describe("catalogTimeDefaults (§9.2)", () => {
  it("takes restSecondsMax, and per-rep rest for a single-set counted drill", () => {
    expect(catalogTimeDefaults({ setsMax: 1, restSecondsMax: 60 }, "reps")).toEqual({
      restSeconds: 60, restScope: "reps", restBetweenSetsSeconds: null, familiarizationReps: 0,
    });
  });

  it("defaults to set rest for a multi-set drill and treats a null rest as 0", () => {
    expect(catalogTimeDefaults({ setsMax: 4, restSecondsMax: null }, "reps")).toEqual({
      restSeconds: 0, restScope: "sets", restBetweenSetsSeconds: null, familiarizationReps: 0,
    });
  });

  it("honors an explicit restScope and the between-sets maximum", () => {
    expect(catalogTimeDefaults(
      { setsMax: 3, restSecondsMax: 25, restScope: "reps", restBetweenSetsSecondsMax: 210, familiarizationReps: 2 },
      "reps",
    )).toEqual({ restSeconds: 25, restScope: "reps", restBetweenSetsSeconds: 210, familiarizationReps: 2 });
  });

  it("never produces per-rep rest or familiarization for a timed drill", () => {
    const defaults = catalogTimeDefaults({ setsMax: 1, restSecondsMax: 30, familiarizationReps: 2 }, "minutes");
    expect(defaults.restScope).toBe("sets");
    expect(defaults.familiarizationReps).toBe(0);
    expect(blockInputErrors({ sets: 1, reps: 12, repUnit: "minutes", ...defaults })).toEqual([]);
  });
});
