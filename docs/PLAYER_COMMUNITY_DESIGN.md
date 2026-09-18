# Player experience: reference lock

The approved second pass replaces the first pass's container-preservation rule.
The user requested the mobile application's layout, symbols, content, colors,
logo and interactions, with separate AI Coach and Training tabs. Native source
`e2c37363ca0f29e068dcb65fbd373d94f3120fad` is the dominant reference: active
`CoachPlayerView → StatsView`, Drills, Training Hub, workout player and coach.
Dead native `PlayerView`/`PlayerProfile` experiments are not a target.

## Research and decisions

Refero's public style references were reviewed directly (the live Refero MCP is
not configured). Existing PoseTek screens remain the dominant reference.

| Decision | Reference | Role and adaptation |
| --- | --- | --- |
| Native hierarchy, brand and symbols | Active PoseTek native source | Profile hero/skill map, eight-tile Drills chooser, native dashboard, training rail/rings, anchored workout and full-height coach. |
| Crisp lime action/selection treatment | [Refero .SWOOSH](https://styles.refero.design/style/604af0f7-b4c3-4921-93af-9da03df81493) | Borrow accent discipline, not promotional typography, full-bleed layouts or 6px radii. Retain PoseTek lime. |
| Distinct green surfaces and quiet borders | [Refero Assurestor](https://styles.refero.design/style/0ed40a3a-2541-4ffa-acdd-f1170858bc5d) | Preserve native green layers, translucent borders and rounded cards. |
| Legible contrast and compact controls | [Refero Modal](https://styles.refero.design/style/68c15685-5db9-4869-b71d-27240568c9d8) | Keep a restrained dark UI and reserve vivid fills for actions. |
| Scrolling video and reduced-motion fallback | User request; Refero bundled motion/craft guides | One visible clip plays muted; prior clip pauses. Manual play under reduced-motion/data-saving preferences. Rep chart stays below video. |
| Recorded video effects | Native pose/timing plus user request | Exact-recording skeleton, confidence gaps, foot trails and saved event markers; no invented tracking. |
| Stable chronological feed and chosen audiences | Official Strava feed ordering and Instagram Following references in the approved plan | Preserve reading position, explicit refresh and user-selected scopes. |

## Build target

Five shared tabs: **Profile / AI Coach / Drills / Training / Feed**. Feed is the
intentional web extension; team standings remain in Profile. Capture, calibration,
camera settings and new scans remain app-only.

Native semantic colors: dashboard/action lime `#7cff18`, menu/navigation green
`#38aa6a`, cyan `#20c8dc`, orange `#ff8c33`, chrome `#081816`, white text and
translucent secondary text/borders. Match native screen-specific gradients and
system/rounded typography. Browser SVGs represent native symbols without Apple
font binaries. The logo uses the app's P tile and spaced wordmark.

Global Coach is a separate destination; workout/drill coaching uses a labeled
Training sheet. Suggestions fill an editable draft. Plan changes retain review
and activation. Work, rest and session timers have separate meanings; time alone
never marks a set completed.

Video and pose publication each require an explicit choice. Drawing data is
bounded and excludes private artifact links. Missing tracking, dimensions or
exact binding leaves authorized video playable without effects. Preview clips
are approved public demonstrations labeled separately from sample measurements.

## Validation target

Compare Profile, body view, skill details, standings, Drills chooser, dashboards,
sessions/replay, Training, workout/detail/history/coach sheets, AI Coach and Feed
at 360/390/430px and desktop. Check return paths, timers, tab retention, video
lifecycle, chart placement, focus and overflow. Source audit findings and
intentional differences are in `PLAYER_COMMUNITY_NATIVE_AUDIT.md`.

Source-grounded implementation and desktop phone-size review do not establish
pixel identity or physical iOS/Android acceptance. Signed-in media and real
keyboard/safe-area acceptance remain rollout gates.
