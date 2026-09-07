// Club membership is trusted server data. Legacy coach rosters are used only
// when the athlete has not been assigned to the club schema.
export type StaffRole = "manager" | "coach";
export interface ClubMembership {
  uid: string;
  organizationId: string;
  role: StaffRole;
  status: string;
  teamIds: string[];
  email?: string;
  firstName?: string;
  lastName?: string;
}
export interface ClubOrganization { id: string; name: string; schemaVersion: number; logoUrl?: string; logoStoragePath?: string; websiteUrl?: string; logoSourceUrl?: string }
export interface ClubTeam { id: string; organizationId: string; name: string; coachUIDs: string[]; playerIds: string[] }
export interface ClubAccess { organization: ClubOrganization; membership: ClubMembership }
export function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0))] : [];
}
export function membershipFrom(uid: string, organizationId: string, value: Record<string, unknown>): ClubMembership | null {
  if (!uid || !organizationId || value.userUID !== uid || !Array.isArray(value.teamIds)) return null;
  if (value.status !== "active" || !["manager", "coach"].includes(String(value.role))) return null;
  return { uid, organizationId, role: value.role as StaffRole, status: "active", teamIds: strings(value.teamIds),
    email: typeof value.email === "string" ? value.email : undefined,
    firstName: typeof value.firstName === "string" ? value.firstName : undefined,
    lastName: typeof value.lastName === "string" ? value.lastName : undefined };
}
export function canAccessClubPlayer(membership: ClubMembership | null, player: Record<string, unknown>): boolean {
  if (!membership || membership.status !== "active" || player.organizationId !== membership.organizationId) return false;
  return membership.role === "manager" || (typeof player.teamId === "string" && membership.teamIds.includes(player.teamId));
}
export function visibleTeams(teams: ClubTeam[], access: ClubAccess): ClubTeam[] {
  return teams.filter(team => team.organizationId === access.organization.id &&
    (access.membership.role === "manager" || access.membership.teamIds.includes(team.id)));
}
export function selectedTeam(teams: ClubTeam[], requestedId: string | null): ClubTeam | null {
  if (requestedId) {
    const team = teams.find(entry => entry.id === requestedId);
    if (!team) throw new Error("This team is not assigned to your account.");
    return team;
  }
  return teams.length === 1 ? teams[0] : null;
}
export function staffHomeRoute(): string { return "/organization"; }
