// Pure training-plan / workout logic, ported from the iOS app's training hub
// so the web portal renders and scores workouts the same way:
//
//   PlanDomainDisplay          -> domainName / domainShortName / domainIcon / humanized
//   TrainingPlan window math   -> weekWindow / currentWeekNumber / daysLeftInWeek
//   HubDoseFormatter           -> doseLine / prescriptionDoseLine / blockDoseLine
//   WorkoutStore.todaysWorkout -> todaysWorkout
//   WeeklyProgressBuilder      -> buildWeekProgress
//   WorkoutPlayerMath          -> targetSets / setsCompleted / blockStatus / …
//
// Firestore documents stay loosely typed (`any`) as elsewhere in this portal;
// everything exported here is a pure function with a real signature. No DOM,
// no Firebase.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { number } from "./mobile";

// MARK: - Firestore vocabulary (mirrors PlannedWorkoutFirestore / WorkoutLogFirestore)

export const END_REASON_COMPLETED = "completed";
export const END_REASON_ENDED_EARLY = "endedEarly";
export const END_REASON_ABANDONED = "abandoned";

export const STATUS_DONE = "done";
export const STATUS_PARTIAL = "partial";
export const STATUS_SKIPPED = "skipped";

export const SKIP_REASON_TOO_TIRED = "tooTired";
export const SKIP_REASON_NO_SPACE = "noSpace";
export const SKIP_REASON_PAIN = "pain";
export const SKIP_REASON_OTHER = "other";

export const SKIP_REASONS: { id: string; label: string }[] = [
  { id: SKIP_REASON_TOO_TIRED, label: "Too tired" },
  { id: SKIP_REASON_NO_SPACE, label: "No space or equipment" },
  { id: SKIP_REASON_PAIN, label: "Something hurts" },
  { id: SKIP_REASON_OTHER, label: "Other reason" },
];

export function skipReasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case SKIP_REASON_TOO_TIRED: return "too tired";
    case SKIP_REASON_NO_SPACE: return "no space or equipment";
    case SKIP_REASON_PAIN: return "pain";
    default: return "";
  }
}

// MARK: - Domain display

// "linearSpeed" -> "Linear speed". Used for every id the app doesn't recognize,
// which is what keeps a catalog vocabulary change from being a code change.
export function humanized(raw: string): string {
  if (!raw) return "";
  let out = "";
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (index > 0 && character >= "A" && character <= "Z") out += " ";
    out += index === 0 ? character.toUpperCase() : character.toLowerCase();
  }
  return out;
}

const DOMAIN_NAMES: Record<string, string> = {
  linearSpeed: "Linear speed",
  verticalPower: "Vertical power",
  horizontalPower: "Horizontal power",
  codAgility: "Change of direction",
  dribbling: "Dribbling",
  passingReceiving: "Passing & receiving",
  shooting: "Shooting",
  strengthResilience: "Strength & resilience",
  representativeGames: "Game play",
};

const DOMAIN_SHORT_NAMES: Record<string, string> = {
  linearSpeed: "Speed",
  verticalPower: "Vertical",
  horizontalPower: "Horizontal",
  codAgility: "Agility",
  dribbling: "Dribbling",
  passingReceiving: "Passing",
  shooting: "Shooting",
  strengthResilience: "Strength",
  representativeGames: "Games",
};

// SF Symbols on iOS; the Material Symbols equivalents here.
const DOMAIN_ICONS: Record<string, string> = {
  linearSpeed: "sprint",
  verticalPower: "arrow_upward",
  horizontalPower: "arrow_forward",
  codAgility: "switch_access_shortcut",
  dribbling: "sports_soccer",
  passingReceiving: "sync_alt",
  shooting: "sports_soccer",
  strengthResilience: "fitness_center",
  representativeGames: "stadium",
};

export function domainName(domain: string): string {
  return DOMAIN_NAMES[domain] ?? humanized(domain);
}

export function domainShortName(domain: string): string {
  return DOMAIN_SHORT_NAMES[domain] ?? domainName(domain);
}

export function domainIcon(domain: string): string {
  return DOMAIN_ICONS[domain] ?? "exercise";
}

export function blockKindLabel(kind: string): string {
  switch (kind) {
    case "warmup": return "Warm-up";
    case "main": return "Main";
    case "game": return "Game";
    default: return humanized(kind);
  }
}

// MARK: - Dose formatting

// Rep units are catalog vocabulary (reps | seconds | contacts | meters |
// minutes | cues | passes | shots, today) — unknown units pass through verbatim
// rather than being dropped.
function unitLabel(unit: string, count: number): string {
  switch (unit) {
    case "reps": return count === 1 ? "rep" : "reps";
    case "seconds": return "sec";
    case "minutes": return "min";
    case "meters": return "m";
    default: return unit;
  }
}

export interface Dose {
  sets?: unknown;
  reps?: unknown;
  repUnit?: unknown;
  restSeconds?: unknown;
}

// Tolerant by design: any field may be zero (the plan agent omits what doesn't
// apply to a drill) and the line degrades to whatever is real.
export function doseLine(dose: Dose): string {
  const sets = number(dose.sets) ?? 0;
  const reps = number(dose.reps) ?? 0;
  const repUnit = String(dose.repUnit || "reps");
  const restSeconds = number(dose.restSeconds) ?? 0;
  const parts: string[] = [];
  if (sets > 0 && reps > 0) parts.push(`${sets} × ${reps} ${unitLabel(repUnit, reps)}`);
  else if (reps > 0) parts.push(`${reps} ${unitLabel(repUnit, reps)}`);
  else if (sets > 0) parts.push(sets === 1 ? "1 set" : `${sets} sets`);
  if (restSeconds > 0) parts.push(`${restSeconds}s rest`);
  return parts.length ? parts.join(" · ") : "As prescribed";
}

// A plan-week prescription also carries its weekly frequency.
export function prescriptionDoseLine(drill: any): string {
  const frequency = number(drill?.frequencyPerWeek) ?? 0;
  const line = doseLine(drill || {});
  return frequency > 0 ? `${line} · ${frequency}×/week` : line;
}

// A workout block also carries its minute cost.
export function blockDoseLine(block: any): string {
  const minutes = number(block?.estimatedMinutes) ?? 0;
  const line = doseLine(block || {});
  return minutes > 0 ? `${line} · ~${minutes} min` : line;
}

// MARK: - Plan week windows (day precision, local calendar)

// Parses a `startDate`-shaped "YYYY-MM-DD" into a local-midnight Date. Day
// precision, no timezone metaphysics.
export function dayStringToDate(value: unknown): Date | null {
  const parts = String(value ?? "").split("-");
  if (parts.length !== 3) return null;
  const [year, month, day] = parts.map(part => Number(part));
  if (![year, month, day].every(Number.isFinite)) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.valueOf()) ? null : date;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Whole days between two dates, DST-safe (the rounding absorbs the ±1h shift).
function dayDelta(from: Date, to: Date): number {
  return Math.round((startOfDay(to).valueOf() - startOfDay(from).valueOf()) / 86400000);
}

export interface DateWindow {
  start: Date;
  end: Date;
}

export function windowContains(window: DateWindow, date: Date | number): boolean {
  const value = typeof date === "number" ? date : date.valueOf();
  return value >= window.start.valueOf() && value < window.end.valueOf();
}

// `week N = [startDate + 7(N−1), startDate + 7N)` in the athlete's local
// calendar. Null for a non-positive week number or an unparseable startDate.
export function weekWindow(plan: any, weekNumber: number): DateWindow | null {
  if (!(weekNumber >= 1)) return null;
  const base = dayStringToDate(plan?.startDate);
  if (!base) return null;
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 7 * (weekNumber - 1));
  const end = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 7 * weekNumber);
  return { start, end };
}

export function planHorizonWeeks(plan: any): number {
  return number(plan?.horizonWeeks) || (plan?.weeks || []).length || 1;
}

// Which week `now` falls in, clamped to [1, horizonWeeks].
export function currentWeekNumber(plan: any, now: Date = new Date()): number {
  const base = dayStringToDate(plan?.startDate);
  if (!base) return 1;
  const computed = Math.floor(dayDelta(base, now) / 7) + 1;
  return Math.min(Math.max(computed, 1), Math.max(planHorizonWeeks(plan), 1));
}

// Days remaining in a week's window, clamped at 0 — the hub's "3 days left".
export function daysLeftInWeek(plan: any, weekNumber: number, now: Date = new Date()): number {
  const window = weekWindow(plan, weekNumber);
  if (!window) return 0;
  return Math.max(dayDelta(now, window.end), 0);
}

export function weekWindowLabel(window: DateWindow): string {
  const format = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
  // The window is half-open; the last *trained* day is the day before `end`.
  const last = new Date(window.end.getFullYear(), window.end.getMonth(), window.end.getDate() - 1);
  return `${format.format(window.start)} – ${format.format(last)}`;
}

// The model is not trusted to emit these arrays sorted.
export function orderedWeeks(plan: any): any[] {
  return [...(plan?.weeks || [])].sort((a, b) => (number(a?.weekNumber) ?? 0) - (number(b?.weekNumber) ?? 0));
}

export function weekOf(plan: any, weekNumber: number): any | null {
  return (plan?.weeks || []).find((week: any) => number(week?.weekNumber) === weekNumber) || null;
}

export function orderedBlocks(workout: any): any[] {
  return [...(workout?.blocks || [])].sort((a, b) => (number(a?.order) ?? 0) - (number(b?.order) ?? 0));
}

// MARK: - Today's workout

// The newest planned workout generated today (the athlete's local calendar) for
// the given week. Deliberately derived, never stored — workouts are disposable
// by design, and one built yesterday answered yesterday's questions about time
// and energy. At local midnight the CTA honestly reverts to "Create workout".
export function todaysWorkout(workouts: any[], weekNumber: number, now: Date = new Date()): any | null {
  const sameDay = (date: Date) =>
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();

  let best: any = null;
  let bestMillis = -Infinity;
  for (const workout of workouts || []) {
    if (number(workout?.weekNumber) !== weekNumber) continue;
    const generatedAt = toDate(workout?.generatedAt);
    if (!generatedAt || !sameDay(generatedAt)) continue;
    if (generatedAt.valueOf() > bestMillis) {
      best = workout;
      bestMillis = generatedAt.valueOf();
    }
  }
  return best;
}

// Firestore Timestamp | Date | epoch millis | ISO string -> Date.
export function toDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value.toDate === "function") {
    const converted = value.toDate();
    return converted && !Number.isNaN(converted.valueOf()) ? converted : null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

// MARK: - Weekly progress

export type DrillCompletionState =
  | { kind: "notStarted" }
  | { kind: "partial"; completed: number; target: number }
  | { kind: "done"; completed: number; target: number };

export interface DomainProgress {
  domain: string;
  exposuresDone: number;
  exposuresTarget: number;
  isMet: boolean;
}

export interface DrillProgress {
  drillId: string;
  state: DrillCompletionState;
}

export interface WeekProgress {
  weekNumber: number;
  domainProgress: DomainProgress[];
  drillProgress: DrillProgress[];
  // Wall-clock minutes of evidence inside the week window: ended workout logs
  // plus free sessions no log already claims.
  minutesTrained: number;
}

// The app's six measured drills -> the plan's domain vocabulary. Keyed by the
// raw Firestore `repType`, NOT the canonical drill-id vocabulary: deadball shot
// writes its reps as `side_kick`, so a "deadballShot" key here would never
// match a real rep and would silently drop every recorded kick from shooting.
export const MEASURED_DRILL_DOMAINS: Record<string, string> = {
  sprint: "linearSpeed",
  jump: "verticalPower",
  broadJump: "horizontalPower",
  changeOfDirection: "codAgility",
  dribbling: "dribbling",
  side_kick: "shooting",
  // The web portal's rep normalization also surfaces these aliases.
  deadballShot: "shooting",
  shooting: "shooting",
};

export interface ProgressRep {
  id: string;
  repType: string;
  createdAtMillis: number;
  sessionFolder?: string | null;
}

export interface ProgressSession {
  id: string;
  startedAtMillis: number;
  endedAtMillis: number | null;
  // Rep doc ids this session claims.
  sessionRepIds: string[];
}

// What actually happened this week, folded against what the plan's week asked
// for. An *exposure* of a domain is one non-skipped workout-log block, or — for
// a measured drill recorded outside any workout — one recorded drill session
// inside the week window. A session already claimed by an in-week log's
// `linkedTrainingSessionId` is not double-counted as a second exposure.
export function buildWeekProgress(options: {
  plan: any;
  weekNumber: number;
  logs: any[];
  reps?: ProgressRep[];
  sessions?: ProgressSession[];
}): WeekProgress {
  const { plan, weekNumber, logs, reps = [], sessions = [] } = options;
  const week = weekOf(plan, weekNumber);
  const window = weekWindow(plan, weekNumber);
  if (!week || !window) {
    return { weekNumber, domainProgress: [], drillProgress: [], minutesTrained: 0 };
  }

  const weekLogs = (logs || []).filter(log => number(log?.weekNumber) === weekNumber);

  const coveredSessionIds = new Set(
    weekLogs.map(log => log?.linkedTrainingSessionId).filter((id): id is string => Boolean(id)),
  );
  const coveredRepIds = new Set(
    sessions.filter(session => coveredSessionIds.has(session.id)).flatMap(session => session.sessionRepIds),
  );

  const domainExposures = new Map<string, number>();
  const bump = (domain: string) => domainExposures.set(domain, (domainExposures.get(domain) ?? 0) + 1);

  for (const log of weekLogs) {
    for (const block of log?.blocks || []) {
      if (block?.status === STATUS_SKIPPED) continue;
      bump(String(block?.domain || ""));
    }
  }

  // One exposure per (domain, recording session) inside the window, so several
  // reps from one session don't multiply-count.
  const seenFreeSessions = new Set<string>();
  for (const rep of reps) {
    if (!windowContains(window, rep.createdAtMillis)) continue;
    if (coveredRepIds.has(rep.id)) continue;
    const domain = MEASURED_DRILL_DOMAINS[rep.repType];
    if (!domain) continue;
    const key = `${domain}|${rep.sessionFolder || rep.id}`;
    if (seenFreeSessions.has(key)) continue;
    seenFreeSessions.add(key);
    bump(domain);
  }

  const domainProgress: DomainProgress[] = (week.targets || []).map((target: any) => {
    const domain = String(target?.domain || "");
    const exposuresDone = domainExposures.get(domain) ?? 0;
    const exposuresTarget = number(target?.exposures) ?? 0;
    return { domain, exposuresDone, exposuresTarget, isMet: exposuresDone >= exposuresTarget };
  });

  const drillCompleted = new Map<string, number>();
  for (const log of weekLogs) {
    for (const block of log?.blocks || []) {
      if (block?.status === STATUS_SKIPPED) continue;
      const drillId = String(block?.drillId || "");
      drillCompleted.set(drillId, (drillCompleted.get(drillId) ?? 0) + 1);
    }
  }

  const drillProgress: DrillProgress[] = (week.drills || []).map((drill: any) => {
    const drillId = String(drill?.drillId || "");
    const completed = drillCompleted.get(drillId) ?? 0;
    const target = Math.max(number(drill?.frequencyPerWeek) ?? 0, 1);
    let state: DrillCompletionState;
    if (completed <= 0) state = { kind: "notStarted" };
    else if (completed >= target) state = { kind: "done", completed, target };
    else state = { kind: "partial", completed, target };
    return { drillId, state };
  });

  let secondsTrained = 0;
  for (const log of weekLogs) {
    const started = toDate(log?.startedAt);
    const ended = toDate(log?.endedAt);
    if (!started || !ended) continue;
    secondsTrained += Math.max((ended.valueOf() - started.valueOf()) / 1000, 0);
  }
  for (const session of sessions) {
    if (!windowContains(window, session.startedAtMillis)) continue;
    if (coveredSessionIds.has(session.id) || session.endedAtMillis === null) continue;
    secondsTrained += Math.max((session.endedAtMillis - session.startedAtMillis) / 1000, 0);
  }

  return {
    weekNumber,
    domainProgress,
    drillProgress,
    minutesTrained: Math.round(secondsTrained / 60),
  };
}

export function drillProgressFor(progress: WeekProgress, drillId: string): DrillProgress | null {
  return progress.drillProgress.find(entry => entry.drillId === drillId) || null;
}

// The week's minute budget: v2 plans allocate per domain, older plans fall back
// to the intake's stated availability.
export function weekBudgetMinutes(plan: any, week: any): number {
  const allocated = (week?.allocations || []).reduce(
    (total: number, allocation: any) => total + (number(allocation?.minutes) ?? 0),
    0,
  );
  if (allocated > 0) return allocated;
  return (number(plan?.intake?.daysPerWeek) ?? 0) * (number(plan?.intake?.minutesPerSession) ?? 0);
}

// MARK: - Workout player rules

// Every block trains at least once — a block whose dose omitted `sets` (the
// schema tolerates zero) still needs one tick to be completable.
export function targetSets(block: any): number {
  return Math.max(number(block?.sets) ?? 0, 1);
}

export function blockLogOf(log: any, blockId: string): any | null {
  return (log?.blocks || []).find((entry: any) => entry?.blockId === blockId) || null;
}

export function setsCompleted(block: any, log: any): number {
  return number(blockLogOf(log, block?.blockId)?.setsCompleted) ?? 0;
}

// The logged outcome for a block, or null while it's untouched.
export function blockStatus(block: any, log: any): string | null {
  return blockLogOf(log, block?.blockId)?.status ?? null;
}

// Resume position: the first block (in order) with no outcome yet. Everything
// done/skipped -> the last block, so reopening a finished session doesn't
// restart it at the top.
export function initialPageIndex(blocks: any[], log: any): number {
  if (!blocks.length) return 0;
  for (let index = 0; index < blocks.length; index += 1) {
    const status = blockStatus(blocks[index], log);
    if (status !== STATUS_DONE && status !== STATUS_SKIPPED) return index;
  }
  return blocks.length - 1;
}

export interface BlockLogRow {
  blockId: string;
  drillId: string;
  domain: string;
  targetSets: number;
  setsCompleted: number;
  status: string;
  skipReason?: string;
  estimatedMinutes?: number;
}

// The log row for "the athlete now has `sets` sets done". Only meaningful for
// 1+ sets — backing out to zero is represented by *removing* the row, never by
// a 0-set `partial` row, because any non-skipped row counts as a full weekly
// exposure in buildWeekProgress.
export function blockLogRow(block: any, sets: number): BlockLogRow {
  const target = targetSets(block);
  const clamped = Math.min(Math.max(sets, 0), target);
  const row: BlockLogRow = {
    blockId: String(block?.blockId || ""),
    drillId: String(block?.drillId || ""),
    domain: String(block?.domain || ""),
    targetSets: target,
    setsCompleted: clamped,
    status: clamped >= target ? STATUS_DONE : STATUS_PARTIAL,
  };
  const minutes = number(block?.estimatedMinutes) ?? 0;
  if (minutes > 0) row.estimatedMinutes = minutes;
  return row;
}

// Skipping preserves any sets already completed — partial credit is first-class
// and "I did one set, then the goal was taken" is the normal case, not an edge.
export function skippedLogRow(block: any, previousSets: number, reason: string): BlockLogRow {
  const target = targetSets(block);
  const row: BlockLogRow = {
    blockId: String(block?.blockId || ""),
    drillId: String(block?.drillId || ""),
    domain: String(block?.domain || ""),
    targetSets: target,
    setsCompleted: Math.min(Math.max(previousSets, 0), target),
    status: STATUS_SKIPPED,
    skipReason: reason,
  };
  const minutes = number(block?.estimatedMinutes) ?? 0;
  if (minutes > 0) row.estimatedMinutes = minutes;
  return row;
}

// Whether every block has an outcome — the line between "Finish workout" and
// "End early".
export function allBlocksAccounted(blocks: any[], log: any): boolean {
  return blocks.every(block => {
    const status = blockStatus(block, log);
    return status === STATUS_DONE || status === STATUS_SKIPPED;
  });
}

// `completed` when every block was seen through (done or deliberately skipped);
// anything left untouched or mid-way means the athlete ended early. The log, not
// good intentions, is what the week measures.
export function endReasonFor(blocks: any[], log: any): string {
  return allBlocksAccounted(blocks, log) ? END_REASON_COMPLETED : END_REASON_ENDED_EARLY;
}

// Exposures this one workout added, per domain, in block order — the summary
// screen's "what this session moved" lines.
export function domainExposures(blocks: any[], log: any): { domain: string; count: number }[] {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const block of blocks) {
    const status = blockStatus(block, log);
    if (status !== STATUS_DONE && status !== STATUS_PARTIAL) continue;
    const domain = String(block?.domain || "");
    if (!counts.has(domain)) order.push(domain);
    counts.set(domain, (counts.get(domain) ?? 0) + 1);
  }
  return order.map(domain => ({ domain, count: counts.get(domain) ?? 0 }));
}

export function hasPainSkip(log: any): boolean {
  return (log?.blocks || []).some((block: any) => block?.skipReason === SKIP_REASON_PAIN);
}

// MARK: - Clock formatting

export function elapsedString(fromMillis: number, toMillis: number): string {
  const seconds = Math.max(Math.floor((toMillis - fromMillis) / 1000), 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

export function restString(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

// The workout CTA's status line, keyed on the log the same way the app is:
// "Completed" is reserved for `endReason === "completed"`; any other end reason
// is labeled honestly as ended early and is never resumable.
export function workoutStatus(log: any): { line: string; icon: string; kind: "ready" | "active" | "done" | "early" } {
  if (log?.endReason === END_REASON_COMPLETED) return { line: "Completed", icon: "check_circle", kind: "done" };
  if (log?.endReason) return { line: "Ended early", icon: "flag_circle", kind: "early" };
  if (log) return { line: "In progress", icon: "play_circle", kind: "active" };
  return { line: "Ready when you are", icon: "bolt", kind: "ready" };
}

// The builder's "focus on anything?" options: this week's domains in plan
// order, deduped. They are the only focuses the builder can serve, since its
// candidate pool is the plan week itself.
export function focusChoices(week: any): string[] {
  const seen = new Set<string>();
  const domains = [
    ...(week?.targets || []).map((target: any) => String(target?.domain || "")),
    ...(week?.drills || []).map((drill: any) => String(drill?.domain || "")),
  ];
  const chosen: string[] = [];
  for (const domain of domains) {
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    chosen.push(domain);
  }
  return chosen;
}

// Mirrors the gateway's hard cap on `adjustmentRequest` — over-length text is
// trimmed client-side rather than round-tripping into a non-retryable
// invalid_request.
export const ADJUSTMENT_MAX_CHARS = 500;

// MARK: - Preview

// A built session for the signed-out preview, shaped exactly like a
// gateway-written `plannedWorkouts` doc so the hub and player render it through
// the same code paths as the real thing.
export function demoWorkout(planId: string, weekNumber: number, now: Date = new Date()): any {
  return {
    id: "preview-workout",
    playerId: "preview",
    planId,
    weekNumber,
    jobId: "preview-job",
    generatedAt: now,
    catalogVersion: "1.0.0",
    params: { timeAvailableMinutes: 30, energy: "normal", focusDomains: [] },
    estimatedMinutes: 30,
    intro: "A short, sharp session: get the nervous system firing, then quality acceleration work.",
    stopRule: "Stop if anything hurts — tell a parent or coach before you train that area again.",
    blocks: [
      {
        blockId: "warm", order: 1, kind: "warmup", drillId: "WRM-002", name: "Dynamic warm-up",
        domain: "strengthResilience", sets: 1, reps: 6, repUnit: "minutes", restSeconds: 0,
        estimatedMinutes: 6, cues: ["Build gradually", "Full range before full speed"],
        whyIncluded: "Prepares the hips and ankles for hard acceleration.", isMeasuredDrill: false,
      },
      {
        blockId: "accel", order: 2, kind: "main", drillId: "SPD-010", name: "Acceleration starts",
        domain: "linearSpeed", sets: 4, reps: 3, repUnit: "reps", restSeconds: 60,
        estimatedMinutes: 14, cues: ["Push the ground away", "Stay low for the first three steps"],
        whyIncluded: "Your first-step speed is the plan's clearest opportunity.", isMeasuredDrill: true,
        measuredDrillType: "sprint",
      },
      {
        blockId: "ball", order: 3, kind: "game", drillId: "DRB-004", name: "Tight-space control",
        domain: "dribbling", sets: 3, reps: 45, repUnit: "seconds", restSeconds: 45,
        estimatedMinutes: 10, cues: ["Small touches", "Head up between touches"],
        whyIncluded: "Keeps ball work in the week without adding sprint load.", isMeasuredDrill: false,
      },
    ],
  };
}
