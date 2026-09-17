import { accountContext, accountPlayerPath, accountQuery, accountReturnPath } from "../../admin/lib/accountHierarchy";
import type { AccountContext } from "../../admin/lib/accountHierarchy";
import type { ClubContext } from "../../../lib/organization-data";

export const INSIGHTS_WEEK_OPTIONS = [4, 8, 12, 26];
export type InsightsOrigin = "accounts" | "organization" | "dashboard";
export function insightsRequest(search: string) {
  const query = new URLSearchParams(search), count = Number(query.get("weeks") || 8);
  const from = query.get("from");
  return { ...accountContext(query), weeks: Number.isInteger(count) && count >= 1 && count <= 26 ? count : 8,
    from: (["accounts", "organization", "dashboard"].includes(from || "") ? from : "organization") as InsightsOrigin };
}
export function insightsLink(context: AccountContext = {}, from: InsightsOrigin = "organization", weeks?: number) {
  const query = new URLSearchParams(accountQuery(context));
  query.set("from", from);
  if (weeks) query.set("weeks", String(weeks));
  return `/insights?${query}`;
}
export function insightsReturnLink(role: ClubContext["role"] | undefined, context: AccountContext, from: InsightsOrigin) {
  if (role === "admin") return from === "organization" ? `/admin/organizations${accountQuery(context)}` : accountReturnPath(context);
  if (role === "coach" && from === "dashboard" && context.teamId) {
    const query = new URLSearchParams(accountQuery(context)); query.set("team", context.teamId);
    return `/dashboard?${query}`;
  }
  return `/organization${accountQuery({ orgId: context.orgId, teamId: context.teamId })}`;
}
export function insightsPlayerLink(role: ClubContext["role"] | undefined, playerId: string, context: AccountContext) {
  return role === "admin" ? accountPlayerPath(playerId, context, true)
    : `/athlete?player=${encodeURIComponent(playerId)}&view=drills${accountQuery({ orgId: context.orgId, teamId: context.teamId }).replace(/^\?/, "&")}`;
}
export function dashboardPlayerQuery(search: string, canonical: { orgId: string; teamId: string } | null, playerId: string | null) {
  const previous = new URLSearchParams(search), query = new URLSearchParams();
  if (canonical) { query.set("orgId", canonical.orgId); query.set("teamId", canonical.teamId); query.set("team", canonical.teamId); }
  else if (previous.get("team")) query.set("team", previous.get("team")!);
  if (previous.get("preview") === "1") query.set("preview", "1");
  if (playerId) query.set("athlete", playerId);
  return query;
}

export function isInsightsStaff(role: ClubContext["role"]) { return ["admin", "manager", "coach"].includes(role); }

export function insightsAccessFailure(error: unknown) {
  const code = String((error as { code?: unknown })?.code ?? "").split("/").at(-1);
  return ["permission-denied", "unauthenticated", "not-found", "failed-precondition"].includes(code || "");
}
export function insightsFailureMessage(error: unknown, report: boolean) {
  if (insightsAccessFailure(error)) return "Team access changed or the team is unavailable. Retry to check your current organization access.";
  return report ? "Team Insights could not be loaded. Retry or choose another team."
    : "Your organization could not be loaded. Retry to check your current access.";
}

/** The callable's current role/teams are the only source of available choices. */
export async function loadInsightsScope(request: ReturnType<typeof insightsRequest>, load: (id?: string) => Promise<ClubContext>) {
  let context = await load(request.orgId);
  if (context.role === "admin" && !context.organization && !request.orgId) {
    const first = context.organizations.find(org => org.schemaVersion === 2);
    if (first) context = await load(first.id);
  }
  const organizations = context.organizations.filter(org => org.schemaVersion === 2);
  const limited = context.organizations.length >= 100 || context.teams.length >= 100 || context.players.length >= 2000;
  if (!isInsightsStaff(context.role)) return { context: { ...context, organizations, teams: [] }, orgId: "", teamId: "", notice: "", limited };
  const organization = context.organization?.schemaVersion === 2 ? context.organization : null;
  if (request.orgId && organization?.id !== request.orgId) throw new Error("The requested organization is no longer available to this account.");
  const teams = organization ? context.teams.filter(team => team.organizationId === organization.id) : [];
  const team = teams.find(entry => entry.id === request.teamId) ?? teams[0];
  return { context: { ...context, organization, organizations, teams }, orgId: organization?.id || "", teamId: team?.id || "", limited,
    notice: request.teamId && !teams.some(entry => entry.id === request.teamId) ? "The requested team is no longer available. Showing a current team you can access." : "" };
}

/** Invalidates late context/report responses on selection, auth change or unmount. */
export function createInsightsRequestGuard(currentUid: () => string | undefined) {
  let generation = 0;
  return {
    begin(uid: string) { const request = ++generation; return () => request === generation && currentUid() === uid; },
    cancel() { ++generation; },
  };
}
