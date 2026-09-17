import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ user: { uid: "viewer", isAnonymous: false }, docs: {} as Record<string, any>, errors: {} as Record<string, any>, context: vi.fn(), legacy: vi.fn(), organizations: vi.fn(), coaches: vi.fn() }));
vi.mock("../../../lib/firebase", () => ({
  auth: { get currentUser() { return f.user; } },
  db: { collection: (name: string) => {
    const snapshot = (id: string) => ({ id, exists: !!f.docs[id], data: () => f.docs[id] });
    const ref = (id: string) => ({ id, path: `${name}/${id}`, get: async () => { if (f.errors[id]) throw f.errors[id]; return snapshot(id); } });
    const comparable = (value: any) => value?.path || value;
    const query = (field: string, value: any, limit = Infinity): any => ({ limit: (n: number) => query(field, value, n), get: async () => ({ docs: Object.keys(f.docs).filter(id => comparable(f.docs[id][field]) === comparable(value)).slice(0, limit).map(snapshot) }) });
    return { doc: ref, where: (field: string, _op: string, value: any) => query(field, value) };
  } },
}));
vi.mock("../../../lib/organization-data", () => ({ getClubContext: f.context }));
vi.mock("../../coach-dashboard/lib/data", () => ({ loadCoachContext: f.legacy }));
vi.mock("./accounts", () => ({ loadOrganizations: f.organizations, loadCoaches: f.coaches, playerRow: (id: string, raw: any) => ({ id, raw, organizationId: raw.organizationId ?? raw.organization?.id, teamId: raw.teamId, name: raw.firstName || id }) }));
import { loadPlannerScope } from "./plannerScope";

const club = (role: string) => ({ role, organizations: [{ id: "club", name: "Club", schemaVersion: 2 }], organization: { id: "club", name: "Club", schemaVersion: 2 }, teams: [{ id: "team", organizationId: "club", playerIds: ["player"] }], players: [{ id: "player", organizationId: "club", teamId: "team" }] });
beforeEach(() => { vi.clearAllMocks(); f.user = { uid: "viewer", isAnonymous: false }; f.errors = {}; f.docs = { player: { firstName: "Athlete", organizationId: "club", teamId: "team" } }; f.coaches.mockResolvedValue([]); f.organizations.mockResolvedValue(club("admin").organizations); });
describe("personalized planner role scope", () => {
  it("loads an athlete's fixed UID-bound profile without querying a club roster", async () => {
    f.docs.player.authenticationUID = "viewer";
    expect((await loadPlannerScope("athlete", "", "player")).players.map(p => p.id)).toEqual(["player"]);
    expect(f.context).not.toHaveBeenCalled();
  });
  it("rejects a shared player and conflicting owner fields", async () => {
    await expect(loadPlannerScope("athlete", "", "player")).rejects.toThrow("own athlete account");
    f.docs.player.authenticationUID = "viewer"; f.docs.player.userUID = "other";
    await expect(loadPlannerScope("athlete", "", "player")).rejects.toThrow("own athlete account");
  });
  it.each(["coach", "manager"])("uses canonical context for %s and never unions a legacy roster", async role => {
    f.context.mockResolvedValue(club(role));
    expect((await loadPlannerScope("staff", "club")).players.map(p => p.id)).toEqual(["player"]);
    expect(f.legacy).not.toHaveBeenCalled();
    f.docs.player.organizationId = "moved";
    expect((await loadPlannerScope("staff", "club")).players).toEqual([]);
  });
  it("rejects nonadmins in the admin adapter", async () => {
    f.context.mockResolvedValue(club("manager"));
    await expect(loadPlannerScope("admin")).rejects.toThrow("Administrator");
  });
  it("retains only independent legacy profiles in legacy fallback", async () => {
    f.context.mockResolvedValue({ role: "none" });
    f.legacy.mockResolvedValue({ players: [{ id: "independent" }, { id: "migrated", organizationId: "club" }, { id: "inactive", organizationId: null }] });
    expect((await loadPlannerScope("staff")).players.map(p => p.id)).toEqual(["independent"]);
  });
  it("loads admin legacy organizations by references, code and coach relationships without calling the club API with a legacy ID", async () => {
    f.context.mockResolvedValue({ ...club("admin"), organization: null, players: [], teams: [] });
    f.organizations.mockResolvedValue([{ id: "legacy", schemaVersion: 1, code: "OLD", coachIds: ["coach"], name: "Old club", logoUrl: null }]);
    f.coaches.mockResolvedValue([{ id: "coach", userUID: "coach-user", organizationId: "legacy", members: ["member"], name: "Coach" }]);
    f.docs = { reference: { organization: { id: "legacy", path: "organizations/legacy" } }, textReference: { organization: "legacy" }, code: { organizationCode: "OLD" }, member: {},
      pointer: { coachUID: "coach-user" }, moved: { organizationCode: "OLD", organizationId: "elsewhere" }, other: { organizationCode: "OTHER" } };
    expect((await loadPlannerScope("admin", "legacy")).players.map(p => p.id)).toEqual(["code", "member", "pointer", "reference", "textReference"]);
    expect(f.context).toHaveBeenCalledExactlyOnceWith();
  });
  it("keeps staff legacy code scope consistent with the gateway and excludes migrated profiles", async () => {
    f.context.mockResolvedValue({ role: "none" });
    f.legacy.mockResolvedValue({ coachDoc: { data: () => ({ userUID: "viewer", organizationCode: "OLD" }) }, players: [{ id: "member" }] });
    f.docs = { code: { organizationCode: "OLD" }, migrated: { organizationCode: "OLD", organizationId: "club" }, pointerOnly: { coachUID: "viewer" } };
    expect((await loadPlannerScope("staff", "legacy")).players.map(p => p.id)).toEqual(["code", "member"]);
  });
  it("rejects missing admin organizations instead of returning arbitrary organizationId matches", async () => {
    f.context.mockResolvedValue(club("admin"));
    await expect(loadPlannerScope("admin", "missing")).rejects.toThrow("not available");
  });
  it("removes players moved out of a coach's teams while retaining same-club manager access", async () => {
    f.docs.player.teamId = "other-team";
    f.context.mockResolvedValue(club("coach"));
    expect((await loadPlannerScope("staff", "club")).players).toEqual([]);
    f.context.mockResolvedValue(club("manager"));
    expect((await loadPlannerScope("staff", "club")).players.map(p => p.id)).toEqual(["player"]);
  });
  it("omits per-player revocation errors but exposes network failures", async () => {
    f.context.mockResolvedValue(club("coach"));
    f.errors.player = { code: "permission-denied" };
    expect((await loadPlannerScope("staff", "club")).players).toEqual([]);
    f.errors.player = new Error("Network unavailable");
    await expect(loadPlannerScope("staff", "club")).rejects.toThrow("Network unavailable");
  });
  it("reports and caps an inherited large legacy roster", async () => {
    f.context.mockResolvedValue({ role: "none" });
    f.legacy.mockResolvedValue({ players: Array.from({ length: 2001 }, (_, i) => ({ id: String(i) })) });
    const scope = await loadPlannerScope("staff");
    expect(scope.players).toHaveLength(2000);
    expect(scope.limited).toBe(true);
  });
  it("rejects anonymous sessions and results from a previous sign-in", async () => {
    f.user.isAnonymous = true;
    await expect(loadPlannerScope("staff")).rejects.toThrow("registered account");
    f.user.isAnonymous = false;
    f.context.mockImplementation(async () => { f.user = { uid: "another-user", isAnonymous: false }; return club("coach"); });
    await expect(loadPlannerScope("staff", "club")).rejects.toThrow("sign-in changed");
  });
});
