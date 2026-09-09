/* eslint-disable @typescript-eslint/no-explicit-any */
import { planV3JobParams } from "./planJobs";
import type { PlanIntakeForm } from "./planJobs";

export const PERSONALIZED_ENGINE = "personalized-v1";
export const PERSONALIZED_CAPABILITIES = ["generate_personalized_plan", "activate_personalized_plan", "discard_personalized_plan", "assess_personalized_plan"] as const;
export function operationLabel(capability: string) {
  return ({generate_personalized_plan:"Generate draft",activate_personalized_plan:"Activate plan",discard_personalized_plan:"Discard draft",assess_personalized_plan:"Assess priorities"} as Record<string,string>)[capability] ?? capability;
}
export function recentEvidence(reps: any[], now = Date.now()) {
  const recent = reps.filter(rep => Number.isFinite(rep.createdAtMillis) && rep.createdAtMillis > 0
    && rep.createdAtMillis <= now && rep.createdAtMillis >= now - 180 * 86400000);
  return { reps: recent, excluded: reps.length - recent.length,
    window: recent.length ? { oldestAt: new Date(Math.min(...recent.map(r => r.createdAtMillis))).toISOString(),
      newestAt: new Date(Math.max(...recent.map(r => r.createdAtMillis))).toISOString() } : undefined };
}
export function personalizedParams(reps: any[], player: any, age: number | null, intake: PlanIntakeForm): Record<string, any> {
  const evidence = recentEvidence(reps);
  return { ...planV3JobParams(evidence.reps, player, age, intake), engineVersion: PERSONALIZED_ENGINE,
    ...(evidence.window ? { evidenceWindow: evidence.window } : {}) };
}
export function plannerLink(personalized: boolean, orgId: string, playerIds: Iterable<string>, teamId = "") {
  const query = new URLSearchParams();
  if (orgId) query.set("orgId", orgId);
  if (teamId) query.set("teamId", teamId);
  const ids = [...playerIds];
  if (ids.length) query.set("players", ids.join(","));
  return `/admin/programs${personalized ? "/personalized" : ""}${query.size ? `?${query}` : ""}`;
}
export function previewEnabled(config: any, capability = PERSONALIZED_CAPABILITIES[0] as string) {
  const entry = config?.capabilities?.[capability];
  return config?.globalEnabled !== false && config?.programV3Enabled === true
    && (capability === "discard_personalized_plan" || config?.personalizedPlannerEnabled === true)
    && entry?.enabled === true && Number.isInteger(entry.dailyLimitPerUser) && entry.dailyLimitPerUser > 0;
}
export function allocationRows(plan: any, weekNumber: number) {
  const week = plan?.weeks?.find((w: any) => w.weekNumber === weekNumber);
  return week?.check?.allocation?.domains ?? (week?.allocations ?? []).map((row: any) => ({
    domain: row.domain, targetMinutes: row.minutes, actualMinutes: week?.actualMinutesByDomain?.[row.domain] ?? 0,
  }));
}
export function prescriptionSignature(plan: any) {
  return JSON.stringify((plan?.weeks ?? []).map((week: any) => (week.workouts ?? []).map((w: any) =>
    (w.blocks ?? []).map((b: any) => [b.drillId, b.sets, b.reps, b.restSeconds, b.restScope, b.restBetweenSetsSeconds]))));
}
export function activationParams(draft: any) {
  if (draft?.status !== "ready" || !draft.comparisonToken || !Array.isArray(draft.expectedActivePlans)) {
    throw new Error("Choose a ready draft and review its comparison first.");
  }
  return { engineVersion: PERSONALIZED_ENGINE, draftId: draft.draftId,
    comparisonToken: draft.comparisonToken, expectedActivePlans: draft.expectedActivePlans };
}

/** Compare the draft baseline with current active plans, independent of serialization. */
export function activePlansMatch(expected: unknown, plans: any[]): boolean {
  if (!Array.isArray(expected)) return false;
  const active = plans.filter(p => p?.status === "active");
  if (expected.length !== active.length) return false;
  const revisions = new Map(active.map(p => [p.id, p.planRevision ?? 1]));
  if (revisions.size !== active.length) return false;
  const seen = new Set<string>();
  return expected.every(row => {
    if (!row || typeof row.planId !== "string" || !row.planId || seen.has(row.planId)) return false;
    seen.add(row.planId);
    return revisions.has(row.planId) && revisions.get(row.planId) === row.planRevision;
  });
}
