# Player website: native source mapping

This audit pins the native reference to `posetek-mobile-app` commit
**`e2c37363ca0f29e068dcb65fbd373d94f3120fad`** on
`codex/testing-audit-remediation`. Native paths below are relative to that
repository; web paths are relative to this repository. The implementation is a
source comparison and browser adaptation, not a claim of pixel-identical SwiftUI
rendering or physical iPhone acceptance.

The active player route is `KickAI/KickAIApp.swift` →
`PlayerCoachNavigationShell` → `CoachPlayerView`. The old `MainTabView` is not the
screen reference. Native `CoachPlayerView` has Profile / AI Coach / Drills /
Training / Leaderboards. The confirmed website order is **Profile / AI Coach /
Drills / Training / Feed**, with team standings reachable from Profile. Full
native screen structure, section placement and visual treatment are the target;
the earlier instruction to preserve the old website's containers is superseded.

In the table, `player/` and `views/` mean
`app/src/pages/athlete-portal/player/` and
`app/src/pages/athlete-portal/views/` respectively.

| Screen | Pinned native source | Addressed website differences and source | Known limits / deliberate adaptation |
| --- | --- | --- | --- |
| Shell and navigation | `KickAI/CoachView/CoachPlayerView/CoachPlayerView.swift`; `StatsView.swift` brand/theme | `player/PlayerExperience.tsx`, `player/native-ui.tsx`: five ordered icon tabs, P/POSETEK header, dark green surfaces and lime accents; drill navigation has a distinct landing destination. | Feed replaces the native Leaderboards tab by request. Browser history and retained drafts/running-workout pause need phone acceptance. Browser SVG icons approximate SF Symbols; they are not unrelated emoji substitutions. |
| Profile | `KickAI/CoachView/CoachPlayerView/StatsView.swift` | `player/PlayerProfile.tsx`, `player/native-results.css`: body/club/identity hero, skill map and D1 comparison, lime Streak / cyan Sessions / orange Favorite Drill cards, standings and technique entry. | Body and club content depend on saved authorized data. Unavailable measurements must stay unavailable; body capture and calibration remain native. |
| AI Coach | `KickAI/LLM/AICoachTabView.swift` | `player/CoachChat.tsx`: native-styled conversation, existing gateway requests and Training handoff retained inside the shared player shell. | Website preserves the shared gateway's capabilities, permissions and limits; styling does not grant additional generation rights. |
| Drills landing | `KickAI/CoachView/CoachPlayerView/DrillsView.swift` | `player/PlayerDrillMenu.tsx`, `player/native-results.ts`: native question header, soccer figure, two-column grid, leading icon discs, chevrons and accent underlines. Seven supported drill cards plus Drill Settings. | Shooting = soccer ball; Sprint = runner; Jump/Broad Jump = jump rope; Dribbling = soccer figure; Change of Direction = turning arrow/diamond; Free Record = video; Settings = gear. Settings opens a truthful native-only information sheet, with no fabricated app link. |
| Drill dashboard | `KickAI/DrillDashboard/DrillDashboardView.swift`; `PoseTekDashboardComponents.swift` | `views/NativeDrillDashboard.tsx`: 220px lime chart, time range picker, horizontal icon/value/label metrics, shooting technique entry, selectable Latest Sessions and rep links. `player/native-results.ts` supplies measured-only session means, small-history rep points and selected-session rep charts. | This is the current unified green/lime native dashboard, not the unused legacy per-drill red/blue/orange palette. Web metric cards are 116px rather than the native 122px portrait width; session rows use browser scrolling. Recording stays in the app. |
| Drill metrics | Same dashboard source | Shooting shows average/max speed, launch angle, dominant foot, left/right counts, total and trend. Sprint/Jump/Broad Jump show four summary values; shuttle drills show time, distance, phases, totals and trend; dribbling adds ball distance. | Accepted corrections, qualification, duplicate suppression and canonical units remain authoritative. Dribbling dashboard ball distance is feet; missing values are not zero. Free Record has no fabricated performance chart. |
| Session replay | `KickAI/SessionViewer/PoseTekSessionScaffold.swift` and drill-specific viewers | `views/SessionView.tsx`, `app/src/components/PosePlayback.tsx`: rep strip, saved video/pose, frame steps, play/scrub/speed, valid marker jumps, metrics and joint inspection in native-styled cards. | Generic browser replay does not port every native drill-specific analyzer, professional overlay, velocity plot or local processing control. Unknown pose timing remains unavailable rather than guessed; exact saved capture binding is preserved. |
| Technique | `StatsView.swift` → `PoseTekAnalyzeKickView` and technique cards | `player/TechniqueAnalysis.tsx`, `TechniqueReplay.tsx`: recorded-kick selection, saved/pending/failed states, authorized kick analysis, evidence-linked guided review, published coach feedback and saved left/right comparison review. | Creating comparisons still follows existing staff permissions. Unsupported evidence and missing professional artifacts do not become invented comparison visuals. The native specialized walkthrough is not fully identical. |
| Training and intake | `KickAI/TrainingHub/TrainingHubView.swift`, `PlanIntakeFlowView.swift`, `CatalogDrillDetailView.swift` | `player/PlayerTraining.tsx`, `ProgramIntake.tsx`, `DrillMedia.tsx`: native-style training sections, weekly progress, active-plan explanation, exercise detail and history links, graceful instruction-media fallback. | Preserve intentional web draft/activation planning and reviewed schema-3 plans. No gateway, cohort-plan or native daily-limit changes. Missing exercise video keeps written instructions available. |
| Workout execution | `KickAI/TrainingHub/WorkoutPlayerView.swift`; `KickAI/TrainingPlans/WorkoutRuntimeSnapshot.swift` | `player/PlayerWorkout.tsx` and runtime helpers: pause/continue, account-scoped restoration, old-plan snapshot resume, correct completed reload, route-leave pause, cross-plan ad-hoc weekly credit and session links. Successful completion offers explicit Feed sharing. | A saved workout is not automatically published. Physical-device background/foreground behavior and interrupted-network completion still require acceptance. |
| Standings | Native Leaderboards destination from `CoachPlayerView.swift` | `player/PlayerLeaderboards.tsx`, `native-results.css`: Profile entry, native-styled podium/list and drill selection. | Team/organization access and qualified scores remain unchanged; there is no new public ranking entitlement. |
| Feed and media | Deliberate website extension using the native brand and replay vocabulary | `app/src/pages/feed/FeedPage.jsx`, `FeedMedia.tsx`, `media-playback.ts`, `pose-overlay.ts`: activity, comments/kudos, explicit sharing, rep chart below video, one visible muted autoplay clip, consented saved pose outline and foot trails. | Native has no equivalent fifth-tab feed in this source. Reduced motion/data saving use manual playback. Pose needs separate explicit per-post consent; no ball/pro effects are invented. Missing/ambiguous pose leaves authorized video usable. See the backend contract below. |

## Visual and data boundaries

The native Drills landing uses a common `#38aa6a` accent; dashboard/profile
surfaces use deep greens (`#041610`, `#062016`, `#082417`), lime `#7cff18` and
comparison cyan `#20c8dc`. Rounded translucent cards, leading icons and small
labels follow the active native source. A responsive browser must still support
text enlargement, touch targets and safe-area insets. Preview fixtures are sample
content, not evidence that an athlete has recorded those results.

The athlete `playerMode` branch in `views/DrillDashboard.tsx` selects the new
dashboard; existing coach/admin dashboard behavior is separate. Capture setup,
camera/gate calibration, high-frame-rate recording, local retention/processing
and new body scans remain native. Marketing, shared planner semantics,
qualification, existing account hierarchy and production release receipts are
outside this visual mapping.

## Media contract and verification

[Community backend handoff](../functions/SOCIAL_COMMUNITY.md) documents exact
capture selection, separate pose consent, authorization rechecks and the additive
`getSocialMedia(includeOverlay:true)` projection. Pose input is bounded to 16 MiB
with generation-pinned streaming; metadata remains bounded to 2 MiB. Public
output is at most 300 frames / 33 joints / 200 KiB, with recorded video timing and
normalized coordinates, never raw private artifacts or processing context.

The focused backend overlay review passed **85 tests** with no failures/skips
across social, community, effective-results and overlay suites. The two pure
frontend suites passed **55 tests**, covering playback selection and overlay
validation/interpolation/dropouts, including direct backend-to-client COCO17 and
MediaPipe33 compatibility. These counts are scoped regression runs, not the
complete application's test count and not physical-device validation.

Before release, complete real authenticated owner/nonowner checks and phone
acceptance: tab return from Coach/Training, retained drafts and paused workouts,
portrait/landscape replay alignment, actual high-frame-rate footage, muted
autoplay handoff/manual controls, missing pose, consent/access revocation,
five-minute lease expiry and account changes. Follow the existing community
rules/indexes, migration and scoped deployment gates; this overlay adds no
Firestore or Storage rule change. Native TestFlight validation remains Taiyo's
separate release gate.
