# Accepted reconstructed shooting hero

The maintained Svelte renderer reproduces deployment
`6aa9b6f0d8faf6177db8fd97`, rather than the earlier checked-in September 13 pose.
The exact data in `shooting-pose.json` was extracted from `index-B_aLIfan.js`.
The renderer changes were recovered from `mount-B0YcjNhI.js`:

- Camera `[2.3, 1.85, 3.9]`, target `[0, 1, .05]`, 34 degree field of view.
- Same world-landmark reconstruction and estimated ball position and radius.
- Anatomical bone colors, per-landmark sphere scale/color, physically lit materials.
- Ambient and two directional lights; support-foot and ball ground shadows.
- Same ball geometry, pitch grid and ring, orbit limits, rotation speed, commands,
  on-demand canvas, error boundary, resource disposal and context-loss fallback.

`../PitchVisual.tsx` retains idle loading, offscreen and hidden-document unmount,
reduced motion, pointer rotation suspension/resume and arrow-key/Home controls.
The renderer uses installed Svelte/Threlte/Three dependencies. The full deployed
entry and its bundled React/Svelte/Three runtimes are not imported.

The original object includes reconstruction provenance and checksums. The
reconstruction has estimated world depth; it is not a calibrated 3D body scan.
