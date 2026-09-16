import template from './mhr-template.json';
import { BufferGeometry, Float32BufferAttribute, Matrix4, Vector3 } from 'three';

type Point3 = readonly [number, number, number];
type Frame = { side: Vector3; up: Vector3; front: Vector3 };
const SOURCE_UP = new Vector3(0, 1, 0);
const SOURCE_SIDE = new Vector3(1, 0, 0);
const SOURCE_FRONT = new Vector3(0, 0, 1);
const REST = template.joints as Record<string, number[]>;
const joint = (name: string) => new Vector3(...REST[name] as [number, number, number]);
const midpoint = (a: Vector3, b: Vector3) => a.clone().add(b).multiplyScalar(.5);
function direction(value: Vector3, fallback: Vector3) {
  return value.lengthSq() > 1e-12 ? value.normalize() : fallback.clone().normalize();
}
function frame(up: Vector3, preferredSide: Vector3, fallback: Vector3): Frame {
  up = direction(up.clone(), fallback);
  let side = preferredSide.clone().addScaledVector(up, -preferredSide.dot(up));
  if (side.lengthSq() < 1e-10) side = fallback.clone().addScaledVector(up, -fallback.dot(up));
  side.normalize();
  return { side, up, front: side.clone().cross(up).normalize() };
}
function fit(source: Vector3, target: Vector3, from: Frame, to: Frame, scale: Point3): Matrix4 {
  const origin = new Matrix4().makeBasis(from.side, from.up, from.front).setPosition(source).invert();
  const destination = new Matrix4().makeBasis(to.side, to.up, to.front).scale(new Vector3(...scale)).setPosition(target);
  return destination.multiply(origin);
}
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Fit Meta's continuous Apache-2.0 MHR surface to recorded landmarks.
 * This is anatomical template skinning, not SAM inference, a scan or an athlete
 * likeness. Source points are never modified. The caller owns the geometry.
 */
export function createAthleteBody(points: readonly Point3[]): BufferGeometry {
  if (points.length !== 33 || points.some(point => point.length !== 3 || !point.every(Number.isFinite))) {
    throw new TypeError('An athlete body requires 33 finite three-dimensional pose landmarks.');
  }
  const p = points.map(point => new Vector3(...point));
  const hips = midpoint(p[23], p[24]);
  const shoulders = midpoint(p[11], p[12]);
  const spine = shoulders.clone().sub(hips);
  if (spine.length() < .01 || p[11].distanceTo(p[12]) < .01 || p[23].distanceTo(p[24]) < .01) {
    throw new RangeError('The pose must have a distinct torso, hips and shoulders to fit an athlete body.');
  }
  const side = p[11].clone().sub(p[12]).normalize();
  const body = frame(spine, side, p[23].clone().sub(p[24]));
  const pelvis = frame(spine, p[23].clone().sub(p[24]), side);
  const sourceHips = midpoint(joint('l_upleg'), joint('r_upleg'));
  const sourceShoulders = midpoint(joint('l_uparm'), joint('r_uparm'));
  const sourceSpine = sourceShoulders.clone().sub(sourceHips);
  const sourceBody = frame(sourceSpine, SOURCE_SIDE, SOURCE_FRONT);
  const legLength = (p[23].distanceTo(p[25]) + p[25].distanceTo(p[27]) + p[24].distanceTo(p[26]) + p[26].distanceTo(p[28])) / 2;
  const scale = (spine.length() + legLength) / 135.5; // MHR uses centimeters.
  const transforms: Record<string, Matrix4> = {};
  transforms.pelvis = fit(sourceHips, hips, sourceBody, pelvis, [p[23].distanceTo(p[24]) / joint('l_upleg').distanceTo(joint('r_upleg')), spine.length() / sourceSpine.length(), scale]);
  transforms.torso = fit(sourceHips, hips, sourceBody, body, [p[11].distanceTo(p[12]) / joint('l_uparm').distanceTo(joint('r_uparm')), spine.length() / sourceSpine.length(), scale]);

  function limb(name: string, from: string, to: string, start: Vector3, end: Vector3, thickness = 1) {
    const a = joint(from), b = joint(to);
    const sourceAlong = b.clone().sub(a), targetAlong = end.clone().sub(start);
    const sourceFrame = frame(sourceAlong, sourceAlong.clone().cross(SOURCE_FRONT), SOURCE_SIDE);
    const targetFrame = frame(targetAlong, targetAlong.clone().cross(body.front), body.side);
    transforms[name] = fit(a, start, sourceFrame, targetFrame, [scale * thickness, targetAlong.length() / sourceAlong.length(), scale * thickness]);
  }
  for (const [prefix, shoulder, elbow, wrist, pinky, index, hip, knee, ankle, heel, toe] of [
    ['l', 11, 13, 15, 17, 19, 23, 25, 27, 29, 31],
    ['r', 12, 14, 16, 18, 20, 24, 26, 28, 30, 32],
  ] as const) {
    transforms[`${prefix}_clavicle`] = transforms.torso;
    limb(`${prefix}_uparm`, `${prefix}_uparm`, `${prefix}_lowarm`, p[shoulder], p[elbow]);
    limb(`${prefix}_lowarm`, `${prefix}_lowarm`, `${prefix}_wrist`, p[elbow], p[wrist]);
    limb(`${prefix}_upleg`, `${prefix}_upleg`, `${prefix}_lowleg`, p[hip], p[knee]);
    limb(`${prefix}_lowleg`, `${prefix}_lowleg`, `${prefix}_foot`, p[knee], p[ankle]);

    // Pose's index/pinky points describe the hand base, not detailed finger joints.
    // Keep the neutral MHR finger articulation and use the recorded palm direction.
    const sourcePalm = midpoint(joint(`${prefix}_pinky1`), joint(`${prefix}_index1`));
    const sourceHand = sourcePalm.sub(joint(`${prefix}_wrist`));
    const targetHand = midpoint(p[pinky], p[index]).sub(p[wrist]);
    const sourceHandFrame = frame(sourceHand, joint(`${prefix}_pinky1`).sub(joint(`${prefix}_index1`)), SOURCE_FRONT);
    const targetHandFrame = frame(targetHand, p[pinky].clone().sub(p[index]), body.front);
    const handScale = clamp(targetHand.length() / sourceHand.length(), scale * .72, scale * 1.12);
    transforms[`${prefix}_hand`] = fit(joint(`${prefix}_wrist`), p[wrist], sourceHandFrame, targetHandFrame, [handScale, handScale, handScale]);

    const footFront = direction(p[toe].clone().sub(p[heel]), body.front);
    const footCenter = midpoint(p[heel], p[toe]);
    const ankleHeight = p[ankle].clone().sub(footCenter);
    const footUp = direction(ankleHeight.clone().addScaledVector(footFront, -ankleHeight.dot(footFront)), body.up);
    const footSide = footUp.clone().cross(footFront).normalize();
    const footFrame = { side: footSide, up: footUp, front: footSide.clone().cross(footUp).normalize() };
    transforms[`${prefix}_foot`] = fit(joint(`${prefix}_foot`), p[ankle], { side: SOURCE_SIDE, up: SOURCE_UP, front: SOURCE_FRONT }, footFrame, [
      scale * .95,
      clamp(ankleHeight.dot(footUp) / 7.39, scale * .45, scale * 1.3),
      clamp(p[heel].distanceTo(p[toe]) / 24, scale * .65, scale * 1.15),
    ]);
  }

  const ears = midpoint(p[7], p[8]);
  const headUp = direction(ears.clone().sub(shoulders).normalize().lerp(body.up, .45), body.up);
  const headFrame = frame(headUp, p[7].clone().sub(p[8]), body.side);
  const headScale = clamp(p[7].distanceTo(p[8]) / 14.5, scale * .85, scale * 1.15);
  transforms.head = fit(new Vector3(0, 163, 3.545), ears, { side: SOURCE_SIDE, up: SOURCE_UP, front: SOURCE_FRONT }, headFrame, [headScale, headScale, headScale]);
  const neckStart = joint('c_neck').applyMatrix4(transforms.torso);
  const neckEnd = joint('c_head').applyMatrix4(transforms.head);
  limb('neck', 'c_neck', 'c_head', neckStart, neckEnd, .94);

  const matrices = template.regions.map(name => transforms[name]);
  const positions = new Float32Array(template.positions.length);
  const original = new Vector3(), transformed = new Vector3(), sum = new Vector3();
  for (let vertex = 0; vertex < positions.length / 3; vertex++) {
    original.fromArray(template.positions, vertex * 3);
    sum.set(0, 0, 0);
    let totalWeight = 0;
    for (let influence = 0; influence < 4; influence++) {
      const offset = vertex * 4 + influence;
      const weight = template.skinWeights[offset];
      if (!weight) continue;
      transformed.copy(original).applyMatrix4(matrices[template.skinRegions[offset]]);
      sum.addScaledVector(transformed, weight);
      totalWeight += weight;
    }
    sum.divideScalar(totalWeight).toArray(positions, vertex * 3);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(template.indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
