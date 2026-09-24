// Admin workout edits are submitted to the deterministic gateway. The server
// rereads eligibility, workload and current revisions and writes the plan and
// its audit together. Browsers no longer write trainingPlans directly.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { auth, db } from "../../../lib/firebase";
import { submitLlmJob } from "../../athlete-portal/lib/loaders";
import {
  localDayString,
  weekWindow,
} from "../../../lib/contracts/planV3";
import { draftMinutes } from "./editor";
import type { Issue, WorkoutDraft } from "./editor";
import { workoutRationale } from "./rationale";

export const MAX_DOCUMENT_BYTES = 900 * 1024;

export type SaveErrorCode =
  | "signedOut"
  | "planMissing"
  | "planNotV3"
  | "planNotActive"
  | "workoutMissing"
  | "workoutChanged"
  | "planChanged"
  | "scheduleMissing"
  | "scheduleMoved"
  | "validation"
  | "tooLarge";

export class SaveError extends Error {
  code: SaveErrorCode;
  issues: Issue[];
  constructor(code: SaveErrorCode, message: string, issues: Issue[] = []) {
    super(message);
    this.code = code;
    this.issues = issues;
  }
}

// MARK: - Frequency context (§13's revision protocol)

export interface FrequencyContext {
  /** The `workoutSchedule/current` revision this context was assembled at. */
  scheduleRevision: number;
  scheduleExists: boolean;
  /** Ad-hoc and other-plan exposures inside this plan week's window, per drill. */
  extraExposures: Record<string, number>;
}

function scheduleRef(playerId: string) {
  return db.collection("players").doc(playerId).collection("workoutSchedule").doc("current");
}

function startedDay(log: any, timezone: string | null | undefined): string | null {
  const raw = log?.startedAt;
  if (!raw) return null;
  const date = typeof raw?.toDate === "function" ? raw.toDate() : new Date(raw);
  return Number.isNaN(date?.valueOf?.()) ? null : localDayString(date, timezone);
}

function drillIdsOf(container: any): string[] {
  return [...new Set((container?.blocks || []).map((block: any) => String(block?.drillId ?? "")).filter(Boolean))] as string[];
}

/**
 * Read the counter, assemble the evidence, re-read the counter — and retry if
 * it moved. The commit then requires the same revision and increments it, so
 * two concurrent edits cannot both take the last allowed exposure of a drill.
 */
export async function loadFrequencyContext(
  playerId: string,
  plan: any,
  weekNumber: number,
): Promise<FrequencyContext> {
  const planId = String(plan?.planId ?? plan?.id ?? "");
  const window = weekWindow(plan, weekNumber);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await scheduleRef(playerId).get();
    const revision = Number(before.data()?.revision ?? 0);

    const player = db.collection("players").doc(playerId);
    const [logsSnapshot, plannedSnapshot] = await Promise.all([
      player.collection("workoutLogs").get(),
      player.collection("plannedWorkouts").get(),
    ]);

    const exposures: Record<string, number> = {};
    const loggedIds = new Set(logsSnapshot.docs.map(doc => doc.id));

    for (const doc of logsSnapshot.docs) {
      const log: any = { id: doc.id, ...doc.data() };
      const day = startedDay(log, plan?.timezone);
      if (!window || !day || day < window.start || day >= window.end) continue;
      // This plan's own scheduled slots are already counted from the plan week.
      const isThisPlanSlot = String(log.planId ?? "") === planId && log.source !== "adhoc";
      if (isThisPlanSlot) continue;
      for (const drillId of drillIdsOf(log)) exposures[drillId] = (exposures[drillId] ?? 0) + 1;
    }

    for (const doc of plannedSnapshot.docs) {
      const planned: any = { id: doc.id, ...doc.data() };
      if (String(planned.status ?? "") !== "ready") continue;
      if (loggedIds.has(doc.id)) continue; // a reservation with a log is counted once, above
      if (String(planned.planId ?? "") !== planId || Number(planned.weekNumber) !== weekNumber) continue;
      for (const drillId of drillIdsOf(planned)) exposures[drillId] = (exposures[drillId] ?? 0) + 1;
    }

    const after = await scheduleRef(playerId).get();
    if (Number(after.data()?.revision ?? 0) === revision) {
      return { scheduleRevision: revision, scheduleExists: after.exists, extraExposures: exposures };
    }
  }
  throw new SaveError(
    "scheduleMoved",
    "This athlete's schedule kept changing while the editor was reading it. Reload and try again.",
  );
}

// MARK: - Size

function byteLength(value: unknown): number {
  // Sentinels and Timestamps serialize to something small and stable enough for
  // a conservative bound; this is a pre-commit guard, not an exact Firestore
  // encoding.
  try {
    const json = JSON.stringify(value, (_key, entry) => {
      if (entry && typeof entry === "object" && typeof (entry as any).toDate === "function") return "1970-01-01T00:00:00.000Z";
      if (entry && typeof entry === "object" && (entry as any)._methodName) return "__sentinel__";
      return entry;
    });
    return new TextEncoder().encode(json ?? "").length;
  } catch {
    // A shape we cannot serialize is not evidence that it is too large; the
    // guard must never be the reason a legitimate edit fails.
    return 0;
  }
}

// MARK: - The save

export interface SaveWorkoutEdit {
  playerId: string;
  planId: string;
  draft: WorkoutDraft;
  rationale: string;
  /** Explicitly selected by the admin; an empty text field alone is not consent. */
  noFeedback?: boolean;
  /** The warnings the admin chose to save through; recorded verbatim. */
  warningsOverridden: Issue[];
  frequency: FrequencyContext;
  setting: string;
  equipment: string[];
  /** From `players/{id}/trainingPlanContexts/{planId}` when it exists. */
  generatorIntent: string | null;
  generatorCheck: any | null;
  generationContextRef: string | null;
}

export interface SaveResult {
  adjustmentId: string;
  newPlanRevision: number;
  newWorkoutRevision: number;
}

export async function saveWorkoutEdit(input: SaveWorkoutEdit): Promise<SaveResult> {
  if (!auth.currentUser?.uid) throw new SaveError("signedOut", "You are signed out. Sign in again to save.");
  const rationale = workoutRationale(input.rationale, input.noFeedback === true);
  if (rationale === null) throw new SaveError("validation", "Write 3–2000 characters of feedback or select “I have no feedback to provide here”.");
  const draft = input.draft;
  const workout = {
    workoutId: draft.workoutId, order: draft.order, title: draft.title, intent: draft.intent,
    focusDomains: draft.focusDomains, budgetMinutes: draft.budgetMinutes,
    estimatedMinutes: draftMinutes(draft), blocks: draft.blocks, nextBlockSequence: draft.nextBlockSequence,
    ...(draft.scheduledDate ? { scheduledDate: draft.scheduledDate } : {}),
  };
  if (byteLength(workout) > MAX_DOCUMENT_BYTES) throw new SaveError("tooLarge", "This workout is too large. Shorten its copy before saving.");
  const ref = await submitLlmJob(input.playerId, "save_workout_edit", {
    planId: input.planId, workoutId: draft.workoutId, expectedPlanRevision: draft.basePlanRevision,
    expectedWorkoutRevision: draft.baseRevision, expectedScheduleRevision: input.frequency.scheduleRevision,
    workout, rationale,
  });
  // This deterministic gateway operation validates the current catalog, clearance,
  // equipment and shared workload before committing the edit and audit atomically.
  return new Promise((resolve, reject) => {
    let stop = () => {};
    const timeout = setTimeout(() => { stop(); reject(new Error("The save is still processing. Check the workout before retrying; the server job continues.")); }, 120000);
    stop = ref.onSnapshot((snapshot: any) => {
      const job = snapshot.data() || {};
      if (job.status === "complete") { clearTimeout(timeout); stop(); resolve(job.result as SaveResult); }
      else if (job.status === "failed") { clearTimeout(timeout); stop(); reject(new SaveError("validation", job.error?.detail || job.error?.message || "The server could not save this edit.")); }
    }, (error: Error) => { clearTimeout(timeout); stop(); reject(error); });
  });
}
// MARK: - The immutable generation context (§13)

export interface GenerationContext {
  ref: string | null;
  /** The ORIGINAL generated workout, keyed by immutable workoutId. */
  originalWorkouts: Record<string, any>;
  originalChecks: Record<string, any>;
  available: boolean;
}

/**
 * Gateway-written and admin-readable. It is what makes "reset to the original
 * workout" honest; when it is absent the editor says so rather than passing a
 * later revision off as the original.
 */
export async function loadGenerationContext(playerId: string, planId: string): Promise<GenerationContext> {
  const path = `players/${playerId}/trainingPlanContexts/${planId}`;
  try {
    const doc = await db.collection("players").doc(playerId)
      .collection("trainingPlanContexts").doc(planId).get();
    if (!doc.exists) return { ref: null, originalWorkouts: {}, originalChecks: {}, available: false };
    const data: any = doc.data() || {};
    const workouts: Record<string, any> = {};
    const checks: Record<string, any> = {};
    const source = data.originalWorkouts ?? data.workouts ?? {};
    if (Array.isArray(source)) {
      for (const workout of source) {
        const id = String(workout?.workoutId ?? "");
        if (id) { workouts[id] = workout; checks[id] = workout?.check ?? null; }
      }
    } else if (source && typeof source === "object") {
      for (const [id, workout] of Object.entries(source)) {
        workouts[id] = workout;
        checks[id] = (workout as any)?.check ?? null;
      }
    }
    return { ref: path, originalWorkouts: workouts, originalChecks: checks, available: true };
  } catch (error) {
    console.warn("[admin] generation context unavailable", path, error);
    return { ref: null, originalWorkouts: {}, originalChecks: {}, available: false };
  }
}
