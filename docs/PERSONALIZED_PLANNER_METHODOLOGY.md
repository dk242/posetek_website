# Evidence-linked personalized planning

The September 17 methodology connects a player's supported testing needs to
training priorities, time allocations, eligible library exercises and progress
checks. It covers the existing admin personalized planner and schema-3 mobile
generation. The September 17 release is live; immutable deployment identifiers,
validation and rollback are recorded in the
[production receipt](../deployment/EVIDENCE_PLANNER_PRODUCTION.json).

## Evidence and exercise selection

The gateway reconciles supplied primary best results with current, dated,
qualified recording evidence. The six primary metrics are shot speed, sprint
completion time, vertical jump height, broad-jump distance, no-ball shuttle time
and dribbling completion time. Missing, invalid, stale or unreconciled results
cannot become a zero score or a measured deficit. Single best results support
bounded development priorities, not repeatability, trends or technical diagnoses.

Scores must agree with a known benchmark cell. The fallback asset contains only
the six primary anchors from the mobile application's shipped generation-2
dataset, with provenance. A valid same-or-newer production dataset takes precedence.
The planner does not silently rescore an unknown client reference using the old
gateway benchmark registry. Web and mobile retain their existing benchmark-cell
selection; their scores are not assumed to be interchangeable.

At most two supported measured domains lead the plan, within the existing
age/level priority cap. Partial increases are allowed when a full increase would
not fit. Reviewed conditional estimates, explicit goals and general baseline
practice remain distinct. Overall drill time does not establish a specific
touch, braking, acceleration, landing or strength fault.

The versioned objective map reviews actual published library content. It
distinguishes short sprint practice from maximum-speed work and vertical from
horizontal jumping. Publication status, content identity, age, difficulty,
equipment, partner setting, dose, rest and frequency remain independent gates.
A primary objective must receive a relevant exercise. General practice in the
same domain is labeled as general support and cannot masquerade as a specific
measurement-to-exercise match. Missing equipment or curriculum is reported.

## Reviewed estimates

Estimate values come from the existing private reviewed documents and their
exact recording identities. Client-supplied numbers, free text or status flags
cannot create authoritative estimates. The server checks the review method,
course coverage, dates, matching source rep, immutable object generation and
checksum, and whether a qualified result has superseded that same drill.

The admin interface sends an explicit estimate preference through its visible
checkbox. Existing mobile schema-3 requests use eligible reviewed estimates by
default; an explicit false preference opts out. Estimates remain low-confidence
support. Using them in planning does not change measured reps, the existing
skill-map scoring and labeled estimate display, rankings, testing completion,
or Insights. A later qualified test takes precedence when a new
assessment or plan is generated. Saved workout prescriptions do not silently
change after a retest.

## Review and delivery

The admin workflow remains: review evidence, set goals and time, generate and
review a draft, then explicitly use the plan. The interface separates Speed and
Agility goals. All goals can remain unchecked for evidence-led selection; up to
two optional goals add coaching emphasis without asserting a measured weakness.
The interface shows the evidence type, reason, weekly target and progress
check for each priority. Related objectives can share one domain time budget;
the UI marks that budget as shared rather than additive.

Short schedules retain their primary objectives while reconciling complete sets
with available domain slots. Combined age/level priority limits apply to both
projected targets and actual exercise minutes. Revised targets and any unassigned
minutes are disclosed rather than silently adding time or erasing an objective.
Session duration remains a target with the existing `max(5 minutes, 10%)`
tolerance; the weekly total has the same tolerance rule. Actual durations include
transitions. The live two-session pilot is 65 and 63 minutes for a requested
60-minute target, not two strict 60-minute windows.

Every generated exercise carries a structured rationale and the existing short
`whyIncluded` explanation. Activated admin plans and mobile-generated plans use
the existing `players/{playerId}/trainingPlans` collection and schema version 3.
Athlete web and the current native reader already render `whyIncluded`.
No new native subscription, plan schema or application-store release is required
for this shared generation logic or existing explanation field.

Native Generate keeps its existing active-plan persistence behavior and daily
limit. Admin generation remains a draft until the coach explicitly activates it.
Existing plans are not bulk regenerated. Access checks, current-membership
validation, optimistic activation, workout snapshots and scheduling limits remain
in place. New private evidence is included in stale-review checks and is excluded
from player-readable projections.

The native reader accepts schemas 1, 2 and 3. Never add the forbidden recording
keys `retest`, `isRetest`, `isMeasuredDrill` or `measuredDrillType` to schema-3 plan
documents, including false/null values. Rich priority cards are a web interface
feature; existing mobile screens show the saved exercise explanation. Native
snapshot serialization and manual workout editors may omit unknown structured
fields. An edited workout is not an unchanged generator-approved prescription.

## Verification and release boundary

Validate the objective map against the current catalog; run the gateway tests,
cross-route persistence/projection checks, frontend tests and TypeScript; verify
desktop and phone-width browser behavior. Stage an immutable, committed gateway
archive, verify the exact Cloud Build source generation/hash and image, then
promote the checked candidate after draining planner jobs. Publish the identical
reviewed website preview while preserving approved marketing bytes and reconcile
the protected application baseline.

The shared website Firestore rules allow the optional boolean
`useProvisionalEstimates` only on personalized assessment and generation requests.
Omission remains valid for existing callers; actor authorization and the separate
activation/discard parameter lists remain unchanged. This narrowly scoped rules
update is required for the website's estimate preference to reach the gateway.
It does not change capability/quota settings, recording processors, historical
repairs or archive guards. Preserve their current before-images and the prior
rules release. Rollback restores the prior gateway revision, website deploy and,
when reverting this request contract, the prior Firestore rules release;
it must not delete athlete data, plans, drafts or workout logs. Plans already saved
with additive rationale fields remain readable by the existing schema-3 clients.

Source and offline contract checks are distinct from installed-device acceptance.
Windows validation does not establish the installed iPhone build, Xcode execution
or TestFlight acceptance. The separate native recording-remediation handoff still
requires its documented Mac/iPhone validation.

## September 17 backend description follow-up

The backend-only follow-up was verified September 17 at 6:13 PM PDT
(`2026-09-18T01:13:01.386Z`). Its immutable identifiers, checks and rollback are
recorded in [the intent release receipt](../deployment/PLANNER_INTENT_PRODUCTION.json).
The prior methodology release receipt remains a historical record of that rollout.

Session intent now lists every actual domain-minute total in descending order,
for example: “Time allocation: jumping (19 min), dribbling (18 min) and speed
(18 min).” It avoids declaring a single lead area when totals are nearly equal.
The generic plyometrics label is “jumping”; a category name alone does not
establish that the selected exercises teach landing technique. Descriptions still
state a fresh-first sequence only when it is present, identify actual strength
block positions, retain the prescribed-rest reminder and respect the 400-character
limit.

The selection, prescribed doses, ordering, domain allocations, caps, progression,
independent checker and retry policy are unchanged. Independent comparisons across
19 synthetic profiles confirmed identical exercise IDs, doses, order and budgets.
Only context fingerprints changed in 18 authored replay tapes; provider strategies,
acceptance assertions and historical private recordings were preserved.

Validation passed 34 composition tests, 111 admin/native/evidence integration tests,
42 replay/adversarial tests and 14 release-guard tests. Six existing replay skips
reflect private historical recordings excluded from the source handoff. The exact
committed candidate also completed the mandatory full test process successfully
inside Cloud Build. Its final numeric summary was unavailable in Cloud Logging,
so no whole-container pass or skip total is inferred.

This release changes only gateway descriptions for newly generated plans. It does
not rewrite existing prescriptions or change website bytes, Firestore rules,
planner configuration, IAM, the 32-entry video archive guard, the effective-results
reader, or the native binary, request contract, schema-3 persistence and daily
generation limit. Both admin and native generation receive the shared description
change. Rollback restores gateway revision `agent-gateway-web-e75e9318d15d` after
draining jobs, preserving existing traffic tags and saved athlete data; this
follow-up requires no website or rules rollback. Cohort plan activation outcomes
are documented separately.
