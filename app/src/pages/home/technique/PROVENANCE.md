# Recovered interactive technique section

This component preserves the Technique panel from the user-approved deployed
reference, `6aa9b6f0d8faf6177db8fd97` (September 15, 2026). The original editable
source for that release was unavailable. This is a recovery of its published
component and data, not a new analysis of the athlete or professional reference.

Source assets:

- `https://6aa9b6f0d8faf6177db8fd97--posetek.netlify.app/marketing/assets/TechniqueDemo-DOOeISdl.js`
  SHA-256: `acd73b5eafadda7d2327aa62981c631e719a64657c8f61ca3da7f121f89e2b2f`
- `https://6aa9b6f0d8faf6177db8fd97--posetek.netlify.app/marketing/assets/TechniqueDemo-BgQuGAyD.css`
  SHA-256: `cc55f46c18a917ed8f1ec71aad66403f1c99530e9ec829a4f60e36b7e106115b`

`technique-data.json` is the exact literal data extracted through the TypeScript
parser, without executing the deployed bundle. It contains 71 sampled frames,
ball positions, saved phase measurements, static professional reference poses,
focus cues, and the original source hashes/mobile commit. Its canonical JSON
SHA-256 is `60b852db742200642f781d81832c7f3a4507cf557f83d1032d39dcd8149bab68`.
The source hashes are preserved metadata; the private original recordings were
not available or revalidated in this recovery.

`TechniqueDemo.jsx` initially retained the deployed component logic. The recovery renamed
bindings, formats the code, extracts four pure helpers into the typed model,
and replaces bundled React/JSX/icon imports with this application's existing
React, JSX runtime, and TacticalIcon. The deployed `Vu` skeleton edges were
compared exactly with the existing `pitch/pose-model.ts` POSE_EDGES array.
The measurement selector additionally has an explicit "Inspect a measurement"
accessible name so option text cannot change the control's label. Two narrowly
scoped lint comments explain the preserved playback effect timing and pause-on-
visibility behavior. The deployed main bundle is never imported or executed. CSS has formatting-only
changes and retains its `.pt-home` scope and responsive/reduced-motion rules.

The default export accepts `{ active?: boolean }`, defaulting to true. Set active
only while its containing section is active. The component additionally observes
its own viewport and pauses when hidden or inactive. Required icon kinds are
`play`, `pause`, `explore`, and `control`.

The initial recovery used the contact snapshot as its initial state and saved
phase measurements while scrubbing. The subsequent annotation release
`6aaa2d81f7a768e5e5799ae1` adapts playback to the mobile reference: forward play,
four guided pauses, Continue, and cues/measurements tied to the same displayed
frame. `walkthrough.ts` and its tests describe the maintained guided progression.
Selected joint/metric inspection, static professional reference comparisons,
keyboard controls, visibility suspension, and the absence of a professional
follow-through reference remain. Recorded frames and saved data are unchanged;
the adaptation does not fabricate improved athlete recordings or moving references.

To reproduce the recovery from the ignored pinned capture, run from repository
root: `node app/src/pages/home/technique/recover-technique.mjs`. It overwrites only
the generated component, data JSON and CSS in this directory; it is not a build
or deployment step. Do not run it as setup: it would replace the intentional
guided-walkthrough edits with the historical recovered component.
