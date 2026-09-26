// Firestore access for the coach dashboard. Collection names and coach
// resolution mirror the roster page and athlete portal; the plan write path is
// the one genuinely new surface (coach adjustments to `trainingPlans` docs).

/* eslint-disable @typescript-eslint/no-explicit-any */

import { getClubContext } from "../../../lib/organization-data";
import { parseProvisionalEstimates, type ProvisionalEstimate } from "../../../lib/provisional-estimates";
import { selectedTeam } from "../../../lib/organization";
import type { ClubTeam } from "../../../lib/organization";
import { readAccessibleLegacyRoster } from "../../../lib/legacy-roster";
import { cloud, db } from "../../../lib/firebase";
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
  teams?: ClubTeam[];
  limited?: boolean;
}

export async function loadCoachContext(user: any, requestedTeamId: string | null = null, organizationId?: string): Promise<CoachContext> {
  const club = await getClubContext(organizationId);
  if (club.role === "coach" && club.organization) {
    const team = selectedTeam(club.teams, requestedTeamId);
    const shared = { organizationId: club.organization.id, teams: club.teams,
      limited: club.players.length >= 2000 || club.teams.length >= 100 };
    if (!team) return { coachDoc: null, orgLabel: club.organization.name, players: [], ...shared };
    const ids = [...new Set(club.players.filter(player => player.organizationId === club.organization!.id && player.teamId === team.id).map(player => player.id))];
    const docs = await Promise.all(ids.map(id => db.collection("players").doc(id).get()));
    const players = docs.filter(doc => doc.exists && doc.data()?.organizationId === club.organization!.id && doc.data()?.teamId === team.id)
      .map(doc => ({ ...doc.data(), id: doc.id }));
    return { coachDoc: null, orgLabel: `${club.organization.name} · ${team.name}`, players, ...shared, teamId: team.id };
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
  const [repsSnapshot, plansSnapshot, logsSnapshot, config] = await Promise.all([
    cloud.httpsCallable("getAthleteEffectiveResults")({ playerId }),
    player.collection("trainingPlans").get(),
    player.collection("workoutLogs").get(),
    db.collection('config').doc('llm').get(),
  ]);
  // Rules and gateway deploy before this flag is enabled. Do not query the new
  // staff-readable collection while its permission contract is unavailable.
  const personal = config.data()?.personalWorkoutsEnabled === true
    ? (await player.collection('personalWorkoutLogs').get()).docs.map(doc => ({ ...doc.data(), id: doc.id, source: 'personal' })) : [];
  const all = ((repsSnapshot.data as any).reps || []).map(normalizeRep);
  const byDrill: Record<string, any[]> = {};
  DRILLS.forEach(drill => { byDrill[drill.key] = all.filter((rep: any) => accepted(rep, drill)); });
  return {
    reps: allStatsReps(byDrill),
    provisionalEstimates: parseProvisionalEstimates((repsSnapshot.data as any).provisionalEstimates),
    allResultReps: all,
    plans: plansSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })),
    logs: [...logsSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id })), ...personal],
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
