import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HERO_POSES, heroPose, nextHeroPose, shouldAnimateHero } from "./pose-model";
import { PoseFallback } from "./PoseFallback";
import { createAthleteBody } from "./body-geometry";

describe("recorded hero pose sequence", () => {
  it("cycles shooting, sprint and jump with consistent optional ball behavior", () => {
    expect(nextHeroPose("shooting")).toBe("sprint");
    expect(nextHeroPose("sprint")).toBe("jump");
    expect(nextHeroPose("jump")).toBe("shooting");
    expect(HERO_POSES.filter(pose => pose.ball).map(pose => pose.id)).toEqual(["shooting"]);
  });
  it("suspends automatic motion for manual pause, reduced motion, interaction and hidden scenes", () => {
    expect(shouldAnimateHero(true, true, false, false)).toBe(true);
    expect(shouldAnimateHero(false, true, false, false)).toBe(false);
    expect(shouldAnimateHero(true, false, false, false)).toBe(false);
    expect(shouldAnimateHero(true, true, true, false)).toBe(false);
    expect(shouldAnimateHero(true, true, false, true)).toBe(false);
  });
  it("retains estimated depth, airborne clearance, finite body geometry and source privacy", () => {
    for (const pose of HERO_POSES) {
      expect(pose.points).toHaveLength(33);
      expect(pose.points.every(point => point.length === 3 && point.every(Number.isFinite))).toBe(true);
      expect(Math.max(...pose.points.map(p => p[2])) - Math.min(...pose.points.map(p => p[2]))).toBeGreaterThan(.1);
      const body = createAthleteBody(pose.points);
      expect(Array.from(body.getAttribute("position").array).every(Number.isFinite)).toBe(true);
      expect(body.boundingBox!.max.y).toBeLessThan(3.1);
      body.dispose();
    }
    expect(Math.min(...heroPose("jump").points.map(p => p[1]))).toBeGreaterThan(.4);
    expect(JSON.stringify(HERO_POSES)).not.toMatch(/https?:|token=|Spadorcio|4xopp3|@/);
  });
  it("provides each selected pose and its body/skeleton description without WebGL", () => {
    for (const pose of HERO_POSES) {
      const markup = renderToStaticMarkup(<PoseFallback pose={pose} />);
      expect(markup).toContain(`${pose.label}: illustrative athlete with recorded tracking skeleton`);
      expect(markup).not.toMatch(/NaN|undefined/);
      const skeleton = renderToStaticMarkup(<PoseFallback pose={pose} layer="skeleton" />);
      expect(skeleton).toContain(`${pose.label}: recorded tracking skeleton`);
      expect(skeleton).toContain('stroke-opacity="0"');
    }
  });
});
