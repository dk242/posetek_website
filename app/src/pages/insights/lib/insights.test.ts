import { describe, expect, it } from "vitest";
import {
  formatMetric,
  lastActiveText,
  metricLabel,
  metricValue,
  sortPlayers,
  teamSummary,
  teamWeeklyReps,
  trendOf,
  weekLabel,
} from "./insights";
import type { InsightMetric, InsightPlayer } from "./insights";

const DAY = 24 * 60 * 60 * 1000;
const WEEKS = [Date.UTC(2026, 8, 7), Date.UTC(2026, 8, 14)];

function player(overrides: Partial<InsightPlayer> = {}): InsightPlayer {
  return { id: "p", firstName: "Zoe", lastName: "Park", lastActiveMillis: null, undatedReps: 0, weeklyReps: [0, 0], drillCounts: {}, metrics: [], ...overrides };
}

function metric(overrides: Partial<InsightMetric> = {}): InsightMetric {
  return { drill: "sprint", field: "max_velocity", lowerIsBetter: false, weeklyBest: [null, null], ...overrides };
}

describe("metric formatting", () => {
  it("converts stored SI values to the units the site already shows", () => {
    expect(formatMetric("max_velocity", 8)).toBe("17.9 mph");
    expect(formatMetric("jump_height_m", 0.5)).toBe("19.7 in");
    expect(formatMetric("jump_height_in", 17)).toBe("17.0 in");
    expect(formatMetric("broadJumpDistance", 2)).toBe("6.6 ft");
    expect(formatMetric("totalTime", 5.912)).toBe("5.91 s");
    expect(formatMetric("totalTime", null)).toBe("—");
    expect(metricValue("max_velocity", 8)).toBe(17.9);
    expect(metricValue("unknownField", 3.14159)).toBe(3.14159);
  });

  it("labels drill and metric together", () => {
    expect(metricLabel({ drill: "changeOfDirection", field: "totalTime" })).toBe("Change of direction · Total time");
    expect(metricLabel({ drill: "mystery", field: "score" })).toBe("mystery · score");
  });

  it("labels weeks in UTC so a Monday bucket never shows as Sunday", () => {
    expect(weekLabel(WEEKS[1])).toBe("Sep 14");
  });
});

describe("trendOf", () => {
  it("compares the first and last weeks that have a value", () => {
    expect(trendOf(metric({ weeklyBest: [null, 7.5, null, 8.2] }))).toEqual({ first: 7.5, last: 8.2, improved: true });
    expect(trendOf(metric({ weeklyBest: [8.2, 7.5] }))).toEqual({ first: 8.2, last: 7.5, improved: false });
  });

  it("treats a lower time as improvement", () => {
    expect(trendOf(metric({ field: "totalTime", lowerIsBetter: true, weeklyBest: [6.4, 5.9] }))?.improved).toBe(true);
  });

  it("reports no direction for a single week or an unchanged value, and null when empty", () => {
    expect(trendOf(metric({ weeklyBest: [null, 8] }))?.improved).toBeNull();
    expect(trendOf(metric({ weeklyBest: [8, 8] }))?.improved).toBeNull();
    expect(trendOf(metric({ weeklyBest: [8.2001, 8.2003] }))?.improved).toBeNull();
    expect(trendOf(metric())).toBeNull();
  });
});

describe("team rollups", () => {
  const players = [
    player({ id: "a", firstName: "Ada", weeklyReps: [2, 3], lastActiveMillis: WEEKS[1] + DAY }),
    player({ id: "b", firstName: "Ben", weeklyReps: [4, 0], lastActiveMillis: WEEKS[0] + DAY }),
    player({ id: "c", firstName: "Cy", weeklyReps: [0, 0] }),
  ];

  it("sums weekly reps and counts active and inactive players", () => {
    expect(teamWeeklyReps({ weeks: WEEKS, players })).toEqual([6, 3]);
    expect(teamSummary({ weeks: WEEKS, players })).toEqual({ players: 3, activeThisWeek: 1, repsThisWeek: 3, repsInWindow: 9, inactiveInWindow: 1 });
    expect(teamSummary({ weeks: WEEKS, players: [] })).toEqual({ players: 0, activeThisWeek: 0, repsThisWeek: 0, repsInWindow: 0, inactiveInWindow: 0 });
  });

  it("sorts by reps, recency or name without mutating the input", () => {
    expect(sortPlayers(players, "reps").map(entry => entry.id)).toEqual(["a", "b", "c"]);
    expect(sortPlayers(players, "lastActive").map(entry => entry.id)).toEqual(["a", "b", "c"]);
    expect(sortPlayers([...players].reverse(), "name").map(entry => entry.id)).toEqual(["a", "b", "c"]);
    expect(players.map(entry => entry.id)).toEqual(["a", "b", "c"]);
  });
});

describe("lastActiveText", () => {
  const now = Date.UTC(2026, 8, 16, 12);
  it("describes recency in days", () => {
    expect(lastActiveText(null, now)).toBe("No dated reps");
    expect(lastActiveText(now - 60_000, now)).toBe("Today");
    expect(lastActiveText(now - DAY, now)).toBe("Yesterday");
    expect(lastActiveText(now - 9 * DAY, now)).toBe("9 days ago");
  });
});
