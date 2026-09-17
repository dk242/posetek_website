import { describe, expect, it } from "vitest";
import { clearPlayerFilters, dateInZone, expandedQuery, expandedRequest, shiftDate } from "./expandedQuery";

describe("expanded Insights date and URL contract", () => {
  const now = new Date("2026-09-17T04:00:00Z");
  it("defaults to eight Los Angeles calendar weeks and cumulative testing", () => {
    expect(expandedRequest("", now)).toMatchObject({ startDate: "2026-07-23", endDate: "2026-09-16", timezone: "America/Los_Angeles", testingWindow: "cumulative", view: "overview" });
  });
  it("uses calendar dates through DST, not fixed24-hour offsets", () => {
    expect(shiftDate("2026-03-09", -1)).toBe("2026-03-08");
    expect(dateInZone(new Date("2026-03-09T06:30:00Z"), "America/Los_Angeles")).toBe("2026-03-08");
  });
  it("preserves scope, period, view and filters in reloadable links", () => {
    const request = expandedRequest("orgId=club&teamId=team&view=testing&division=girls&ageBand=13-15&testingWindow=period", now);
    expect(expandedRequest(expandedQuery(request).toString(), now)).toEqual(request);
    expect(expandedRequest(expandedQuery(request, { ...clearPlayerFilters(), teamId: "next" }).toString(), now)).toMatchObject({ teamId: "next", division: "", ageBand: "", view: "testing", testingWindow: "period" });
  });
  it("rejects impossible, reversed and excessive date ranges and unknown dimensions", () => {
    expect(expandedRequest("start=2026-02-30&end=2026-09-16&timezone=Invalid&view=secret&division=gender", now)).toMatchObject({ startDate: "2026-07-23", timezone: "America/Los_Angeles", view: "overview", division: "" });
    expect(expandedRequest("start=2027-01-01&end=2026-09-16", now).startDate).toBe("2026-07-23");
  });
});
