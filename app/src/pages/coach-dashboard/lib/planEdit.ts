// Pure plan-editing operations for the coach dashboard's week-by-week editor.
//
// A coach edit must leave the plan doc shaped exactly like a gateway-written
// one (schemas/training_plan_v1.py): every drill row carries the full
// _PLAN_DRILL field set plus the server-computed `weeklyMinutes`, and each
// week's `targets` stay the per-domain frequencyPerWeek sums — the workout
// builder and the athlete's progress bars are both derived from them.

/* eslint-disable @typescript-eslint/no-explicit-any */

// MARK: - Schema bounds (training_plan_v1._PLAN_DRILL)

export const DOSE_BOUNDS = {
  sets: { min: 1, max: 10 },
  reps: { min: 1, max: 500 },
  restSeconds: { min: 0, max: 600 },
  frequencyPerWeek: { min: 1, max: 7 },
  estimatedMinutes: { min: 1, max: 90 },
} as const;

export const MAX_DRILLS_PER_WEEK = 8;
export const REP_UNITS = ["reps", "seconds", "contacts", "meters", "minutes", "cues", "passes", "shots"];
export const INTENSITY_INTENTS = ["low", "moderate", "high", "maxQuality"];

export interface DoseDraft {
  sets: number;
  reps: number;
  repUnit: string;
  restSeconds: number;
  frequencyPerWeek: number;
  estimatedMinutes: number;
}

function toInt(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : NaN;
}

// Human-readable validation errors against the gateway schema bounds, so an
// invalid dose never reaches the doc.
export function doseErrors(dose: DoseDraft): string[] {
  const errors: string[] = [];
  const check = (label: string, value: number, bounds: { min: number; max: number }) => {
    if (!Number.isFinite(value)) errors.push(`${label} must be a number.`);
    else if (value < bounds.min || value > bounds.max) {
      errors.push(`${label} must be between ${bounds.min} and ${bounds.max}.`);
    }
  };
  check("Sets", toInt(dose.sets), DOSE_BOUNDS.sets);
  check("Reps", Number(dose.reps), DOSE_BOUNDS.reps);
  check("Rest", toInt(dose.restSeconds), DOSE_BOUNDS.restSeconds);
  check("Days per week", toInt(dose.frequencyPerWeek), DOSE_BOUNDS.frequencyPerWeek);
  check("Minutes", toInt(dose.estimatedMinutes), DOSE_BOUNDS.estimatedMinutes);
  if (!REP_UNITS.includes(dose.repUnit)) errors.push("Unknown rep unit.");
  return errors;
}

// MARK: - Catalog defaults

// The standard dose a catalog drill prescribes: the midpoint of each workbook
// range, so "just click through" lands on a sensible default.
function midpoint(min: unknown, max: unknown, fallback: number): number {
  const lo = Number(min);
  const hi = Number(max);
  if (Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo) return Math.round((lo + hi) / 2);
  if (Number.isFinite(lo)) return Math.round(lo);
  return fallback;
}

function clampTo(value: number, bounds: { min: number; max: number }): number {
  return Math.min(Math.max(value, bounds.min), bounds.max);
}

export function defaultDoseFor(catalogDrill: any): DoseDraft {
  const dose = catalogDrill?.dose || {};
  const estimated = catalogDrill?.estimatedMinutes || {};
  return {
    sets: clampTo(midpoint(dose.setsMin, dose.setsMax, 3), DOSE_BOUNDS.sets),
    reps: Math.max(midpoint(dose.repsMin, dose.repsMax, 6), 1),
    repUnit: REP_UNITS.includes(String(dose.repUnit)) ? String(dose.repUnit) : "reps",
    restSeconds: clampTo(midpoint(dose.restSecondsMin, dose.restSecondsMax, 60), DOSE_BOUNDS.restSeconds),
    frequencyPerWeek: clampTo(midpoint(dose.frequencyPerWeekMin, dose.frequencyPerWeekMax, 2), DOSE_BOUNDS.frequencyPerWeek),
    estimatedMinutes: clampTo(midpoint(estimated.min, estimated.max, 10), DOSE_BOUNDS.estimatedMinutes),
  };
}

// MARK: - Drill rows

export function weeklyMinutes(row: { estimatedMinutes?: unknown; frequencyPerWeek?: unknown }): number {
  const minutes = Number(row?.estimatedMinutes) || 0;
  const frequency = Number(row?.frequencyPerWeek) || 0;
  return minutes * frequency;
}

// A full _PLAN_DRILL row from a catalog entry + the coach's dose. `cues` are
// schema-capped (≤4, ≤80 chars each); `note` marks provenance for the athlete.
export function drillRowFromCatalog(catalogDrill: any, dose: DoseDraft): Record<string, any> {
  const intensity = INTENSITY_INTENTS.includes(String(catalogDrill?.intensityIntent))
    ? String(catalogDrill.intensityIntent)
    : "moderate";
  const row: Record<string, any> = {
    drillId: String(catalogDrill?.drillId || catalogDrill?.id || ""),
    name: String(catalogDrill?.name || "Drill"),
    domain: String(catalogDrill?.domain || ""),
    sets: toInt(dose.sets),
    reps: Number(dose.reps),
    repUnit: dose.repUnit,
    restSeconds: toInt(dose.restSeconds),
    frequencyPerWeek: toInt(dose.frequencyPerWeek),
    intensityIntent: intensity,
    estimatedMinutes: toInt(dose.estimatedMinutes),
    cues: (Array.isArray(catalogDrill?.cues) ? catalogDrill.cues : [])
      .slice(0, 4)
      .map((cue: unknown) => String(cue).slice(0, 80)),
    note: "Added by your coach",
  };
  row.weeklyMinutes = weeklyMinutes(row);
  return row;
}

// MARK: - Week operations (all return a NEW week object)

// Per-domain frequencyPerWeek sums — the same derivation the gateway finalizer
// runs, so progress bars keep meaning after a coach edit.
export function derivedTargets(week: any): { domain: string; exposures: number }[] {
  const sums = new Map<string, number>();
  const order: string[] = [];
  for (const drill of week?.drills || []) {
    const domain = String(drill?.domain || "");
    if (!domain) continue;
    if (!sums.has(domain)) order.push(domain);
    sums.set(domain, (sums.get(domain) ?? 0) + (Number(drill?.frequencyPerWeek) || 0));
  }
  return order.map(domain => ({ domain, exposures: sums.get(domain) ?? 0 }));
}

function normalizedWeek(week: any, drills: any[]): any {
  const next = { ...week, drills: drills.map(row => ({ ...row, weeklyMinutes: weeklyMinutes(row) })) };
  next.targets = derivedTargets(next);
  return next;
}

export function addDrillToWeek(week: any, row: Record<string, any>): any {
  const drills = [...(week?.drills || [])];
  if (drills.length >= MAX_DRILLS_PER_WEEK) {
    throw new Error(`A week holds at most ${MAX_DRILLS_PER_WEEK} drills — remove one first.`);
  }
  if (drills.some((drill: any) => drill?.drillId === row.drillId)) {
    throw new Error("That drill is already in this week.");
  }
  drills.push(row);
  return normalizedWeek(week, drills);
}

export function removeDrillFromWeek(week: any, drillId: string): any {
  const drills = (week?.drills || []).filter((drill: any) => drill?.drillId !== drillId);
  return normalizedWeek(week, drills);
}

export function updateDrillDose(week: any, drillId: string, dose: DoseDraft): any {
  const drills = (week?.drills || []).map((drill: any) =>
    drill?.drillId === drillId
      ? {
          ...drill,
          sets: toInt(dose.sets),
          reps: Number(dose.reps),
          repUnit: dose.repUnit,
          restSeconds: toInt(dose.restSeconds),
          frequencyPerWeek: toInt(dose.frequencyPerWeek),
          estimatedMinutes: toInt(dose.estimatedMinutes),
        }
      : drill,
  );
  return normalizedWeek(week, drills);
}

export function doseDraftFrom(drill: any): DoseDraft {
  return {
    sets: toInt(drill?.sets) || 1,
    reps: Number(drill?.reps) || 1,
    repUnit: REP_UNITS.includes(String(drill?.repUnit)) ? String(drill?.repUnit) : "reps",
    restSeconds: toInt(drill?.restSeconds) || 0,
    frequencyPerWeek: toInt(drill?.frequencyPerWeek) || 1,
    estimatedMinutes: toInt(drill?.estimatedMinutes) || 10,
  };
}

// MARK: - Plan operations

// Replaces one week in the plan's weeks array (matched on weekNumber).
export function withEditedWeek(plan: any, editedWeek: any): any[] {
  return (plan?.weeks || []).map((week: any) =>
    Number(week?.weekNumber) === Number(editedWeek?.weekNumber) ? editedWeek : week,
  );
}

// The final horizon week is the server-stamped retest week (all six measured
// drills, no prescriptions) — the editor treats it as read-only.
//
// v1/v2 only: TRAINING_PROGRAM_V3_CONTRACT.md §7 removes generated retesting
// entirely, so a v3 plan's last week is an ordinary training week and must not
// be greyed out as a retest.
export function isRetestWeek(plan: any, weekNumber: number): boolean {
  if (Number(plan?.schemaVersion) === 3) return false;
  const horizon = Number(plan?.horizonWeeks) || (plan?.weeks || []).length;
  return Number(weekNumber) === horizon;
}

export function weekMinuteTotal(week: any): number {
  return (week?.drills || []).reduce((total: number, drill: any) => total + weeklyMinutes(drill), 0);
}
