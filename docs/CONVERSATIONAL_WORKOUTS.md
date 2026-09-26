# Conversational workouts and Community navigation

September 25–26, 2026 implementation. Publication evidence is recorded in the
release receipt after the guarded production workflow completes.

## Athlete experience

Personal workouts → Create workout opens a dedicated conversation. The athlete
supplies a focus and available time. Explicit age, equipment, partner setting and
pain/restriction statements carry forward; only missing conditions are requested.
No active plan is required. Drill selection, dosage and ordering are read-only
prescriptions. Follow-up requests revise the current server proposal, retaining
earlier constraints and unaffected prescription details.

Time remains an approximate target with the existing tolerance. The review shows
requested and calculated minutes, including rest and transitions. Publish workout
saves the reviewed proposal into Personal workouts and opens its Start detail.
The current schedule and catalog eligibility are revalidated. Failed refinements
retain the last valid proposal. Expired or past-date drafts can be refreshed through
the conversation and its training-date control.

The web AI Coach opts into `personalWorkoutFlowVersion: 1`. Its authorized workout
request includes a stable originating conversation/message identity. After any
missing conditions are supplied, the same personal generator creates an actual
prescription and links it to that assistant message. Review in Training opens the
existing private conversation; it does not regenerate the workout. History and
refresh recover through server readback, with only identifiers cached locally.

Published unstarted workouts continue the same conversation. A new revision
requires explicit republication into the same saved workout. Started workouts
create a new personal copy from the immutable session snapshot. Assigned workouts
retain personal-copy behavior and cannot be changed by the athlete.

## Contract and source of truth

The existing `generate_personal_workout` and `save_personal_workout` jobs remain
the command interface. Optional generation references are `conversationId`,
`baseProposalId`, `originConversationId`, `originMessageId`, and
`copyFromWorkoutId`. Ownership, paired identifiers, origin authorization and
current proposal references are validated by the canonical gateway.

Server-written private `aiConversations`/messages persist bounded conversational
history. Immutable `personalWorkoutProposals` store the prescription, requested
minutes, requirements and revision. Conversation metadata identifies the latest
proposal and the exact published proposal/workout. Saved workouts link back with
`personalConversationId`. Prompts and transcripts are excluded from published
workouts and reporting. The creator-private rules must be published before the
gateway creates the new conversation capability.

Publish loads the reviewed server proposal, checks the latest revision, and
transactionally binds it to one personal workout. Different request IDs and
competing tabs cannot publish duplicates. Old manual clients and native schema
contracts remain compatible; the website no longer exposes manual drill editing.
Existing quotas, coaching visibility, sharing permissions and assigned logs remain
in place. No Insights or social callable redeployment is required for this change.

## Shared player navigation

`PlayerShell.tsx` provides the shared header and six equal bottom destinations:
Profile, AI Coach, Drills, Training, Community and Standings. Community uses this
shell for normal athlete views, including loading and error states. Activity,
Find people and Sharing settings live in an accessible content toolbar with
URL-backed panel state. `/feed`, `/feed.html`, connection/activity links,
sign-in returns, query context and Back remain supported. Authorized staff and
scoped read-only administrator previews preserve their navigation boundaries.

Leaving Training dispatches the existing pause/persistence event. Workout sets
and timer state remain recoverable on return; private workout conversations are
recoverable from their history and URL identifiers. Browser wake-lock/timer
limitations remain as documented in the player handoff; this release adds no
native lock-screen activity.

## Validation and release

Use website tests/TypeScript, exact canonical rules emulator and website rule
suites, and gateway tests. Inspect the conversation, prescription, Community
panels and navigation at 360/390/430px and desktop. Exercise AI Coach handoff,
revisions, publish/replay, refresh/Back, expired/schedule/ownership changes and
session recovery using temporary accounts. Remove all synthetic records,
including conversation message grandchildren, and verification accounts.

Gateway publishing is only `Services/agent-gateway/scripts/release.sh` from clean
pushed backend main. Rules publishing is only native `firebase/operations.py
publish`. Website publication uses the guarded application build with approved
marketing bytes, verifies a draft, promotes that exact deployment, then
reconciles the protected baseline. Source and receipt merges use `[skip netlify]`
to avoid an ordinary marketing-only build overwriting the application release.

The App Store submission, native UI release, catalog/media approval and false
whole-body mobile acceptance gate remain outside this adjustment.
