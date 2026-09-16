# Movement demo recovery

The original source of the September 15, 2026 release was unavailable. The user
accepted deployment `6aa9b6f0d8faf6177db8fd97` as the appearance and behavior
reference. `RecoveredMovement.js` preserves that release's canvas controller,
React UI, calibration overlays, telemetry, playback, transition animations,
keyboard-accessible controls, reduced-motion behavior, visibility suspension,
and disposal. Its six recordings are extracted without rounding or resampling
into `recorded-movement.json`.

`recover-reference.mjs` reproducibly extracts the reviewed public bundle,
replaces its bundled React imports with this project's React and JSX runtime,
uses the existing `TacticalIcon`, and renames only resolved top-level symbols.
It does not import or execute the deployed site's main entry. No account data,
private video, or new service dependency is introduced.

`reference-provenance.json` records the original asset hashes and exact canonical
data hashes. The script also extracts the newer reconstructed shooting pose for
`../latest-hero/`. The renderer there is maintained as Svelte/TypeScript source
adapted from the prior source and checked against the accepted compiled renderer.

The JavaScript is recovered output, not the unavailable original TypeScript.
The typed React wrapper is `MovementDemo.tsx`. The accepted demo CSS remains
scoped to `.pt-home`. Run the extractor only deliberately: it overwrites the
recovered module/data/CSS and pose JSON from the pinned local reference.

## September 16, 2026 rendering refinement

Following visual review, the recorded 2D viewer uses thin 1.5 px primary limb
strokes, 1 px hand/foot details and uniform 1.5 px landmark dots. The earlier
heavy contrast outlines and torso fill were removed at the user's request.
Nose and ear points retain head orientation while dense eye/mouth dots are
omitted from the presentation.
The green/lime hierarchy follows the approved PoseTek visual system and Refero
craft guidance; existing overlay colors retain their measurement meanings.
Playback has a 44 px hit target and explicit keyboard focus.

This is a presentation change only: all 33 landmarks remain in every original
frame, all data hashes are unchanged, and projection, calibration, telemetry,
overlays, selected frames and playback behavior are preserved. No source video,
trajectory smoothing, generated motion, or external rendering service is used.
