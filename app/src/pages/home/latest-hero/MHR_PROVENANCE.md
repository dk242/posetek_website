# Anatomical body template

The September 16, 2026 viewer revision replaces overlapping procedural body
parts with the continuous **Meta Momentum Human Rig (MHR)** LOD3 surface.
MHR source and model assets are Apache-2.0. Copyright belongs to Meta Platforms,
Inc. and affiliates. The complete license is retained in `MHR-LICENSE.txt` and
the homepage exposes the Vite-emitted license URL through `mhr-attribution.ts`.

- Official project: https://github.com/facebookresearch/MHR
- Pinned asset release: https://github.com/facebookresearch/MHR/releases/tag/v1.0.1
- Official archive: https://github.com/facebookresearch/MHR/releases/download/v1.0.1/assets.zip
- Asset licensing clarification: https://github.com/facebookresearch/MHR/issues/62#issuecomment-4669907228
- Archive SHA-256: `e4f4f205cd87c0fa106577ba1de4fc763e4eb197c924461d2ef7e6944e9d6b94`
- Original `lod3.fbx` SHA-256: `5d5fe30ba09488e96a06b2fe6306202c4048083df9e1003f1051ad541e06aafa`

## Reproduction and modifications

Extract only `assets/lod3.fbx` and `assets/LICENSE.txt` into the ignored
`.netlify/mhr-source/` folder, then run:

```sh
node scripts/prepare-mhr-template.mjs
```

The script verifies the source FBX hash and uses the installed Three.js FBX
loader. It removes unused morph targets and UVs, welds indexed vertices, and
collapses the original 127-bone weights into 18 anatomical regions. Four
normalized influences are retained per vertex. The resulting tracked
`mhr-template.json` contains 4,899 vertices and 9,794 triangles, with its source
hash and license declaration. No model weights, private imagery, recordings or
account identifiers are included. The original full archive remains ignored.

`body-geometry.ts` fits this template around the three existing recorded
landmark sets at runtime. Torso and pelvis follow shoulder/hip frames; arms and
legs follow the recorded segment endpoints. Hands retain the template's neutral
finger articulation while following the recorded palm direction. Feet follow
the ankle/heel/toe frame. Head size and unobserved body thickness are bounded
illustrative estimates. Smooth template skinning preserves one continuous
surface across the joints. Normal vectors are recomputed after deformation.

The captured 33-point landmark arrays, their source frames, phase labels,
shooting ball and airborne jump placement are unchanged. The fitted body is
**illustrative anatomy**, not the athlete's exact body shape, clothing or
likeness, and not a calibrated body scan. This implementation does **not** run
SAM 3D Body inference and must not be presented as a Meta-generated
reconstruction of the athlete. It uses the properly licensed MHR template as
the user-requested anatomical reference.

## Geometry verification

Tests validate finite outward-oriented geometry for all three poses, one
connected manifold surface, normalized skin weights, preserved input points,
rotation/translation/uniform-scale covariance, bounded complexity, hand/foot
direction, and retained airborne jump clearance. The template does not add
measurements or change any athlete scores.
