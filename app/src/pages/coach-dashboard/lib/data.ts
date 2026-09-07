// Firestore access for the coach dashboard. Collection names and coach
// resolution mirror the roster page and athlete portal; the plan write path is
// the one genuinely new surface (coach adjustments to `trainingPlans` docs).

/* eslint-disable @typescript-eslint/no-explicit-any */

import firebase, { auth, db } from "../../../lib/firebase";
import { findCoach as findCoachByUid } from "../../../lib/identity";
import { allStatsReps, normalizeRep, accepted } from "../../athlete-portal/lib/metrics";
import { DRILLS } from "../../athlete-portal/lib/drills";
import { submitLlmJob } from "../../athlete-portal/lib/loaders";
import { planJobParams } from "./logic";
import { planSchemaVersion } from "../../../lib/contracts/types";

// UID-first coach resolution shared with the roster page (firebase-identity.js).
export async function findCoach(uid: string): Promise<any> {
  return findCoachByUid(db, uid);
}

export interface CoachContext {
  coachDoc: any;
  orgLabel: string;
  players: any[];
}

export async function loadCoachContext(user: any): Promise<CoachContext> {
  const coachDoc = await findCoach(user.uid);
  if (!coachDoc) throw new Error("No coach profile is linked to this sign-in.");
  const coach = coachDoc.data() || {};
  let orgLabel = "Independent coach";
  if (coach.org?.get) {
    try {
      const org = await coach.org.get();
      orgLabel = org.exists ? org.data().name || "Coach dashboard" : "Independent coach";
    } catch {
      orgLabel = "Coach dashboard";
    }
  }
  const ids = [...new Set(Array.isArray(coach.members) ? coach.members : [])];
  const docs = await Promise.all(ids.map((id: any) => db.collection("players").doc(id).get()));
  const players = docs.filter(doc => doc.exists).map(doc => ({ id: doc.id, ...doc.data() }));
  return { coachDoc, orgLabel, players };
}

// MARK: - Per-athlete bundle

export interface AthleteBundle {
  /** Flat `_statsDrill`-tagged rep list (the stats component's input shape). */
  reps: any[];
  plans: any[];
  logs: any[];
}

// One athlete's reps + plans + workout logs, fetched together. Free Record is
// excluded — it feeds no metric and Storage listing is slow at roster scale.
export async function loadAthleteBundle(playerId: string): Promise<AthleteBundle> {
  const player = db.collection("players").doc(playerId);
  const [repsSnapshot, plansSnapshot, logsSnapshot] = await Promise.all([
    player.collection("reps").get(),
    player.collection("trainingPlans").get(),
    player.collection("workoutLogs").get(),
  ]);
  const all = repsSnapshot.docs.map(normalizeRep);
  const byDrill: Record<string, any[]> = {};
  DRILLS.forEach(drill => { byDrill[drill.key] = all.filter((rep: any) => accepted(rep, drill)); });
  return {
    reps: allStatsReps(byDrill),
    plans: plansSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    logs: logsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
  };
}

// MARK: - Drill catalog

let catalogCache: any[] | null = null;

export async function loadDrillCatalog(): Promise<any[]> {
  if (catalogCache) return catalogCache;
  const snapshot = await db.collection("drillCatalog").get();
  catalogCache = snapshot.docs.map(doc => ({ id: doc.id, drillId: doc.id, ...doc.data() }));
  return catalogCache;
}

// MARK: - Plan writes

// Writes back an edited weeks array, stamping coach provenance. Additive
// fields only — the doc stays shaped like a gateway-written TrainingPlanV1.
//
// This is the LEGACY whole-week writer. It must never touch a schemaVersion-3
// plan: v3 weeks hold predefined workouts with per-workout revisions, and
// replacing the whole array here would revert a concurrent admin or athlete
// edit and skip the required `planAdjustments` record
// (TRAINING_PROGRAM_V3_CONTRACT.md §6/§13, 01A F08/F19). v3 plans are edited in
// the admin console's workout editor, which is the one authorized write path.
// The guard lives at the write, in a transaction, so no caller can bypass it.
export async function savePlanWeeks(playerId: string, planId: string, weeks: any[]): Promise<void> {
  const ref = db.collection("players").doc(playerId).collection("trainingPlans").doc(planId);
  await db.runTransaction(async transaction => {
    const doc = await transaction.get(ref);
    if (!doc.exists) throw new Error("That training plan no longer exists.");
    if (planSchemaVersion(doc.data()) === 3) {
      throw new Error(
        "This athlete is on a version 3 plan. Its workouts are edited one at a time in the PoseTek admin console, which records why each change was made.",
      );
    }
    transaction.update(ref, {
      weeks,
      coachAdjustedAt: firebase.firestore.FieldValue.serverTimestamp(),
      coachAdjustedByUid: auth.currentUser?.uid ?? null,
    });
  });
}

// MARK: - Plan generation jobs

export interface PlanJobState {
  playerId: string;
  jobId: string | null;
  status: "submitting" | "pending" | "running" | "complete" | "failed";
  message?: string;
}

// Submits a generate_training_plan job for one athlete and reports status
// transitions until terminal. Returns the unsubscribe for the job listener.
export async function startPlanJob(
  playerId: string,
  bundle: AthleteBundle,
  athlete: any,
  onChange: (state: PlanJobState) => void,
): Promise<() => void> {
  onChange({ playerId, jobId: null, status: "submitting" });
  const params = planJobParams(bundle.reps, athlete);
  const ref = await submitLlmJob(playerId, "generate_training_plan", params);
  onChange({ playerId, jobId: ref.id, status: "pending" });
  const unsubscribe = ref.onSnapshot((snapshot: any) => {
    const job: any = snapshot.data() || {};
    if (job.status === "complete") {
      unsubscribe();
      onChange({ playerId, jobId: ref.id, status: "complete" });
    } else if (job.status === "failed") {
      unsubscribe();
      onChange({
        playerId,
        jobId: ref.id,
        status: "failed",
        message: job.error?.detail || job.error?.message || "The plan could not be generated.",
      });
    } else if (job.status === "running") {
      onChange({ playerId, jobId: ref.id, status: "running" });
    }
  }, (error: any) => {
    unsubscribe();
    onChange({ playerId, jobId: ref.id, status: "failed", message: error?.message || "Connection lost." });
  });
  return unsubscribe;
}
