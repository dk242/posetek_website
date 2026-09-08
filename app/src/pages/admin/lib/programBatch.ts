// Batch program generation — the Firestore half. Reads an organization's
// roster and each athlete's evidence, then submits one v3
// `generate_training_plan` job per selected athlete through the same
// `planV3JobParams` / `startPlanGeneration` path the single-athlete page uses,
// so a batch program is byte-for-byte the program that page would build.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { db } from "../../../lib/firebase";
import { isPosition, planSchemaVersion } from "../../../lib/contracts/types";
import { loadAthleteBundle } from "../../coach-dashboard/lib/data";
import { activePlan, playerRow, resolvePlayerAge } from "./accounts";
import type { PlayerRow } from "./accounts";
import { planV3JobParams, startPlanGeneration } from "./planJobs";
import type { PlanIntakeForm, PlanJobState } from "./planJobs";
import { applyLevel, testedDrills } from "./programBatchLogic";
import type { AthleteEvidence, LevelChoice } from "./programBatchLogic";

/** Every player carrying the club's `organizationId` (admins read all players). */
export async function loadOrganizationPlayers(organizationId: string): Promise<PlayerRow[]> {
  const snapshot = await db.collection("players").where("organizationId", "==", organizationId).get();
  return snapshot.docs.map(doc => playerRow(doc.id, doc.data()));
}

export interface AthleteLoad {
  reps: any[];
  evidence: AthleteEvidence;
}

export async function loadAthleteEvidence(player: PlayerRow): Promise<AthleteLoad> {
  const bundle = await loadAthleteBundle(player.id);
  const age = resolvePlayerAge(player.raw);
  const plan = activePlan(bundle.plans);
  return {
    reps: bundle.reps,
    evidence: {
      tested: testedDrills(bundle.reps),
      repCount: bundle.reps.length,
      age: age.age,
      ageStale: age.stale,
      position: isPosition(player.raw?.position) ? String(player.raw.position) : null,
      activePlanVersion: plan ? planSchemaVersion(plan) : null,
    },
  };
}

/** Submits one athlete's job and watches it to a terminal status. Returns the unsubscribe. */
export function generateForAthlete(
  player: PlayerRow,
  load: AthleteLoad,
  intake: PlanIntakeForm,
  level: LevelChoice,
  onChange: (state: PlanJobState) => void,
): Promise<() => void> {
  const params = applyLevel(planV3JobParams(load.reps, player.raw, load.evidence.age, intake), level);
  return startPlanGeneration(player.id, params, onChange);
}
