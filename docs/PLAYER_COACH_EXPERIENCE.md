# Player and coach experience candidate

September 25, 2026. Source implementation and review handoff; **not deployed**.
The new personal-workout capabilities remain disabled in production. No athlete
plans, coach accounts, invitations, training approvals or production settings were
changed for this work.

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

| Component | Candidate source |
| --- | --- |
| Website player, coach and reporting UI | `dk242/posetek_website`, `codex/player-coach-experience` |
| Job validation, personal workouts, AI, shared workload | `posetek/posetek-backend`, `codex/personal-workouts-experience`, `Services/agent-gateway/` |
| Native follow-up and canonical access rules | `athelyticsOG/posetek-mobile-app`, `personal-workouts-experience` |

The former `Athelytics/python-video-processor` repository redirects to
`posetek/posetek-backend` (confirmed by GitHub during the candidate push).
`Services/agent-gateway/PERSONAL_WORKOUTS.md` in that repository is the shared
personal-workout wire contract. The website does not carry a gateway/rules copy.

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

The legacy mobile parity receipt is updated to `b980de4` after reviewing the
WorkoutStore listener recovery changes and additive gateway contract amendments.
Its eleven UTF-8 sources and benchmark data match after LF normalization; Windows
checkout line endings no longer produce a false contract change. The receipt
does not certify the new native personal-workout UI or Xcode compilation.

Required release sequence:

1. Review the paired source branches and rerun their recorded checks. Build the
   native candidate through the owned primary Mac checkout and complete physical
   iPhone acceptance; preserve the submitted App Store build.
2. Publish canonical rules only through `python firebase/operations.py publish`,
   with its current reviewed live snapshot, identity audit and exact test receipt.
   Coordinate the rules main merge/push with publication to preserve the drift
   monitor. Never deploy rules from this website.
3. Release the gateway from pushed backend main using
   `Services/agent-gateway/scripts/release.sh`, and publish the changed Insights
   functions through their existing scoped release workflow.
4. Build/preview the website using `scripts/build-application-release.mjs` with
   the verified approved marketing snapshot and the current live baseline guard.
   Review authenticated player/coach/admin paths, including distinct teams and
   revoked membership, without manufacturing production training as test data.
5. Enable the personal capability group only after the shared acceptance gates
   pass. Preserve the separate false whole-body mobile acceptance gate and all
   80 unpublished exercise drafts.

On September 25, the connected Netlify project and committed baseline both
identified current release `6ab5e409d3ca5da40c5c01d2` (published September 24 at
8:04:50 PM PDT), with 899 protected application/public entries. This candidate
does not replace that production record. The local Netlify CLI is signed out;
no deploy was attempted through a different publishing route.

Browser capability references: [Apple ActivityKit](https://developer.apple.com/documentation/ActivityKit)
and [Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).
