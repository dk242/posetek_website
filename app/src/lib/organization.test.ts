import { describe, expect, it } from "vitest";
import { canAccessClubPlayer, membershipFrom, selectedTeam, visibleTeams } from "./organization";
const manager = membershipFrom("m", "club", { userUID: "m", role: "manager", status: "active", teamIds: [] })!;
const coach = membershipFrom("c", "club", { userUID: "c", role: "coach", status: "active", teamIds: ["first"] })!;
const teams = ["first", "second"].map(id => ({ id, name: id, organizationId: "club", coachUIDs: [], playerIds: [] }));
describe("club authorization used by navigation", () => {
  it("lets managers inspect their club and denies another club", () => {
    expect(canAccessClubPlayer(manager, { organizationId: "club", teamId: "second" })).toBe(true);
    expect(canAccessClubPlayer(manager, { organizationId: "other", teamId: "second" })).toBe(false);
  });
  it("scopes every coach to assigned teams, even with legacy roster pointers", () => {
    expect(canAccessClubPlayer(coach, { organizationId: "club", teamId: "first" })).toBe(true);
    expect(canAccessClubPlayer(coach, { organizationId: "club", teamId: "second", coachUID: "c" })).toBe(false);
  });
  it("rejects revoked membership and unrecognized roles", () => {
    expect(membershipFrom("m", "club", { userUID: "m", role: "manager", status: "revoked", teamIds: [] })).toBeNull();
    expect(membershipFrom("m", "club", { userUID: "m", role: "admin", status: "active", teamIds: [] })).toBeNull();
  });
  it("rejects missing or contradictory canonical UID bindings", () => {
    for (const userUID of [undefined, null, "someone-else", ""]) {
      expect(membershipFrom("m", "club", { userUID, role: "manager", status: "active", teamIds: [] })).toBeNull();
    }
  });
  it("requires the canonical team array even for an organization manager", () => {
    for (const teamIds of [undefined, null, "first", { first: true }]) {
      expect(membershipFrom("m", "club", { userUID: "m", role: "manager", status: "active", teamIds })).toBeNull();
    }
  });
  it("does not widen an invalid or unselected team to the entire roster", () => {
    expect(selectedTeam(teams, null)).toBeNull();
    expect(() => selectedTeam([teams[0]], "second")).toThrow("not assigned");
    expect(selectedTeam([teams[0]], null)?.id).toBe("first");
  });
  it("keeps a coach's team list inside their organization", () => {
    expect(visibleTeams([...teams, { ...teams[0], organizationId: "other" }], { organization: { id: "club", name: "Club", schemaVersion: 2 }, membership: coach }).map(t => t.id)).toEqual(["first"]);
  });
});
