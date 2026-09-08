// Pure aggregation logic for the coach dashboard: per-athlete summaries
// (training time, session counts, focus areas, plan progress) and the
// generate_training_plan job payload (default intake + the web-built
// statsProfile snapshot the gateway range-checks).
//
// No DOM, no Firebase — everything here is testable with plain objects.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { buildProfile } from "../../../components/athlete-stats/AthleteStats";
import type { AthleteProfile } from "../../../components/athlete-stats/AthleteStats";
import {
  currentWeekNumber,
  daysLeftInWeek,
  planHorizonWeeks,
  toDate,
} from "../../athlete-portal/lib/training";

// MARK: - Small helpers

export function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampScore(value: number): number {
  const clamped = Math.min(Math.max(value, 0), 400);
  return Math.round(clamped * 100) / 100;
}

// MARK: - Active plan selection

// The athlete's current program: newest `active` plan. The gateway supersedes
// older plans on regeneration, but "newest generatedAt wins" also tolerates a
// stale pair of actives.
export function activePlan(plans: any[]): any | null {
  const actives = (plans || []).filter(plan => plan?.status === "active");
  if (!actives.length) return null;
  return [...actives].sort(
    (a, b) => (toDate(b?.generatedAt)?.valueOf() ?? 0) - (toDate(a?.generatedAt)?.valueOf() ?? 0),
  )[0];
}

// MARK: - Training time / activity aggregates

export interface TrainingTotals {
  /** Wall-clock seconds across ended workout logs. */
  trainingSeconds: number;
  workoutsCompleted: number;
  workoutsStarted: number;
  lastActiveMillis: number | null;
}

export function trainingTotals(logs: any[], reps: any[]): TrainingTotals {
  let seconds = 0;
  let completed = 0;
  let started = 0;
  let lastActive: number | null = null;

  const note = (millis: number | null | undefined) => {
    if (typeof millis === "number" && Number.isFinite(millis) && millis > 0) {
      lastActive = lastActive === null ? millis : Math.max(lastActive, millis);
    }
  };

  for (const log of logs || []) {
    started += 1;
    if (log?.endReason === "completed") completed += 1;
    const startedAt = toDate(log?.startedAt);
    const endedAt = toDate(log?.endedAt);
    if (startedAt && endedAt) {
      seconds += Math.max((endedAt.valueOf() - startedAt.valueOf()) / 1000, 0);
      note(endedAt.valueOf());
    } else if (startedAt) {
      note(startedAt.valueOf());
    }
  }
  for (const rep of reps || []) note(rep?.createdAtMillis);

  return { trainingSeconds: seconds, workoutsCompleted: completed, workoutsStarted: started, lastActiveMillis: lastActive };
}

export function hoursLine(seconds: number): string {
  if (!(seconds > 0)) return "0 min";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function lastActiveLine(millis: number | null, now: Date = new Date()): string {
  if (!millis) return "No activity yet";
  const days = Math.floor((now.valueOf() - millis) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(millis));
}

// MARK: - Focus areas

export interface FocusArea {
  domain: string;
  /** "plan" = written by the plan agent; "suggested" = weakest measured axes. */
  source: "plan" | "suggested";
}

// Web axis key -> plan domain vocabulary, for the "no plan yet" suggestion.
const AXIS_TO_DOMAIN: Record<string, string> = {
  power: "verticalPower",
  speed: "linearSpeed",
  agility: "codAgility",
  ballControl: "dribbling",
  striking: "shooting",
};

export function focusAreasFor(plan: any | null, profile: AthleteProfile): FocusArea[] {
  const fromPlan = (plan?.focusAreas || [])
    .map((area: any) => String(area?.domain || ""))
    .filter(Boolean)
    .map((domain: string) => ({ domain, source: "plan" as const }));
  if (fromPlan.length) return fromPlan.slice(0, 3);

  const scored = profile.axes.filter(axis => axis.score !== null);
  if (!scored.length) return [];
  return [...scored]
    .sort((a, b) => (a.score as number) - (b.score as number))
    .slice(0, 2)
    .map(axis => ({ domain: AXIS_TO_DOMAIN[axis.key] ?? axis.key, source: "suggested" as const }));
}

// MARK: - Plan progress line

export function planProgress(plan: any | null, now: Date = new Date()): string {
  if (!plan) return "No plan";
  const week = currentWeekNumber(plan, now);
  const horizon = planHorizonWeeks(plan);
  const daysLeft = daysLeftInWeek(plan, week, now);
  return daysLeft > 0 ? `Week ${week} of ${horizon} · ${daysLeft}d left` : `Week ${week} of ${horizon}`;
}

// MARK: - Athlete summary (one roster row)

export interface AthleteSummary {
  athlete: any;
  /** The flat `_statsDrill`-tagged rep list the stats component consumes. */
  reps: any[];
  profile: AthleteProfile;
  totals: TrainingTotals;
  plan: any | null;
  focus: FocusArea[];
}

export function athleteSummary(athlete: any, reps: any[], plans: any[], logs: any[]): AthleteSummary {
  const profile = buildProfile(reps);
  const plan = activePlan(plans);
  return {
    athlete,
    reps,
    profile,
    totals: trainingTotals(logs, reps),
    plan,
    focus: focusAreasFor(plan, profile),
  };
}

export function summarySort(rows: AthleteSummary[]): AthleteSummary[] {
  return [...rows].sort((a, b) => {
    const nameA = String(a.athlete?.firstName || a.athlete?.name || "");
    const nameB = String(b.athlete?.firstName || b.athlete?.name || "");
    return nameA.localeCompare(nameB);
  });
}

// MARK: - generate_training_plan job payload

// Mirrors the app's PlanIntakeVocabulary/PlanLevelInference defaults so a
// coach-triggered plan matches what the athlete would get from the app's
// intake with default answers.
export const ASSUMED_EQUIPMENT = ["ball", "cones", "markers", "goal", "timer", "wall"];
export const FIXED_MINUTES_PER_SESSION = 60;
export const DEFAULT_DAYS_PER_WEEK = 3;
export const DEFAULT_HORIZON_WEEKS = 6;

// Web axis key -> intake goal id (the gateway's six goal categories).
const AXIS_TO_GOAL: Record<string, string> = {
  power: "strengthPower",
  speed: "speedAgility",
  agility: "speedAgility",
  ballControl: "dribbling",
  striking: "shooting",
};

export function inferredLevel(overallScore: number | null): string {
  if (overallScore === null || !Number.isFinite(overallScore)) return "club";
  if (overallScore >= 85) return "performance";
  if (overallScore >= 65) return "club";
  return "foundation";
}

// Goals default to the athlete's two weakest measured axes (deduped — speed and
// agility share a goal id); an unmeasured athlete trains the general pair.
export function defaultGoals(profile: AthleteProfile): string[] {
  const scored = profile.axes.filter(axis => axis.score !== null);
  const goals: string[] = [];
  for (const axis of [...scored].sort((a, b) => (a.score as number) - (b.score as number))) {
    const goal = AXIS_TO_GOAL[axis.key];
    if (goal && !goals.includes(goal)) goals.push(goal);
    if (goals.length === 2) break;
  }
  return goals.length ? goals : ["speedAgility", "dribbling"];
}

export function defaultIntake(profile: AthleteProfile, age: number | null): Record<string, any> {
  const intake: Record<string, any> = {
    goals: defaultGoals(profile),
    daysPerWeek: DEFAULT_DAYS_PER_WEEK,
    minutesPerSession: FIXED_MINUTES_PER_SESSION,
    setting: "solo",
    equipment: ASSUMED_EQUIPMENT,
    level: inferredLevel(profile.overall),
    horizonWeeks: DEFAULT_HORIZON_WEEKS,
    painFlag: false,
  };
  if (age !== null && age >= 5 && age <= 80) intake.age = Math.round(age);
  return intake;
}

export function resolveAge(athlete: any, now: Date = new Date()): number | null {
  const direct = num(athlete?.age);
  if (direct !== null && direct >= 5 && direct <= 80) return Math.round(direct);
  const birth = toDate(athlete?.birthdate ?? athlete?.birthday ?? athlete?.dateOfBirth);
  if (!birth) return null;
  const age = Math.floor((now.valueOf() - birth.valueOf()) / (365.25 * 86400000));
  return age >= 5 && age <= 80 ? age : null;
}

// MARK: - statsProfile snapshot (the gateway's client-snapshot exception)

// Web drill key -> the app's StatsDrill vocabulary the gateway/prompts see.
const DRILL_KEY_TO_APP: Record<string, string> = {
  // Stats snapshots use the gateway's drill identifier. `deadballShot` is
  // a legacy recording/storage name; ballSpeed and shotAccuracy belong to kick.
  shooting: "kick",
  sprint: "sprint",
  jump: "jump",
  broadJump: "broadJump",
  dribbling: "dribbling",
  changeOfDirection: "changeOfDirection",
};

// Axis -> its measured drills (web keys), for `missingDrills`.
const AXIS_DRILLS: Record<string, string[]> = {
  power: ["broadJump", "jump"],
  speed: ["sprint"],
  agility: ["changeOfDirection"],
  ballControl: ["dribbling"],
  striking: ["shooting"],
};

// The formatted strings travel with canonical values (contract §5); the unit
// label rides separately so the model can quote numbers without re-deriving
// unit conversion.
const METRIC_UNIT_LABELS: Record<string, string> = {
  ballSpeed: "mph",
  shotAccuracy: "%",
  broadJumpDistance: "ft",
  verticalJumpHeight: "in",
  sprintMaxAcceleration: "m/s²",
  sprintMaxSpeed: "mph",
  sprintCompletionTime: "s",
  dribbleTotalTime: "s",
  dribbleBallControl: "ft",
  dribbleOutboundTime: "s",
  dribbleTurnTime: "s",
  dribbleReturnTime: "s",
  codTotalTime: "s",
  codOutboundTime: "s",
  codTurnTime: "s",
  codReturnTime: "s",
};

const DRILL_DISPLAY_NAMES: Record<string, string> = {
  shooting: "Shooting",
  sprint: "Sprint",
  jump: "Jump",
  broadJump: "Broad Jump",
  dribbling: "Dribbling",
  changeOfDirection: "Change of Direction",
};

// The app's BenchmarkBand rawValues (elite | approaching | developing |
// earlyStage), same thresholds as the web's display bands.
export function appBand(score: number): string {
  if (score >= 100) return "elite";
  if (score >= 85) return "approaching";
  if (score >= 65) return "developing";
  return "earlyStage";
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

// Builds the `statsProfile` job param from normalized stats reps (the
// `_statsDrill`-tagged flat list). Shape mirrors AthleteStatsSnapshot.encode:
// required keys always present, optional ones omitted rather than nulled.
export function buildStatsSnapshot(reps: any[]): Record<string, any> {
  const profile = buildProfile(reps);

  const axes = profile.axes.map(axis => {
    const drillsForAxis = AXIS_DRILLS[axis.key] ?? [];
    const present = new Set(
      reps.map(rep => String(rep._statsDrill || rep.repType || "")).filter(Boolean),
    );
    const payload: Record<string, any> = {
      axis: axis.key,
      repCount: axis.repCount,
      missingDrills: drillsForAxis.filter(key => !present.has(key)).map(key => DRILL_KEY_TO_APP[key] ?? key),
    };
    if (axis.score !== null) payload.score = clampScore(axis.score);
    return payload;
  });

  const drills: Record<string, any>[] = [];
  for (const section of Object.values(profile.sections)) {
    if (!section.reps.length) continue;
    const metrics = section.metrics.map(metric => {
      const values = section.reps
        .filter((rep: any) => metric.drills.includes(String(rep._statsDrill || rep.repType || "")))
        .map((rep: any) => ({ rep, value: metricRepValue(rep, metric.fields) }))
        .filter((entry: any): entry is { rep: any; value: number } => entry.value !== null);
      const latest = values.length
        ? [...values].sort((a, b) => (b.rep.createdAtMillis || 0) - (a.rep.createdAtMillis || 0))[0].value
        : metric.best;
      const payload: Record<string, any> = {
        metric: metric.key,
        displayName: metric.label,
        score: clampScore(metric.score),
        band: appBand(metric.score),
        bestCanonical: round4(metric.best),
        latestCanonical: round4(latest),
        bestFormatted: metric.format(metric.best),
        latestFormatted: metric.format(latest),
        unitLabel: METRIC_UNIT_LABELS[metric.key] ?? "",
        repCount: metric.repCount,
      };
      if (metric.reference !== null) {
        payload.referenceCanonical = round4(metric.reference);
        payload.referenceFormatted = metric.format(metric.reference);
      }
      if (metric.delta !== null) payload.scoreDelta = Math.round(metric.delta * 100) / 100;
      return payload;
    });
    const drillKeys = [...new Set(section.reps.map((rep: any) => String(rep._statsDrill || rep.repType || "")))];
    for (const key of drillKeys) {
      const drillReps = section.reps.filter((rep: any) => String(rep._statsDrill || rep.repType || "") === key);
      const drillMetrics = metrics.filter(metric =>
        (section.slots.find(slot => slot.key === metric.metric)?.drills ?? []).includes(key));
      const payload: Record<string, any> = {
        drill: DRILL_KEY_TO_APP[key] ?? key,
        displayName: DRILL_DISPLAY_NAMES[key] ?? key,
        repCount: drillReps.length,
        sessionCount: new Set(drillReps.map((rep: any) => rep.sessionNumber || 1)).size,
        isLowConfidence: drillReps.length < 3,
        metrics: drillMetrics,
      };
      const scores = drillMetrics.map(metric => metric.score);
      if (scores.length) {
        payload.score = clampScore(scores.reduce((sum, value) => sum + value, 0) / scores.length);
      }
      const lastMillis = Math.max(...drillReps.map((rep: any) => rep.createdAtMillis || 0));
      if (lastMillis > 0) payload.lastRecorded = new Date(lastMillis).toISOString();
      drills.push(payload);
    }
  }

  const payload: Record<string, any> = {
    schemaVersion: 1,
    benchmarkProfile: { ageBand: "senior", gender: "unspecified", isDefaulted: true },
    totalReps: profile.totalReps,
    totalSessions: profile.totalSessions,
    axes,
    drills,
  };
  if (profile.overall !== null) payload.overallScore = clampScore(profile.overall);
  return payload;
}

function metricRepValue(rep: any, fields: string[]): number | null {
  for (const field of fields) {
    const value = num(rep[field]);
    if (value !== null && value > 0) return value;
  }
  return null;
}

// The full job params for one athlete's plan.
export function planJobParams(reps: any[], athlete: any, now: Date = new Date()): Record<string, any> {
  const snapshot = buildStatsSnapshot(reps);
  const profile = buildProfile(reps);
  return {
    statsProfile: snapshot,
    intake: defaultIntake(profile, resolveAge(athlete, now)),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
}
