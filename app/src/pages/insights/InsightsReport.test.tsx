import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import InsightsReport from "./InsightsReport";
import type { ClubInsights } from "./lib/insights";

const WEEKS = [Date.UTC(2026, 8, 7), Date.UTC(2026, 8, 14)];

const insights: ClubInsights = {
  organizationId: "club",
  teamId: "a",
  teamName: "U15 Blue",
  generatedAtMillis: Date.UTC(2026, 8, 16, 12),
  rosterTruncated: false,
  weeks: WEEKS,
  players: [
    {
      id: "zoe", firstName: "Zoe", lastName: "<Park>", lastActiveMillis: Date.UTC(2026, 8, 15), undatedReps: 2,
      weeklyReps: [1, 4], drillCounts: { sprint: 3, dribbling: 2 },
      metrics: [
        { drill: "dribbling", field: "totalTime", lowerIsBetter: true, weeklyBest: [6.4, 5.9] },
        { drill: "sprint", field: "max_velocity", lowerIsBetter: false, weeklyBest: [8.2, 7.5] },
      ],
    },
    { id: "ada", firstName: "Ada", lastName: "Stone", lastActiveMillis: null, undatedReps: 0, weeklyReps: [0, 0], drillCounts: {}, metrics: [] },
  ],
};

describe("InsightsReport", () => {
  it("summarizes the team and lists every player with weekly counts", () => {
    const html = renderToStaticMarkup(<InsightsReport insights={insights} />);
    expect(html).toContain("<span>Active this week</span><strong>1</strong><em>of 2</em>");
    expect(html).toContain("<span>Reps this week</span><strong>4</strong>");
    expect(html).toContain("<span>5 total</span>");
    expect(html).toContain(">Sep 7</th>");
    expect(html).toContain(">Sep 14</th>");
    expect(html).toContain("Zoe &lt;Park&gt;");
    expect(html).not.toContain("<Park>");
    expect(html).toContain("No dated reps");
    expect(html.indexOf("Zoe")).toBeLessThan(html.indexOf("Ada"));
    expect(html).not.toContain("insights-detail");
    expect(html).not.toContain("Only the first");
    expect(renderToStaticMarkup(<InsightsReport insights={{ ...insights, rosterTruncated: true }} />)).toContain("Only the first 2 players on this team are shown.");
  });

  it("opens a player's per-drill trends with direction stated in text, not color alone", () => {
    const html = renderToStaticMarkup(<InsightsReport insights={insights} initialOpenPlayer="zoe" />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Sprint <strong>3</strong>");
    expect(html).toContain("2 reps have no recorded date");
    expect(html).toContain("6.40 s → 5.90 s <em>Improving</em>");
    expect(html).toContain("18.3 mph → 16.8 mph <em>Declining</em>");
    expect((html.match(/<canvas/g) ?? []).length).toBe(3);
  });
});
