import { beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ context: vi.fn(), coach: vi.fn(), docs: {} as Record<string, Record<string, unknown>> }));
vi.mock("../../../lib/organization-data", () => ({ getClubContext: f.context }));
vi.mock("../../../lib/firebase", () => ({ default: {}, auth: {}, db: { collection: () => ({ doc: (id: string) => ({ get: async () => ({ id, exists: !!f.docs[id], data: () => f.docs[id] }) }) }) } }));
vi.mock("../../../lib/identity", () => ({ findCoach: f.coach }));
vi.mock("../../athlete-portal/lib/loaders", () => ({ submitLlmJob: vi.fn() }));
import { loadCoachContext } from "./data";

beforeEach(() => { vi.clearAllMocks(); f.coach.mockResolvedValue(null); f.docs = {}; });
describe("canonical coach dashboard roster", () => {
  it("uses canonical context players when the team's playerIds mirror is stale or empty", async () => {
    f.context.mockResolvedValue({ role: "coach", organization: { id: "club", name: "Club" },
      teams: [{ id: "team", organizationId: "club", name: "Team", playerIds: ["stale"] }],
      players: [{ id: "current", organizationId: "club", teamId: "team" }, { id: "moved", organizationId: "club", teamId: "team" }, { id: "deleted", organizationId: "club", teamId: "team" }, { id: "other", organizationId: "club", teamId: "other-team" }] });
    f.docs = { current: { organizationId: "club", teamId: "team", firstName: "Current" }, moved: { organizationId: "club", teamId: "new-team" }, stale: { organizationId: "club", teamId: "team" } };
    const result = await loadCoachContext({ uid: "coach" }, "team", "club");
    expect(f.context).toHaveBeenCalledWith("club");
    expect(result.players.map(p => p.id)).toEqual(["current"]);
    expect(result.organizationId).toBe("club"); expect(result.teamId).toBe("team");
  });
  it("retains canonical navigation for an empty authorized team", async () => {
    f.context.mockResolvedValue({ role: "coach", organization: { id: "club", name: "Club" }, teams: [{ id: "empty", organizationId: "club", name: "Empty", playerIds: [] }], players: [] });
    const result = await loadCoachContext({ uid: "coach" }, "empty", "club");
    expect(result.players).toEqual([]);
    expect(result.teamId).toBe("empty");
  });
});
