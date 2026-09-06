// "Build workout works the same as in the app": submitting a v3
// `generate_training_plan` job from the admin console.
//
// LLM_GATEWAY_CONTRACT.md §2 (the job document and its lifecycle) and §5 /
// PLAYER_PROFILE_INPUTS_CONTRACT.md §5 (the v3 params). Generation stays
// gateway-only — the client may only CREATE a pending job, never write a plan.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { db } from "../../../lib/firebase";
import { submitLlmJob } from "../../athlete-portal/lib/loaders";
import { buildStatsSnapshot, inferredLevel } from "../../coach-dashboard/lib/logic";
import { buildProfile } from "../../../components/athlete-stats/profile";
import { isPosition } from "../../../lib/contracts/types";
import type { Position } from "../../../lib/contracts/types";

export const SESSIONS_PER_WEEK = [1, 2, 3, 4, 5, 6] as const;
export const MINUTES_PER_SESSION = [15, 30, 45, 60, 75, 90] as const;
export const HORIZON_WEEKS = [1, 2, 3, 4, 6, 8, 10, 12] as const;
export const SETTINGS = ["solo", "partner", "halfAndHalf"] as const;
export const DEFAULT_EQUIPMENT = ["ball", "cones", "markers", "goal", "timer", "wall"];

export interface PlanIntakeForm {
  horizonWeeks: number;
  sessionsPerWeek: number;
  minutesPerSession: number;
  setting: (typeof SETTINGS)[number];
  equipment: string[];
  painFlag: boolean;
}

export const DEFAULT_INTAKE: PlanIntakeForm = {
  horizonWeeks: 2,
  sessionsPerWeek: 2,
  minutesPerSession: 60,
  setting: "solo",
  equipment: DEFAULT_EQUIPMENT,
  painFlag: false,
};

/**
 * `planVersion: 3` is explicit: the gateway writes a v3 document only for a
 * request that asks for one, so an older client can never silently receive a
 * plan it cannot read (program §10).
 */
export function planV3JobParams(
  reps: any[],
  player: any,
  age: number | null,
  intake: PlanIntakeForm,
): Record<string, any> {
  const profile = buildProfile(reps);
  const params: Record<string, any> = {
    planVersion: 3,
    statsProfile: buildStatsSnapshot(reps),
    intake: {
      horizonWeeks: intake.horizonWeeks,
      sessionsPerWeek: intake.sessionsPerWeek,
      minutesPerSession: intake.minutesPerSession,
      setting: intake.setting,
      equipment: intake.equipment,
      level: inferredLevel(profile.overall),
      painFlag: intake.painFlag,
    },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  };
  if (age !== null) params.intake.age = age;
  // The player document wins; the request value is echoed only for audit.
  if (isPosition(player?.position)) params.intake.position = player.position as Position;
  return params;
}

export type PlanJobStatus = "submitting" | "pending" | "running" | "complete" | "failed";

export interface PlanJobState {
  jobId: string | null;
  status: PlanJobStatus;
  message?: string;
}

/** Creates the job and watches it to a terminal status. Returns the unsubscribe. */
export async function startPlanGeneration(
  playerId: string,
  params: Record<string, any>,
  onChange: (state: PlanJobState) => void,
): Promise<() => void> {
  onChange({ jobId: null, status: "submitting" });
  const ref = await submitLlmJob(playerId, "generate_training_plan", params);
  onChange({ jobId: ref.id, status: "pending" });
  const unsubscribe = db.collection("llmJobs").doc(ref.id).onSnapshot(
    (snapshot: any) => {
      const job: any = snapshot.data() || {};
      if (job.status === "complete") {
        unsubscribe();
        onChange({ jobId: ref.id, status: "complete" });
      } else if (job.status === "failed") {
        unsubscribe();
        onChange({
          jobId: ref.id,
          status: "failed",
          message: job.error?.detail || job.error?.message || "The plan could not be generated.",
        });
      } else if (job.status === "running") {
        onChange({ jobId: ref.id, status: "running" });
      }
    },
    (error: any) => {
      unsubscribe();
      onChange({ jobId: ref.id, status: "failed", message: error?.message || "Connection lost." });
    },
  );
  return unsubscribe;
}
