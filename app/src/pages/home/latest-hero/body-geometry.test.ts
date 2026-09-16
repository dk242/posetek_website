import { describe, expect, it } from "vitest";
import { BufferGeometry, Vector3 } from "three";
import { createAthleteBody } from "./body-geometry";
import capturedPose from "./shooting-pose.json";

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

describe("illustrative athlete body", () => {
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
});
