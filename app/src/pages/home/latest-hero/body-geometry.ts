import { BufferGeometry, Float32BufferAttribute, Matrix4, SphereGeometry, Vector3 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

type Point3 = readonly [number, number, number];
type Ring = { center: Vector3; side: Vector3; front: Vector3; width: number; depth: number };
const SIDES = 16;
const UP = new Vector3(0, 1, 0);

function direction(vector: Vector3, fallback: Vector3): Vector3 {
  return vector.lengthSq() > 1e-10 ? vector.normalize() : fallback.clone();
}

/** Closed elliptical loft; its smoothed sides give the torso and limbs a silhouette
 * rather than enlarging the straight tracking bones. Each ring may also twist. */
function loft(rings: Ring[]): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const ring of rings) {
    for (let slice = 0; slice < SIDES; slice++) {
      const angle = slice / SIDES * Math.PI * 2;
      const position = ring.center.clone()
        .addScaledVector(ring.side, Math.cos(angle) * ring.width)
        .addScaledVector(ring.front, Math.sin(angle) * ring.depth);
      positions.push(position.x, position.y, position.z);
    }
  }
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let slice = 0; slice < SIDES; slice++) {
      const a = ring * SIDES + slice;
      const b = ring * SIDES + (slice + 1) % SIDES;
      const c = a + SIDES;
      const d = b + SIDES;
      indices.push(a, c, b, b, c, d);
    }
  }
  // Separate cap vertices keep the end-plane normals out of the silhouette.
  for (const end of [0, rings.length - 1]) {
    const centerIndex = positions.length / 3;
    positions.push(...rings[end].center.toArray());
    const rimIndex = positions.length / 3;
    positions.push(...positions.slice(end * SIDES * 3, (end + 1) * SIDES * 3));
    for (let slice = 0; slice < SIDES; slice++) {
      const a = rimIndex + slice;
      const b = rimIndex + (slice + 1) % SIDES;
      indices.push(...(end === 0 ? [centerIndex, a, b] : [centerIndex, b, a]));
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function axes(along: Vector3, preferredSide: Vector3): { side: Vector3; front: Vector3 } {
  const side = preferredSide.clone().addScaledVector(along, -preferredSide.dot(along));
  if (side.lengthSq() < 1e-8) {
    side.copy(Math.abs(along.y) < .9 ? UP : new Vector3(1, 0, 0));
    side.addScaledVector(along, -side.dot(along));
  }
  side.normalize();
  return { side, front: side.clone().cross(along).normalize() };
}

/** An illustrative neutral body fitted around 33 MediaPipe world landmarks.
 * Coordinates and body proportions are estimates, not a scan or new measurement.
 * The caller owns/disposes the returned geometry. No landmark is modified. */
export function createAthleteBody(points: readonly Point3[]): BufferGeometry {
  if (points.length !== 33 || points.some(point => point.length !== 3 || !point.every(Number.isFinite))) {
    throw new TypeError("An athlete body requires 33 finite three-dimensional pose landmarks.");
  }
  const p = points.map(point => new Vector3(...point));
  const midpoint = (a: number, b: number) => p[a].clone().add(p[b]).multiplyScalar(.5);
  const shoulders = midpoint(11, 12);
  const hips = midpoint(23, 24);
  const spine = shoulders.clone().sub(hips);
  const torsoLength = spine.length();
  if (torsoLength < .01 || p[11].distanceTo(p[12]) < .01) {
    throw new RangeError("The pose must have a distinct torso and shoulders to fit an athlete body.");
  }
  const bodyUp = spine.clone().normalize();
  const shoulderSide = direction(p[11].clone().sub(p[12]), new Vector3(1, 0, 0));
  const hipSide = direction(p[23].clone().sub(p[24]), shoulderSide);
  const shoulderWidth = p[11].distanceTo(p[12]);
  const hipWidth = p[23].distanceTo(p[24]);
  // Proportions follow skeletal lengths, so a bent/jumping pose stays the same
  // build instead of shrinking with its vertical bounding box.
  const legLength = (p[23].distanceTo(p[25]) + p[25].distanceTo(p[27])
    + p[24].distanceTo(p[26]) + p[26].distanceTo(p[28])) / 2;
  const unit = Math.max(.15, (torsoLength + legLength) / 1.32);
  const parts: BufferGeometry[] = [];
  function ellipsoid(center: Vector3, radii: Point3, along = bodyUp, side = shoulderSide) {
    const frame = axes(along, side);
    const shape = new SphereGeometry(1, 16, 12);
    shape.scale(...radii);
    shape.applyMatrix4(new Matrix4().makeBasis(frame.side, along, frame.front));
    shape.translate(...center.toArray());
    shape.deleteAttribute("uv");
    parts.push(shape);
  }
  function limb(start: Vector3, end: Vector3, profile: readonly (readonly [number, number, number])[]) {
    const along = direction(end.clone().sub(start), bodyUp);
    const frame = axes(along, shoulderSide);
    parts.push(loft(profile.map(([fraction, width, depth]) => ({
      center: start.clone().lerp(end, fraction), ...frame, width: width * unit, depth: depth * unit,
    }))));
  }

  const hipRadius = Math.max(hipWidth * .63, .115 * unit);
  const chestRadius = Math.max(shoulderWidth * .49, .17 * unit);
  const torsoProfile: readonly (readonly [number, number, number])[] = [
    [-.09, hipRadius * .75, .085 * unit],
    [.04, hipRadius, .11 * unit],
    [.20, hipRadius * .98, .105 * unit],
    [.40, chestRadius * .72, .083 * unit],
    [.60, chestRadius * .88, .10 * unit],
    [.79, chestRadius, .12 * unit],
    [.92, chestRadius * 1.02, .115 * unit],
    [1.00, chestRadius * .87, .084 * unit],
    [1.045, .060 * unit, .059 * unit],
  ];
  parts.push(loft(torsoProfile.map(([height, width, depth]) => {
    const frame = axes(bodyUp, direction(hipSide.clone().lerp(shoulderSide, Math.max(0, Math.min(1, height))), shoulderSide));
    return { center: hips.clone().addScaledVector(spine, height), ...frame, width, depth };
  })));

  for (const [shoulder, elbow, wrist, pinky, index] of [[11, 13, 15, 17, 19], [12, 14, 16, 18, 20]]) {
    limb(p[shoulder], p[elbow], [[0, .073, .074], [.17, .076, .077], [.43, .067, .069], [.73, .054, .056], [1, .039, .040]]);
    limb(p[elbow], p[wrist], [[0, .040, .042], [.22, .050, .051], [.46, .046, .047], [.75, .034, .035], [1, .024, .026]]);
    ellipsoid(p[shoulder], [.076 * unit, .081 * unit, .075 * unit]);
    ellipsoid(p[elbow], [.042 * unit, .043 * unit, .042 * unit]);
    const fingertips = midpoint(pinky, index);
    const handAlong = direction(fingertips.clone().sub(p[wrist]), p[wrist].clone().sub(p[elbow]).normalize());
    ellipsoid(p[wrist].clone().lerp(fingertips, .57), [.040 * unit, Math.max(.056 * unit, p[wrist].distanceTo(fingertips) * .61), .021 * unit], handAlong, p[pinky].clone().sub(p[index]));
  }
  for (const [hip, knee, ankle, heel, toe] of [[23, 25, 27, 29, 31], [24, 26, 28, 30, 32]]) {
    limb(p[hip], p[knee], [[0, .097, .108], [.17, .101, .112], [.38, .092, .105], [.68, .071, .080], [1, .049, .052]]);
    limb(p[knee], p[ankle], [[0, .050, .053], [.22, .066, .073], [.42, .059, .065], [.68, .040, .044], [1, .027, .029]]);
    ellipsoid(p[hip], [.101 * unit, .095 * unit, .104 * unit]);
    ellipsoid(p[knee], [.053 * unit, .054 * unit, .053 * unit]);
    const footAlong = direction(p[toe].clone().sub(p[heel]), axes(bodyUp, shoulderSide).front);
    const footUp = direction(p[ankle].clone().sub(midpoint(heel, toe)), bodyUp);
    const footSide = direction(footAlong.clone().cross(footUp), shoulderSide);
    const footCenter = midpoint(heel, toe).lerp(p[ankle], .22);
    ellipsoid(footCenter, [.047 * unit, Math.max(.084 * unit, p[heel].distanceTo(p[toe]) * .66), .034 * unit], footAlong, footSide);
    ellipsoid(p[ankle].clone().lerp(footCenter, .4), [.033 * unit, .039 * unit, .034 * unit]);
  }

  const ears = midpoint(7, 8);
  const headUp = direction(ears.clone().sub(shoulders).normalize().lerp(bodyUp, .35), bodyUp);
  const headSide = direction(p[7].clone().sub(p[8]), shoulderSide);
  const headCenter = ears.clone().addScaledVector(headUp, .025 * unit);
  limb(shoulders.clone().addScaledVector(bodyUp, .015 * unit), headCenter.clone().addScaledVector(headUp, -.074 * unit), [[0, .052, .053], [.5, .047, .048], [1, .050, .054]]);
  ellipsoid(headCenter, [.084 * unit, .116 * unit, .096 * unit], headUp, headSide);

  const body = mergeGeometries(parts);
  parts.forEach(part => part.dispose());
  if (!body) throw new Error("Unable to assemble the athlete body geometry.");
  body.computeBoundingBox();
  body.computeBoundingSphere();
  return body;
}
