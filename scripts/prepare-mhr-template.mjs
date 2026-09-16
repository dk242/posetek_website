/** Prepare the public Apache-2.0 Meta MHR LOD3 template for a lightweight viewer.
 * Run after extracting lod3.fbx from MHR v1.0.1 to .netlify/mhr-source/.
 * No athlete images, recordings, model inference, or private data are used here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FBXLoader } from '../app/node_modules/three/examples/jsm/loaders/FBXLoader.js';
import { mergeVertices } from '../app/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import { Vector3 } from '../app/node_modules/three/build/three.module.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, '.netlify/mhr-source/lod3.fbx');
const output = path.join(root, 'app/src/pages/home/latest-hero/mhr-template.json');
const bytes = fs.readFileSync(source);
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (sha256 !== '5d5fe30ba09488e96a06b2fe6306202c4048083df9e1003f1051ad541e06aafa') {
  throw new Error('MHR LOD3 source differs from the pinned v1.0.1 asset.');
}
const scene = new FBXLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
scene.updateMatrixWorld(true);
let mesh;
scene.traverse(object => { if (object.isSkinnedMesh && object.name === 'body_mesh') mesh = object; });
if (!mesh || mesh.skeleton.bones.length !== 127) throw new Error('Expected the official MHR LOD3 body rig.');
const geometry = mesh.geometry;
geometry.morphAttributes = {};
geometry.deleteAttribute('normal');
geometry.deleteAttribute('uv');
const welded = mergeVertices(geometry, 1e-5);
const names = ['pelvis', 'torso', 'neck', 'head'];
for (const side of ['l', 'r']) names.push(...['clavicle', 'uparm', 'lowarm', 'hand', 'upleg', 'lowleg', 'foot'].map(part => `${side}_${part}`));
function region(bone) {
  if (bone.name === 'root' || bone.name === 'body_world') return 'pelvis';
  if (bone.name.startsWith('c_spine')) return 'torso';
  if (bone.name.startsWith('c_neck')) return 'neck';
  if (bone.name === 'c_head') return 'head';
  for (const side of ['l', 'r']) {
    for (const part of ['clavicle', 'uparm', 'lowarm', 'upleg', 'lowleg']) {
      if (bone.name.startsWith(`${side}_${part}`)) return `${side}_${part}`;
    }
    if (bone.name === `${side}_wrist_twist`) return `${side}_lowarm`;
    if (bone.name === `${side}_wrist`) return `${side}_hand`;
    if (bone.name === `${side}_foot`) return `${side}_foot`;
  }
  if (bone.parent?.isBone) return region(bone.parent);
  throw new Error(`Unmapped bone: ${bone.name}`);
}
const positions = Array.from(welded.attributes.position.array, n => +n.toFixed(5));
const skinRegions = [], skinWeights = [];
for (let vertex = 0; vertex < welded.attributes.position.count; vertex++) {
  const combined = new Map();
  for (let influence = 0; influence < 4; influence++) {
    const weight = welded.attributes.skinWeight.array[vertex * 4 + influence];
    if (!weight) continue;
    const index = welded.attributes.skinIndex.array[vertex * 4 + influence];
    const id = names.indexOf(region(mesh.skeleton.bones[index]));
    if (id < 0) throw new Error('Unmapped skin region.');
    combined.set(id, (combined.get(id) ?? 0) + weight);
  }
  const entries = [...combined.entries()];
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  for (let influence = 0; influence < 4; influence++) {
    skinRegions.push(entries[influence]?.[0] ?? 0);
    skinWeights.push(entries[influence] ? +(entries[influence][1] / total).toFixed(7) : 0);
  }
}
const joints = {};
scene.traverse(object => {
  if (object.isBone) joints[object.name] = object.getWorldPosition(new Vector3()).toArray().map(n => +n.toFixed(6));
});
const template = {
  source: { project: 'Meta Momentum Human Rig', release: 'v1.0.1', lod: 3, license: 'Apache-2.0', sourceSha256: sha256 },
  regions: names, positions, indices: Array.from(welded.index.array), skinRegions, skinWeights, joints,
};
fs.writeFileSync(output, JSON.stringify(template) + '\n');
console.log(JSON.stringify({ output, sourceSha256: sha256, vertices: positions.length / 3, triangles: template.indices.length / 3, bytes: fs.statSync(output).size }, null, 2));
