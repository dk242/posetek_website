# Release-build screenshot capture brief

The authored gallery is a review concept until the sample interface illustrations
are replaced with genuine captures from the intended App Store binary. The
current source supports both iPhone and iPad (`TARGETED_DEVICE_FAMILY = 1,2`).
Do not stretch iPhone captures into iPad screenshots.

Use an authorized demo account with fictional player details and approved demo
recordings. Preserve the actual app UI and avoid real athlete identities, exact
locations, private coaching notes or other unapproved personal data.

| Order | Story | Capture from the real app | What to check |
| --- | --- | --- | --- |
| 01 | Start with evidence | Player Profile overview | Five skill areas, readable results and clear sample identity |
| 02 | Six tests. One picture | Drills list | Shooting, sprint, vertical jump, broad jump, dribbling and change of direction |
| 03 | Look closer at every rep | Session replay/analysis | Approved demo clip, visible movement overlay and recorded metrics; no loading/error state |
| 04 | Find your next focus | Athlete profile skill map | Values available in the release build; no invented scores or decorative improvements |
| 05 | Turn focus into a session | Training workout player | Exercise instructions, sets and rest as actually shipped |
| 06 | Retest. See what changes | Results history/trend | Recorded demo results across sessions; do not manufacture a gain |

Capture each screen at full device resolution, in the same orientation, on the
actual chosen release build. For iPhone this package exports the accepted
1320 × 2868 portrait gallery size. If the existing canonical simulator produces
1206 × 2622 captures, retain those originals and proportionally fit them within
the authored device frame; do not distort the UI. Follow the mobile repository's
single-simulator rule rather than creating extra devices for this task.

For iPad use true tablet captures and the 2064 × 2752 portrait layout. Verify the
app's real iPad support and orientation in App Store Connect before upload.

Before a submission candidate is considered ready, replace all sample screens,
review each exported image at full size and listing-thumbnail size, and confirm
the gallery exactly matches features available in the submitted binary. The
generator's input mechanism and output manifest keep review previews separate
from native-capture exports.

The existing `images/appKickRecording.png` is an authentic 1206 × 2622 calibration
screen but its current-build parity is unverified. Four September 8 native demo
captures in mobile `tools/kick_analysis/results/2026-09-08/` show mostly empty
comparison/review states. They are useful reference evidence, not a complete
promotional screenshot set. Website `MobileAppPreview.tsx` is explicitly a web
illustration and must never be labeled a captured iPhone screenshot.

Apple references checked September 18, 2026:
[screenshot dimensions and no-alpha requirement](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications),
[accurate metadata and screenshots](https://developer.apple.com/app-store/review/guidelines/#accurate-metadata).
