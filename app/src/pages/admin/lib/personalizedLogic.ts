/* eslint-disable @typescript-eslint/no-explicit-any */
import { planV3JobParams } from "./planJobs";
import type { PlanIntakeForm } from "./planJobs";
import { accountContext, accountPlayerPath, accountQuery } from "./accountHierarchy";
import { estimatePlanningContext, provisionalDribbling, type ProvisionalEstimate } from '../../../lib/provisional-estimates';

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
export function personalizedParams(reps: any[], player: any, age: number | null, intake: PlanIntakeForm, goals: string[] = [], freeTextGoals = "", provisionalEstimates: ProvisionalEstimate[] = [], estimateReps: any[] = reps): Record<string, any> {
  const evidence = recentEvidence(reps);
  const params = planV3JobParams(evidence.reps, player, age, intake);
  const estimate = provisionalDribbling(provisionalEstimates, recentEvidence(estimateReps).reps);
  const context = estimatePlanningContext(estimate);
  const text = [freeTextGoals.trim(), context].filter(Boolean).join('\n\n');
  if (text.length > 500) throw new Error('Shorten the training context to leave room for the estimated result.');
  const planningGoals = estimate && !goals.includes('dribbling') && goals.length < 2 ? [...goals, 'dribbling'] : goals;
  return { ...params, intake: { ...params.intake, goals: planningGoals, freeTextGoals: text || null }, engineVersion: PERSONALIZED_ENGINE,
    ...(evidence.window ? { evidenceWindow: evidence.window } : {}) };
}
export function plannerLink(_personalized: boolean, orgId: string, playerIds: Iterable<string>, teamId = "") {
  const query = new URLSearchParams();
  if (orgId) query.set("orgId", orgId);
  if (teamId) query.set("teamId", teamId);
  const ids = [...playerIds];
  if (ids.length) query.set("players", ids.join(","));
  return `/admin/programs${query.size ? `?${query}` : ""}`;
}
export function previewEnabled(config: any, capability = PERSONALIZED_CAPABILITIES[0] as string) {
  const entry = config?.capabilities?.[capability];
  const policy = entry?.dailyLimitPolicy;
  const allowed = policy === "unlimited" ? PERSONALIZED_CAPABILITIES.includes(capability as typeof PERSONALIZED_CAPABILITIES[number])
    : policy == null && Number.isInteger(entry?.dailyLimitPerUser) && entry.dailyLimitPerUser > 0;
  return config?.globalEnabled !== false && config?.programV3Enabled === true
    && (capability === "discard_personalized_plan" || config?.personalizedPlannerEnabled === true)
    && entry?.enabled === true && allowed;
}
export function allocationRows(plan: any, weekNumber: number) {
  const week = plan?.weeks?.find((w: any) => w.weekNumber === weekNumber);
  return week?.check?.allocation?.domains ?? (week?.allocations ?? []).map((row: any) => ({
    domain: row.domain, targetMinutes: row.minutes, actualMinutes: week?.actualMinutesByDomain?.[row.domain] ?? 0,
  }));
}
export function prescriptionSignature(plan: any) {
  return JSON.stringify((plan?.weeks ?? []).map((week: any) => [week.weekNumber,
    (week.workouts ?? []).map((w: any) => [w.order,
      (w.blocks ?? []).map((b: any) => [b.order, b.drillId, b.kind, b.domain, b.sets, b.reps, b.repUnit,
        b.perSide === true, b.restSeconds, b.restScope, b.restBetweenSetsSeconds, b.familiarizationReps ?? 0])])]));
}

/** A refresh must reauthorize before callbacks or queued submissions can resume. */
export function createPlannerAccessGuard() {
  let revision = 0, authorized = false;
  return {
    begin() { authorized = false; return ++revision; },
    capture() { return revision; },
    isCurrent(token: number) { return token === revision; },
    authorize(token: number) { if (token === revision) authorized = true; },
    block() { authorized = false; ++revision; },
    permits(token = revision) { return authorized && token === revision; },
  };
}

export function isPlannerAuthorizationError(error: any) {
  const code = String(error?.code ?? "").toLowerCase().split("/").at(-1);
  return code === "permission-denied" || code === "unauthenticated"
    || code === "user-token-expired" || code === "invalid-user-token" || code === "user-disabled";
}

/** Older completed jobs predate the public intake projection. Never invent their schedule. */
export function normalizeAssessment(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const text = (v: any) => typeof v === "string" ? v : "";
  const intake = value.intake;
  const scheduleAvailable = Number.isFinite(intake?.sessionsPerWeek) && intake.sessionsPerWeek > 0
    && Number.isFinite(intake?.minutesPerSession) && intake.minutesPerSession > 0 && !!text(intake?.setting);
  const split = value.focusSplit?.final ?? value.focusSplit;
  return {
    assessedAt: value.assessedAt,
    schedule: scheduleAvailable ? { sessionsPerWeek: intake.sessionsPerWeek, minutesPerSession: intake.minutesPerSession, setting: intake.setting } : null,
    evidenceReason: text(value.evidencePolicy?.reason ?? value.inputs?.evidencePolicy?.reason) || "Historical evidence details are unavailable.",
    findings: (Array.isArray(value.findings) ? value.findings : []).filter((f: any) => f && typeof f === "object").map((f: any) => ({
      domain: text(f.domain) || "Unspecified", confidence: text(f.confidence) || "unavailable",
      statement: text(f.statement), limitation: text(f.limitation),
      targetBeforePct: Number.isFinite(f.targetBeforePct) ? f.targetBeforePct : "—",
      targetFinalPct: Number.isFinite(f.targetFinalPct) ? f.targetFinalPct : "—",
    })),
    focusSplit: Object.fromEntries(Object.entries(split && typeof split === "object" ? split : {}).filter(([, n]) => typeof n === "number" && Number.isFinite(n) && n > 0)),
  };
}

export function plannerPlayerDetailsLink(role: string, player: any, search: string) {
  const prior = accountContext(search);
  const coachId = (prior.orgId ?? "") === (player.organizationId ?? "") ? prior.coachId : undefined;
  const context = { orgId: player.organizationId || undefined, teamId: player.teamId || undefined,
    coachId: coachId || (!player.organizationId ? player.coachId : undefined) || undefined };
  return role === "admin" ? accountPlayerPath(player.id, context)
    : `/athlete?player=${encodeURIComponent(player.id)}${accountQuery(context).replace(/^\?/, "&")}`;
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
