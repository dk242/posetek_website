// The one admin write path to `trainingPlans`, and the frequency context it
// needs. TRAINING_PROGRAM_V3_CONTRACT.md §6 (three writers, one document),
// §8.3 (the ground-truth record) and §13 (transactions, frequency
// serialization, size bounds); the coupled rules live in docs/rules/llm.rules.
//
// Two invariants make this file worth reading carefully:
//
//   1. The new `weeks` array is built from the snapshot read INSIDE the
//      transaction, and only the target workout is spliced. Writing back the
//      array the browser loaded would revert a sibling workout someone else
//      edited meanwhile (01A F08).
//   2. The plan update and the `planAdjustments` create are one transaction.
//      The rules refuse either alone, in both directions, via `getAfter` — an
//      edit without its rationale record cannot exist.

/* eslint-disable @typescript-eslint/no-explicit-any */

import firebase, { auth, db } from "../../../lib/firebase";
import { normalizeCatalogDrill } from "../../../lib/contracts/drillV2";
import type { CatalogDrill } from "../../../lib/contracts/drillV2";
import {
  actualMinutesByDomain,
  derivedTargets,
  localDayString,
  weekTransitionMinutes,
  weekWindow,
} from "../../../lib/contracts/planV3";
import { ageBand, isPosition, resolveEligibility } from "../../../lib/contracts/types";
import type { TechnicalEligibility, WorkoutSnapshot } from "../../../lib/contracts/types";
import { resolvePlayerAge } from "./accounts";
import {
  diffWorkouts,
  errorsOf,
  snapshotOf,
  snapshotOfDraft,
  validateDraft,
  workoutFromDraft,
} from "./editor";
import type { Issue, WorkoutDraft } from "./editor";
import { ADMIN_CLIENT_VERSION } from "./identity";
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
  const uid = auth.currentUser?.uid;
  if (!uid) throw new SaveError("signedOut", "You are signed out. Sign in again to save.");
  const rationale = workoutRationale(input.rationale, input.noFeedback === true);
  if (rationale === null) {
    throw new SaveError("validation", "Write 3–2000 characters of feedback or select “I have no feedback to provide here”.");
  }

  const playerRef = db.collection("players").doc(input.playerId);
  const planRef = playerRef.collection("trainingPlans").doc(input.planId);
  const counterRef = scheduleRef(input.playerId);

  return db.runTransaction(async transaction => {
    // --- reads (all before any write) ---
    const [planDoc, counterDoc, playerDoc] = await Promise.all([
      transaction.get(planRef),
      transaction.get(counterRef),
      transaction.get(playerRef),
    ]);

    if (!planDoc.exists) throw new SaveError("planMissing", "This plan no longer exists.");
    const plan: any = planDoc.data();
    if (Number(plan.schemaVersion) !== 3) {
      throw new SaveError("planNotV3", "The web editor only edits schemaVersion 3 plans.");
    }
    if (String(plan.status ?? "") !== "active") {
      throw new SaveError("planNotActive", "This plan is no longer active — it cannot be edited.");
    }
    if (!counterDoc.exists) {
      throw new SaveError(
        "scheduleMissing",
        "This athlete has no workoutSchedule/current counter yet. The training engine writes it with the first v3 plan; a client cannot create it.",
      );
    }
    if (Number(counterDoc.data()?.revision ?? 0) !== input.frequency.scheduleRevision) {
      throw new SaveError("scheduleMoved", "This athlete's schedule changed while you were editing. Reload and re-apply.");
    }

    // Locate the target by IMMUTABLE workoutId in the freshly read snapshot.
    const weeks: any[] = Array.isArray(plan.weeks) ? plan.weeks : [];
    const weekIndex = weeks.findIndex((week: any) => Number(week?.weekNumber) === input.draft.weekNumber);
    const week = weekIndex === -1 ? null : weeks[weekIndex];
    const workoutIndex = week
      ? (week.workouts || []).findIndex((workout: any) => String(workout?.workoutId) === input.draft.workoutId)
      : -1;
    if (!week || workoutIndex === -1) {
      throw new SaveError("workoutMissing", "That workout is no longer in the plan.");
    }
    const current = week.workouts[workoutIndex];
    if (Number(current?.revision ?? 1) !== input.draft.baseRevision) {
      throw new SaveError(
        "workoutChanged",
        "This workout changed since you opened it — review the current version and save again.",
      );
    }

    // The athlete's technical eligibility, re-resolved from live documents.
    const player: any = playerDoc.data() || {};
    let coach: any = null;
    let coachId: string | null =
      (typeof player.coach?.id === "string" ? player.coach.id : null)
      ?? (player.coachUID ? String(player.coachUID) : null);
    if (coachId) {
      const coachDoc = await transaction.get(db.collection("coaches").doc(coachId));
      coach = coachDoc.exists ? coachDoc.data() : null;
      if (!coach) coachId = null;
    }
    const eligibility: TechnicalEligibility = resolveEligibility(player, coach, coachId);

    // Every referenced catalog row, read fresh: a rating downgrade or a drill
    // pulled from `published` since the draft was made must be caught here.
    const drillIds = [...new Set(input.draft.blocks.map(block => block.drillId))];
    const drills = new Map<string, CatalogDrill>();
    const catalogRows: Record<string, firebase.firestore.DocumentData> = {};
    for (const drillId of drillIds) {
      const doc = await transaction.get(db.collection("drillCatalog").doc(drillId));
      if (doc.exists) {
        const raw = doc.data()!;
        drills.set(drillId, normalizeCatalogDrill(doc.id, raw));
        // Keep the exact evidence validated by this transaction. Normalized UI
        // rows introduce undefined optional fields, which Firestore rejects.
        catalogRows[drillId] = raw;
      }
    }

    const issues = validateDraft(input.draft, {
      drills,
      athlete: {
        age: resolvePlayerAge(player).age,
        maxDrillDifficulty: eligibility.maxDrillDifficulty,
        setting: input.setting,
        equipment: input.equipment,
        position: isPosition(player.position) ? player.position : null,
      },
      week,
      extraExposures: input.frequency.extraExposures,
    });
    const blocking = errorsOf(issues);
    if (blocking.length) {
      throw new SaveError("validation", blocking[0].message, blocking);
    }

    // --- the new document bodies ---
    const editedAt = firebase.firestore.Timestamp.now(); // serverTimestamp() is not allowed inside an array
    const nextWorkout = workoutFromDraft(input.draft, current, uid, editedAt);
    const nextWorkouts = [...week.workouts];
    nextWorkouts[workoutIndex] = nextWorkout;
    const nextWeek = {
      ...week,
      workouts: nextWorkouts,
      targets: derivedTargets({ ...week, workouts: nextWorkouts }),
      actualMinutesByDomain: actualMinutesByDomain({ ...week, workouts: nextWorkouts }),
      transitionMinutes: weekTransitionMinutes({ ...week, workouts: nextWorkouts }),
    };
    const nextWeeks = [...weeks];
    nextWeeks[weekIndex] = nextWeek;

    const basePlanRevision = Number(plan.planRevision) || 1;
    const newPlanRevision = basePlanRevision + 1;
    const adjustmentId = `${input.planId}_r${newPlanRevision}`;
    const adjustmentRef = playerRef.collection("planAdjustments").doc(adjustmentId);

    const before: WorkoutSnapshot = snapshotOf(current);
    const after: WorkoutSnapshot = snapshotOfDraft(input.draft);
    const diff = diffWorkouts(before, after);

    const planUpdate = {
      weeks: nextWeeks,
      planRevision: newPlanRevision,
      lastEdit: {
        workoutId: input.draft.workoutId,
        weekNumber: input.draft.weekNumber,
        revision: nextWorkout.revision,
        editedBy: "admin",
        editedAt,
        editorUid: uid,
        adjustmentId,
      },
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    const assessmentInputs = plan.assessment?.inputs || {};
    const adjustment = {
      schemaVersion: 1,
      planId: input.planId,
      planSchemaVersion: 3,
      weekNumber: input.draft.weekNumber,
      workoutId: input.draft.workoutId,
      editor: { uid, role: "admin", surface: "web" },
      baseRevision: input.draft.baseRevision,
      newRevision: nextWorkout.revision,
      basePlanRevision,
      newPlanRevision,
      before,
      after,
      diff,
      rationale,
      feedbackProvided: input.noFeedback !== true,
      conversationId: null,
      // Never the CURRENT intent: after one edit that is the editor's, not the
      // generator's (01A F14). Absent context is recorded as absent.
      generatorIntent: input.generatorIntent,
      generatorIntentSource: input.generationContextRef ? "generationContext" : "unavailable",
      generationContextRef: input.generationContextRef,
      generatorCheck: input.generatorCheck,
      priorCheck: current?.check ?? null,
      warningsOverridden: input.warningsOverridden.map(issue => ({
        code: issue.code,
        drillId: issue.drillId ?? null,
        blockId: issue.blockId ?? null,
        message: issue.message,
      })),
      catalogRows,
      profileSnapshot: {
        position: player.position ?? assessmentInputs.position ?? null,
        ageBand: ageBand(resolvePlayerAge(player).age) ?? assessmentInputs.ageBand ?? null,
        level: assessmentInputs.level ?? plan.intake?.level ?? null,
        stats: assessmentInputs.stats ?? null,
        peer: assessmentInputs.peer ?? null,
        // Presence and the generation-time hash only — raw coach text never
        // leaves players/{id}/privateProfile (01A F04).
        coachFeedbackPresent: Boolean(assessmentInputs.coachFeedback?.present),
        coachFeedbackSha256: assessmentInputs.coachFeedback?.textSha256 ?? null,
        focusSplitFinal: plan.assessment?.focusSplit?.final ?? null,
        technicalEligibility: eligibility,
      },
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      clientVersion: ADMIN_CLIENT_VERSION,
    };

    const planBytes = byteLength({ ...plan, ...planUpdate });
    if (planBytes > MAX_DOCUMENT_BYTES) {
      throw new SaveError("tooLarge", `This plan would be about ${Math.round(planBytes / 1024)} KB — over the 900 KB limit. Shorten the workout copy.`);
    }
    const adjustmentBytes = byteLength(adjustment);
    if (adjustmentBytes > MAX_DOCUMENT_BYTES) {
      throw new SaveError("tooLarge", `The adjustment record would be about ${Math.round(adjustmentBytes / 1024)} KB — over the 900 KB limit.`);
    }

    // --- writes: the plan, its audit record and the counter, together ---
    transaction.update(planRef, planUpdate);
    transaction.set(adjustmentRef, adjustment);
    transaction.update(counterRef, {
      revision: input.frequency.scheduleRevision + 1,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    return { adjustmentId, newPlanRevision, newWorkoutRevision: nextWorkout.revision };
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
