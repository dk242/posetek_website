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
