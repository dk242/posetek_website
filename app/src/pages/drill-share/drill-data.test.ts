import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClubMembership } from "../../lib/organization";

const mocks = vi.hoisted(() => ({ get: vi.fn(), coach: vi.fn(), player: vi.fn(), membership: vi.fn(), identity: vi.fn(), callable: vi.fn() }));
vi.mock("../../lib/firebase", () => ({
  db: { collection: () => ({ doc: (id: string) => ({ get: () => mocks.get(id) }) }) },
  cloud: { httpsCallable: mocks.callable },
}));
vi.mock("../../lib/identity", async importOriginal => ({
  ...await importOriginal<typeof import("../../lib/identity")>(), findCoach: mocks.coach, findPlayer: mocks.player,
}));
vi.mock("../../lib/organization-data", () => ({ loadClubMembership: mocks.membership }));
vi.mock("../admin/lib/identity", () => ({ refreshAdminIdentity: mocks.identity }));

import { resolveAuthenticatedDrillPlayer } from "./drill-data";

const doc = (id: string, data: Record<string, unknown>) => ({ id, exists: true, data: () => data });
const clubPlayer = { userUID: "athlete", organizationId: "club", teamId: "team" };
const member = (role: "manager" | "coach", teamIds: string[] = []): ClubMembership => ({ uid: "viewer", organizationId: "club", role, status: "active", teamIds });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.get.mockResolvedValue(doc("player", clubPlayer));
  mocks.coach.mockResolvedValue(null);
  mocks.player.mockResolvedValue(null);
  mocks.membership.mockResolvedValue(null);
  mocks.identity.mockImplementation(async (user: { uid: string }) => ({ uid: user.uid, isAdmin: false }));
});

describe("dedicated authenticated drill access", () => {
  it("opens a requested athlete for a refreshed verified admin without requiring a legacy coach profile", async () => {
    mocks.identity.mockResolvedValue({ uid: "viewer", isAdmin: true });
    const result = await resolveAuthenticatedDrillPlayer({ uid: "viewer", email: "admin@posetek.net" }, "player");
    expect(result.viewer.role).toBe("admin");
    expect(result.player.id).toBe("player");
    expect(mocks.coach).not.toHaveBeenCalled();
    expect(mocks.membership).not.toHaveBeenCalled();
  });

  it.each(["manager", "coach"] as const)("uses current club membership for an authorized %s without a coach document", async role => {
    mocks.membership.mockResolvedValue(member(role, role === "coach" ? ["team"] : []));
    const result = await resolveAuthenticatedDrillPlayer({ uid: "viewer" }, "player");
    expect(result.viewer.role).toBe(role);
    expect(mocks.membership).toHaveBeenCalledWith("viewer", "club");
    expect(mocks.coach).not.toHaveBeenCalled();
  });

  it.each([
    null,
    member("coach", ["other"]),
    { ...member("manager"), organizationId: "other" },
    { ...member("manager"), status: "revoked" },
  ])("rejects absent, cross-team, foreign and revoked memberships despite stale coach roster mirrors", async membership => {
    mocks.membership.mockResolvedValue(membership);
    mocks.coach.mockResolvedValue(doc("coach", { userUID: "viewer", members: ["player"] }));
    await expect(resolveAuthenticatedDrillPlayer({ uid: "viewer" }, "player")).rejects.toThrow("permission");
    expect(mocks.coach).not.toHaveBeenCalled();
  });

  it("does not infer administrator access from an unverified domain email", async () => {
    await expect(resolveAuthenticatedDrillPlayer({ uid: "viewer", email: "admin@posetek.net" }, "player")).rejects.toThrow("permission");
    expect(mocks.identity).toHaveBeenCalledOnce();
  });

  it("opens only the athlete's canonical ownership and rejects conflicting UID bindings", async () => {
    mocks.get.mockResolvedValue(doc("player", { ...clubPlayer, authenticationUID: "athlete" }));
    expect((await resolveAuthenticatedDrillPlayer({ uid: "athlete" }, "player")).viewer.role).toBe("player");
    mocks.get.mockResolvedValue(doc("player", { ...clubPlayer, authenticationUID: "another" }));
    await expect(resolveAuthenticatedDrillPlayer({ uid: "athlete" }, "player")).rejects.toThrow("permission");
  });

  it("resolves a linked athlete when a direct player parameter is absent", async () => {
    mocks.player.mockResolvedValue(doc("player", clubPlayer));
    expect((await resolveAuthenticatedDrillPlayer({ uid: "athlete" }, null)).player.id).toBe("player");
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("preserves a bound independent coach's legacy roster access and rejects an unrelated coach", async () => {
    mocks.get.mockResolvedValue(doc("player", { userUID: "athlete", coachDocId: "legacy" }));
    mocks.coach.mockResolvedValue(doc("legacy", { userUID: "viewer", members: [] }));
    expect((await resolveAuthenticatedDrillPlayer({ uid: "viewer" }, "player")).viewer.role).toBe("coach");
    mocks.coach.mockResolvedValue(doc("unrelated", { userUID: "viewer", members: [] }));
    await expect(resolveAuthenticatedDrillPlayer({ uid: "viewer" }, "player")).rejects.toThrow("not on your roster");
    expect(mocks.membership).not.toHaveBeenCalled();
  });

  it("rejects anonymous sessions and an account changed during identity refresh", async () => {
    await expect(resolveAuthenticatedDrillPlayer({ uid: "viewer", isAnonymous: true }, "player")).rejects.toThrow("Sign in");
    mocks.identity.mockResolvedValue({ uid: "other", isAdmin: true });
    await expect(resolveAuthenticatedDrillPlayer({ uid: "viewer" }, "player")).rejects.toThrow("account changed");
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("does not fall back to legacy roster access for malformed migrated organization identity", async () => {
    mocks.get.mockResolvedValue(doc("player", { organizationId: null, coachUID: "viewer" }));
    mocks.coach.mockResolvedValue(doc("viewer", { userUID: "viewer", members: ["player"] }));
    await expect(resolveAuthenticatedDrillPlayer({ uid: "viewer" }, "player")).rejects.toThrow("permission");
    expect(mocks.coach).not.toHaveBeenCalled();
  });
});
