import { describe, expect, it } from "vitest";
import { diagrams, figureEightRoute } from "./DrillDiagram";

describe("approved drill illustration geometry", () => {
  it("draws two equal mirrored loops with one central crossing and cones centered in each loop", () => {
    const [centerX, centerY] = figureEightRoute[0];
    const crossingIndices = figureEightRoute.flatMap(([x, y], index) =>
      Math.hypot(x - centerX, y - centerY) < 1e-8 ? [index] : []);
    expect(crossingIndices).toEqual([0, 64, 128]);
    for (let index = 0; index <= 64; index++) {
      const right = figureEightRoute[index], left = figureEightRoute[index + 64];
      expect(right[0] + left[0]).toBeCloseTo(centerX * 2, 8);
      expect(right[1]).toBeCloseTo(left[1], 8);
      const verticalMirror = figureEightRoute[64 - index];
      expect(right[0]).toBeCloseTo(verticalMirror[0], 8);
      expect(right[1] + verticalMirror[1]).toBeCloseTo(centerY * 2, 8);
    }
    const [leftCone, rightCone] = diagrams["DRB-006"].cones;
    expect(leftCone[0] + rightCone[0]).toBeCloseTo(centerX * 2, 8);
    expect(leftCone[1]).toBe(centerY);
    expect(rightCone[1]).toBe(centerY);
    expect(leftCone[0]).toBeGreaterThan(Math.min(...figureEightRoute.map(([x]) => x)));
    expect(rightCone[0]).toBeLessThan(Math.max(...figureEightRoute.map(([x]) => x)));
  });

  it("keeps the dribbling ball close to the player on the same figure-eight route throughout a closed lap", () => {
    const diagram = diagrams["DRB-006"];
    // Distance to the actual polyline, rather than a second approximate curve.
    const distanceToRoute = ([x, y]: readonly number[]) => Math.min(...figureEightRoute.slice(1).map((end, index) => {
      const start = figureEightRoute[index], dx = end[0] - start[0], dy = end[1] - start[1];
      const fraction = Math.max(0, Math.min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(x - (start[0] + dx * fraction), y - (start[1] + dy * fraction));
    }));
    for (let step = 0; step <= 100; step++) {
      const { player, ball } = diagram.positions(step / 100);
      expect(distanceToRoute(player)).toBeLessThan(1e-7);
      expect(distanceToRoute(ball)).toBeLessThan(1e-7);
      const separation = Math.hypot(player[0] - ball[0], player[1] - ball[1]);
      expect(separation).toBeGreaterThan(13);
      expect(separation).toBeLessThanOrEqual(16.000001);
    }
    expect(diagram.positions(0)).toEqual(diagram.positions(1));
  });

  it("keeps the wall-pass player, ball and target on one axis in both travel directions", () => {
    const diagram = diagrams["PAS-001"];
    const initial = diagram.positions(0);
    const contact = diagram.positions(.5);
    const finish = diagram.positions(1);
    expect(initial).toEqual(finish);
    expect(contact.ball).toEqual([286, 112]);
    expect(initial.ball).toEqual([107, 112]);
    for (let step = 0; step <= 100; step++) {
      const progress = step / 100, { player, ball } = diagram.positions(progress);
      expect(player).toEqual([90, 112]);
      expect(ball[1]).toBe(player[1]);
      expect(ball[0]).toBeGreaterThanOrEqual(initial.ball[0]);
      expect(ball[0]).toBeLessThanOrEqual(contact.ball[0]);
      expect(ball[0]).toBeCloseTo(diagram.positions(1 - progress).ball[0], 8);
    }
  });
});
