import { describe, expect, it } from "vitest";
import {
  activePlan,
  appBand,
  buildStatsSnapshot,
  defaultGoals,
  defaultIntake,
  focusAreasFor,
  hoursLine,
  inferredLevel,
  lastActiveLine,
  planJobParams,
  planProgress,
  resolveAge,
  trainingTotals,
} from "./logic";
import { buildProfile } from "../../../components/athlete-stats/AthleteStats";

// Reps shaped like the portal's normalized `_statsDrill`-tagged rows.
function sprintRep(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1", _statsDrill: "sprint", repType: "sprint", sessionNumber: 1,
    max_velocity: 6.0, createdAtMillis: Date.UTC(2026, 7, 1), ...overrides,
  };
}

function jumpRep(overrides: Record<string, unknown> = {}) {
  return {
    id: "r2", _statsDrill: "jump", repType: "jump", sessionNumber: 1,
    jumpHeight: 0.4, createdAtMillis: Date.UTC(2026, 7, 2), ...overrides,
  };
}

describe("activePlan", () => {
  it("prefers the newest active plan and ignores superseded ones", () => {
    const plans = [
      { id: "a", status: "superseded", generatedAt: new Date(2026, 6, 1) },
      { id: "b", status: "active", generatedAt: new Date(2026, 6, 10) },
      { id: "c", status: "active", generatedAt: new Date(2026, 7, 10) },
    ];
    expect(activePlan(plans)?.id).toBe("c");
    expect(activePlan([{ id: "a", status: "completed" }])).toBeNull();
    expect(activePlan([])).toBeNull();
  });
});

describe("trainingTotals", () => {
  it("sums ended log durations and counts completions", () => {
    const logs = [
      { startedAt: new Date(2026, 7, 1, 10, 0), endedAt: new Date(2026, 7, 1, 10, 30), endReason: "completed" },
      { startedAt: new Date(2026, 7, 2, 10, 0), endedAt: new Date(2026, 7, 2, 10, 15), endReason: "endedEarly" },
      { startedAt: new Date(2026, 7, 3, 10, 0) },
    ];
    const totals = trainingTotals(logs, [sprintRep()]);
    expect(totals.trainingSeconds).toBe(45 * 60);
    expect(totals.workoutsCompleted).toBe(1);
    expect(totals.workoutsStarted).toBe(3);
    expect(totals.lastActiveMillis).toBe(new Date(2026, 7, 3, 10, 0).valueOf());
  });

  it("is empty-safe", () => {
    const totals = trainingTotals([], []);
    expect(totals.trainingSeconds).toBe(0);
    expect(totals.lastActiveMillis).toBeNull();
  });
});

describe("format helpers", () => {
  it("formats durations", () => {
    expect(hoursLine(0)).toBe("0 min");
    expect(hoursLine(45 * 60)).toBe("45 min");
    expect(hoursLine(150 * 60)).toBe("2h 30m");
    expect(hoursLine(120 * 60)).toBe("2h");
  });

  it("labels last-active recency", () => {
    const now = new Date(2026, 7, 22, 12, 0);
    expect(lastActiveLine(null, now)).toBe("No activity yet");
    expect(lastActiveLine(new Date(2026, 7, 22, 8, 0).valueOf(), now)).toBe("Today");
    expect(lastActiveLine(new Date(2026, 7, 21, 8, 0).valueOf(), now)).toBe("Yesterday");
    expect(lastActiveLine(new Date(2026, 7, 18, 8, 0).valueOf(), now)).toBe("4 days ago");
  });

  it("describes plan progress", () => {
    expect(planProgress(null)).toBe("No plan");
    const plan = { startDate: "2026-08-17", horizonWeeks: 6, weeks: [] };
    const line = planProgress(plan, new Date(2026, 7, 22));
    expect(line).toContain("Week 1 of 6");
  });
});

describe("focusAreasFor", () => {
  it("prefers the plan's focus areas", () => {
    const plan = { focusAreas: [{ domain: "linearSpeed", rationale: "slow start" }, { domain: "shooting" }] };
    const profile = buildProfile([]);
    expect(focusAreasFor(plan, profile)).toEqual([
      { domain: "linearSpeed", source: "plan" },
      { domain: "shooting", source: "plan" },
    ]);
  });

  it("suggests the weakest measured axes without a plan", () => {
    const profile = buildProfile([sprintRep({ max_velocity: 3.0 }), jumpRep({ jumpHeight: 0.44 })]);
    const focus = focusAreasFor(null, profile);
    expect(focus).toHaveLength(2);
    expect(focus[0].source).toBe("suggested");
    // The slow sprint scores far below the strong jump.
    expect(focus[0].domain).toBe("linearSpeed");
  });

  it("is empty for an unmeasured athlete without a plan", () => {
    expect(focusAreasFor(null, buildProfile([]))).toEqual([]);
  });
});

describe("plan-generation defaults", () => {
  it("infers level from the overall score with the app's thresholds", () => {
    expect(inferredLevel(null)).toBe("club");
    expect(inferredLevel(90)).toBe("performance");
    expect(inferredLevel(70)).toBe("club");
    expect(inferredLevel(30)).toBe("foundation");
  });

  it("derives goals from the weakest axes, deduped", () => {
    const profile = buildProfile([sprintRep({ max_velocity: 3.0 }), jumpRep({ jumpHeight: 0.2 })]);
    const goals = defaultGoals(profile);
    expect(goals).toHaveLength(2);
    expect(new Set(goals).size).toBe(2);
    expect(goals).toContain("speedAgility");
    expect(goals).toContain("strengthPower");
  });

  it("falls back to a general pair for an unmeasured athlete", () => {
    expect(defaultGoals(buildProfile([]))).toEqual(["speedAgility", "dribbling"]);
  });

  it("builds a gateway-valid intake", () => {
    const intake = defaultIntake(buildProfile([]), 14);
    expect(intake.goals.length).toBeGreaterThan(0);
    expect(intake.daysPerWeek).toBe(3);
    expect(intake.minutesPerSession).toBe(60);
    expect(intake.setting).toBe("solo");
    expect(intake.level).toBe("club");
    expect(intake.horizonWeeks).toBe(6);
    expect(intake.painFlag).toBe(false);
    expect(intake.age).toBe(14);
  });

  it("omits an out-of-range age", () => {
    expect(defaultIntake(buildProfile([]), null).age).toBeUndefined();
    expect(defaultIntake(buildProfile([]), 3).age).toBeUndefined();
  });

  it("resolves age from a birthdate when no age field exists", () => {
    const now = new Date(2026, 7, 22);
    expect(resolveAge({ age: 15 }, now)).toBe(15);
    expect(resolveAge({ birthdate: "2012-03-05" }, now)).toBe(14);
    expect(resolveAge({}, now)).toBeNull();
  });
});

describe("buildStatsSnapshot", () => {
  it("emits every gateway-required key", () => {
    const snapshot = buildStatsSnapshot([sprintRep(), jumpRep()]);
    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.benchmarkProfile).toEqual({ ageBand: "senior", gender: "unspecified", isDefaulted: true });
    expect(typeof snapshot.totalReps).toBe("number");
    expect(typeof snapshot.totalSessions).toBe("number");

    for (const axis of snapshot.axes) {
      expect(axis).toHaveProperty("axis");
      expect(axis).toHaveProperty("repCount");
      expect(axis).toHaveProperty("missingDrills");
    }
    // Unmeasured axes have no score key at all (omitted, not null).
    const striking = snapshot.axes.find((axis: { axis: string }) => axis.axis === "striking");
    expect(striking.score).toBeUndefined();
    expect(striking.missingDrills).toEqual(["kick"]);

    expect(snapshot.drills.length).toBe(2);
    for (const drill of snapshot.drills) {
      for (const key of ["drill", "repCount", "sessionCount", "metrics"]) {
        expect(drill).toHaveProperty(key);
      }
      for (const metric of drill.metrics) {
        for (const key of ["metric", "score", "band", "bestCanonical", "latestCanonical", "bestFormatted", "unitLabel", "repCount"]) {
          expect(metric).toHaveProperty(key);
        }
        expect(metric.score).toBeGreaterThanOrEqual(0);
        expect(metric.score).toBeLessThanOrEqual(400);
      }
    }
  });

  it("uses the latest rep for latestCanonical", () => {
    const snapshot = buildStatsSnapshot([
      sprintRep({ id: "old", max_velocity: 5.0, createdAtMillis: 1000 }),
      sprintRep({ id: "new", max_velocity: 6.0, createdAtMillis: 2000 }),
    ]);
    const sprint = snapshot.drills.find((drill: { drill: string }) => drill.drill === "sprint");
    const metric = sprint.metrics.find((entry: { metric: string }) => entry.metric === "sprintMaxSpeed");
    expect(metric.bestCanonical).toBe(6.0);
    expect(metric.latestCanonical).toBe(6.0);
    const older = buildStatsSnapshot([
      sprintRep({ id: "old", max_velocity: 6.0, createdAtMillis: 1000 }),
      sprintRep({ id: "new", max_velocity: 5.0, createdAtMillis: 2000 }),
    ]);
    const olderMetric = older.drills[0].metrics.find((entry: { metric: string }) => entry.metric === "sprintMaxSpeed");
    expect(olderMetric.bestCanonical).toBe(6.0);
    expect(olderMetric.latestCanonical).toBe(5.0);
  });

  it("maps bands on the app's thresholds", () => {
    expect(appBand(110)).toBe("elite");
    expect(appBand(90)).toBe("approaching");
    expect(appBand(70)).toBe("developing");
    expect(appBand(10)).toBe("earlyStage");
  });

  it("assembles full job params", () => {
    const params = planJobParams([sprintRep()], { age: 14 });
    expect(params.statsProfile.schemaVersion).toBe(1);
    expect(params.intake.age).toBe(14);
    expect(typeof params.timezone).toBe("string");
    expect(params.timezone.length).toBeGreaterThan(0);
  });
});
