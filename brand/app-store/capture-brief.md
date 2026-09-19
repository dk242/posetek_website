# Release-build screenshot capture brief

The gallery is a source-derived review preview. Replace every device screen
with a genuine capture of the intended release before App Store upload. The
inspected app targets iPhone and iPad (`TARGETED_DEVICE_FAMILY = 1,2`), so
provide six captures from each family. Do not stretch a phone UI into a tablet.

## Prepare the build and demo account

On an owned Mac primary checkout, integrate the reviewed icon patch and intended
release changes, then follow native `docs/BUILD_AND_TESTING.md`. Open
`KickAI.xcworkspace` and use `scripts/validate.sh compile-device`. Physical
camera checks need a real iPhone. The repository permits only its existing
canonical iPhone simulator; use a physical iPad for tablet captures rather
than creating another simulator in that constrained environment.

Use an authorized demo account with fictional player details and approved
recordings. Check the active player and intended results/plan. Exclude private
identifiers, exact locations, coaching notes and unapproved media. Do not write
fabricated records to a real athlete. Let data finish loading and dismiss
keyboards, debug overlays, errors and permission prompts.

## Capture sequence

Native source establishes **Profile / AI Coach / Drills / Training /
Leaderboards**. Older architecture notes have stale tab names.

| File key | Source and route | Required view and orientation |
| --- | --- | --- |
| `01-evidence` | Profile; `StatsView.swift` and embedded `AthleteStatsView.swift` | **Portrait.** Populated athlete overview and approved sample identity. Scroll to the intended content; do not splice screens together. |
| `02-tests` | Drills; `DrillsView.swift` | **Portrait.** Two-column chooser. Native labels include Shooting, Sprint, Jump, Broad Jump, Dribbling, Change of Direction, Free record and Drill Settings. Preserve the actual extra options; the marketing headline counts six performance tests. |
| `03-replay` | Drills → Sprint → completed session/rep → analysis; `SessionAnalysisView.swift` | **Landscape on both devices.** Select an approved rep with available pose data, wait for analysis and pause at a useful frame. Portrait asks the user to rotate. Preserve the actual analysis/playback controls. |
| `04-focus` | Profile → skill map/category details; `AthleteStatsView.swift` | **Portrait.** Show the selected category and available measured results. Retain missing-data and estimate labels where applicable; no invented scores. |
| `05-session` | Training → existing workout → guided player; `TrainingHubView.swift`, `WorkoutPlayerView.swift` | **Portrait.** Use a player permitted to execute the demo workout. Show real instructions, sets and working/rest state. A coach walkthrough must keep its walkthrough labeling. |
| `06-retest` | Drills → Sprint dashboard/history; `DrillDashboardView.swift` | **Portrait.** Approved history across sessions with actual dates, units, chart/list and selection state. Improvement is not required; the claim is comparison over time. |

Confirm exact taps and permissions on the selected binary. Preserve its bottom
navigation and real tablet adaptation. Do not add marketing emoji to native UI.

## Pose and replay checks

Prefer a genuine MediaPipe-33 recording with facial, hand and foot landmarks.
The native loader also supports COCO-17 with padding: 33 array slots alone do
not establish 33 detected joints. Preserve native missing-data treatment and
source aspect ratio. Do not paint extra joints onto app captures or imply video
is available for every recording.

The authored preview uses sanitized recorded homepage poses with all 33 points
and canonical 35 connections. It is a documented illustration, not an app
capture or new cloud analysis. Final captures must show what the shipping
native renderer actually displays.

## Files and composition

Keep original PNG files at full device resolution. Save five portrait files and
one landscape replay file per family under ignored `screenshot-input/iphone/`
and `screenshot-input/ipad/`, using the table keys as filenames.
`03-replay.png` is landscape. Do not rotate it into portrait or distort it;
the compositor fits landscape analysis inside the portrait marketing canvas.

Final gallery sizes are **1320 × 2868** for iPhone and **2064 × 2752** for iPad.
Keep canonical 1206 × 2622 simulator originals when applicable and fit them
proportionally. These final dimensions are listed in
[Apple's screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications).
Confirm the exact device slots in Connect.

Input validation accepts PNG or JPEG but retains PNG as the recommended original.
It requires a short side of at least 1170 pixels for iPhone and 1640 pixels for
iPad, and checks orientation and screen aspect ratio. Supply the full actual
screen, not a crop or a device-frame composite. Image checks cannot establish
authenticity; verify the original capture provenance yourself.

Copy `gallery-input.example.json` to `gallery-input.local.json`. File paths
resolve relative to that JSON. Supply every panel under both `iphone` and
`ipad`; enter the real `buildNumber`. Record release commit, marketing version,
device/OS, capture date and demo-data source in `captureProvenance`. Set
`currentBuildConfirmed` and `privacyReviewed` true only after those checks.

From `brand/app-store`:

```sh
npm ci
npm run render -- --input gallery-input.local.json
node validate-gallery.mjs
```

The current input example is the schema of record. Inspect the generated
manifest and every image at full size and thumbnail size. Composition is a
candidate for final review; it does not grant submission approval.

## Acceptance

- Six genuine captures from each family show the intended release; only replay
  is landscape within its portrait marketing canvas.
- Text, controls, charts and full movement figures are legible and unclipped.
  All screenshots retain their actual aspect ratio and interface.
- Gallery and copy describe features in the submitted binary. No preview
  illustration or invented metric is presented as a native screenshot.
- Media rights, demo-data approval and provenance are recorded. Originals and
  account details remain outside public Git.
- Taiyo checks the processed build, screenshot slots and product page before
  submission.

Existing website `images/appKickRecording.png` is a calibration capture with
unverified current-build parity. September 8 native demo captures mostly show
empty comparison/review states. Neither provides this complete release set.
`MobileAppPreview.tsx` is a website illustration, not an iPhone capture.

Apple guidance checked September 18, 2026:
[screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
and [accurate metadata](https://developer.apple.com/app-store/review/guidelines/#accurate-metadata).
