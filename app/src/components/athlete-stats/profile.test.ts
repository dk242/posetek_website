// Parity tests for the pure logic ported from athlete-stats-view.js.

import { describe, expect, it } from "vitest";
import {
  AXES,
  METRICS,
  athleteInitials,
  band,
  buildProfile,
  formatHeight,
  formatWeight,
  sessionCount
} from "./profile";
import { metrics } from "../../lib/benchmarks";

const SPRINT_SPEED_REF = metrics.sprintMaxSpeed.reference as number; // 14.2 mph in m/s

describe("buildProfile", () => {
  it("returns an empty profile for no reps", () => {
    const profile = buildProfile([]);
    expect(profile.axes.map(axis => axis.key)).toEqual(["power", "speed", "agility", "ballControl", "striking"]);
    profile.axes.forEach(axis => {
      expect(axis.score).toBeNull();
      expect(axis.repCount).toBe(0);
    });
    expect(profile.overall).toBeNull();
    expect(profile.totalReps).toBe(0);
    expect(profile.totalSessions).toBe(0);
    expect(profile.sections.speed.slots).toHaveLength(3);
    expect(profile.sections.speed.metrics).toHaveLength(0);
  });

  it("scores a higher-is-better metric off the best rep with field fallback", () => {
    const profile = buildProfile([
      { repType: "sprint", max_velocity: SPRINT_SPEED_REF, createdAtMillis: 1 },
      { repType: "sprint", maxVelocity: SPRINT_SPEED_REF / 2, createdAtMillis: 2 }
    ]);
    const speed = profile.sections.speed;
    expect(speed.reps).toHaveLength(2);
    const result = speed.availableByKey.get("sprintMaxSpeed");
    expect(result).toBeDefined();
    expect(result!.best).toBe(SPRINT_SPEED_REF);
    expect(result!.score).toBeCloseTo(100, 10);
    expect(result!.repCount).toBe(2);
    // Sorted by createdAtMillis: scores [100, 50] → mean(last half) − mean(first half).
    expect(result!.delta).toBeCloseTo(-50, 10);
    expect(speed.availableByKey.has("sprintMaxAcceleration")).toBe(false);
    expect(speed.availableByKey.has("sprintCompletionTime")).toBe(false);
    expect(speed.score).toBeCloseTo(100, 10);
    const speedAxis = profile.axes.find(axis => axis.key === "speed")!;
    expect(speedAxis.score).toBeCloseTo(100, 10);
    expect(speedAxis.repCount).toBe(2);
    expect(profile.overall).toBeCloseTo(100, 10);
    expect(profile.totalSessions).toBe(1); // both default to sessionNumber 1
  });

  it("scores a lower-is-better metric off the fastest rep", () => {
    const profile = buildProfile([
      { repType: "changeOfDirection", totalTime: 4.68, sessionNumber: 1, createdAtMillis: 100 },
      { repType: "changeOfDirection", totalTime: 9.36, sessionNumber: 2, createdAtMillis: 200 }
    ]);
    const result = profile.sections.agility.availableByKey.get("codTotalTime")!;
    expect(result.best).toBe(4.68);
    expect(result.score).toBe(100);
    expect(result.delta).toBe(50 - 100);
    expect(profile.sections.agility.metrics).toHaveLength(1);
    expect(profile.totalSessions).toBe(2);
  });

  it("routes reps by _statsDrill before repType/drillType", () => {
    const profile = buildProfile([
      { _statsDrill: "sprint", repType: "dribbling", max_velocity: SPRINT_SPEED_REF }
    ]);
    expect(profile.sections.speed.reps).toHaveLength(1);
    expect(profile.sections.ballControl.reps).toHaveLength(0);
  });

  it("keeps placeholder metrics (shot accuracy) unavailable", () => {
    const profile = buildProfile([
      { repType: "shooting", velocity: metrics.ballSpeed.reference }
    ]);
    const striking = profile.sections.striking;
    expect(striking.slots).toHaveLength(2);
    expect(striking.availableByKey.has("ballSpeed")).toBe(true);
    expect(striking.availableByKey.has("shotAccuracy")).toBe(false);
    expect(striking.metrics).toHaveLength(1);
  });

  it("ignores zero, negative, and non-numeric values but still counts the reps", () => {
    const profile = buildProfile([
      { repType: "jump", jumpHeight: 0 },
      { repType: "jump", jumpHeight: -3 },
      { repType: "jump", jumpHeight: "abc" }
    ]);
    const power = profile.axes.find(axis => axis.key === "power")!;
    expect(power.score).toBeNull();
    expect(power.repCount).toBe(3);
    expect(profile.sections.power.metrics).toHaveLength(0);
  });

  it("averages the overall score across scored axes only", () => {
    const profile = buildProfile([
      { repType: "sprint", max_velocity: SPRINT_SPEED_REF },
      { repType: "changeOfDirection", totalTime: 4.68 * 2 }
    ]);
    expect(profile.axes.find(axis => axis.key === "speed")!.score).toBeCloseTo(100, 10);
    expect(profile.axes.find(axis => axis.key === "agility")!.score).toBe(50);
    expect(profile.overall).toBeCloseTo(75, 10);
    expect(profile.totalReps).toBe(2);
    expect(profile.totalSessions).toBe(2);
  });
});

describe("metric slot definitions", () => {
  it("mirrors the legacy axis/drill/field mapping", () => {
    expect(METRICS.map(metric => metric.key)).toEqual([
      "ballSpeed", "shotAccuracy", "broadJumpDistance", "verticalJumpHeight",
      "sprintMaxAcceleration", "sprintMaxSpeed", "sprintCompletionTime",
      "dribbleTotalTime", "dribbleBallControl", "dribbleOutboundTime",
      "dribbleTurnTime", "dribbleReturnTime",
      "codTotalTime", "codOutboundTime", "codTurnTime", "codReturnTime"
    ]);
    const sprintSpeed = METRICS.find(metric => metric.key === "sprintMaxSpeed")!;
    expect(sprintSpeed.fields).toEqual(["max_velocity", "maxVelocity"]);
    expect(sprintSpeed.lowerIsBetter).toBe(false);
    const codTotal = METRICS.find(metric => metric.key === "codTotalTime")!;
    expect(codTotal.drills).toEqual(["changeOfDirection"]);
    expect(codTotal.lowerIsBetter).toBe(true);
    expect(AXES.map(axis => axis.key)).toEqual(["power", "speed", "agility", "ballControl", "striking"]);
  });
});

describe("sessionCount", () => {
  it("counts distinct drill/session pairs, defaulting sessionNumber to 1", () => {
    expect(sessionCount([
      { repType: "sprint" },
      { repType: "sprint", sessionNumber: 2 },
      { drillType: "sprint" },
      { _statsDrill: "jump", repType: "sprint" }
    ])).toBe(3);
    expect(sessionCount([])).toBe(0);
  });
});

describe("band", () => {
  it("matches the legacy thresholds", () => {
    expect(band(130).key).toBe("standard");
    expect(band(100).key).toBe("standard");
    expect(band(99.9)).toEqual({ key: "approaching", label: "Approaching", icon: "trending_up" });
    expect(band(85).key).toBe("approaching");
    expect(band(84.9)).toEqual({ key: "developing", label: "Developing", icon: "monitoring" });
    expect(band(65).key).toBe("developing");
    expect(band(64.9)).toEqual({ key: "early", label: "Early stage", icon: "pending" });
    expect(band(0).key).toBe("early");
  });
});

describe("formatting helpers", () => {
  it("formats height in feet and inches from centimeters", () => {
    expect(formatHeight(175.26)).toBe("5' 9\"");
    expect(formatHeight("180")).toBe("5' 11\"");
    expect(formatHeight(null)).toBe("—");
    expect(formatHeight(0)).toBe("—");
    expect(formatHeight("abc")).toBe("—");
  });

  it("formats weight in pounds from kilograms", () => {
    expect(formatWeight(70)).toBe("154 lbs");
    expect(formatWeight("90")).toBe("198 lbs");
    expect(formatWeight(undefined)).toBe("—");
    expect(formatWeight(-1)).toBe("—");
  });

  it("builds athlete initials like the legacy view", () => {
    expect(athleteInitials("lionel messi")).toBe("LM");
    expect(athleteInitials("Zlatan")).toBe("Z");
    expect(athleteInitials("  ada  byron  lovelace ")).toBe("AB");
    expect(athleteInitials("")).toBe("A");
    expect(athleteInitials(null)).toBe("A");
  });
});
