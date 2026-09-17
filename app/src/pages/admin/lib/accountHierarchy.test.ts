import { describe, expect, it } from "vitest";
import { accountContext, accountPlayerPath, accountQuery, accountReturnPath, buildClubHierarchy, legacyCoachGroups } from "./accountHierarchy";
import type { ClubContext } from "../../../lib/organization-data";
import type { CoachRow, OrganizationRow, PlayerRow } from "./accounts";

const organization = { id: "club", name: "Example club", schemaVersion: 2 };
const team = (id: string, name = id) => ({ id, name, organizationId: "club", coachUIDs: ["stale-coach"], playerIds: ["moved"] });
const staff = (userUID: string, role: "manager" | "coach", teamIds: string[], status = "active") => ({ userUID, role, teamIds, status, email: `${userUID}@example.test`, firstName: userUID, lastName: "" });
function player(id: string, teamId: string | null, org = "club"): PlayerRow {
  return { id, name: id, email: "", coachId: "legacy", organizationId: org, teamId, registered: true, signupCode: null, raw: { organizationId: org, teamId } };
}
function context(): ClubContext {
  return { role: "admin", organization, organizations: [organization], teams: [team("a"), team("b"), team("named", "Girls-Coach Daniel"), team("empty")],
    staff: [staff("manager", "manager", []), staff("coach-a", "coach", ["a", "b"]), staff("coach-b", "coach", ["a"]), staff("unassigned", "coach", []), staff("revoked", "coach", ["named"], "inactive")],
    invitations: [], players: [] };
}

describe("canonical admin hierarchy", () => {
  it("separates managers, supports shared teams and counts each athlete once", () => {
    const a = player("athlete-a", "a"), b = player("athlete-b", "b");
    const result = buildClubHierarchy(context(), [a, b, a]);
    expect(result.players).toHaveLength(2);
    expect(result.managers.map(row => row.userUID)).toEqual(["manager"]);
    expect(result.coaches.find(row => row.member.userUID === "coach-a")?.players).toHaveLength(2);
    expect(result.teams.find(row => row.team.id === "a")?.coaches.map(row => row.userUID)).toEqual(["coach-a", "coach-b"]);
    expect(result.coaches.find(row => row.member.userUID === "unassigned")?.teams).toEqual([]);
  });
  it("preserves named teams without creating a person or assigning revoked staff", () => {
    const result = buildClubHierarchy(context(), [player("new", "named")]);
    expect(result.unassignedTeams.map(row => row.team.name)).toContain("Girls-Coach Daniel");
    expect(result.coaches.map(row => row.member.userUID)).not.toContain("revoked");
    expect(result.coaches.some(row => row.member.firstName === "Daniel")).toBe(false);
    expect(result.inactiveStaff.map(row => row.userUID)).toEqual(["revoked"]);
  });
  it("ignores stale projections and cross-organization players, showing invalid teams separately", () => {
    const result = buildClubHierarchy(context(), [player("moved", "b"), player("other", "a", "elsewhere"), player("orphan", null), player("missing-team", "deleted")]);
    expect(result.teams.find(row => row.team.id === "a")?.players).toEqual([]);
    expect(result.teams.find(row => row.team.id === "b")?.players.map(row => row.id)).toEqual(["moved"]);
    expect(result.unassignedPlayers.map(row => row.id)).toEqual(["missing-team", "orphan"]);
    expect(result.players.some(row => row.id === "other")).toBe(false);
  });
  it("does not adopt legacy references or malformed staff assignments as club authority", () => {
    const input = context();
    input.staff.push({ ...staff("broken", "coach", []), teamIds: "a" as unknown as string[] });
    const legacy = { ...player("legacy", "a"), raw: { organization: { id: "club" } } };
    const result = buildClubHierarchy(input, [legacy]);
    expect(result.players).toEqual([]);
    expect(result.coaches.some(row => row.member.userUID === "broken")).toBe(false);
    expect(result.inactiveStaff.some(row => row.userUID === "broken")).toBe(true);
  });
  it("reports bounded data instead of claiming a complete roster", () => {
    const input = context();
    input.teams = Array.from({ length: 100 }, (_, i) => team(String(i)));
    input.staff = Array.from({ length: 100 }, (_, i) => staff(String(i), "coach", []));
    expect(buildClubHierarchy(input, [], true).limits).toHaveLength(3);
  });
});

describe("legacy fallback and navigation context", () => {
  it("keeps legacy and independent coaches visible without exposing canonical manager mirrors as coaches", () => {
    const orgs: OrganizationRow[] = [{ ...organization, code: "", coachIds: ["manager"], logoUrl: null }, { id: "old", name: "Old club", schemaVersion: 1, code: "OLD", coachIds: ["alias"], logoUrl: null }];
    const base: CoachRow = { id: "alias", userUID: "coach", name: "Coach", email: "", members: [], organizationId: null, organizationCode: null, maxDrillDifficulty: null };
    const result = legacyCoachGroups(orgs, [base, { ...base, id: "solo", userUID: "solo" }, { ...base, id: "manager", organizationId: "club", organizationRole: "manager" }, { ...base, id: "lost", organizationId: "gone" }, { ...base, id: "broken", organizationRole: "coach" }]);
    expect(result.groups.get("old")?.map(row => row.id)).toEqual(["alias"]);
    expect(result.independent.map(row => row.id)).toEqual(["solo"]);
    expect(result.unknown.map(row => row.id)).toEqual(["lost", "broken"]);
    expect(result.groups.has("club")).toBe(false);
  });
  it("round trips team/coach context to profiles and results without changing athlete identity", () => {
    const state = { orgId: "club", teamId: "team", coachId: "coach" };
    expect(accountContext(accountQuery(state))).toEqual(state);
    expect(accountReturnPath(state)).toBe("/admin/accounts/coach/coach?orgId=club&teamId=team&coachId=coach");
    expect(accountPlayerPath("athlete & id", state, true)).toBe("/admin/accounts/player/athlete%20%26%20id/results?orgId=club&teamId=team&coachId=coach");
    expect(accountReturnPath({ orgId: "club", teamId: "team" })).toBe("/admin/accounts?orgId=club&teamId=team");
  });
  it("accepts only account selection keys and rejects path-shaped identifiers", () => {
    expect(accountContext("?orgId=club&teamId=../other&coachId=bad%2Fpath&returnTo=https://elsewhere.test&session=private")).toEqual({ orgId: "club" });
    expect(accountReturnPath()).toBe("/admin/accounts");
  });
});
