# Recorded hero poses and illustrative athlete body

## Current anatomical renderer — September 16, 2026

The recorded pose data below remains the source of truth. The current viewer
fits Meta's continuous MHR LOD3 anatomical surface, with the versioned athletic
male display profile, around those unchanged landmarks. See
[`MHR_PROVENANCE.md`](./MHR_PROVENANCE.md) for the pinned source, Apache license,
preparation script, fitting method and limitations. This is an illustrative
template fit, not SAM inference, an athlete likeness or a calibrated body scan.

`stage-camera.ts` defines the shared camera target `[0, 1.4, .02]`, 34 degree
field of view, 5.5 display-unit distance and front/side/reset viewpoints.
`Scene.svelte` uses the studio lighting and `AthleteStage.svelte` stage; these
supersede the historical camera, pitch grid and lighting described below.
The **Body + pose** and **Pose only** layers retain visible recorded tracking.
The static non-WebGL fallback uses pre-rendered views of the same fitted body,
with thin SVG tracking at the matching reset-camera projection. Run
`node scripts/render-hero-fallbacks.mjs` after changing body geometry, camera,
lighting or pose sources; `--check` validates the committed source/asset hashes.
The separate movement playback preserves its data and uses finer tracking lines.
Camera state survives offscreen unmounts. Soft contact shadows retain a visible
gap beneath the airborne jump.

Shooting → Sprint → Vertical jump still holds each pose for six seconds with
a 450 ms crossfade. Manual selection, Pause/Resume, reduced motion, keyboard
orbit and the lightweight non-WebGL fallback remain supported. Only Shooting
includes the existing ball. The installed Svelte/Threlte/Three dependencies
render the scene; no recovered deployment runtime is imported.

## Historical shooting renderer and reconstruction baseline

The initial recovered Svelte renderer reproduced deployment
`6aa9b6f0d8faf6177db8fd97`, rather than the earlier checked-in September 13 pose.
The exact data in `shooting-pose.json` was extracted from `index-B_aLIfan.js`.
The following historical renderer settings were recovered from
`mount-B0YcjNhI.js`; current presentation is documented above:

- Camera `[2.3, 1.85, 3.9]`, target `[0, 1, .05]`, 34 degree field of view.
- Same world-landmark reconstruction and estimated ball position and radius.
- Anatomical bone colors, per-landmark sphere scale/color, physically lit materials.
- Ambient and two directional lights; support-foot and ball ground shadows.
- Same ball geometry, pitch grid and ring, orbit limits, rotation speed, commands,
  on-demand canvas, error boundary, resource disposal and context-loss fallback.

That renderer retained idle loading, offscreen and hidden-document unmount,
reduced motion, pointer rotation suspension/resume and arrow-key/Home controls.
It used installed Svelte/Threlte/Three dependencies. The full deployed entry
and its bundled React/Svelte/Three runtimes were not imported.

The original object includes reconstruction provenance and checksums. The
reconstruction has estimated world depth; it is not a calibrated 3D body scan.

## Sprint and vertical-jump held poses — September 16, 2026

`sprint-pose.json` and `jump-pose.json` were reconstructed from the two athlete
recordings authorized for the hero revision. They contain only 33 derived
coordinates and technical provenance. Names, account identifiers, private
recording URLs, access tokens, video frames and full recordings are not included
in public assets or Git.

- Sprint: source frame **312**, a flight stride with the lead knee bent and the
  other leg extending behind. The original video frame was inspected directly.
- Vertical jump: source frame **158**, the final saved key frame in
  `[82, 99, 124, 158]`. Visual inspection confirms the athlete is near the jump's
  airborne peak; the saved foot-height minimum occurs at frame 157. The source
  sequence's other three saved key frames show preparation and takeoff.
- MediaPipe **Pose Landmarker Heavy, float16/1**, the exact model hash already
  recorded for shooting. Inference uses each source frame's full athlete crop
  with 55% padding, keeping the original image aspect and anatomical directions.
- A five-frame temporal median (sprint 310–314; jump 156–160) reduces inference
  jitter. The depth coordinates come from the model's world-landmark inference,
  not fabricated depth added to the saved 2D tracking.
- X is camera-horizontal, Y is up, and Z is toward the viewer. A uniform scale
  matches the existing shooting skeleton's head–torso–leg anatomical chain
  length. It does not assert the athlete's measured body size.
- The jump preserves an estimated airborne feet-to-ground offset from the saved
  image calibration. The sprint has an illustrative 0.12 display-unit flight
  clearance, verified as airborne in the source frame. These offsets are for
  presentation, not new performance measurements.
- Mean pixel distance between the new model's image landmarks and the original
  saved landmarks: **3.177 px** for sprint, **7.223 px** for jump. This is a
  tracking consistency check, not an independently measured 3D accuracy claim.

To reproduce, supply the authorized source files listed in
`scripts/prepare-held-hero-poses.py` to the ignored directory
`.netlify/hero-pose-source`, together with `pose_landmarker_heavy.task` from
Google's MediaPipe model distribution. The script validates every input hash and
the selected jump key frame. Run it in an isolated Python environment with
`mediapipe`, `opencv-python` and `numpy`; the generation environment used Python
3.12, MediaPipe 1.0.1, OpenCV 5.0.0 and NumPy 2.5.3. No credentials or network
access are used by the preparation script. Collaborators need only the committed
small JSON assets for normal builds.

```powershell
python scripts/prepare-held-hero-poses.py
```

Source video, source-pose and inferred-world checksums accompany each asset.
The original shooting reconstruction and its provenance remain unchanged.

## Historical first three-pose presentation — September 16, 2026

This first three-pose release held Shooting, Sprint and Vertical jump for six
seconds each, with a 450 ms crossfade. Its shared camera was
`[2.8, 2.25, 4.85]`, targeting
`[0, 1.35, .05]` at 34 degrees, to include the jump's airborne clearance.

At that release, `body-geometry.ts` assembled translucent procedural torso,
pelvis, limb, head, hand and foot parts around each recorded skeleton. These
were illustrative geometry, not a recovered body scan or likeness. The label
stated “Illustrative body · Recorded pose.” Tracking bones and joints rendered
above the surface. The current MHR surface supersedes those procedural parts;
the recorded skeleton and Shooting ball remain unchanged.

Manual selection pauses cycling. Pause/Resume governs both automatic cycling
and rotation; orbit input briefly suspends motion. Reduced-motion preference
disables automatic motion and crossfades. Hidden/offscreen scenes unmount, and
an interrupted drag is cleared when the scene is destroyed. SVG body/skeleton
fallbacks preserve all three manual selections if WebGL cannot load.

## Skeleton-only cleanup — September 16, 2026

The current homepage renders only recorded skeletons. No body geometry or PNG body snapshot is imported into the viewer. The existing projected landmarks supply the SVG fallback. MHR files and the mesh-rendering generator remain historical reference and are not required by this release. Manual orbit and pose selection resume after 1.5 seconds; visible layer, pause/play and camera preset controls are removed. Keyboard Home reset, reduced motion and visibility suspension remain. Fine nose/ear-to-shoulder connections make the skeleton readable without the former body surface.
