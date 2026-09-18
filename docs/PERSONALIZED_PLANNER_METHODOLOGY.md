# Evidence-linked personalized planning

The September 17 methodology connects a player's supported testing needs to
training priorities, time allocations, eligible library exercises and progress
checks. It covers the existing admin personalized planner and schema-3 mobile
generation. Release status and immutable deployment identifiers are recorded in
the production receipt after verification.

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
support and do not alter measured reps, skill-map scoring, rankings, testing
completion, or Insights. A later qualified test takes precedence when a new
assessment or plan is generated. Saved workout prescriptions do not silently
change after a retest.

## Review and delivery

The admin workflow remains: review evidence, set goals and time, generate and
review a draft, then explicitly use the plan. The interface separates Speed and
Agility goals and shows the evidence type, reason, weekly target and progress
check for each priority. Related objectives can share one domain time budget;
the UI marks that budget as shared rather than additive.

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

This change does not require Firestore rules, capability/quota settings, recording
processors, historical repairs or archive-guard changes. Preserve their current
before-images. Rollback restores the prior gateway revision and website deploy;
it must not delete athlete data, plans, drafts or workout logs. Plans already saved
with additive rationale fields remain readable by the existing schema-3 clients.

Source and offline contract checks are distinct from installed-device acceptance.
Windows validation does not establish the installed iPhone build, Xcode execution
or TestFlight acceptance. The separate native recording-remediation handoff still
requires its documented Mac/iPhone validation.
