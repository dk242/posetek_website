import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PerformanceProgress, { progressDisplay } from "./PerformanceProgress";
import { expandedRequest } from "./lib/expandedQuery";
import { previewInsights } from "./lib/preview";
const request = expandedRequest("view=testing", new Date("2026-09-17T04:00:00Z"));
describe("verified V2 performance", () => {
  it("converts normalized primary values once and retains timing units", () => {
    expect(progressDisplay({ drill: "sprint", unit: "m/s" }).factor * 8).toBeCloseTo(17.89552);
    expect(progressDisplay({ drill: "jump", unit: "m" }).factor * .5).toBeCloseTo(19.685);
    expect(progressDisplay({ drill: "broadJump", unit: "m" }).factor * 2).toBeCloseTo(6.56168);
    expect(progressDisplay({ drill: "dribbling", unit: "s" })).toEqual({ unit: "s", factor: 1, digits: 2 });
  });
  it("renders server sample counts, full filtered denominator and local boundary dates", () => {
    const data = previewInsights(request);
    data.testing.progress = [{ drill: "sprint", unit: "m/s", lowerIsBetter: false, samples: 3, players: 2, weeks: [{ weekStart: "2026-09-07", best: null, samples: 0, players: 0 }, { weekStart: "2026-09-14", best: 8, samples: 3, players: 2 }] }];
    const html = renderToStaticMarkup(<PerformanceProgress data={data} />);
    expect(html).toContain("3 qualifying results · 2 of 84 matching players"); expect(html).toContain("America/Los_Angeles");
    expect(html).toContain("2026-09-07"); expect(html).toContain("17.9"); expect(html).toContain("No qualified result");
    expect(html).toContain("not a measure of individual improvement"); expect(html).not.toContain("Open team trends");
  });
  it("distinguishes no verified results from an older unavailable API response", () => {
    const data = previewInsights(request); data.testing.progress = [];
    expect(renderToStaticMarkup(<PerformanceProgress data={data} />)).toContain("No qualified results in this period");
    delete data.testing.progress;
    expect(renderToStaticMarkup(<PerformanceProgress data={data} />)).toContain("Qualified performance is unavailable");
  });
  it("keeps synthetic metric samples consistent across pages and filtered exercise coverage", () => {
    const data = previewInsights({ ...request, division: "girls" });
    expect(data.testing.progress).toEqual(previewInsights({ ...request, division: "girls" }, 1).testing.progress);
    expect(data.testing.progress!.reduce((sum, series) => sum + series.samples, 0)).toBe(data.testing.qualifyingTests);
    for (const series of data.testing.progress!) {
      expect(series.weeks.reduce((sum, week) => sum + week.samples, 0)).toBe(series.samples);
      expect(series.players).toBeLessThanOrEqual(data.roster.filtered);
    }
  });
});
