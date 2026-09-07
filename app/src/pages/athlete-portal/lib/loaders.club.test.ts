import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  player: vi.fn(), membership: vi.fn(), coach: vi.fn(), own: vi.fn(), admin: vi.fn(), call: vi.fn(),
}));
vi.mock("../../../lib/firebase", () => ({
  default: {}, auth: { currentUser: { uid: "viewer" } },
  db: { collection: () => ({ doc: () => ({ get: mocks.player }) }) },
  cloud: { httpsCallable: (name: string) => (data: unknown) => mocks.call(name, data) },
  storage: { ref: () => ({ listAll: async () => ({ prefixes: [], items: [] }) }) },
}));
vi.mock("../../../lib/identity", () => ({ findCoach: mocks.coach, findPlayer: mocks.player, ownsPlayer: mocks.own }));
vi.mock("../../../lib/organization-data", () => ({ loadClubMembership: mocks.membership }));
vi.mock("../../admin/lib/identity", () => ({ refreshAdminIdentity: mocks.admin }));
import { loadAuthenticated, loadTeamStandings } from "./loaders";
const membership = { uid: "viewer", organizationId: "club", role: "coach", teamIds: ["blue"], status: "active" };
function player(data = {}) {
  return { id: "original-player-doc", exists: true, data: () => ({ organizationId: "club", teamId: "blue", userUID: "athlete-auth", ...data }),
    ref: { collection: () => ({ get: async () => ({ docs: [] }) }) } };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.player.mockResolvedValue(player()); mocks.membership.mockResolvedValue(membership);
  mocks.own.mockReturnValue(false); mocks.admin.mockResolvedValue({ isAdmin: false });
  mocks.coach.mockResolvedValue({ id: "viewer", data: () => ({ members: ["original-player-doc"] }) });
  mocks.call.mockResolvedValue({ data: { athletes: [] } });
});
describe("club athlete handoff", () => {
  it("preserves the player's existing document ID and never resolves by email", async () => {
    mocks.own.mockReturnValue(true);
    const result = await loadAuthenticated({ uid: "athlete-auth" }, "original-player-doc");
    expect(result.playerId).toBe("original-player-doc");
    expect(result.access).toBe("athlete");
    expect(mocks.coach).not.toHaveBeenCalled();
  });
  it("allows either assigned team coach through canonical membership", async () => {
    expect((await loadAuthenticated({ uid: "viewer" }, "original-player-doc")).access).toBe("coach");
    expect(mocks.coach).not.toHaveBeenCalled();
  });
  it("denies a former coach even when their old roster still names the player", async () => {
    mocks.membership.mockResolvedValue(null);
    await expect(loadAuthenticated({ uid: "viewer" }, "original-player-doc")).rejects.toThrow("permission");
    expect(mocks.coach).not.toHaveBeenCalled();
  });
  it("denies the wrong team or organization without falling back to coach aliases", async () => {
    for (const changed of [{ ...membership, teamIds: ["red"] }, { ...membership, organizationId: "elsewhere" }]) {
      mocks.membership.mockResolvedValue(changed);
      await expect(loadAuthenticated({ uid: "viewer" }, "original-player-doc")).rejects.toThrow("permission");
    }
  });
  it("gives club managers a distinct oversight view and preserves admin access", async () => {
    mocks.membership.mockResolvedValue({ ...membership, role: "manager", teamIds: [] });
    expect((await loadAuthenticated({ uid: "viewer" }, "original-player-doc")).access).toBe("manager");
    mocks.admin.mockResolvedValue({ isAdmin: true });
    expect((await loadAuthenticated({ uid: "viewer" }, "original-player-doc")).access).toBe("admin");
  });
  it("continues resolving legacy independent coach rosters", async () => {
    mocks.player.mockResolvedValue(player({ organizationId: undefined, teamId: undefined }));
    expect((await loadAuthenticated({ uid: "viewer" }, "original-player-doc")).access).toBe("coach");
  });
  it("asks the server for this athlete's actual team standings", async () => {
    await loadTeamStandings("original-player-doc");
    expect(mocks.call).toHaveBeenCalledWith("getTeamLeaderboard", { teamId: "blue" });
    expect(mocks.coach).not.toHaveBeenCalled();
  });
});
