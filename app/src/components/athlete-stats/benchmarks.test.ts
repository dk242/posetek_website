// Golden-value parity tests for src/lib/benchmarks.ts against athlete-benchmarks.js.
// Lives in the athlete-stats folder (its owner also owns lib/benchmarks.ts).

import { describe, expect, it } from "vitest";
import { format, generation, get, metrics, profile, score } from "../../lib/benchmarks";

describe("benchmark definitions", () => {
  it("keeps the legacy generation/profile stamp", () => {
    expect(generation).toBe(2);
    expect(profile).toBe("senior|unspecified");
  });

  it("keeps the legacy references and directions", () => {
    expect(metrics.ballSpeed.reference).toBeCloseTo(75 / 2.23694, 12);
    expect(metrics.shotAccuracy.reference).toBeNull();
    expect(metrics.shotAccuracy.placeholder).toBe(true);
    expect(metrics.broadJumpDistance.reference).toBeCloseTo(6 / 3.28084, 12);
    expect(metrics.verticalJumpHeight.reference).toBeCloseTo(18 / 39.37007874015748, 12);
    expect(metrics.sprintMaxAcceleration.reference).toBe(6.2);
    expect(metrics.sprintMaxSpeed.reference).toBeCloseTo(14.2 / 2.23694, 12);
    expect(metrics.sprintCompletionTime.reference).toBe(1.84);
    expect(metrics.dribbleTotalTime.reference).toBe(6.04);
    expect(metrics.dribbleBallControl.reference).toBeCloseTo(2.1 / 3.28084, 12);
    expect(metrics.dribbleOutboundTime.reference).toBe(2.41);
    expect(metrics.dribbleTurnTime.reference).toBe(2.25);
    expect(metrics.dribbleReturnTime.reference).toBe(1.38);
    expect(metrics.codTotalTime.reference).toBe(4.68);
    expect(metrics.codOutboundTime.reference).toBe(2.1);
    expect(metrics.codTurnTime.reference).toBe(1.11);
    expect(metrics.codReturnTime.reference).toBe(1.72);
    expect(metrics.sprintCompletionTime.direction).toBe("lower");
    expect(metrics.ballSpeed.direction).toBe("higher");
  });
});

describe("format", () => {
  it("produces the exact legacy strings", () => {
    expect(format("ballSpeed", metrics.ballSpeed.reference)).toBe("75.0 mph");
    expect(format("shotAccuracy", 62.4)).toBe("62%");
    expect(format("broadJumpDistance", 6 / 3.28084)).toBe("6.0 ft");
    expect(format("verticalJumpHeight", 18 / 39.37007874015748)).toBe("18.0 in");
    expect(format("sprintMaxAcceleration", 6.2)).toBe("6.2 m/s²");
    expect(format("sprintMaxSpeed", 6.7)).toBe("15.0 mph");
    expect(format("sprintCompletionTime", 1.844)).toBe("1.84 s");
    expect(format("dribbleBallControl", 0.64)).toBe("2.1 ft");
    expect(format("codTotalTime", 4.5)).toBe("4.50 s");
  });

  it("falls back to an em dash for unknown keys and non-numeric values", () => {
    expect(format("ballSpeed", "not a number")).toBe("—");
    expect(format("ballSpeed", NaN)).toBe("—");
    expect(format("ballSpeed", Infinity)).toBe("—");
    expect(format("does-not-exist", 5)).toBe("—");
    // Legacy quirk: Number(null) is 0, which is finite, so null formats as zero.
    expect(format("ballSpeed", null)).toBe("0.0 mph");
  });
});

describe("score", () => {
  it("indexes 100 at the D1 reference", () => {
    expect(score("codTotalTime", 4.68)).toBe(100);
    expect(score("codTotalTime", 9.36)).toBe(50);
    expect(score("ballSpeed", (metrics.ballSpeed.reference as number) * 2)).toBeCloseTo(200, 10);
    expect(score("sprintMaxSpeed", (metrics.sprintMaxSpeed.reference as number) / 2)).toBeCloseTo(50, 10);
  });

  it("returns null without a reference or a positive finite value", () => {
    expect(score("shotAccuracy", 55)).toBeNull();
    expect(score("ballSpeed", 0)).toBeNull();
    expect(score("ballSpeed", -2)).toBeNull();
    expect(score("ballSpeed", "abc")).toBeNull();
    expect(score("ballSpeed", Infinity)).toBeNull();
    expect(score("does-not-exist", 5)).toBeNull();
  });
});

describe("get", () => {
  it("returns metric definitions or null", () => {
    expect(get("ballSpeed")).toBe(metrics.ballSpeed);
    expect(get("bogus")).toBeNull();
  });
});
