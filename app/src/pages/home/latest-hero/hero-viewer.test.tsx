/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HERO_POSES, heroPose, nextHeroPose, shouldAnimateHero } from "./pose-model";
import { PoseFallback } from "./PoseFallback";
import { createAthleteBody } from "./body-geometry";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import fallbackManifest from "./fallback/manifest.json";

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
      expect(markup).toContain('<image href="');
      expect(markup).toContain('preserveAspectRatio="xMidYMid slice"');
      expect(markup).not.toMatch(/NaN|undefined/);
      const skeleton = renderToStaticMarkup(<PoseFallback pose={pose} layer="skeleton" />);
      expect(skeleton).toContain(`${pose.label}: recorded tracking skeleton`);
      expect(skeleton).not.toContain('<image');
      expect(skeleton).not.toContain('stroke-width="16"');
    }
  });
  it("ships distinct verified transparent mesh snapshots within the fallback transfer budget", () => {
    const pngs = fallbackManifest.assets.filter(asset => asset.file.endsWith('.png'));
    expect(pngs.map(asset => asset.file)).toEqual(['shooting.png', 'sprint.png', 'jump.png']);
    expect(new Set(pngs.map(asset => asset.sha256)).size).toBe(3);
    expect(fallbackManifest.assets.reduce((bytes, asset) => bytes + asset.bytes, 0)).toBeLessThan(150 * 1024);
    for (const asset of pngs) {
      const bytes = readFileSync(new URL(`./fallback/${asset.file}`, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      expect(bytes.readUInt32BE(16)).toBe(fallbackManifest.width);
      expect(bytes.readUInt32BE(20)).toBe(fallbackManifest.height);
      expect(bytes[25]).toBe(6); // PNG color type 6 retains alpha.
    }
  });
});
