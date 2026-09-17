import type { ClubContext } from "../../../lib/organization-data";
import type { CoachRow, OrganizationRow, PlayerRow, TeamRow } from "./accounts";

export interface AccountContext { orgId?: string; teamId?: string; coachId?: string }
export function accountContext(search: string | URLSearchParams): AccountContext {
  const query = typeof search === "string" ? new URLSearchParams(search) : search;
  return Object.fromEntries(["orgId", "teamId", "coachId"].flatMap(key => {
    const value = query.get(key);
    return value && value.length <= 150 && !/[\\/\u0000-\u001f]/.test(value) ? [[key, value]] : [];
  }));
}
export function accountQuery(context: AccountContext = {}): string {
  const query = new URLSearchParams();
  for (const key of ["orgId", "teamId", "coachId"] as const) if (context[key]) query.set(key, context[key]!);
  return query.size ? `?${query}` : "";
}
export function accountReturnPath(context: AccountContext = {}): string {
  return (context.coachId ? `/admin/accounts/coach/${encodeURIComponent(context.coachId)}` : "/admin/accounts") + accountQuery(context);
}
export function accountPlayerPath(playerId: string, context: AccountContext = {}, results = false): string {
  return `/admin/accounts/player/${encodeURIComponent(playerId)}${results ? "/results" : ""}${accountQuery(context)}`;
}

export type ClubStaff = ClubContext["staff"][number];
export interface HierarchyTeam { team: TeamRow; players: PlayerRow[]; coaches: ClubStaff[] }
export interface ClubHierarchy {
  teams: HierarchyTeam[];
  coaches: { member: ClubStaff; teams: HierarchyTeam[]; players: PlayerRow[] }[];
  managers: ClubStaff[];
  inactiveStaff: ClubStaff[];
  unassignedTeams: HierarchyTeam[];
  unassignedPlayers: PlayerRow[];
  players: PlayerRow[];
  limits: string[];
}
export function staffName(member: ClubStaff): string {
  return [member.firstName, member.lastName].filter(Boolean).join(" ").trim() || member.email || "Unnamed staff member";
}
function uniquePlayers(players: PlayerRow[]) {
  return [...new Map(players.map(player => [player.id, player])).values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function hasClubIdentity(player: PlayerRow): boolean {
  return Object.prototype.hasOwnProperty.call(player.raw || {}, "organizationId");
}

/** Memberships and player ownership are authority; historical roster arrays are never merged into a club. */
export function buildClubHierarchy(context: ClubContext, rows: PlayerRow[], truncated = false): ClubHierarchy {
  const orgId = context.organization?.id;
  const players = uniquePlayers(rows.filter(player => orgId && hasClubIdentity(player) && player.organizationId === orgId));
  const validStaff = (member: ClubStaff) => Boolean(member.userUID && ["coach", "manager"].includes(member.role)
    && Array.isArray(member.teamIds) && member.teamIds.every(id => typeof id === "string"));
  const active = context.staff.filter(member => validStaff(member) && member.status === "active");
  const staffSort = (a: ClubStaff, b: ClubStaff) => staffName(a).localeCompare(staffName(b));
  const teams = context.teams.filter(team => team.organizationId === orgId).map(team => ({
    team,
    players: players.filter(player => player.teamId === team.id),
    coaches: active.filter(member => member.role === "coach" && member.teamIds.includes(team.id)).sort(staffSort),
  })).sort((a, b) => a.team.name.localeCompare(b.team.name));
  const coaches = active.filter(member => member.role === "coach").sort(staffSort).map(member => {
    const assigned = teams.filter(row => member.teamIds.includes(row.team.id));
    return { member, teams: assigned, players: uniquePlayers(assigned.flatMap(row => row.players)) };
  });
  const limits: string[] = [];
  if (truncated || context.players.length >= 2000) limits.push("Showing up to 2,000 athletes in this organization.");
  if (context.teams.length >= 100) limits.push("The organization service returned its 100-team limit; additional teams may be missing.");
  if (context.staff.length >= 100) limits.push("The organization service returned its 100-staff limit; additional staff may be missing.");
  if (context.invitations.length >= 200) limits.push("Showing up to 200 staff invitations.");
  return {
    teams, coaches, players, limits,
    managers: active.filter(member => member.role === "manager").sort(staffSort),
    inactiveStaff: context.staff.filter(member => !validStaff(member) || member.status !== "active").sort(staffSort),
    unassignedTeams: teams.filter(row => row.coaches.length === 0),
    unassignedPlayers: players.filter(player => !teams.some(row => row.team.id === player.teamId)),
  };
}

/** Legacy organizations retain their historical relationships; canonical staff are handled above. */
export function legacyCoachGroups(orgs: OrganizationRow[], coaches: CoachRow[]) {
  const groups = new Map<string, CoachRow[]>();
  const unknown: CoachRow[] = [];
  const independent: CoachRow[] = [];
  for (const coach of coaches) {
    if (coach.organizationId && orgs.some(org => org.id === coach.organizationId && org.schemaVersion === 2)) continue;
    if (coach.organizationRole) { unknown.push(coach); continue; }
    const matches = coach.organizationId
      ? orgs.filter(org => org.schemaVersion !== 2 && org.id === coach.organizationId)
      : orgs.filter(org => org.schemaVersion !== 2 && (org.coachIds.includes(coach.id) || org.coachIds.includes(coach.userUID)
        || Boolean(org.code && org.code === coach.organizationCode)));
    if (matches.length) for (const org of matches) groups.set(org.id, [...(groups.get(org.id) || []), coach]);
    else if (coach.organizationId || coach.organizationCode) unknown.push(coach);
    else independent.push(coach);
  }
  return { groups, unknown, independent };
}
