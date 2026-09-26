# Confirmed training access

Prepared September 26, 2026. This handoff describes the implemented source;
the production receipt records deployment and live acceptance separately.

Published as website deployment `6ab788d1c138322f8f9b9911` on September 26 at
2:55:16 AM PDT, with gateway `agent-gateway-sha-dac82d119dc7`, canonical rules and
catalog version `1.0.92`. Read the
[production receipt](../deployment/CONFIRMED_TRAINING_ACCESS_PRODUCTION.json).
The exact artifact, primary-host routes, authenticated browser flow and ordinary
preservation guard passed. Browser/API checks verified an unchanged saved
prescription, one reported set and 39 active seconds across Community navigation
and current-access Resume; the coach's history showed that same saved revision
and the correct early ending. Physical-device lock-screen behavior is not claimed.

## Athlete experience

Personal workout creation and AI Coach handoffs begin with a visible setup:
**Space & people, Football, Strength, Movement, Timing & cues**. All 28 canonical
equipment IDs have readable choices. Location is context, not an equipment
bundle: selecting Gym never grants a mat, bench, weights or machines. An explicit
No equipment choice supports eligible bodyweight work. People includes the
athlete; one means solo. Participants, equipment and location must be confirmed.
Dimensions, surface, overhead space and a marked goal area are optional, but an
unconfirmed detail cannot satisfy a drill that explicitly requires it.

The athlete describes a focus and approximate duration, confirms any missing
age/pain information, then requests the prescription. Follow-up messages modify
the same private conversation. Explicit equipment statements prefill suggestions;
negations remove availability, and a drill request alone grants no equipment.
If a message changes the setup, generation waits for the athlete to review and
confirm the changed selections. Manual drill and dose controls remain absent.

Confirmed access changes take precedence over implicit preservation of an older
draft. The personal generator may replace only baseline drills that no longer
fit, retaining suitable identities and earlier explicit exclusions/counts. This
also covers “No cones today” and the setup panel's suggested revision request.
An explicit request to keep an unavailable drill produces a constraint conflict.
“Include ball control” requires that domain to be present; explicit requests to
add another drill still require a new identity. Intermediate repair steps must
strictly reduce existing access failures without introducing another hard
violation. Final eligibility and exact-proposal publication remain strict.

If the requested domain has no additional eligible drill, personal search explains
which domains the draft already covers and offers clearly labeled alternatives
from other domains. Those alternatives retain every resource, age, frequency and
other eligibility filter; the AI must choose and validate the resulting draft.
A read-only candidate preview exposes calculated duration and remaining request
requirements. Repeated unchanged empty searches stop with a recoverable error
instead of using the remaining tool calls in a loop. No fallback silently grants
equipment, changes the athlete's intent or publishes a partial draft.

The reviewed prescription shows calculated and requested minutes, dose, rest,
and available catalog resource requirements. A changed setup blocks publication
until AI creates a revised proposal. Publication still binds the exact immutable
server proposal to one personal workout. Failure retains the last valid draft.

Resource preferences are remembered by authenticated owner/player only. They
contain no age, pain answer or credentials, and never restore confirmation.
Opening a stored proposal requires confirming the setup again. A matching setup
confirmed during the current visit survives generation and the resulting URL
update. Back/Forward and external conversation links still restore through the
existing authoritative conversation reader.

## Starting, resuming and copying

Personal Start and Resume both ask for today's setup and pain confirmation and
send `currentAccess` through the existing Start job. Resume reads the current
log revision first. The server rechecks current ownership, schedule, catalog,
resources and safety gates before returning the same frozen log and snapshot.
It does not create a new session, change recorded sets or reset the timer.
An unfinished session may resume across midnight; unfinished personal snapshots
continue to reserve their drill exposures across a week boundary. Completed-log
attribution retains its existing started-at semantics.

If access no longer fits, an unstarted workout can be revised and explicitly
republished. A started session can be ended with its progress retained, then
copied into a new AI conversation using the new setup. Assigned workout start,
coach prescriptions and native UI remain outside this change.

Resume consumes the existing Start capability allowance; it does not introduce
a new quota or increase any configured limit. Stable request identities retain
the existing retry behavior. Older clients without the optional access fields
retain their prior contracts.

## Source boundaries

- Website setup/state: `app/src/pages/athlete-portal/player/training-access.ts`,
  `TrainingSetup.tsx`, `PersonalWorkoutHub.tsx`, `use-personal-workouts.ts`.
- Canonical gateway: `posetek/posetek-backend`, `Services/agent-gateway/`.
- Canonical rules: `posetek/posetek-mobile-app`, `firebase/` only.
- Catalog audit/publisher: [TRAINING_ACCESS_CATALOG.md](TRAINING_ACCESS_CATALOG.md).
- Account entry: [ACCOUNT_ENTRY_WORKFLOW.md](ACCOUNT_ENTRY_WORKFLOW.md).

`intake.access` version 1 is additive and contains confirmed location, participant
count and bounded optional space attributes. Equipment remains the existing flat
intake field. Access-aware revisions cannot remove this boundary. Each eligible
catalog record must carry a valid source-bound `accessRequirements` map; missing,
stale, malformed or explicitly unresolved maps are excluded from the new flow.
Legacy/native requests without access retain their existing equipment behavior.

The 54 published requirement maps come from existing authored source. Only two
incorrectly empty equipment lists are corrected. Three explicit source gaps
remain held from this flow. All 208 catalog records, 80 unpublished whole-body
drafts, review/media states, active plans and the false mobile acceptance gate
remain preserved. These metadata checks do not create coaching or content
clearance and do not replace the full drill setup instructions.

## Release order and recovery

Use canonical exact-image gateway validation and canonical rule publication.
Install and verify all 54 catalog maps before exposing the new website flow.
The website release uses the deliberate application build with the verified
marketing snapshot, draft verification and exact-draft promotion. Reconcile the
protected baseline afterward and run the ordinary preservation guard without
deploying its output. Every source/release-record commit includes `[skip netlify]`.

Retain the exact catalog plan, commit-attempt and verification journals outside
Git. A lost commit response requires readback, not another publication. Never
delete maps or rewrite old workout logs as a rollback. See the catalog handoff
for drift guards and the production receipt for exact service/site revisions,
verification results and temporary-data cleanup.
