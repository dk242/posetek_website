# Gallery design references and pose provenance

Reviewed September 18, 2026. PoseTek's existing brand and native source are the
primary references. The user approved recorded homepage poses and small emoji
accents. External references guide presentation; they do not supply PoseTek
features, metrics, photographs, copied screens or endorsements.

## Reference roles

| Primary source | Applied presentation principle | Boundary |
| --- | --- | --- |
| [PoseTek website](https://posetek.net/) and `MarketingHeader.tsx` / `home.scss` | Official lime P, evergreen canvas, condensed athletic headings and test → review → train → retest narrative | Preserve actual identity and documented claims |
| Native `posetek-mobile-app` at `944177b` | Actual tabs, two-column drill chooser, profile/skill-map structure, landscape analysis, workout and history screens | Source-derived preview is not a release-build capture |
| [Runna features](https://www.runna.com/features) | One clear workout action at a time; readable plan/instruction hierarchy and device presentation | Do not import Runna features, pricing, results or graphics |
| [Nike Training Club](https://www.nike.com/ntc-app) | Athletic editorial rhythm and decisive, short headings around the product | No Nike photography, branding or copied layouts/assets |
| [Strava Training Log](https://support.strava.com/en-us/articles/15402077-training-log) | Legible chronological results and progress context | No copied charts/data or implied integrations |
| [Apple product-page guidance](https://developer.apple.com/app-store/product-page/) | A clear sequence of product moments that communicates function | Actual screenshots and truthful release claims remain required |
| [Microsoft Fluent emoji](https://github.com/microsoft/fluentui-emoji) | Small, consistent Flat SVG caption accents | Marketing layer only; retain the MIT license |

The exterior uses website colors `#04130E`, `#B7F34A`, `#F0F5ED`.
Device reconstructions respect native colors, including the profile's
`#041610` / `#082417` greens and `#7CFF18` lime. Native screen-specific
themes remain the reference rather than forcing every screen into website
colors. The gallery corrects the prior “Ranks” label to “Leaderboards” and
removes the invented tablet navigation rail.

The six captions use football, stopwatch, magnifier, target, calendar and
rising-chart accents for evidence, tests, replay, focus, session and retesting.
Fixed local SVG assets render consistently without platform-dependent Unicode
glyph substitution. `emoji/manifest.json` pins their source URLs and SHA-256
hashes at Fluent commit `1ffb34c752ecf5d402f04cfb4b392c77f57c54bc`;
`emoji/LICENSE` carries the MIT terms. Preserve them when redistributing assets.
The image contents must not imply measured improvement merely because a chart
emoji appears.

## Native fidelity

`KickAI/CoachView/CoachPlayerView/CoachPlayerView.swift` defines Profile,
AI Coach, Drills, Training and Leaderboards in a bottom panel. It overrides
stale tab names in older repository prose. `DrillsView.swift` uses two columns
and includes Free record and Drill Settings beside the six performance tests.
The native Jump card is titled “Jump”; marketing may explain that test as
vertical jump without renaming the app's control.

`SessionAnalysisView.swift` requires landscape; portrait displays a rotation
instruction. The replay gallery therefore fits landscape analysis within the
portrait store canvas. Real iPad captures are required to validate tablet
layout. `TrainingHub/WorkoutPlayerView.swift` and `WorkoutNowCard.swift`
establish the guided session. The user's request changes gallery presentation,
not native feature behavior.

## All 33 landmarks

The source index is MediaPipe Pose's 33-landmark order, also represented in
native `StatsView.swift` and the website's full `POSE_EDGES` map.
[Google's landmark guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker)
documents the model.

| Indices | Landmarks |
| --- | --- |
| 0 | Nose |
| 1–3 | Left eye inner, eye, outer |
| 4–6 | Right eye inner, eye, outer |
| 7–8 | Left and right ear |
| 9–10 | Left and right mouth |
| 11–12 | Left and right shoulder |
| 13–14 | Left and right elbow |
| 15–16 | Left and right wrist |
| 17–18 | Left and right pinky |
| 19–20 | Left and right index finger |
| 21–22 | Left and right thumb |
| 23–24 | Left and right hip |
| 25–26 | Left and right knee |
| 27–28 | Left and right ankle |
| 29–30 | Left and right heel |
| 31–32 | Left and right foot index |

The renderer must retain all 33 valid points and the canonical 35 edges. Do not
omit face/hands/feet, substitute a stick figure, independently stretch axes or
invent missing points. A 33-slot array can be padded COCO-17 data in native
`SessionViewer/PoseSkeleton.swift`; source schema and validity matter.

## Homepage versus storage

Public homepage assets are under `app/src/pages/home/latest-hero/`:
`shooting-pose.json`, `sprint-pose.json`, `jump-pose.json`, the
`fallback/projection.json` coordinates, `pose-model.ts` and `PROVENANCE.md`.
Each recorded pose has 33 finite points. The sprint snapshot derives from source
frame 312; the jump snapshot from frame 158. Shooting carries contact/frame,
foot and ball context. Preserve source hashes and their documented reconstruction
rather than treating these as new measurements. The latest homepage provenance
specifies skeleton-only figures, superseding historical body-mesh descriptions.

The gallery's self-contained snapshot is `pose/recorded-poses.json`, with
`pose/PROVENANCE.md`. The output manifest records the pose/frame, source and
projection hashes, landmark/connection counts, emoji source and capture status.

These public files are prepared from authorized source recordings. Their depth
is estimated, not a calibrated scan. The gallery uses sanitized derived
coordinates, not private athlete names, raw videos or cloud account data.
Uniform fitting preserves the recorded geometry; no new analysis is performed.

Root `index.html` loads the marketing application. It is not the bucket
connection. Authenticated web replay uses `drill-data.ts` to request permitted
artifacts through `getAthleteRepMedia` or `getAthleteSharedRepArtifacts`.
Backend `effective-results.js` and `athlete-storage-paths.js` validate access
and resolve artifact paths in the configured Firebase/GCS bucket; viewers
normalize `pose.json` with its metadata. Native
`DrillSessionRepLoader.swift` likewise reads pose/metadata artifacts. These
authenticated flows are distinct from the public homepage snapshots.

Exports intentionally require no live bucket connection, contain no signed
URLs, and make no backend writes. The final screenshot step uses what the
selected native binary actually displays; the static illustration's full
connection map must not be painted onto a capture to misrepresent native UI.

## Release honesty and licenses

Preserve preview labeling until actual captures replace the illustrated device
screens. A pose sourced from a real recording does not make the surrounding
authored UI a screenshot. Current dimensions and provenance are in
`output/gallery-manifest.json`; capture instructions are in
[capture-brief.md](capture-brief.md).

Inter, Barlow Condensed and IBM Plex Mono license files accompany the fonts.
Microsoft Fluent assets retain their MIT license. Third-party reference pages
are linked for rationale; their screenshots or photographs are not redistributed
in the package. No optional app-preview video was fabricated.

Apple's [accurate-metadata guidance](https://developer.apple.com/app-store/review/guidelines/#accurate-metadata)
and [screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
inform final review. Eligibility still depends on the submitted binary and
account configuration, not the fact that a renderer produced PNGs.
