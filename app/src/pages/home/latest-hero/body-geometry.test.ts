import { describe, expect, it } from "vitest";
import { BufferGeometry, Vector3 } from "three";
import { createAthleteBody } from "./body-geometry";
import capturedPose from "./shooting-pose.json";
import sprintPose from "./sprint-pose.json";
import jumpPose from "./jump-pose.json";
import template from "./mhr-template.json";

const SHOOTING_POSE = capturedPose.points.map(point => point as [number, number, number]);

function enclosedVolume(geometry: BufferGeometry): number {
  const positions = geometry.getAttribute("position");
  const indices = geometry.index!;
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let volume = 0;
  for (let face = 0; face < indices.count; face += 3) {
    a.fromBufferAttribute(positions, indices.getX(face));
    b.fromBufferAttribute(positions, indices.getX(face + 1));
    c.fromBufferAttribute(positions, indices.getX(face + 2));
    volume += a.dot(b.cross(c)) / 6;
  }
  return volume;
}

describe("continuous MHR anatomical body", () => {
  it("creates a finite, outward-facing mesh with useful body volume and bounded complexity", () => {
    const body = createAthleteBody(SHOOTING_POSE);
    const positions = body.getAttribute("position");
    const normals = body.getAttribute("normal");
    expect([...positions.array].every(Number.isFinite)).toBe(true);
    expect([...normals.array].every(Number.isFinite)).toBe(true);
    expect(positions.count).toBeLessThan(8000);
    expect(body.index!.count / 3).toBeLessThan(14000);
    expect(enclosedVolume(body)).toBeGreaterThan(.07);
    expect(enclosedVolume(body)).toBeLessThan(.5);
    for (let vertex = 0; vertex < normals.count; vertex++) {
      expect(new Vector3().fromBufferAttribute(normals, vertex).length()).toBeCloseTo(1, 5);
    }
    const size = body.boundingBox!.getSize(new Vector3());
    expect(size.y).toBeGreaterThan(2);
    expect(size.y).toBeLessThan(2.5);
    expect(size.x).toBeLessThan(1.6);
    expect(size.z).toBeLessThan(1.1);
    expect(body.boundingSphere!.radius).toBeGreaterThan(1);
    body.dispose();
  });

  it("fits the pose without changing landmarks and follows translation, scale and rotation", () => {
    const before = JSON.stringify(SHOOTING_POSE);
    const body = createAthleteBody(SHOOTING_POSE);
    const transformed = SHOOTING_POSE.map(point => new Vector3(...point)
      .multiplyScalar(1.5).applyAxisAngle(new Vector3(0, 1, 0), .7)
      .add(new Vector3(4, 3, -2)).toArray() as [number, number, number]);
    const other = createAthleteBody(transformed);
    expect(enclosedVolume(other) / enclosedVolume(body)).toBeCloseTo(1.5 ** 3, 4);
    expect(other.boundingBox!.min.y).toBeCloseTo(body.boundingBox!.min.y * 1.5 + 3, 5);
    expect(other.boundingBox!.max.y).toBeCloseTo(body.boundingBox!.max.y * 1.5 + 3, 5);
    expect(JSON.stringify(SHOOTING_POSE)).toBe(before);
    body.dispose();
    other.dispose();
  });

  it("rejects incomplete or non-finite poses before allocating geometry", () => {
    expect(() => createAthleteBody(SHOOTING_POSE.slice(0, 32))).toThrow(/33 finite/);
    const invalid = SHOOTING_POSE.map(point => [...point] as [number, number, number]);
    invalid[13][0] = Number.NaN;
    expect(() => createAthleteBody(invalid)).toThrow(/33 finite/);
    expect(() => createAthleteBody(Array.from({ length: 33 }, () => [0, 0, 0] as const))).toThrow(/distinct torso/);
  });

  it("retains one connected, closed manifold rather than overlapping body parts", () => {
    const body = createAthleteBody(SHOOTING_POSE);
    const edgeUses = new Map<string, number>();
    const neighbors: Set<number>[] = Array.from({ length: body.getAttribute('position').count }, () => new Set());
    for (let face = 0; face < body.index!.count; face += 3) {
      const corners = [0, 1, 2].map(offset => body.index!.getX(face + offset));
      for (let edge = 0; edge < 3; edge++) {
        const a = corners[edge], b = corners[(edge + 1) % 3];
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        edgeUses.set(key, (edgeUses.get(key) ?? 0) + 1);
        neighbors[a].add(b); neighbors[b].add(a);
      }
    }
    expect([...edgeUses.values()].every(uses => uses === 2)).toBe(true);
    const reached = new Set([0]);
    const queue = [0];
    while (queue.length) for (const next of neighbors[queue.pop()!]) {
      if (!reached.has(next)) { reached.add(next); queue.push(next); }
    }
    expect(reached.size).toBe(4899);
    expect(body.index!.count / 3).toBe(9794);
    expect(reached.size - edgeUses.size + body.index!.count / 3).toBe(2);
    body.dispose();
  });

  it("uses normalized template skinning with the pinned public license provenance", () => {
    expect(template.source.license).toBe('Apache-2.0');
    expect(template.source.release).toBe('v1.0.1');
    expect(template.source.sourceSha256).toBe('5d5fe30ba09488e96a06b2fe6306202c4048083df9e1003f1051ad541e06aafa');
    for (let vertex = 0; vertex < template.positions.length / 3; vertex++) {
      const weights = template.skinWeights.slice(vertex * 4, vertex * 4 + 4);
      expect(weights.every(weight => weight >= 0 && weight <= 1)).toBe(true);
      expect(weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 6);
      expect(template.skinRegions.slice(vertex * 4, vertex * 4 + 4).every(region => region >= 0 && region < template.regions.length)).toBe(true);
    }
  });

  it("fits all three captured poses and preserves the jump's airborne placement", () => {
    for (const source of [capturedPose, sprintPose, jumpPose]) {
      const points = source.points as [number, number, number][];
      const snapshot = JSON.stringify(points);
      const body = createAthleteBody(points);
      expect(enclosedVolume(body)).toBeGreaterThan(.1);
      expect(enclosedVolume(body)).toBeLessThan(.35);
      expect(body.boundingBox!.max.y).toBeLessThan(3.1);
      if (source === jumpPose) expect(body.boundingBox!.min.y).toBeGreaterThan(.48);
      expect(JSON.stringify(points)).toBe(snapshot);

      // The toe-bearing surface must point with the recorded heel-to-toe axis;
      // a mirrored/backwards foot can otherwise pass bounds and volume checks.
      for (const [prefix, ankle, heel, toe] of [['l', 27, 29, 31], ['r', 28, 30, 32]] as const) {
        const region = template.regions.indexOf(`${prefix}_foot`);
        const forward = new Vector3(...points[toe]).sub(new Vector3(...points[heel])).normalize();
        const origin = new Vector3(...points[ankle]);
        const projections = [];
        for (let vertex = 0; vertex < template.positions.length / 3; vertex++) {
          let weight = 0;
          for (let influence = 0; influence < 4; influence++) {
            const offset = vertex * 4 + influence;
            if (template.skinRegions[offset] === region) weight += template.skinWeights[offset];
          }
          if (weight > .95) projections.push(new Vector3().fromBufferAttribute(body.getAttribute('position'), vertex).sub(origin).dot(forward));
        }
        expect(Math.max(...projections)).toBeGreaterThan(.08);
        expect(Math.min(...projections)).toBeLessThan(0);
      }
      for (const [prefix, wrist, pinky, index] of [['l', 15, 17, 19], ['r', 16, 18, 20]] as const) {
        const region = template.regions.indexOf(`${prefix}_hand`);
        const origin = new Vector3(...points[wrist]);
        const forward = new Vector3(...points[pinky]).add(new Vector3(...points[index])).multiplyScalar(.5).sub(origin).normalize();
        const projections = [];
        for (let vertex = 0; vertex < template.positions.length / 3; vertex++) {
          let weight = 0;
          for (let influence = 0; influence < 4; influence++) {
            const offset = vertex * 4 + influence;
            if (template.skinRegions[offset] === region) weight += template.skinWeights[offset];
          }
          if (weight > .95) projections.push(new Vector3().fromBufferAttribute(body.getAttribute('position'), vertex).sub(origin).dot(forward));
        }
        expect(Math.max(...projections)).toBeGreaterThan(.075);
      }
      body.dispose();
    }
  });
});
