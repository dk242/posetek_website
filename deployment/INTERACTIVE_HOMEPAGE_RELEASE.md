# September 13 pose refinements

The current homepage uses a neutral standing 33-landmark hero with a resting ball,
retaining Threlte rotation and keyboard controls. All six card snapshots now come
from corresponding recording frames, with a separate lightweight snapshot bundle.
All four added clips preserve native source coordinates; the existing broad-jump
and agility framing remains intact. No dynamic camera crop or recentering remains.

Vertical jump uses the saved torso-midpoint COM track, chest offsets, and events
(82 load, 99 mid, 124 takeoff, 158 highest). Negative source chest-offset Y means
upward displacement; downward countermovement is clamped to zero for the rise label.
The calibrated artifact peaks at 0.554633 m (21.8 in), superseding the older 18.4 in
context summary. The athlete's stored records were not modified.

Dribbling uses 225 sampled frames from the existing source rep. A ball track was
derived locally from the original video using template matching and frame-by-frame
contact-sheet review, with manual corrections at contacts and marker crossings.
Frames 559, 603, 607, and 935 have no published ball point because it is obscured.
Trails break at these gaps. Source video and review images remain in ignored cache;
only the verified coordinates are bundled. The source checksum manifest now also
pins the derived ball track and three jump measurement files.

Watch-rep and training glyphs are replaced with inline SVG field-diagram icons.
Magic UI card effects, reduced-motion handling, and the existing theme are retained.

Validation: 53 homepage tests and 6 navigation tests pass; TypeScript builds;
Svelte reports 0 errors/warnings; scoped lint and diff whitespace checks pass.
Browser checks cover all six selectors, pause, timeline endpoints, standing hero
rotation, recorded card previews, mobile jump labels and dribble track, desktop
training icons, and 390px/768px overflow checks. No preview console errors observed.
Reduced-motion behavior is covered by logic tests and CSS/code review; device-level
motion settings and physical touch were not simulated.

Preview: https://6aa6fb7f2ef630cd2c973b1b--posetek.netlify.app
HTTP verification: 2 homepage routes, 22 application routes, 63 assets, and all
157 preserved application file checksums passed. No application-baseline changes.

The notes below describe the preceding release; cropping and illustrated-card
notes there have been superseded by this refinement.

---

# Interactive homepage — September 11, 2026

Validated preview: https://6aa4dfe93dd49238c055a835--posetek.netlify.app

Production target: https://posetek.net

Rollback/application baseline: `6aa4c3aaf800c80008dbe855`, source commit
`56cc905879eb42378189c85f207a6be104198524` (player mobile parity).
The build preserves all 157 application files from this newer release.
Netlify's nonservable `/netlify.toml` inventory entry is platform configuration,
not an application asset; the current repository configuration governs this deploy.

## Interaction

- Threlte's OrbitControls rotates a soccer-strike illustration with 33 landmarks
  and a soccer ball. Mouse dragging, arrow keys, left/right buttons, reset, and
  pause/resume are supported. This is an illustration, not recorded 3D data.
- Reduced motion stops automatic rotation while retaining manual exploration.
  Hidden/offscreen scenes unmount, with an SVG fallback on rendering failure.
- Magic UI test cards are approximately 211px tall on desktop, down from 306px.
  Hover, keyboard focus or click reveals an action pose. Mobile cards use two
  columns where space permits. Every card links to its matching recorded demo.
- All six recorded demos have selectors, play/pause and keyboard-accessible
  scrubbing. Each clip loops without unexpectedly changing the selected drill.
  Playback loads as the section approaches the viewport.

## Recordings

The existing Change of Direction and Broad Jump recordings and their measured
results are preserved. Four additional clips were acquired through the authorized
admin account. Public assets contain only pose coordinates, timing and selected
results; no account identifiers, raw camera footage or download URLs are included.

`scripts/prepare-homepage-poses.mjs` reads the ignored `.netlify/pose-source`
folder and verifies the input checksums before preparing the four new demos.
The checksums pin the selected crops and results to their inspected sources.

| Demo | Source frame range | Playback sampling | Notes |
| --- | --- | --- | --- |
| Sprint | 120–416 | Every fourth frame, ~30 fps | Trims unreliable tracking before/after the run; horizontal camera follow |
| Vertical Jump | 0–280 | Every fourth frame, 30 fps | Includes loading, flight and landing; height comes from the artifact's processing context |
| Dribbling | 71–968 | Every fourth frame, ~30 fps | Uses recorded start/end and phase splits; horizontal camera follow |
| Shooting | 300–660 | Every fourth frame, 60 fps | Includes approach/contact/follow-through and the recorded ball track through its fit window |

Cropping and horizontal camera translations preserve joint proportions and
vertical motion. Playback duration describes the excerpt; result metrics retain
their source values. The raw inputs are needed only to regenerate these demos,
not to build or serve the website.

## Validation

- 49 homepage/pose tests and 6 home-navigation tests pass.
- TypeScript passes. Svelte: 0 errors, 0 warnings. Changed playback components
  pass the scoped lint check.
- Browser: all six selectors, pause, timeline endpoints, repeated Watch rep
  navigation, actual WebGL rendering, mouse/button/keyboard rotation and reset.
- Desktop and 390px mobile layouts have no horizontal overflow. The earlier
  interaction preview was also checked at 768px.
- HTTP: 2 homepage routes, 22 application routes, 63 JS/CSS assets, plus all
  157 application file checksums preserved.
- Reduced-motion and WebGL-failure paths were reviewed in code; device settings
  and physical touch gestures were not simulated.

References: [Magic UI](https://magicui.design/docs/components/magic-card),
[Threlte OrbitControls](https://threlte.xyz/docs/reference/extras/orbit-controls/),
[Jitter motion](https://jitter.video/). Magic UI and Threlte skills are installed.
Jitter uses the previously approved reference fallback; no Jitter skill is installed.

The isolated application-baseline build is described in `HOMEPAGE_RELEASE.md`.
Future application updates must reconcile that baseline or deliberately integrate
the public entry into the main application build.
