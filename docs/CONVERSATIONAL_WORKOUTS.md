# Conversational workouts and Community navigation

Published September 26, 2026 at 12:31:38 AM PDT as deployment
`6ab76982d74a19707a6f9d9a`, from website source `9b15c40`. The verified candidate
was promoted without rebuilding; all 1,048 artifact files match and the baseline
protects 1,016 application/public files. The final gateway and canonical private-
conversation rules are live. Production browser verification and the ordinary
preservation guard passed, and synthetic verification cleanup is complete in the
[release receipt](../deployment/CONVERSATIONAL_WORKOUTS_PRODUCTION.json).

The subsequent [confirmed training access release](../deployment/CONFIRMED_TRAINING_ACCESS_PRODUCTION.json)
adds five visible setup tabs before generation and checks today's resources at
personal Start/Resume. Explicit resource changes revise unavailable drills while
preserving suitable prescription details; they cannot publish an old draft under
new conditions. Read [the current resource workflow](CONFIRMED_TRAINING_ACCESS.md)
for confirmation, revision and recovery details. The numbers below remain the
historical acceptance record for the conversational-navigation release.

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
refresh recover the authoritative proposal through server readback. Local
proposal selection stores identifiers only. The durable pending-request outbox
temporarily retains submitted parameters alongside stable request/job IDs so an
accepted action can be retried safely.

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

The personal generator preserves the seeded valid draft during refinement and
copy operations. A personal-only tool guard rejects a destructive replacement
when the request requires keeping the existing drills; explicit replacements,
other intermediate edits and dosage changes retain their existing behavior.
Native generation is unchanged. The shared persistence helper explicitly checks
for a non-null transaction because an empty Firestore transaction is false in
Python; reads must remain inside its snapshot for concurrent publish recovery.

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

Website validation passed 1,156 tests across 96 files, TypeScript, 26 independent
tests and 22 release guard checks. Final gateway source `9639e76f5e3a` passed
1,902 exact-image tests, 309 focused tests, 65 shared-tool tests and an independent
86-test review. Its release serves 100% traffic. Canonical rules passed 1,053
emulator tests, seven website suites and 55 deployed checks with zero unresolved
identity findings or access gaps. Source-specific intermediate results remain
historical and do not replace final validation.

All seven live API stages passed. Two save jobs racing on one fresh unpublished
revision returned exactly equal results and one saved revision. Start/Stop,
started-edit denial, personal copy with a new identity and frozen original log,
athlete-private access, coach/stranger draft denial and authorized coach access to
published workouts passed. Direct-write, pain and stale-schedule requests were
denied. No assigned plans or assigned logs were written. Two earlier refused
refinements left the proposal, saved workout and schedule exactly unchanged.

Authenticated candidate UI acceptance created an 8-minute prescription from a
12-minute request, then conversationally renamed it to **My Close Control
Session** while retaining its drills and dosage. Publish immediately opened the
saved detail with Start. After one of four sets, Community → Training restored
the paused session with 22 seconds elapsed, 48 seconds of rest remaining and the
completed set preserved. Save and finish returned a **Finished** workout in
Personal workouts. AI Coach → Training preserved the same proposal/history;
Community panels, sign-in return and browser Back retained their expected state.
See [the design acceptance record](AI_WORKOUT_FLOW_DESIGN.md) for responsive checks.

All generation, publication, progress and cleanup verification use synthetic
accounts. No real athlete training, account, invitation or conversation writes
were performed. A brief read-only primary-origin check used an existing signed-in
view and could emit ordinary page-view usage telemetry. Netlify aliases remain
outside the AI stream proxy CORS allowlist; primary-origin API checks and candidate
UI checks are separate evidence. This release changes no CORS or AI allowance.

Production verification matched all 60 application/new-asset hashes and seven
routes/cache headers on `posetek.net`. The ordinary guarded build preserved all
1,016 protected files; its output was not deployed. Synthetic sign-in on the
production alias returned to Training, displayed the Finished workout and earlier
copy, and recovered the exact request, prescription and rename history. Community
retained its shared navigation, toolbar and empty state; the account was signed
out afterward. Supplemental scoped cleanup removed 194 documents and eight
storage objects with zero failures. Canonical fixture cleanup completed 13 mixed
deletion actions, including three Auth accounts, with zero failures; that is not
a Firestore-document total. Three social-preference records were absent after the
trigger wait, which was not a failure. Independent scoped readback found zero
remaining accounts, documents or objects, including orphaned conversation message
grandchildren, artifact prefixes, social/usage and organization/team fixtures.
The final preservation check again confirmed unchanged AI configuration and
allowances, personal workouts enabled, 208 catalog records and the false mobile
acceptance flag.
The prior website deployment is
`6ab723a4b245cdd9426dc47a`. No physical-device lock-screen or native UI acceptance
is claimed; browser recovery is not an iOS Live Activity.

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
