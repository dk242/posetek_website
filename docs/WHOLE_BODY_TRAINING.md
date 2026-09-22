# Whole-body training and four-week filming handoff

Implementation: September 21, 2026. See `deployment/WHOLE_BODY_TRAINING_PRODUCTION.json`
for the final verified release state; this guide is not itself a deployment receipt.

## Service proposition

PoseTek converts qualified soccer performance results and player context into
reviewable training priorities. The six measured anchors are shot speed, sprint
completion time, vertical jump, broad jump, planned change-of-direction time and
dribble completion time. Equipment, experience, current coaching clearance,
available days, outside practices/matches/strength work, feedback and goals
constrain the output. A test result does not diagnose a muscle weakness, establish
lifting competence, set an external load or prove that a particular exercise will
improve that result.

The library broadens the available service to whole-body strength, isometrics,
plyometrics, speed/change of direction and ball skills. Evidence links distinguish
direct task practice, supporting physical capacities and general development.
Strength support is a bounded adjustment and preserves direct practice for measured
priorities. Research citations include population and transfer limitations;
program-level evidence is never labelled proof for every authored variation.

## New production batch

`whole-body-2026-09` contains **80 entirely new drafts** for ages 10–18 with
access to a normally equipped gym. Existing unfinished content is not counted.
The September 7 Outlook v3.4 handoff's 85-item roster and all 128 observed live
catalog records were compared. v3.5 is a separate research/coverage workbook,
not the active content roster. Comparison details are retained beside the manifest.

| Filming week | Dates (America/Los_Angeles) | Strength | Isometric | Plyometric | Speed/COD | Ball | Drills / required clips |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | September 21–27 | 7 | 3 | 4 | 3 | 3 | 20 / 60 |
| 2 | September 28–October 4 | 7 | 3 | 4 | 3 | 3 | 20 / 60 |
| 3 | October 5–11 | 7 | 3 | 4 | 3 | 3 | 20 / 60 |
| 4 | October 12–18 | 7 | 3 | 4 | 3 | 3 | 20 / 60 |
| Total | Four weeks | 28 | 12 | 16 | 12 | 12 | 80 / 240 |

The filming sequence is not an athlete workout. Each drill needs an original
primary demonstration, a teaching-detail clip and an error/correction clip.
The optional bird's-eye slot does not replace any of those three. The detailed
matrix, CSV and per-exercise briefs are in `content/training-expansion/`.
Actual IDs are assigned atomically at import and recorded in the release receipt;
the manifest's suggested IDs are advisory.

## Admin production workflow

In the drill library, filter the new production batch by filming week. Open an
exercise to review instructions, dose, evidence and its limitations, filming briefs,
content-review status and the three required media slots. Production notes and
evidence authoring live in private `drillCatalogAuthoring` records, separate from
athlete-facing coaching text.

An administrator explicitly designates qualified training reviewers by verified
account ID and records their qualification. Ordinary staff and athletes cannot
grant themselves review authority. No reviewer or player clearance is inferred or
created by this release.

Saving changed content invalidates its review. Each uploaded clip is initially
pending and uses a unique object path. A designated reviewer approves the actual
stored generation. Publication checks current content, current reviewer authority,
all three current clip approvals and applicable mobile compatibility. Drafts are
not eligible for normal plan selection. Content never becomes published merely
because an upload completes.

## Tailoring and execution

New web intake records the actual weekly calendar and external workload, equipment
confirmation, resistance experience and supervision availability. Coaching goals
remain optional. Missing or stale readiness cannot be supplied through self-report.
Current designated and assigned reviewers record approved movement families,
individual exercise loading instructions, independent-use permission where
appropriate, review expiry and session/weekly limits. Test scores never produce a
weight prescription. Returning clearance to pending removes executable permissions.

The gateway validates per-exercise and shared movement-family sets, plyometric
contacts and isometric hold time, including per-side work, current plan/history and
declared outside activity. Calendar-date spacing is conservative; it does not claim
an exact hourly recovery interval from date-only inputs. New restricted work is
held around declared conflicting sessions rather than silently ignoring them.

Generation stays a draft on the web. Activation, native persistence, AI workout
application, manual saves and workout starts recheck the applicable policy.
Manual schema-3 edits use a deterministic server job with plan, workout and schedule
revisions and an audit record. Old clients cannot write raw executable weeks.
Legacy schema-1/2 plans remain readable; editing requires the supported review flow.
Existing active plans and logs are not rewritten by the release.

Starting expanded training requires today's equipment, supervision and pain
confirmation. A short server authorization is bound to the current revisions,
readiness and reviewer; rules recheck the authorization when a log is created.
An unfinished session is revalidated before resuming through the web workflow.

## Mobile acceptance remains outstanding

`config/llm.wholeBodyTraining.mobileVerified` remains **false**. This is a deliberate
delivery gate, not evidence of completed device testing. The new gym content stays
unpublished, and restricted activation is held. No native source or native rules
are deployed by this task.

Taiyo's Mac/iPhone/TestFlight acceptance must demonstrate that the released mobile
reader displays the exact load/assistance instruction, supervision and stop cues,
per-side dose, rest and actual scheduled date; resolves all three approved clips;
and preserves current catalog freshness and schema-3 plan compatibility. It must
also demonstrate refusal of missing/expired/revoked clearance, unavailable equipment,
pain, changed loading, stale revisions and unverified restricted plans. Native
execution needs the same current server authorization boundary, not a local boolean.
Record build/device versions and results before a separate reviewed gate change.

## Release and recovery

The gateway uses a committed immutable source archive and mandatory full-container
tests before traffic promotion. The website release preserves approved Players and
Coaches marketing bytes. Only the new training callables are deployed.

`firestore.rules` also contains previously committed native testing work that is
not part of this release. `scripts/compose-training-rules.cjs` verifies the exact
pre-task source against the captured live boundary, removes only those unchanged
native blocks and emits `deployment/whole-body-firestore.rules`. The production
candidate and storage rules must pass their emulators before publication. Never
deploy the uncomposed root rules file as a shortcut.

`scripts/import-training-expansion.cjs` defaults to read-only preflight. Its explicit
apply creates catalog and private authoring records together, advances counters and
catalog freshness once and saves a manifest-to-live-ID journal. Existing records
are not updated. Private before-images, build/config/service details and readbacks
stay under ignored `.netlify/training-expansion/`; sanitized release facts belong in
the committed receipt.

For recovery, retain all existing plans/logs and imported drafts. Keep the mobile
gate false; disable the new capabilities if necessary. Restore the recorded prior
gateway revision and website candidate with coordinated access rules rather than
deleting athlete data. Restoring older broad rules while private authoring records
remain would expose them: preserve the new private-collection exclusions during any
rules rollback. Imported drafts can remain safely unpublished while a fix is reviewed.
