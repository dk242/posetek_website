// Reading a `schemaVersion: 3` training plan — TRAINING_PROGRAM_V3_CONTRACT.md
// §4 (weeks), §5 (workouts and blocks), §7 (the "next workout" rule), §8.1
// (workout logs) and §11/§13 (the derived week figures).
//
// Everything here is pure. The rule below is evaluated identically by the app,
// the gateway and this website; if the three disagree, the athlete's phone and
// the admin's screen disagree about what happens next.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { transitionMinutes, workoutEstimatedMinutes } from "./expectedMinutes";
import type { PlanV3, WeekV3, WorkoutV3 } from "./types";

// MARK: - Calendar arithmetic in the plan's timezone

/** "YYYY-MM-DD" for `at` as seen in `timezone`. Calendar dates, never elapsed seconds (DST). */
export function localDayString(at: Date, timezone: string | null | undefined): string {
  if (!timezone) {
    const year = at.getFullYear();
    const month = String(at.getMonth() + 1).padStart(2, "0");
    const day = String(at.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  try {
    // en-CA formats as YYYY-MM-DD, which is exactly the plan's startDate shape.
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(at);
  } catch {
    return localDayString(at, null);
  }
}

function dayNumber(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!match) return null;
  const [, year, month, date] = match;
  const value = Date.UTC(Number(year), Number(month) - 1, Number(date));
  return Number.isFinite(value) ? value / 86400000 : null;
}

/** Whole calendar days from `from` to `to`, both "YYYY-MM-DD". */
export function daysBetween(from: string, to: string): number | null {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null ? null : b - a;
}

export function addDays(day: string, days: number): string {
  const base = dayNumber(day);
  if (base === null) return day;
  const date = new Date((base + days) * 86400000);
  return date.toISOString().slice(0, 10);
}

export function planHorizonWeeks(plan: PlanV3 | any): number {
  const declared = Number(plan?.horizonWeeks);
  if (Number.isFinite(declared) && declared >= 1) return Math.round(declared);
  return Math.max((plan?.weeks || []).length, 1);
}

/** The week `now` falls in, clamped to [1, horizonWeeks]. */
export function currentWeekNumber(plan: PlanV3 | any, now: Date = new Date()): number {
  const today = localDayString(now, plan?.timezone);
  const delta = daysBetween(String(plan?.startDate ?? ""), today);
  if (delta === null) return 1;
  const computed = Math.floor(delta / 7) + 1;
  return Math.min(Math.max(computed, 1), planHorizonWeeks(plan));
}

export interface DayWindow {
  /** inclusive "YYYY-MM-DD" */
  start: string;
  /** exclusive "YYYY-MM-DD" */
  end: string;
}

export function weekWindow(plan: PlanV3 | any, weekNumber: number): DayWindow | null {
  const start = String(plan?.startDate ?? "");
  if (!dayNumber(start) || weekNumber < 1) return null;
  return { start: addDays(start, 7 * (weekNumber - 1)), end: addDays(start, 7 * weekNumber) };
}

export function weekWindowLabel(window: DayWindow): string {
  const format = (day: string) => {
    const value = dayNumber(day);
    if (value === null) return day;
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
      .format(new Date(value * 86400000));
  };
  return `${format(window.start)} – ${format(addDays(window.end, -1))}`;
}

// MARK: - Ordering

export function orderedWeeks(plan: PlanV3 | any): WeekV3[] {
  return [...(plan?.weeks || [])].sort(
    (a: any, b: any) => (Number(a?.weekNumber) || 0) - (Number(b?.weekNumber) || 0),
  );
}

export function orderedWorkouts(week: WeekV3 | any): WorkoutV3[] {
  return [...(week?.workouts || [])].sort((a: any, b: any) => (Number(a?.order) || 0) - (Number(b?.order) || 0));
}

export function orderedBlocks(workout: WorkoutV3 | any): any[] {
  return [...(workout?.blocks || [])].sort((a: any, b: any) => (Number(a?.order) || 0) - (Number(b?.order) || 0));
}

export function weekOf(plan: PlanV3 | any, weekNumber: number): WeekV3 | null {
  return (plan?.weeks || []).find((week: any) => Number(week?.weekNumber) === weekNumber) || null;
}

export function findWorkout(
  plan: PlanV3 | any,
  workoutId: string,
): { week: WeekV3; workout: WorkoutV3 } | null {
  for (const week of plan?.weeks || []) {
    for (const workout of week?.workouts || []) {
      if (String(workout?.workoutId) === workoutId) return { week, workout };
    }
  }
  return null;
}

// MARK: - Logs (§8.1)

/** `logId = "{planId}_{workoutId}"` for a plan workout — unique across plans. */
export function planLogId(planId: string, workoutId: string): string {
  return `${planId}_${workoutId}`;
}

export type WorkoutState =
  | { kind: "notStarted" }
  | { kind: "inProgress"; startedAt: unknown }
  | { kind: "finished"; endReason: string };

/**
 * Index logs by workoutId for one plan. A log with `endedAt` set is finished
 * for ANY end reason — including endedEarly and abandoned, which is the written
 * scheduling policy, not a claim that its targets were met.
 */
export function workoutStates(planId: string | string[], logs: any[]): Map<string, WorkoutState> {
  // A caller may know the plan by its document id, by its `planId` field, or
  // both; they are the same value in practice but nothing enforces it, and a
  // mismatch would silently show every workout as never started.
  const accepted = new Set((Array.isArray(planId) ? planId : [planId]).filter(Boolean));
  const states = new Map<string, WorkoutState>();
  for (const log of logs || []) {
    const logPlanId = String(log?.planId ?? "");
    if (!accepted.has(logPlanId)) continue;
    if (log?.source === "adhoc") continue; // ad-hoc work never occupies a plan slot
    const workoutId = String(log?.workoutId ?? "");
    if (!workoutId) continue;
    // Guard against a v1 log whose id collides: the plan log id is canonical.
    if (log?.id && String(log.id) !== planLogId(logPlanId, workoutId)) continue;
    states.set(
      workoutId,
      log?.endedAt
        ? { kind: "finished", endReason: String(log?.endReason ?? "completed") }
        : { kind: "inProgress", startedAt: log?.startedAt },
    );
  }
  return states;
}

export function stateOf(states: Map<string, WorkoutState>, workoutId: string): WorkoutState {
  return states.get(workoutId) ?? { kind: "notStarted" };
}

// MARK: - The "next workout" rule (§7)

export interface NextWorkout {
  weekNumber: number;
  workout: WorkoutV3;
  reason: "resume" | "next";
}

/**
 * Resume beats everything; then the first unfinished workout of the current
 * week by order; then the first unfinished workout of any later week. Skipped
 * weeks are never back-filled, and an inactive plan has no next workout.
 */
export function nextWorkout(
  plan: PlanV3 | any,
  logs: any[],
  now: Date = new Date(),
): NextWorkout | null {
  if (String(plan?.status ?? "active") !== "active") return null;
  const states = workoutStates([String(plan?.planId ?? ""), String(plan?.id ?? "")], logs);
  const week = currentWeekNumber(plan, now);
  const current = weekOf(plan, week);

  if (current) {
    for (const workout of orderedWorkouts(current)) {
      if (stateOf(states, String(workout.workoutId)).kind === "inProgress") {
        return { weekNumber: week, workout, reason: "resume" };
      }
    }
    for (const workout of orderedWorkouts(current)) {
      if (stateOf(states, String(workout.workoutId)).kind !== "finished") {
        return { weekNumber: week, workout, reason: "next" };
      }
    }
  }

  for (const later of orderedWeeks(plan)) {
    const weekNumber = Number(later?.weekNumber) || 0;
    if (weekNumber <= week) continue;
    for (const workout of orderedWorkouts(later)) {
      if (stateOf(states, String(workout.workoutId)).kind !== "finished") {
        return { weekNumber, workout, reason: "next" };
      }
    }
  }
  return null;
}

// MARK: - Derived week figures (§4, §13)

/** Exposures per domain = the number of this week's workouts containing ≥1 block of the domain. */
export function derivedTargets(week: WeekV3 | any): { domain: string; exposures: number }[] {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const workout of week?.workouts || []) {
    const seen = new Set<string>();
    for (const block of workout?.blocks || []) {
      const domain = String(block?.domain ?? "");
      if (!domain || seen.has(domain)) continue;
      seen.add(domain);
      if (!counts.has(domain)) order.push(domain);
      counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
  }
  return order.map(domain => ({ domain, exposures: counts.get(domain) ?? 0 }));
}

/** Actual prescribed minutes per domain across the week. Transitions are overhead, never credited. */
export function actualMinutesByDomain(week: WeekV3 | any): Record<string, number> {
  const minutes: Record<string, number> = {};
  for (const workout of week?.workouts || []) {
    for (const block of workout?.blocks || []) {
      const domain = String(block?.domain ?? "");
      if (!domain) continue;
      minutes[domain] = (minutes[domain] ?? 0) + (Number(block?.estimatedMinutes) || 0);
    }
  }
  return minutes;
}

export function weekTransitionMinutes(week: WeekV3 | any): number {
  return (week?.workouts || []).reduce(
    (total: number, workout: any) => total + transitionMinutes((workout?.blocks || []).length),
    0,
  );
}

export function weekEstimatedMinutes(week: WeekV3 | any): number {
  return (week?.workouts || []).reduce(
    (total: number, workout: any) => total + (Number(workout?.estimatedMinutes) || 0),
    0,
  );
}

/** The distinct drill ids across the week's workouts, in first-appearance order (§4). */
export function weekDrillIds(week: WeekV3 | any): string[] {
  const ids: string[] = [];
  for (const workout of orderedWorkouts(week)) {
    for (const block of orderedBlocks(workout)) {
      const drillId = String(block?.drillId ?? "");
      if (drillId && !ids.includes(drillId)) ids.push(drillId);
    }
  }
  return ids;
}

/** Recompute a workout's `estimatedMinutes` from its blocks' stored per-block minutes. */
export function workoutMinutes(workout: WorkoutV3 | any): number {
  return workoutEstimatedMinutes(
    (workout?.blocks || []).map((block: any) => Number(block?.estimatedMinutes) || 0),
  );
}

/**
 * How many of a week's *scheduled* workouts contain a drill, with one workout
 * optionally replaced by a proposed body (program §13: count the target once,
 * replacement-aware, so editing a workout that already contains the drill is
 * not falsely rejected).
 */
export function scheduledExposures(
  week: WeekV3 | any,
  drillId: string,
  replacement?: { workoutId: string; blocks: { drillId: string }[] } | null,
): number {
  let count = 0;
  for (const workout of week?.workouts || []) {
    const isTarget = replacement && String(workout?.workoutId) === replacement.workoutId;
    const blocks = isTarget ? replacement!.blocks : workout?.blocks || [];
    if (blocks.some((block: any) => String(block?.drillId) === drillId)) count += 1;
  }
  if (replacement && !(week?.workouts || []).some((w: any) => String(w?.workoutId) === replacement.workoutId)) {
    if (replacement.blocks.some(block => String(block?.drillId) === drillId)) count += 1;
  }
  return count;
}
