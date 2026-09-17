# Reviewed provisional dribbling evidence

The September 17 follow-up adds a deliberately separate estimate for two reviewed
September 16 dribbling recordings that stop near the finish. The user authorized
one-time assumptions for the skill map and individualized planning. The original
attempts remain incomplete; no projected value is written as a measured result.
Athlete identities, recordings, source hashes and measurement journals stay in
ignored private evidence, outside Git.

## Reader and display contract

`getAthleteEffectiveResults` adds an authenticated-only `provisionalEstimates`
array. Its existing `reps` projection and qualification are unchanged. Estimates
come only from the server-owned
`players/{playerId}/insightMetadata/provisionalEstimates` document. Existing
private-path rules deny client writes. Shared-link readers do not read or return
this document. No new permissions or public sharing surface is introduced.

The validator accepts only the versioned dribbling method, ordered time bounds,
low confidence and recent review/capture dates. It checks the current original
rep identity, drill, timestamp and exact movie pointer, plus the live object's
generation and MD5 against the privately reviewed source. Duplicate or foreign
attempts, malformed entries, stale footage and future dates are rejected.

Any qualified Dribbling result suppresses the estimate. This includes a later
retest: the estimate never competes with the measured personal best. Deactivate
the private entry to withdraw it. Estimates expire with the 180-day evidence
window; retaining the private document is audit history, not an active score.

Authenticated profile charts render an amber hollow marker and dashed adjacent
segments with an explicit Estimated label. The marker uses the chart's existing
dribbling completion-time reference. It is separate from the measured polygon,
overall rating, rep/session counts, category-completion counts, rankings and
Insights. No projected foot preference, ball distance, phase timing or no-ball
agility value is inferred. Native app display is unchanged.

## Method and interpretation

The reviewed method retains the originally detected start as an assumption. It
uses decoded video presentation timestamps and high-confidence hip positions
from the final 0.5, 1, 1.5 and 2 seconds, projects the recent return pace to the
original home marker and rounds the result to a tenth of a second. It does not
claim an observed finish.

The displayed range varies future return speed by plus/minus 20 percent and
rounds outward. It is a conditional sensitivity range, not a statistical
confidence interval or a guaranteed bound. Unrecorded pauses, ball loss and
start-boundary error are not covered. `observedCourseFraction` describes progress
along the standardized straight out-and-back marker course, not the exact curved
body trajectory or the proportion of video retained.

## Planning behavior

The personalized planner exposes a checked, reversible option to include reviewed
estimates as low-confidence coaching context. Generation and priority assessment
reload authoritative evidence immediately before submission. A valid new test
therefore removes the provisional context on the next request.

The estimate and missing-finish assumption are included in the existing intake
context field. Dribbling is added as a stated goal when one of the two goal slots
is available; existing chosen goals are preserved. The existing bounded goal
allocation policy handles that priority. This is coaching context, not a
fabricated best-result deficit, peer percentile or automatic change in level.
The measured `statsProfile` and `bestResults` remain unchanged. The interface
reserves room within the existing 500-character intake limit rather than
silently truncating the user's notes. No workout plan is generated or activated
by publishing these estimates.

## Associated classification repair

Two mislabeled September 16 Change of Direction attempts were transferred to one
Dribbling session with the same rep IDs, recording dates and original rep numbers.
The original successful agility attempt remains unchanged. Each destination has
ten objects: video, pose, reviewed metadata/context/annotations, original metadata
and context, and three copies of session calibration. All originals remain intact.
Unsupported measurements stay null and the attempts remain unqualified.

The video upload archive guard is now 30 entries in
`onvideoupload-00026-bup`; all prior 26 entries were retained and the source archive
was unchanged. Preserve the full current map during later deployments.

## Evidence and recovery

Private evidence lives under
`.netlify/vacaville-rep-investigation/third-pass-samantha/`, including the two
classification manifests and journals, independent verification, decoded-timing
estimate method/receipt, and a separate two-document estimate seed plan/journal.
The exact guard extension evidence is under
`second-pass/third-pass-samantha/upload-guard/`. Earlier repair journals are
immutable historical records.

Estimate publication uses one atomic compare-and-set commit for the two private
documents, with before-images, pinned evidence and pre/post source checks. It
does not write reps or recordings. A rollback must compare current document
versions with the publication receipt before restoring those before-images;
do not overwrite a later review. Classification rollback has a wider boundary
and must use its own session/rep/artifact journal.

Backend and website release receipts belong under the separately ignored
`.netlify/provisional-dribbling-release/` directory. Reverting the web display or
authenticated reader may hide estimates while preserving their private evidence.
Preserve canonical result/media services, native capture compatibility, private
rules, earlier repairs and the 30-entry video guard in any rollback.
