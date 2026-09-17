import { describe, expect, it } from "vitest";
import { assertReportScope, expandedFailureMessage, minuteText, platformSlices, reportPayload, scopeFor, weeklySeries, workoutDurationText, workoutOutcomeSlices } from "./expanded";
import { expandedRequest } from "./expandedQuery";
import { previewInsights } from "./preview";
const request = expandedRequest("", new Date("2026-09-17T04:00:00Z"));
describe("expanded report contract", () => {
  it("uses admin global, staff organization and explicit team scopes without defaulting coaches to global", () => {
    expect(scopeFor(request, "admin")).toEqual({ kind: "global" });
    expect(scopeFor(request, "manager", "club")).toEqual({ kind: "organization", organizationId: "club" });
    expect(scopeFor({ ...request, orgId: "club", teamId: "team" }, "coach")).toEqual({ kind: "team", organizationId: "club", teamId: "team" });
    expect(() => scopeFor(request, "coach")).toThrow("No current organization");
  });
  it("sends opaque cursors and only selected allowed filters", () => {
    expect(reportPayload({ ...request, division: "girls", usagePlatform: "both", usageFeature: "results" }, { kind: "global" }, "opaque")).toMatchObject({ cursor: "opaque", pageSize: 25, timeZone: "America/Los_Angeles", filters: { division: "girls", usagePlatform: "both", usageFeature: "results" } });
  });
  it("rejects a response for old scope, dates, filters or incomplete projections", () => {
    const report = previewInsights(request);
    expect(() => assertReportScope(report, { kind: "global" }, request)).not.toThrow();
    expect(() => assertReportScope(report, { kind: "organization", organizationId: "northfield" }, request)).toThrow();
    expect(() => assertReportScope(report, { kind: "global" }, { ...request, division: "girls" })).toThrow();
    expect(() => assertReportScope(report, { kind: "global" }, { ...request, endDate: "2026-09-15" })).toThrow();
    expect(() => assertReportScope({ ...report, freshness: { ...report.freshness, complete: false as never } }, { kind: "global" }, request)).toThrow();
  });
  it("counts overlapping platforms once in the disjoint donut", () => {
    const usage = { ...previewInsights(request).usage, webMinutes: 70, iosMinutes: 45, overlapMinutes: 15, activeMinutes: 100 };
    expect(platformSlices(usage).map(slice => slice.value)).toEqual([55, 30, 15]);
    expect(platformSlices(usage).reduce((sum, slice) => sum + slice.value, 0)).toBe(usage.activeMinutes);
  });
  it("keeps pre-collection dates null and measured zero numeric across weekly buckets", () => {
    const weeks = weeklySeries([{ date: "2026-09-07", web: null, ios: null }, { date: "2026-09-14", web: 0, ios: null }], ["web", "ios"], "2026-09-07", "2026-09-20", [true, false]);
    expect(weeks.values).toEqual([[null, 0], [null, null]]);
    expect(minuteText(0, false)).toBe("Not collected");
    expect(minuteText(0, true)).toBe("0 min");
  });
  it("does not present server caps or stale projections as partial totals", () => {
    expect(expandedFailureMessage({ code: "functions/resource-exhausted" })).toContain("too large to load completely");
    expect(expandedFailureMessage({ code: "functions/failed-precondition" })).toContain("latest complete report");
    expect(expandedFailureMessage({ code: "functions/permission-denied" })).toContain("access");
    expect(expandedFailureMessage({ code: "functions/internal" })).not.toContain("internal");
  });
  it("counts log outcomes independently from player priority and in-period starts", () => {
    const workouts = { ...previewInsights(request).workouts, started: 4, completed: 1, endedEarly: 1, inProgress: 3, abandoned: 0, unknownEnding: 0, outcomeEvents: 5 };
    expect(workoutOutcomeSlices(workouts).map(row => row.value)).toEqual([1, 1, 3, 0, 0]);
    expect(workoutOutcomeSlices(workouts).reduce((sum, row) => sum + row.value, 0)).toBe(5);
  });
  it("distinguishes an actual zero timer from missing duration evidence", () => {
    expect(workoutDurationText(0, 1)).toBe("0 min");
    expect(workoutDurationText(0, 0)).toBe("Not recorded");
    expect(workoutDurationText(0)).toBe("Coverage unavailable");
  });
});
