// Firestore access for the coach dashboard. Collection names and coach
// resolution mirror the roster page and athlete portal; the plan write path is
// the one genuinely new surface (coach adjustments to `trainingPlans` docs).

/* eslint-disable @typescript-eslint/no-explicit-any */

import { getClubContext } from "../../../lib/organization-data";
import { parseProvisionalEstimates, type ProvisionalEstimate } from "../../../lib/provisional-estimates";
import { selectedTeam } from "../../../lib/organization";
import { readAccessibleLegacyRoster } from "../../../lib/legacy-roster";
import { auth, cloud, db } from "../../../lib/firebase";
import { findCoach as findCoachByUid } from "../../../lib/identity";
import { allStatsReps, normalizeRep, accepted } from "../../athlete-portal/lib/metrics";
import { DRILLS } from "../../athlete-portal/lib/drills";
import { submitLlmJob } from "../../athlete-portal/lib/loaders";
import { planJobParams } from "./logic";

// UID-first coach resolution shared with the roster page (firebase-identity.js).
export async function findCoach(uid: string): Promise<any> {
  return findCoachByUid(db, uid);
}

export interface CoachContext {
  coachDoc: any;
  orgLabel: string;
  players: any[];
  organizationId?: string;
  teamId?: string;
}

export async function loadCoachContext(user: any, requestedTeamId: string | null = null, organizationId?: string): Promise<CoachContext> {
  const club = await getClubContext(organizationId);
  if (club.role === "coach" && club.organization) {
    const team = selectedTeam(club.teams, requestedTeamId);
    if (!team) throw new Error("Choose a team from your organization before opening the dashboard.");
    const ids = [...new Set(club.players.filter(player => player.organizationId === club.organization!.id && player.teamId === team.id).map(player => player.id))];
    const docs = await Promise.all(ids.map(id => db.collection("players").doc(id).get()));
    const players = docs.filter(doc => doc.exists && doc.data()?.organizationId === club.organization!.id && doc.data()?.teamId === team.id)
      .map(doc => ({ ...doc.data(), id: doc.id }));
    return { coachDoc: await findCoach(user.uid), orgLabel: `${club.organization.name} · ${team.name}`, players, organizationId: club.organization.id, teamId: team.id };
  }
  if (club.role === "manager" || club.role === "admin") throw new Error("Open your organization to review its teams and athlete results.");
  const coachDoc = await findCoach(user.uid);
  if (!coachDoc) throw new Error("No coach profile is linked to this sign-in.");
  const coach = coachDoc.data() || {};
  if (Object.hasOwn(coach, "organizationId")) throw new Error("Your club access is inactive or unavailable. Ask your organization manager to review it.");
  let orgLabel = "Independent coach";
  if ((coach.organization || coach.org)?.get) {
    try {
      const org = await (coach.organization || coach.org).get();
      orgLabel = org.exists ? org.data().name || "Coach dashboard" : "Independent coach";
    } catch {
      orgLabel = "Coach dashboard";
    }
  }
  const ids = [...new Set(Array.isArray(coach.members) ? coach.members : [])];
  const docs = await readAccessibleLegacyRoster(ids as string[], id => db.collection("players").doc(id).get());
  const players = docs.filter(doc => doc.exists).map(doc => ({ id: doc.id, ...doc.data() }));
  return { coachDoc, orgLabel, players };
}

// MARK: - Per-athlete bundle

export interface AthleteBundle {
  /** Flat `_statsDrill`-tagged rep list (the stats component's input shape). */
  reps: any[];
  plans: any[];
  logs: any[];
  provisionalEstimates?: ProvisionalEstimate[];
  allResultReps?: any[];
}

// One athlete's reps + plans + workout logs, fetched together. Free Record is
// excluded — it feeds no metric and Storage listing is slow at roster scale.
export async function loadAthleteBundle(playerId: string): Promise<AthleteBundle> {
  const player = db.collection("players").doc(playerId);
  const [repsSnapshot, plansSnapshot, logsSnapshot] = await Promise.all([
    cloud.httpsCallable("getAthleteEffectiveResults")({ playerId }),
    player.collection("trainingPlans").get(),
    player.collection("workoutLogs").get(),
  ]);
  const all = ((repsSnapshot.data as any).reps || []).map(normalizeRep);
  const byDrill: Record<string, any[]> = {};
  DRILLS.forEach(drill => { byDrill[drill.key] = all.filter((rep: any) => accepted(rep, drill)); });
  return {
    reps: allStatsReps(byDrill),
    provisionalEstimates: parseProvisionalEstimates((repsSnapshot.data as any).provisionalEstimates),
    allResultReps: all,
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

export const PLAN_WEEKS_TIMEOUT_MS = 60000;

// Replaces an edited weeks array on an older (schemaVersion 1/2) plan through the
// gateway's deterministic `save_plan_weeks` job. The browser no longer writes
// `trainingPlans`: the rules cutover closes that path (gateway consolidation plan
// §4.6). The gateway re-checks that the signed-in user is the athlete's coach,
// refuses a v3 plan — whose workouts are edited one at a time in the admin
// console's workout editor, with the required `planAdjustments` record — and
// stamps `coachAdjustedAt` / `coachAdjustedByUid` itself, in one transaction.
export async function savePlanWeeks(playerId: string, planId: string, weeks: any[]): Promise<void> {
  if (!auth.currentUser?.uid) throw new Error("You are signed out. Sign in again to save.");
  const ref = await submitLlmJob(playerId, "save_plan_weeks", { planId, weeks });
  await new Promise<void>((resolve, reject) => {
    let stop = () => {};
    const timeout = setTimeout(() => {
      stop();
      reject(new Error("The save is still processing. Reload the plan before editing again; the server job continues."));
    }, PLAN_WEEKS_TIMEOUT_MS);
    stop = ref.onSnapshot((snapshot: any) => {
      const job = snapshot.data() || {};
      if (job.status === "complete") { clearTimeout(timeout); stop(); resolve(); }
      else if (job.status === "failed") {
        clearTimeout(timeout); stop();
        reject(new Error(job.error?.detail || job.error?.message || "The change could not be saved."));
      }
    }, (error: Error) => { clearTimeout(timeout); stop(); reject(error); });
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
