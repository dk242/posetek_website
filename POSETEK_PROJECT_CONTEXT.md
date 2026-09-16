# PoseTek website project context

Reviewed on September 16, 2026. This guide summarizes the available repository and
release notes; it is not a claim that every historical discussion or private
business document is included.

## Readiness and source provenance

### Current revision: athletic male anatomy and finer tracking

Deployment `6aaa57d3fe77d22f67611c42` was published to https://posetek.net on
September 16, 2026 at 1:52:03 AM PDT (08:52:03.048 UTC). The validated draft was
promoted unchanged. All 197 local output files match the published inventory,
including the 171 preserved application/public files. Release checks and rollback
are recorded in `deployment/ATHLETIC_MALE_VIEWER_PRODUCTION.json`.

The user selected an **athletic male
anatomical model** in neutral sage and confirmed that all three recorded hero
poses must retain their existing coordinates. References inform body shape and
presentation only; they do not replace recorded evidence.

This revision refines the licensed MHR surface through a reproducible athletic
male rest-shape profile, reduces the tracking line and joint sizes, and replaces
the thick limb-based loading illustration with static renders of the fitted
mesh. The body remains illustrative, not a likeness or calibrated scan.

Recorded 2D pose strokes return to a fine treatment: 1.5 px primary lines,
1 px detail lines and 1.5 px dots, with the heavy outlines and torso fill removed.
Measurement overlays, data, playback and the improved phone metrics layout
remain intact. The hero keeps the same controls, held-pose timing and camera
persistence. Modified keyboard shortcuts retain their native browser behavior;
the tablet controls and two-line keyboard hint have separate vertical space.

Higgsfield installation was authorized and its install prompt confirmed, but
connection completion is still pending. No Higgsfield output is used at this
stage. The design decisions and public photo references are recorded in
`deployment/VIEWER_DESIGN_REFERENCE.md`.

### Historical release: anatomical viewer and clearer recorded tracking

Deployment `6aaa4f0b04a11116d8495374` was published to https://posetek.net on
September 16, 2026 at 1:12:19 AM PDT (08:12:19.763 UTC). The validated draft was
promoted unchanged. All 194 local output files match the published inventory,
including the 171 preserved application/public files. Release checks and rollback
are recorded in `deployment/ANATOMICAL_VIEWER_PRODUCTION.json`.
The reference lock and decision ledger are in
[`deployment/VIEWER_DESIGN_REFERENCE.md`](deployment/VIEWER_DESIGN_REFERENCE.md).
The approved scrolling structure, PoseTek green/lime identity, concise copy and
preserved-application release guard remain in place.

The hero now fits Meta's Apache-2.0 **Momentum Human Rig (MHR)** template locally
to the existing recorded landmarks. Its neutral continuous anatomical surface
has **4,899 vertices and 9,794 triangles**, replacing the earlier segmented
illustrative body. This is template fitting, not SAM 3D image inference, the
athlete's likeness, or a calibrated body scan. Attribution, retained license,
input hashes and reproduction steps are documented in
[`latest-hero/MHR_PROVENANCE.md`](app/src/pages/home/latest-hero/MHR_PROVENANCE.md).

The framed viewer provides **Body + pose** and **Pose only** modes, Front/Side/
Reset camera presets, drag and keyboard orbit, and camera persistence across
offscreen suspension. A finite stage, soft ground shadows and restrained
lighting make the figure's depth and airborne placement easier to see. The
three existing held poses, coordinates, shooting ball and cycle timing remain
unchanged. Reduced motion, visibility suspension and static fallbacks remain
part of the viewer contract.

Recorded 2D movement uses contrasting limb outlines, distinct primary joints,
quieter hand/foot and facial details, and a faint torso plane from exact supplied
landmarks. Playback has a larger target and explicit keyboard focus. Source
coordinates, frames, projection, calibration, telemetry and playback behavior
are unchanged; see
[`movement/PROVENANCE.md`](app/src/pages/home/movement/PROVENANCE.md).
Higgsfield was discovered but is not connected; no Higgsfield output is used.

### Historical release: three-pose hero and coherent homepage copy

Deployment `6aaa45aa0d612bd628335ecf` was published to https://posetek.net on
September 16, 2026 at 12:34:12 AM PDT (07:34:12.757 UTC). The validated draft was
promoted unchanged. See `deployment/HERO_REVISION_PRODUCTION.json` for checks and
rollback. All 193 local output files match the published inventory, including
the 171 unchanged application/public files. The established scrolling layout
and green/lime visual system remain the design reference, with Refero motion
and copy guidance.

The hero now has one exploration action, **“See your game differently,”** with a
circular downward arrow and a tracking line that responds to hover and focus.
The large hero booking button was removed; booking remains in the header and
closing section. Header navigation follows the section order: Tests, Technique,
Athlete profile, Training, AI Coach.

The viewer cycles Shooting → Sprint → Vertical jump at six-second intervals,
with a 450 ms crossfade. Shooting retains the prior reconstruction; sprint and
jump use derived world landmarks from the authorized recordings, verified
against source frames 312 and 158 respectively. Each skeleton has a translucent
illustrative body, not a likeness or calibrated body scan. Only shooting includes
a ball. Public assets contain derived coordinates and technical provenance;
private source recordings, account identifiers and access URLs remain excluded.
See `app/src/pages/home/latest-hero/PROVENANCE.md` for reconstruction details.

Manual pose selection pauses the cycle. Pause/Resume controls automatic cycling
and rotation; dragging and keyboard orbit remain available. Reduced motion
disables automatic motion and crossfades. Hidden/offscreen scenes suspend work,
interrupted drags reset on teardown, and the static fallback supports all poses.

Supporting copy now consistently explains testing → review → profile → training
→ retesting. Technique distinguishes three phases from four coaching stops and
labels its saved measurements “Recorded kick.” Workout context follows the
selected focus, identifies each independent two-drill sample, and distinguishes
available time from actual sample duration. Fixed week/progress claims were
removed; skipped demonstrations no longer claim completed drills. Sample profile
and AI Coach measurements and answers are unchanged.

### Shared repository handoff

The user requested that all website changes be committed to
`https://github.com/dk242/posetek_website.git` and made available to collaborators.
This revision includes the published homepage implementation, recovered source
and data, baseline protection, tests, provenance, and release documentation.
The latest fetched teammate commit, `a5fd57d` (admission-code casing tests), was
fast-forwarded into local `main` without changing the website work.

The root `README.md` now documents fresh-clone installation, the one-time public
reference capture, local preview, checks, and the production build. The editable
homepage no longer depends on unshared source changes in this working directory.
Ignored build output and the public-reference capture are reproducible and are
not source deliverables. Historical production receipts retain their original
manual-release and uncommitted-source descriptions as records of publication.

The handoff review found that Netlify rewrites 25 legacy HTML files when serving
the pinned deployment. Their exact tracked originals are now recorded as
`localPath` entries in the baseline; all original hashes and sizes are retained.
Verification without the local baseline cache resolved all 171 preserved files
from those 25 tracked sources and 146 pinned downloads, with zero mismatches.

### Historical release: nine annotations implemented

Deployment `6aaa2d81f7a768e5e5799ae1` was published to https://posetek.net on
September 15, 2026 at 10:50:58 PM PDT (September 16, 05:50:58.892 UTC).
The validated draft was promoted unchanged. See
`deployment/ANNOTATION_UPDATE_PRODUCTION.json` for verification and rollback.
All 171 application/public files remain unchanged; all 193 local output files
match the published inventory, plus one Netlify-generated metadata file.

The release established Hero → journey bar → six tests with one shared replay →
guided technique → athlete profile → ready-made workout → AI Coach/retesting →
booking. Copy is concise. The hero says “players”; only the keypoints art label
was removed, preserving the separate tracked-joints metric.

The user confirmed `athelyticsOG/posetek-mobile-app` main as the mobile reference,
inspected at `98d8a051f0580785b70610f5c1a29a5246e08bfb` through git objects without
changing its dirty local checkout. Technique follows its forward-play, pause,
Continue and same-frame cue behavior. Recorded pose data and measurements remain
unchanged. Professional references are static saved phases; no follow-through
reference or improved athlete recording is fabricated. Five workout examples
adapt its catalog: DRB-006, DRB-009, PAS-001, SHT-003, SHT-004. Plans open ready
to Start or Customize and distinguish actual sample duration from available time.

The Refero reference lock uses the approved scrolling PoseTek visual system,
mobile walkthrough/catalog behavior, and bundled motion, copy and icon guidance.
All nine original annotation quotations remain in
`deployment/HOMEPAGE_ANNOTATIONS_2026-09-15.md`; original browser notes were preserved.
These decisions supersede earlier page order and apostrophe preferences below.

### Historical copy revision before the annotation release

The user requested shorter supporting text beside each bold section heading.
Seven section descriptions in `HomePage.tsx` were reduced to 105 words in total
instead of 168 (38% shorter), preserving the testing-to-training narrative. This
copy revision was subsequently included in the annotation release above. The
marketing build passed and the revised copy was verified in the local browser.
The user also referenced nine saved Codex browser annotations in the original
preview tab. They remain attached to the chat draft; automated submission did not
complete. All nine comments and their highlighted targets have now been read
directly from the original preview and transcribed in
`deployment/HOMEPAGE_ANNOTATIONS_2026-09-15.md`. They cover merging the tests and
movement sections, improving technique playback and workout examples, combining
AI Coach with retesting at the end, moving the journey bar, and small hero/icon
changes. Annotation 8 changes `player’s` to `players`, superseding the earlier
apostrophe preference below. The release above now implements these annotation edits.

This folder was initially empty. Its source is based on a clone of
`https://github.com/dk242/posetek_website.git`, branch `main`, at commit
`c5af2e9` (September 13, 2026, captured shooting hero and recording carousel).
The repository history and its existing documentation are included. The published
scrolling update and subsequent annotation changes are included in the shared
repository handoff described above.

**The live homepage was newer than the original checkout.** On September 15,
`https://posetek.net/` showed a “Your game. In focus.” section with Movement,
Technique, Workout, and AI Coach tabs. The original checkout had separate assessment,
analysis/profile, and training sections. Matching page titles alone do not prove
that the versions match. No fetched branch or inspected local copy contained the
newer tabbed section. The user confirmed that the latest work was edited on
another computer or in another project folder, then explicitly chose to use
the deployed site as the reference rather than wait for that source.

**The working homepage now implements the user's scrolling update.** The user
asked to combine the September 13 page's long scrolling structure and product
explanation with September 15's newer visuals and functional demonstrations.
Movement analysis, technique analysis, AI Coach, and workout planning each have
their own section. The user authorized production publication, and the exact
validated draft was promoted to https://posetek.net on September 15, 2026 at
7:25:58 PM PDT (September 16, 02:25:58.402 UTC), deployment
`6aa9fd38c6863f74b02380e9`. This was a manual Netlify release, not a GitHub push.

The five public homepage assets from September 13 matched the initial source build
byte for byte. September 15's newer demonstrations were recovered from its pinned
public output: exact recording data, measurements, sample answers, and workout
logic are now in the editable project with provenance documents. The hero uses
maintained Svelte source adapted to the latest reconstruction. No deployed entry
bundle or duplicate React runtime is imported. Original authored source from the
other computer remains unavailable; recovered JavaScript is not that original source.

For the approved direction and checks, read
`deployment/SCROLLING_HOMEPAGE_UPDATE.md`. Build with
`npm --prefix app run build:marketing`, then run
`node scripts/serve-homepage-preview.mjs` for the update at http://127.0.0.1:4174.
On a fresh clone, first run `node scripts/capture-deployed-reference.mjs` to
download the public reference needed by the preview servers.
Port 4173 remains the unchanged September 15 tabbed reference. See the
[production receipt](deployment/SCROLLING_HOMEPAGE_PRODUCTION.json) for publication
and verification details. Live HTTP and published-file checks passed.

## Previous deployed reference, rollback, and application baseline

- Previous production/reference deployment: `6aa9b6f0d8faf6177db8fd97`,
  “Compact interactive homepage preview.” It remains unchanged as the tabbed
  comparison reference, rollback target, and preserved-application baseline.
- Published: September 15, 2026, 2:44:08 PM PDT (21:44:08 UTC).
- Pinned URL: https://6aa9b6f0d8faf6177db8fd97--posetek.netlify.app
- Netlify reports no linked commit and no source archive for this release.
- Previous deployment: `6aa73378185ce440bbf18168`, “Correct mobile admin tab padding,”
  published September 13, 2026, 4:36:28 PM PDT (23:36:28 UTC).
- Capture: `.netlify/deployed-reference/6aa9b6f0d8faf6177db8fd97/`.
- Inventory: `reference-manifest.json` in that directory; 88 captured public files,
  5,487,022 bytes, zero capture failures, all local SHA-256 hashes verified.
- Scope: homepage and application entries, booking page, and statically discoverable
  same-origin bundles/assets. This is compiled output, not recovered original TSX
  or a complete backup of external services, user data, or every legacy page.
- Local preview: `node scripts/serve-deployed-reference.mjs`, then
  http://127.0.0.1:4173. The capture is ignored by Git and is not a deployment folder.
- Recapture: `node scripts/capture-deployed-reference.mjs` pins this same immutable
  release. Change its pinned deployment deliberately if adopting a newer reference.
- Browser review confirmed the local “Your game. In focus.” section and all four
  rendered panels: Movement (six recordings), Technique (recorded kick measurements),
  Workout (sample intake), and AI Coach (sample profile/questions/answer).
  No form was submitted, account used, or data changed.

## Production reconciliation

During initial preparation, the old production baseline stopped the build with:
`Production application changed; reconcile homepage-baseline.json with its latest deployment.`
That mismatch was resolved for the authorized scrolling release using the full
Netlify file inventory for `6aa9b6f0d8faf6177db8fd97`, not the partial 88-file
browser-reference capture. `deployment/homepage-baseline.json` now specifies
`applicationPath: "/application.html"` and 171 preserved application/public files.
All 171 retained files matched their pinned SHA-1 hashes and sizes. The application
entry and existing navigation bridge remain at their original paths without
reinjection or rewriting; only the marketing entry and marketing assets were replaced.

Netlify CLI-generated `/netlify.toml` metadata is tracked separately in the manifest
and excluded from served-asset preservation because the CLI regenerates it.
Its five effective header rules and one `/application.html` fallback redirect
were retained. The production guard now compares the live application entry
directly with the pinned modern baseline; it has not been bypassed. Legacy baseline
support remains tested. Preserve this guard and reconcile any future app drift.

Older copies remain untouched:

- `G:\My Drive\PoseTek Auto Editor\posetek_website`: older static homepage with
  existing uncommitted `index.html` changes. These were not copied over main.
- `C:\Users\dylan\OneDrive\Documents\GitHub\posetek_website`: another older checkout.
- A mobile reference exists at
  `C:\Users\dylan\OneDrive\Documents\GitHub\posetek-mobile-app`. Its currentness and
  parity have not been verified in this review. It is reference-only.

## Product and brand context

PoseTek connects soccer performance testing, movement analysis, an athlete
profile, focused training, and retesting for coaches, clubs, and players.
The documented homepage direction is **Draft B — Test to Next Step**:
six tests → review movement → compare with benchmarks → train → retest.
The private pitch video underlying that direction is not a public website asset.

The six tests are Sprint, Straight Vertical Jump, Standing Broad Jump,
Dribbling Shuttle, Change of Direction, and Side-View Shooting. Athlete profiles
organize results into Speed, Shooting, Power, Control, and Agility.

The established visual identity uses dark green, lime accents, condensed
athletic headings, Inter body copy, and IBM Plex Mono for technical labels.
The hero invites visitors to explore the system; booking remains available in
the header and closing section, and sign-in serves returning users. Use concise,
evidence-based copy. Sample athlete scores and training plans
must stay labeled as samples; do not turn them into customer outcome claims.
Experimental `hypothesis_*` page pricing and older offers are not verified current
commercial terms.

## Where homepage changes belong

| File or directory | Purpose |
| --- | --- |
| `index.html` | Public entry, SEO/social metadata, fonts, favicon, noscript fallback |
| `app/src/home-entry.tsx` | Isolated React homepage entry |
| `app/src/pages/home/HomePage.tsx` | Homepage copy, sections, navigation, booking/sign-in links |
| `app/src/pages/home/home.scss`, `magic.css` | Homepage styling, scoped to `.pt-home` |
| `app/src/pages/home/scrolling-home.scss`, `LazyHomepageDemo.tsx` | Scrolling layout and independent, persistent, visibility-aware lazy demos |
| `app/src/pages/home/TestCards.tsx`, `AthleteProfile.tsx` | Assessment cards and sample profile |
| `app/src/pages/home/movement/` | Recovered current movement controller, six exact recordings, telemetry, tests, and provenance |
| `app/src/pages/home/technique/` | Recovered current technique panel, 71 frames, phase measurements, references, and tests |
| `app/src/pages/home/product/` | Recovered current workout/coach UI, typed reducer/sample data, tests, and recovery tooling |
| `app/src/pages/home/PitchVisual.tsx`, `latest-hero/` | Shooting/sprint/jump hero, derived landmarks, illustrative bodies, cycle/orbit controls, Svelte/Threlte/Three renderer and static fallbacks |
| `app/src/pages/home/LazyPoseDemo.tsx`, `PoseDemo.tsx`, `use-pose-demo.ts`, `pitch/` | Earlier implementation reference; not the main page's active demo/hero imports |
| `app/src/pages/home/pose-*.json`, `landing-pose-demo-data.json` | Earlier recording data used by existing cards/tests; newer playback data lives in `movement/` |
| `app/src/App.tsx` | Application routes and legacy aliases |
| `app/vite.marketing.config.ts` | Isolated marketing build |
| `scripts/build-production.mjs` | Production verification and homepage/application assembly |
| `deployment/homepage-baseline.json` | Pinned application file hashes and deployment source |
| `scripts/serve-homepage-preview.mjs` | Local updated marketing preview over the captured current public app; not a deploy command |

This is now a React/TypeScript/Vite project with Svelte islands and legacy HTML
pages, not a single self-contained `index.html`. Future references to editing
“index.html” will usually mean the public homepage and its components.

## Preserve during future changes

- Keep existing clean routes and `.html` aliases, including booking, `/signin`,
  `/privacy`, and athlete deep links. Preserve `share`, `player`, `returnTo`,
  `view`, and `drill` query meanings.
- Retain keyboard controls, focus behavior, reduced-motion support, rendering
  suspension when hidden/offscreen, and the hero's render-failure fallback.
- Keep recorded measurements, units, frames, and checksum provenance intact.
  The hero retains the September 15 shooting reconstruction and adds source-derived
  sprint/jump world landmarks with estimated depth and illustrative bodies, not
  calibrated body scans. Earlier frame-464 source notes describe the prior hero;
  `latest-hero/PROVENANCE.md` and its data supersede them here.
- Preserve sample labels and the distinction between recorded data and illustrative
  content. Keep private video, account identifiers, and download URLs out of
  public bundles.
- Latest checked-in pose notes supersede earlier details: vertical-jump peak is
  0.554633 m / 21.8 in; dribbling ball trails break at occlusions; the recording
  carousel wraps Shooting to Sprint and previous/next retain pause state.
- The `player’s` apostrophe in the hero introduction is documented as an explicit
  earlier user request. Do not silently treat it as an accidental typo.
- Mobile remains the source of truth for shared player behavior and data
  contracts. Capture, calibration, processing, and new body scans remain mobile.
  Missing metrics remain unavailable, and player document IDs are not auth UIDs.
- Gateway-owned plans, proposals, AI history, analyses, and memory are not
  directly edited by public homepage work. Existing Firebase and athlete-share
  access contracts must remain compatible.

## Build and verification

Node 22.18.0 and npm 10.9.3 were available during review. Frontend dependencies
were installed from `app/package-lock.json` with
`npm --prefix app ci --ignore-scripts --no-audit --no-fund`.

Relevant local checks (run from the repository root):

```powershell
npm --prefix app test -- src/pages/home
node --test scripts/home-navigation.test.mjs scripts/production-baseline.test.mjs
npm --prefix app run check:svelte
node app/node_modules/typescript/bin/tsc -b app
npm --prefix app run build:marketing
```

The production command is `node scripts/build-production.mjs`. In the current
release architecture it verifies the live app against the baseline, preserves
171 application/public files, serves the preserved application through `/application.html`, and
adds the isolated homepage at `/` and `/index.html` with assets under
`/marketing/assets/`. Output is `production-dist`. The ordinary application build
outputs `dist` and is a different path; editing app source alone does not replace
the preserved application in a homepage release.

Do not publish the repository root as if it were the old static site. The verified
`production-dist` artifact was uploaded as a draft, reviewed, then promoted without
rebuilding to deployment `6aa9fd38c6863f74b02380e9`. No backend or authenticated data
change was made. Source was uncommitted at that manual release; it is now included
in the repository handoff together with the later annotation update.

Release verification (build, hosted draft, and production):

- Production assembly passed with all 171 preserved files verified.
- Five baseline integration tests and six navigation tests passed; the baseline
  tests cover modern/legacy preservation, drift rejection, corruption rejection,
  and marketing overlap rejection.
- Hosted draft HTTP checks passed for two homepage routes, all 171 preserved
  files, 22 application routes, and 74 application assets.
- Hosted draft browser checks covered the AI Coach's 20-minute workout handoff,
  workout start, and pause, with no browser errors.
- Live HTTP checks passed for the same two homepage routes, 171 preserved files,
  22 application routes, and 74 application assets.
- Live browser smoke checks confirmed movement recording switching, technique
  phase selection, the sign-in screen, and the booking calendar. No form or
  account action was performed.
- The published Netlify inventory contains 195 files. All 194 `production-dist`
  files matched their published SHA-1 hashes and sizes; the additional file is
  platform-generated `netlify.toml`. All 171 preserved application/public files
  remained unchanged.
- The earlier homepage validation remains documented in
  `deployment/SCROLLING_HOMEPAGE_UPDATE.md`; the broader interactive acceptance
  pass was on the hosted draft, followed by the listed live smoke checks.

Initial preparation verification (before the scrolling update):

- Static review: all 48 homepage relative imports resolve; 12 homepage IDs are
  unique; fragment destinations, booking/logo files, sign-in/privacy routes, and
  all six recording/card/thumbnail keys match.
- Homepage tests: 56 passed. Home-navigation tests: 6 passed.
- Svelte: zero errors and zero warnings. TypeScript build passed. Standalone
  marketing build passed and produced `marketing-dist/index.html`; Vite reports
  a large lazy-loaded 3D chunk, which is an existing build warning.
- Production build initially stopped by the baseline mismatch described above;
  the later authorized release resolved it through the modern manifest.
- Initial sandboxed checks encountered subprocess `EPERM`; the local checks were
  rerun with the necessary process access. This was an execution-environment issue.
- Local browser review of the captured deployment confirmed all four current
  showcase panels render. This is not a full responsive, accessibility, backend,
  or authenticated application acceptance test.

## Context documents and precedence

1. `deployment/ANNOTATION_UPDATE_PRODUCTION.json` and
   `deployment/HOMEPAGE_ANNOTATIONS_2026-09-15.md`: latest release receipt and the
   nine requested updates; the current-release section above records decisions.
2. `deployment/SCROLLING_HOMEPAGE_UPDATE.md` and
   `deployment/SCROLLING_HOMEPAGE_PRODUCTION.json`: earlier scrolling direction,
   recovery boundaries, behavior adaptations, reconciliation, and release receipt.
3. `deployment/INTERACTIVE_HOMEPAGE_RELEASE.md`: previous checked-in homepage
   behavior; cumulative notes, with newest sections superseding earlier ones.
4. `deployment/HOMEPAGE_RELEASE.md`: Draft B direction, public entry isolation,
   asset preservation, and recorded release checks.
5. `docs/PLAYER_EXPERIENCE.md`: current player surfaces, ownership, mobile parity,
   and acceptance requirements.
6. `app/PORTING.md`: routing, scoped CSS, shared Firebase/identity conventions.
7. `ATHLETE_RESULTS_LINKS.md`, `functions/CLUB_CONTRACT.md`: share and organization
   contracts when a requested change actually touches those features.
8. `docs/planner/`, `app/PLANNER_PERSONALIZATION_PLAN.md`, and `deployments/`:
   feature plans and historical integration/validation receipts.

Earlier September 9 integration notes describe a unified build with no homepage
bridge; the later homepage release notes and current build script supersede
those build instructions. Old static-site agent descriptions, `images/README.md`,
and parts of `STATIC_JUMP_UPDATES.md` are historical. Previous release test claims
are historical evidence, not a substitute for checking the next changed version.

## Website, UI, and 3D capabilities on this computer

| Skill or tool | Availability and role |
| --- | --- |
| Refero Design | Installed personal skill; primary UI/design methodology, typography, color, responsive layout, accessibility, motion, and copy |
| Figma | Available plugin skills/tools for design files, components, design systems, and code translation |
| ImageGen | Available raster-image generation/editing; not a 3D mesh generator |
| Computer Use | Available browser inspection and interaction testing |
| Netlify | Available configuration, preview, and deployment capabilities |
| Sites | Available complete-site building/hosting workflow; this project currently uses its own React/Netlify setup |
| Visualize | Available inline interactive explanatory tools and diagrams |
| Magic UI | Components are already in this repository; older notes mention a standalone skill that is not installed on this computer |
| Threlte / Three.js | Dependencies already in this project for interactive 3D rendering; no standalone Threlte skill currently installed |
| Meshy | User asked to include it in the 3D tool review; no Meshy skill or direct tool is currently available here |
| Meta SAM 3D | Official browser playground/model repositories exist; no direct local skill/model runtime installed here |

Meta SAM 3D Objects reconstructs textured objects from images; SAM 3D Body focuses
on human mesh/pose reconstruction. See the official
[Objects repository](https://github.com/facebookresearch/sam-3d-objects),
[Body repository](https://github.com/facebookresearch/sam-3d-body), and
[playground](https://www.aidemos.meta.com/segment-anything/editor/convert-image-to-3d).
No new 3D tooling was installed during this review. The user mentioned Meshy,
Threlte, and Meta tools; this was an inventory request, not an installation request.

## Next step

Continue the user's next prompts from the published scrolling implementation and
annotation updates in this repository. Commit website changes here and keep the
shared repository updated for collaborators. Keep the September 15 capture as the unchanged
comparison reference. If newer original source becomes available, reconcile it
with the recovered modules instead of replacing the user's accepted changes.
For any further release, verify the current application against the reconciled
baseline, rebuild, preview, and validate the intended changes before publishing.
