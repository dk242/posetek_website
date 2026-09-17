import { describe, expect, it, vi } from "vitest";
import type { ClubContext } from "../../../lib/organization-data";
import { createInsightsRequestGuard, dashboardPlayerQuery, insightsAccessFailure, insightsFailureMessage, insightsLink, insightsPlayerLink, insightsRequest, insightsReturnLink, loadInsightsScope } from "./navigation";

const org = { id: "club", name: "Club", schemaVersion: 2 };
const team = (id: string, organizationId = "club") => ({ id, name: id, organizationId, playerIds: [], coachUIDs: [] });
function context(role: ClubContext["role"] = "manager"): ClubContext {
  return { role, organization: org, organizations: [org], teams: [team("a"), team("b")], players: [], staff: [], invitations: [] };
}

describe("Team Insights scope and navigation", () => {
  it.each(["admin", "manager"] as const)("retains all authorized %s teams and the requested selection", async role => {
    const scope = await loadInsightsScope(insightsRequest("orgId=club&teamId=b&weeks=12"), async () => context(role));
    expect(scope.context.teams.map(t => t.id)).toEqual(["a", "b"]);
    expect(scope.teamId).toBe("b");
    expect(scope.notice).toBe("");
  });
  it("uses only the current coach's returned teams and replaces an unavailable requested team", async () => {
    const response = { ...context("coach"), teams: [team("a"), team("wrong-org", "other")] };
    const scope = await loadInsightsScope(insightsRequest("orgId=club&teamId=b"), async () => response);
    expect(scope.context.teams.map(t => t.id)).toEqual(["a"]);
    expect(scope.teamId).toBe("a");
    expect(scope.notice).toContain("no longer available");
  });
  it.each(["player", "none"] as const)("exposes no staff team choices to %s accounts", async role => {
    const scope = await loadInsightsScope(insightsRequest("orgId=club&teamId=b"), async () => context(role));
    expect(scope.context.teams).toEqual([]);
    expect(scope.orgId).toBe("");
    expect(scope.teamId).toBe("");
  });
  it("resolves an admin's default canonical organization and excludes legacy choices", async () => {
    const load = vi.fn().mockResolvedValueOnce({ ...context("admin"), organization: null, teams: [], organizations: [{ id: "old", schemaVersion: 1 }, org] }).mockResolvedValueOnce(context("admin"));
    const scope = await loadInsightsScope(insightsRequest(""), load);
    expect(load.mock.calls).toEqual([[undefined], ["club"]]);
    expect(scope.orgId).toBe("club");
    expect(scope.teamId).toBe("a");
    expect(scope.context.organizations).toEqual([org]);
  });
  it("handles an empty authorized roster and propagates permission failures for retry", async () => {
    const scope = await loadInsightsScope(insightsRequest("orgId=club"), async () => ({ ...context(), teams: [] }));
    expect(scope.teamId).toBe("");
    await expect(loadInsightsScope(insightsRequest("orgId=club"), async () => { throw new Error("Permission denied"); })).rejects.toThrow("Permission denied");
    await expect(loadInsightsScope(insightsRequest("orgId=other"), async () => context())).rejects.toThrow("no longer available");
  });
  it("retains an organization-service limit warning even after filtering legacy choices", async () => {
    const scope = await loadInsightsScope(insightsRequest("orgId=club"), async () => ({ ...context("admin"), organizations: [org, ...Array.from({ length: 99 }, (_, i) => ({ id: `legacy-${i}`, name: "Legacy", schemaVersion: 1 }))] }));
    expect(scope.context.organizations).toEqual([org]);
    expect(scope.limited).toBe(true);
  });
  it("round-trips team, organization, origin and period without accepting arbitrary return URLs", () => {
    const link = insightsLink({ orgId: "club", teamId: "b", coachId: "coach" }, "accounts", 12);
    expect(insightsRequest(link.split("?")[1])).toEqual({ orgId: "club", teamId: "b", coachId: "coach", from: "accounts", weeks: 12 });
    expect(insightsRequest("orgId=club&teamId=../bad&weeks=999&from=https://elsewhere.test")).toEqual({ orgId: "club", from: "organization", weeks: 8 });
  });
  it("returns each perspective to the selected canonical context", () => {
    const selection = { orgId: "club", teamId: "b", coachId: "coach" };
    expect(insightsReturnLink("admin", selection, "accounts")).toBe("/admin/accounts/coach/coach?orgId=club&teamId=b&coachId=coach");
    expect(insightsReturnLink("admin", selection, "organization")).toBe("/admin/organizations?orgId=club&teamId=b&coachId=coach");
    expect(insightsReturnLink("manager", selection, "organization")).toBe("/organization?orgId=club&teamId=b");
    expect(insightsReturnLink("coach", selection, "dashboard")).toContain("orgId=club&teamId=b&coachId=coach&team=b");
    expect(insightsPlayerLink("admin", "player", selection)).toBe("/admin/accounts/player/player/results?orgId=club&teamId=b&coachId=coach");
    expect(insightsPlayerLink("coach", "player", selection)).toBe("/athlete?player=player&view=drills&orgId=club&teamId=b");
  });
  it("keeps a multi-organization coach's selected team through athlete detail, back and reload", () => {
    const selected = { orgId: "second-club", teamId: "assigned-team" };
    const opened = dashboardPlayerQuery("team=old&orgId=old&teamId=old", selected, "player");
    expect(Object.fromEntries(opened)).toEqual({ orgId: "second-club", teamId: "assigned-team", team: "assigned-team", athlete: "player" });
    const back = dashboardPlayerQuery(opened.toString(), selected, null);
    expect(back.has("athlete")).toBe(false);
    expect(back.get("orgId")).toBe("second-club");
    expect(back.get("teamId")).toBe("assigned-team");
    expect(dashboardPlayerQuery("team=legacy&preview=1", null, "sample").toString()).toBe("team=legacy&preview=1&athlete=sample");
  });
  it.each(["functions/internal", "functions/unavailable", "functions/deadline-exceeded"])("keeps transient %s report failures recoverable without raw server codes", code => {
    expect(insightsAccessFailure({ code })).toBe(false);
    expect(insightsFailureMessage({ code, message: "internal [0]" }, true)).toBe("Team Insights could not be loaded. Retry or choose another team.");
  });
  it.each(["functions/permission-denied", "functions/unauthenticated", "functions/not-found"])("invalidates cached report scope for %s", code => {
    expect(insightsAccessFailure({ code })).toBe(true);
    expect(insightsFailureMessage({ code }, true)).toContain("current organization access");
  });
});

describe("Team Insights request lifecycle", () => {
  it("suppresses delayed context and report results after a team switch", async () => {
    const guard = createInsightsRequestGuard(() => "user");
    const old = guard.begin("user");
    let resolve!: (value: string) => void;
    let shown = "";
    const pending = new Promise<string>(done => { resolve = done; }).then(value => { if (old()) shown = value; });
    const current = guard.begin("user");
    shown = "new team";
    resolve("old team"); await pending;
    expect(shown).toBe("new team");
    expect(current()).toBe(true);
  });
  it("invalidates on auth change or unmount and starts a clean retry", () => {
    let uid: string | undefined = "first";
    const guard = createInsightsRequestGuard(() => uid), old = guard.begin("first");
    uid = "second";
    expect(old()).toBe(false);
    const latest = guard.begin("second");
    guard.cancel();
    expect(latest()).toBe(false);
    expect(guard.begin("second")()).toBe(true);
  });
  it("suppresses an old same-account request failure after a new selection succeeds", async () => {
    const guard = createInsightsRequestGuard(() => "same-user"), old = guard.begin("same-user");
    let reject!: (reason: Error) => void;
    let error = "";
    const failed = new Promise<void>((_, fail) => { reject = fail; }).catch(failure => { if (old()) error = failure.message; });
    const latest = guard.begin("same-user");
    reject(new Error("Old team load failed")); await failed;
    expect(error).toBe("");
    expect(latest()).toBe(true);
  });
});
