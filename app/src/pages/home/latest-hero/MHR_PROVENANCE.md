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

## Athletic male display profile — September 16, 2026

The current body uses the user-selected **anatomical athletic male** direction,
versioned as `posetek-athletic-male-v1`. The neutral MHR template is preserved
unchanged. `prepare-mhr-template.mjs` also produces
`mhr-athletic-male-shape.json`: one combined rest-position delta from the
inspected official MHR identity shapes `shape_c_0 = -0.6` and
`shape_c_1 = -2.6`. These are art-direction coefficients, not estimated athlete
identity parameters. No inference of the recorded person's sex, anatomy or
body composition is performed.

The preparation script maps the original FBX morph deltas onto welded vertices
by their exact rounded rest positions and rejects ambiguous correspondences.
The delta file pins the original FBX hash and a SHA-256 of the ordered neutral
vertex positions. Tests verify both before accepting the profile, avoiding
shape deltas being applied to a different vertex ordering. Its 14,697 numeric
deltas add 70,645 source bytes; unneeded original morph tensors remain excluded.

`athletic-male-profile.ts` applies that delta once, then adds deterministic,
smooth rest-space contours: broader pectorals and upper back, fuller deltoids,
a leaner waist, restrained glute/quadriceps/calf volume, and a slightly broader
jaw. Contours blend through the original skin weights. The original 4,899
vertices, 9,794 triangles, skeleton and weights remain intact; no new body
parts or disconnected muscle geometry are added.

After pose fitting, a bounded radial correction restores some volume lost to
linear skinning at blended elbows and knees. It affects only the surface shared
by the adjacent limb regions and never shifts a recorded landmark. It is a
lightweight display correction, not Meta's neural pose-corrective model or a
biomechanical measurement. Extreme poses can still exhibit template fitting
limitations; no improved reconstruction accuracy is claimed.

## Geometry verification

Tests validate finite outward-oriented geometry for all three poses, one
connected manifold surface, normalized skin weights, preserved input points,
rotation/translation/uniform-scale covariance, bounded complexity, hand/foot
direction, and retained airborne jump clearance. Male-profile checks also
validate exact source/vertex correspondence, deterministic rest-shape output,
broader upper torso and reduced abdominal projection, and per-vertex covariance
under full 3D rotation, translation and uniform scale for all three poses. The
template does not add measurements or change any athlete scores.
