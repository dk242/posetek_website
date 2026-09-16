import { Vector3 } from 'three';
import template from './mhr-template.json';
import shape from './mhr-athletic-male-shape.json';

/** Art-directed display anatomy; none of these parameters measures the athlete. */
export const ATHLETIC_MALE_PROFILE_VERSION = 'posetek-athletic-male-v1';
const gaussian = (value: number, center: number, width: number) => Math.exp(-(((value - center) / width) ** 2));
const smoothFront = (z: number) => (1 + Math.tanh((z - 2) / 3)) / 2;
const joint = (name: string) => new Vector3(...(template.joints as Record<string, number[]>)[name] as [number, number, number]);

/** Reproducible rest-surface profile, before any captured pose is fitted.
 * Original vertex order, triangles, joint positions and skin weights are intact.
 */
export function createAthleticMaleRestSurface(): Float32Array {
  if (shape.version !== ATHLETIC_MALE_PROFILE_VERSION || shape.deltas.length !== template.positions.length) {
    throw new Error('MHR male profile and neutral template are incompatible.');
  }
  const result = new Float32Array(template.positions.length);
  const p = new Vector3(), radial = new Vector3(), offset = new Vector3();
  const segments = template.regions.map(name => {
    const side = name.slice(0, 1);
    const next = name.endsWith('_uparm') ? `${side}_lowarm`
      : name.endsWith('_lowarm') ? `${side}_wrist`
      : name.endsWith('_upleg') ? `${side}_lowleg`
      : name.endsWith('_lowleg') ? `${side}_foot` : null;
    if (!next) return null;
    const start = joint(name), axis = joint(next).sub(start), length = axis.length();
    return { name, start, axis: axis.normalize(), length };
  });
  for (let vertex = 0; vertex < result.length / 3; vertex++) {
    p.set(...[0, 1, 2].map(axis => template.positions[vertex * 3 + axis] + shape.deltas[vertex * 3 + axis]) as [number, number, number]);
    const { x, y, z } = p;
    let trunkWeight = 0, headWeight = 0, neckWeight = 0;
    offset.set(0, 0, 0);
    for (let influence = 0; influence < 4; influence++) {
      const index = vertex * 4 + influence;
      const region = template.skinRegions[index], weight = template.skinWeights[index];
      const name = template.regions[region];
      if (name === 'pelvis' || name === 'torso' || name.endsWith('_clavicle')) trunkWeight += weight;
      if (name === 'head') headWeight += weight;
      if (name === 'neck') neckWeight += weight;
      const segment = segments[region];
      if (!segment || weight === 0) continue;
      radial.copy(p).sub(segment.start);
      const along = radial.dot(segment.axis);
      radial.addScaledVector(segment.axis, -along);
      const t = along / segment.length;
      const contour = name.endsWith('_uparm')
        ? .17 * gaussian(t, .12, .27) + .085 * gaussian(t, .5, .29)
        : name.endsWith('_lowarm') ? .08 * gaussian(t, .32, .28)
        : name.endsWith('_upleg') ? .115 * gaussian(t, .42, .36)
        : .155 * gaussian(t, .34, .26);
      offset.addScaledVector(radial, contour * weight);
    }
    // Broad upper back and pectorals taper smoothly into a lean waist. The
    // official identity combination first removes the neutral breast contour;
    // these restrained changes then add athletic rather than bodybuilder mass.
    const chest = gaussian(y, 133, 11), waist = gaussian(y, 111, 10);
    offset.x += x * trunkWeight * (.105 * chest + .05 * gaussian(y, 123, 10) - .055 * waist - .07 * gaussian(y, 96, 9));
    const front = smoothFront(z);
    offset.z += trunkWeight * front * (
      .85 * gaussian(y, 132, 8) * gaussian(Math.abs(x), 7, 8)
      - 2.75 * gaussian(y, 112, 15) * gaussian(x, 0, 14)
      - .3 * gaussian(x, 0, 2.4) * gaussian(y, 131, 9)
    );
    offset.z -= trunkWeight * (1 - front) * (
      .85 * gaussian(y, 131, 13) * gaussian(Math.abs(x), 8, 12)
      + .65 * gaussian(y, 93, 7) * gaussian(Math.abs(x), 7, 7)
    );
    offset.x += x * headWeight * .045 * gaussian(y, 155.5, 4.5);
    offset.x += x * neckWeight * .06;
    p.add(offset).toArray(result, vertex * 3);
  }
  return result;
}
