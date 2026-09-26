# Player and coach experience

Published September 25, 2026. Manual/AI personal creation, tracking, coach history and scoped reporting are live. See [the verified production receipt](../deployment/PLAYER_COACH_EXPERIENCE_PRODUCTION.json). Temporary synthetic verification accounts and records were removed. No real athlete plans, invitations or content approvals were changed.

The user explicitly requested personal creation live and authorized deployment independently of native UI acceptance. Native candidate `bc492aa` remains uncompiled/unreleased; the submitted App Store build is unchanged. The separate whole-body mobile acceptance gate remains false.

## Confirmed product decisions

- Keep PoseTek's dark green surfaces, readable neutral text and lime primary
  actions. This pass changes the signed-in player and coach workflows; public
  Players and Coaches marketing remains protected.
- Players can build a standalone workout manually or request an AI proposal,
  review it and explicitly save it. No multiweek program is required.
- Fine-tuning an assignment creates a personal copy. It never changes the coach's
  prescription or completes its assigned slot. Saved personal work can be edited
  before starting; a started session keeps its immutable prescription.
- Coaches select their assigned team, review each player's context, prescribe an
  individual plan and explicitly activate it through the existing planner.
  Administrators retain oversight. There is no additional mandatory admin
  approval, coach/player messaging or one-size-fits-all team prescription.
- A browser timer recovers from lock/unlock and reload using persisted timestamps.
  Optional screen wake lock keeps a visible page awake when supported. No push
  notifications or native lock-screen timer are promised by the website.

## Source of truth

The [coach workflow](COACH_WORKFLOW.md) describes onboarding, team ownership,
draft review, activation and progress review. Current canonical organization
membership and the player's organization/team fields determine coach access;
historical coach mirrors do not override a migrated roster.

| Component | Release source |
| --- | --- |
| Website player, coach and reporting UI | `posetek/posetek_website`, main `587c5b5` |
| Job validation, personal workouts, AI, shared workload | `posetek/posetek-backend`, main `2f0b076`, `Services/agent-gateway/` |
| Published canonical access rules | `posetek/posetek-mobile-app`, main `46cfeb4`, `firebase/` |
| Unreleased native UI follow-up | `posetek/posetek-mobile-app`, `personal-workouts-experience`, `bc492aa` |

The former `Athelytics/python-video-processor` repository redirects to
`posetek/posetek-backend` (confirmed by GitHub during the candidate push).
The former `athelyticsOG/posetek-mobile-app` similarly redirects to
`posetek/posetek-mobile-app` (confirmed during its feature-branch push).
The required shared website repository `dk242/posetek_website` redirects to
`posetek/posetek_website`; its feature-branch push reached that shared repository.
`Services/agent-gateway/PERSONAL_WORKOUTS.md` in that repository is the shared
personal-workout wire contract. The website does not carry a gateway/rules copy.

Reviewed source checkpoints: backend `f70b00d` and native `bc492aa` (including
canonical rules `4aec5c1`). Native handoff lives at
`docs/plans/personal-workouts-experience.md` in its repository. Thirteen new
XCTest cases are authored but have not run on this Windows host. Swift structural
parsing and independent contract review passed; Xcode compilation and current
device acceptance remain outstanding. New native personal sessions do not yet
emit Live Activities; the existing assigned-workout support is unchanged.

## Player flow

Training starts with the next assigned workout, Create workout and History.
Personal workouts remain separate from assigned slots. A builder confirms actual
age, equipment, partner setting, date and pain/restriction context; it offers only
eligible published catalog drills. Sets, amount, rest and ordering can be edited.
Review shows the resulting dose and time before saving. AI produces an unsaved,
checked proposal through the same catalog/workload constraints.

AI Coach has a persistent tab, editable prompt suggestions, readable progress
messages and a recover-saved-conversation path after an interrupted reply.
Its existing workout handoff carries unsent text into the standalone builder.
Community remains available from the header and old feed links redirect safely.

Guided execution preserves set position, active time, rest, pause and pain-stop
state across reloads. A second tab must explicitly take over a session. Returning
from phone lock reconciles wall-clock timestamps; leaving Training pauses the
local clock. Inactivity remains capped at 30 minutes. Optional wake lock is
requested only while the page is visible and running and is safely reacquired.

Personal mutations persist their stable request/job identity before submission.
Recovery reuses the accepted action rather than issuing a new workout or charging
another AI request. Server acknowledgements, pinned revisions and immutable
started snapshots determine the displayed saved state.

`personalWorkoutsEnabled` and `globalEnabled` must both be literal `true`, with
each required capability explicitly enabled and a positive integer
`dailyLimitPerUser`. Deterministic save/start/update have ordinary abuse limits;
only AI generation consumes the existing shared adjustment allowance. Missing
configuration does not query the new player collections or expose usable actions.

Personal records use their own `personalWorkouts`/`personalWorkoutLogs`
collections with `source: personal`, schema 1 and no persisted `planId`.
The guided-player adapter's reserved local identifier is not a Firestore plan.
Coaches see saved personal activity only after the rollout flag; private AI
proposals and operation journals are not part of coach history.

## Reporting

Coach history and Insights use the pinned session prescription. Completing a
session and completing every set remain separate. Active timer time is labeled
separately from legacy elapsed estimates. Personal completed, stopped and pain
endings are distinct; they never satisfy an assigned slot. Separate duplicate
identities keep an assignment and its personal copy from merging.

Insights projection revision 3 reads both log collections, keeps the combined
operational bound, and invalidates on personal-log writes. Publish the existing
Insights invalidation/rebuild entrypoints with this change before enabling the
feature; stale revision-2 projections rebuild through the existing interface.

## Design reference lock

Refero Design's bundled craft and visual-workflow references were used because
live Refero tools were unavailable. The dominant target is the existing PoseTek
native Training and web portal design. The existing Insights workspace supplies
scope, freshness and unavailable-state patterns. This is a direct implementation
within the current product, with no new decorative imagery.

| Choice | Reference / reason |
| --- | --- |
| Profile, AI Coach, Drills, Training, Standings navigation | Native player structure and user's actionable-AI request |
| Next-session action above plan details | Native Training flow; prioritize doing the workout |
| Large primary action, 44px controls, 16px inputs | PoseTek tokens and Refero touch/typography guidance |
| Stacked drill and roster records | Existing mobile portal; readable labels at phone widths |
| Explicit review/save and elapsed/rest labels | User's workout workflow; prevent ambiguous saved/timed state |
| Distinct personal and assigned history | User's personal-copy decision and canonical reporting contract |

## Validation and rollout

The website suite passed **94 files / 1,116 tests**. Subsequent personal-workout
recovery fixes passed 64 focused tests; the final coach workspace passed 82 tests.
TypeScript passed on the final frontend source. Lint completed without errors,
with existing and React optimization advisories remaining. Release composition,
navigation and baseline preservation checks passed **28 tests**.

The guarded application release build passed from website code `dd613fe`.
It verified all 899 baseline entries, then replaced only the application entry,
retaining 898 protected files (107,423,919 bytes) and all 32 current marketing
files (6,082,347 bytes), with 58 added application assets. Independent output
verification matched all 930 preserved entries. The new `/application.html` is
1,309 bytes, SHA-1 `504fe1b0fe49be8a28a1814b1e02dae3f54d35c9`. Generated output and
build receipts remain ignored; this is a local build, not a publication receipt.

The paired canonical rules passed **1,051 emulator tests**; all seven website
rules suites passed against those exact files. Firestore SHA-256:
`19575e5cf2be607e848d4259325af91500f45c1549ddb4f7ed1e7975cec4730b`.
Storage remains unchanged:
`1da8799ec5f785c1a43330342f895fef76774622b32bbf48853b45bc3e4bf3eb`.
The gateway passed 1,823 tests, followed by its 18 focused personal-workout tests
after the explicit global gate adjustment. Three private-history fixtures in the
website's 46 reporting tests are unavailable; the other 43 pass.

Browser checks use clearly labeled synthetic local previews. Verified flows
include phone-width coach roster/history, AI suggestion editing and Training
handoff, and manual create → dose review → save → start → set → pause → early
finish. They do not claim a real account was exercised or a physical phone locked.
Responsive review covered 360, 390 and 430 pixels and desktop. Training, builder
and coach history did not overflow horizontally. Opening a player resets the
dashboard scroll position. Local screenshots are kept outside Git under
`.netlify/player-coach-review/`: `player-training-430.png`,
`player-builder-430.png`, `player-ai-coach-390.png`, `coach-roster-430.png` and
`coach-history-430.png`, plus `coach-roster-desktop.png` at the normal desktop
viewport. Local review tabs are `/athlete?preview=1&view=training` and
`/dashboard?preview=1` on the Vite server; they are not hosted production pages.

The legacy mobile parity receipt is updated to `b980de4` after reviewing the
WorkoutStore listener recovery changes and additive gateway contract amendments.
Its eleven UTF-8 sources and benchmark data match after LF normalization; Windows
checkout line endings no longer produce a false contract change. The receipt
does not certify the new native personal-workout UI or Xcode compilation.

## Confirmed production release

The exact verified draft `6ab723a4b245cdd9426dc47a` was promoted after canonical rules publication, scoped reporting verification and gateway release from pushed main. Manual create/edit/start/partial-save/early-finish, idempotency and stale-revision checks passed against production. Live AI generation produced an unsaved proposal and explicit save persisted it. An initial AI tool-schema omission was corrected in gateway main `2f0b076` and released through the canonical full-test pipeline.

Authenticated browser review covered the mobile player builder and personal history, assigned-team coach dashboard, preserved prescription/outcome history, and selected-player planner handoff. Canonical coach scope and membership revocation were also checked against production. Physical-phone lock/unlock and the native candidate were not tested here. Browser timer recovery does not provide iPhone Live Activities.

Final frontend validation: 94 files / 1,122 tests and TypeScript passed. Canonical rules: 1,051 emulator tests, 55 deployed checks and zero unresolved identities. Scoped Insights publication verified all eight functions and preservation of unrelated functions. The production file inventory matched the built artifact. Refer to the receipt for revisions, checksums and rollback.

Future releases must retain the guarded application build, verify a draft and promote that exact deployment, then reconcile the baseline. Publish gateway only from pushed backend main through `release.sh` and rules only through native `firebase/operations.py publish`. Preserve explicit plan activation, current team scope, personal/assigned separation, and the whole-body review hold.

The older September 16 marketing snapshot fails the current live-page check and
must not be reused. Current marketing was captured from the immutable September
24 deployment and compared with the live site: 32 files, 6,082,347 bytes. Original
homepage bytes match the protected filename alias at SHA-1
`e4d2dfc372f5554ba31be85fefffac6f1b467847` (2,530 bytes); Coaches remains
`0581430222a96caf034d1d6099adff7d4c68236d` (2,489 bytes). Netlify's served homepage
rewrites the noscript link, so its served checksum is recorded separately. The
local manifest and verification receipt are ignored
`.netlify/current-marketing-snapshot.json` and
`.netlify/current-marketing-verification.json`. Refresh against the then-current
approved release on a fresh publishing checkout; never disable the guard.

Browser capability references: [Apple ActivityKit](https://developer.apple.com/documentation/ActivityKit)
and [Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).
