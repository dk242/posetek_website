import { beforeEach, expect, it, vi } from "vitest";
const callable = vi.hoisted(() => vi.fn());
vi.mock("../../../lib/firebase", () => ({
  default: {}, auth: {}, db: {}, cloud: { httpsCallable: () => callable },
}));
import { loadIncidents } from "./aiIncidents";

beforeEach(() => callable.mockReset());
it("passes a page cursor and filters to the admin callable and uses its complete total", async () => {
  callable.mockResolvedValue({ data: { total: 620, pageSize: 50, nextCursor: "next", facets: { capability: [], code: [], kind: [], source: [] },
    breakdown: [{ label: "internal", count: 620 }], rows: [{ id: "req-0000", playerName: "Oldest Athlete", data: { code: "internal", playerId: "p", isTest: false, createdAt: "2026-09-01T00:00:00.000Z" } }] } });
  const page = await loadIncidents({ capability: "", code: "internal", kind: "", source: "", test: "athletes", triage: "", from: "", to: "", search: "reference-0000" }, "code", "prior");
  expect(callable).toHaveBeenCalledWith({ filters: { capability: "", code: "internal", kind: "", source: "", test: "athletes", triage: "", from: "", to: "", search: "reference-0000" }, group: "code", cursor: "prior" });
  expect(page.total).toBe(620);
  expect(page.rows[0].id).toBe("req-0000");
  expect(page.names.get("p")).toBe("Oldest Athlete");
  expect(page.breakdown[0].count).toBe(620);
});
