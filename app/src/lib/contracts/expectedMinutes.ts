// The shared expected-time formula — DRILL_CATALOG_V2_CONTRACT.md §9, with the
// input-validity guards from §11.
//
// One deterministic function, implemented three times (Python in the gateway,
// Swift in the app, TypeScript here) and tested against the shared fixture at
// __fixtures__/expected_minutes_fixture.json. **No surface may estimate minutes
// any other way** — not a model, not a per-repo heuristic. A change to the
// formula is a change to the contract, the fixture and all three copies in one
// commit.
//
// Integer arithmetic only, in deciseconds. Deciseconds exist because 0.6 s per
// metre is not an integer number of seconds; every other unit is a multiple of
// ten. There is no `.5` rounding case because nothing here is a float.

import { isContinuousUnit, REP_UNITS } from "./types";
import type { RepUnit } from "./types";

export const WORK_DECISECONDS_PER_UNIT: Record<RepUnit, number> = {
  reps: 80,
  contacts: 20,
  cues: 50,
  passes: 100,
  shots: 150,
  seconds: 10,
  minutes: 600,
  meters: 6,
};

export const MIN_BLOCK_MINUTES = 1;
export const MAX_BLOCK_MINUTES = 90;
/** 90 real minutes. Saturation must never turn 100 actual minutes into a permitted 90 (§11). */
export const MAX_BLOCK_DECISECONDS = 54000;
export const TRANSITION_MINUTES_BETWEEN_BLOCKS = 1;

export interface BlockTimeInput {
  sets: number;
  reps: number;
  repUnit: string;
  perSide?: boolean | null;
  restSeconds: number;
  restScope?: "reps" | "sets" | null;
  restBetweenSetsSeconds?: number | null;
  familiarizationReps?: number | null;
}

function workDeciseconds(unit: string, count: number): number {
  return count * (WORK_DECISECONDS_PER_UNIT[unit as RepUnit] ?? 0);
}

function effectiveRestScope(input: BlockTimeInput): "reps" | "sets" {
  return input.restScope === "reps" ? "reps" : "sets";
}

/**
 * The §9.2 arithmetic, with no validation. Callers that are about to PERSIST a
 * block must run `blockInputErrors` first — this function will happily compute
 * a number for an input the contract refuses.
 */
export function blockDeciseconds(input: BlockTimeInput): number {
  const sets = input.sets;
  const reps = input.reps;
  const restDs = input.restSeconds * 10;
  const betweenSetsDs =
    input.restBetweenSetsSeconds === null || input.restBetweenSetsSeconds === undefined
      ? restDs
      : input.restBetweenSetsSeconds * 10;
  const familiarization = input.familiarizationReps ?? 0;

  const setDs =
    effectiveRestScope(input) === "reps"
      ? workDeciseconds(input.repUnit, reps) + restDs * (reps - 1)
      : workDeciseconds(input.repUnit, reps);

  let total =
    sets * setDs +
    betweenSetsDs * (sets - 1) +
    familiarization * (workDeciseconds(input.repUnit, 1) + restDs);

  if (input.perSide === true) total *= 2;
  return total;
}

/** clamp(ceilDiv(ds, 600), 1, 90) — integer ceiling division, never 0. */
export function minutesFromDeciseconds(deciseconds: number): number {
  const minutes = Math.floor((deciseconds + 599) / 600);
  return Math.min(Math.max(minutes, MIN_BLOCK_MINUTES), MAX_BLOCK_MINUTES);
}

export function blockEstimatedMinutes(input: BlockTimeInput): number {
  return minutesFromDeciseconds(blockDeciseconds(input));
}

/** Σ blockMinutes + (blockCount − 1); 0 for an empty draft. */
export function workoutEstimatedMinutes(blockMinutes: number[]): number {
  if (!blockMinutes.length) return 0;
  const sum = blockMinutes.reduce((total, minutes) => total + minutes, 0);
  return sum + (blockMinutes.length - 1) * TRANSITION_MINUTES_BETWEEN_BLOCKS;
}

export function transitionMinutes(blockCount: number): number {
  return blockCount > 1 ? (blockCount - 1) * TRANSITION_MINUTES_BETWEEN_BLOCKS : 0;
}

// MARK: - Input validity (§9.1 and §11)

// Booleans are not integers — `true` must not slip through as 1.
function isPositiveInt(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isNonNegativeInt(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Every reason this block may not be prescribed. Empty means the arithmetic
 * above may be persisted. The 90-minute clamp is a DISPLAY rule; a block whose
 * real work exceeds 90 minutes is rejected here rather than silently saturated.
 */
export function blockInputErrors(input: BlockTimeInput): string[] {
  const errors: string[] = [];

  if (!isPositiveInt(input.sets)) errors.push("Sets must be a whole number of at least 1.");
  if (!isPositiveInt(input.reps)) {
    errors.push(
      isContinuousUnit(input.repUnit)
        ? "The per-set duration or distance must be a whole number of at least 1."
        : "Reps must be a whole number of at least 1.",
    );
  }
  if (!(REP_UNITS as readonly string[]).includes(input.repUnit)) {
    errors.push(`Unknown rep unit “${String(input.repUnit)}”.`);
  }
  if (input.perSide !== undefined && input.perSide !== null && typeof input.perSide !== "boolean") {
    errors.push("Per-side must be true or false.");
  }
  if (!isNonNegativeInt(input.restSeconds)) errors.push("Rest must be a whole number of seconds, 0 or more.");
  if (input.restScope !== undefined && input.restScope !== null
      && input.restScope !== "reps" && input.restScope !== "sets") {
    errors.push("Rest scope must be “reps” or “sets”.");
  }
  if (input.restBetweenSetsSeconds !== undefined && input.restBetweenSetsSeconds !== null
      && !isNonNegativeInt(input.restBetweenSetsSeconds)) {
    errors.push("Rest between sets must be a whole number of seconds, 0 or more.");
  }
  if (input.familiarizationReps !== undefined && input.familiarizationReps !== null
      && !isNonNegativeInt(input.familiarizationReps)) {
    errors.push("Familiarization reps must be a whole number, 0 or more.");
  }

  // §11: for a duration/distance unit, `reps` is the size of ONE continuous
  // set — there is no separate effort count to rest between. A nested effort
  // with its own set rest must be split into explicit blocks.
  if (isContinuousUnit(input.repUnit) && input.restScope === "reps") {
    errors.push(
      "Rest between reps is not valid for a timed or distance drill — its value is one continuous set. Use sets for repeated efforts.",
    );
  }
  if (isContinuousUnit(input.repUnit) && (input.familiarizationReps ?? 0) > 0) {
    errors.push("Familiarization reps are only supported for counted units.");
  }

  if (errors.length) return errors;

  const deciseconds = blockDeciseconds(input);
  if (deciseconds > MAX_BLOCK_DECISECONDS) {
    errors.push(
      `This block is about ${Math.floor((deciseconds + 599) / 600)} minutes of real work — over the ${MAX_BLOCK_MINUTES}-minute limit for one block. Split it.`,
    );
  }
  return errors;
}

export function isPrescribableBlock(input: BlockTimeInput): boolean {
  return blockInputErrors(input).length === 0;
}

// MARK: - Building a block's time inputs from a catalog drill (§9.2)

export interface CatalogTimeDefaults {
  restSeconds: number;
  restScope: "reps" | "sets";
  restBetweenSetsSeconds: number | null;
  familiarizationReps: number;
}

function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

/**
 * "When a block is built from a catalog drill" (§9.2): rest defaults to the
 * drill's `restSecondsMax` (null → 0), scope to the drill's `restScope` if set,
 * else "reps" when `setsMax == 1`, else "sets". The block then STORES every
 * input it used, so the three implementations compute from the block alone with
 * no catalog lookup.
 *
 * §11 overrides §9.2's default for a timed/distance drill: per-rep rest and
 * familiarization are not representable there, so a `1 × 12 minutes` drill gets
 * `restScope: "sets"` rather than the invalid `"reps"` the bare default would
 * produce. This is the only reading under which both sections hold.
 */
export function catalogTimeDefaults(
  dose: Record<string, unknown> | null | undefined,
  repUnit: string,
): CatalogTimeDefaults {
  const restSeconds = intOrNull(dose?.restSecondsMax) ?? 0;
  const explicitScope = dose?.restScope;
  const setsMax = intOrNull(dose?.setsMax);
  const continuous = isContinuousUnit(repUnit);
  const restScope: "reps" | "sets" = continuous
    ? "sets"
    : explicitScope === "reps" || explicitScope === "sets"
      ? explicitScope
      : setsMax === 1
        ? "reps"
        : "sets";
  return {
    restSeconds: Math.max(restSeconds, 0),
    restScope,
    restBetweenSetsSeconds: intOrNull(dose?.restBetweenSetsSecondsMax),
    familiarizationReps: continuous ? 0 : Math.max(intOrNull(dose?.familiarizationReps) ?? 0, 0),
  };
}
