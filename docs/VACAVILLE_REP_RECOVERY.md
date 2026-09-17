# Vacaville measurement recovery

The user authorized repairs after the roster and ownership repair. On September
17, eleven failed September 16 attempts were repaired in production: four dribbling
times, one change-of-direction time, three broad jumps, two shots and one vertical
jump. Each original rep document received an audited admin revision. Rep identity,
recording date, session, player and team ownership were preserved.

This first pass was a data repair, with no application, function, rule or website
deployment.
The earlier ownership repair and its historical receipts remain documented in
[`VACAVILLE_DATA_REPAIR.md`](VACAVILLE_DATA_REPAIR.md).

## Measurement evidence

Original diagnostic footage, rep identities, calibration and saved processing
artifacts were reconciled against the September 16 roster audit. Accepted repairs
use measurements from the original attempt and existing application conventions:

- Five timed attempts finish visibly on video. Original motion-start frames are
  retained and reviewed finish crossings provide total time. Actual video time
  differences agree within 0.00046 seconds. Invalid phase, distance and ball-gap
  measurements were cleared; those secondary metrics were not reconstructed.
- Three broad jumps retain a visible, stable landing. Restricting the native
  three-piece fit to the actual jump removes later tracking of unrelated motion.
  The local calculation reproduces the original full-clip algorithm before the
  window is corrected. Relevant derived chart artifacts were updated consistently.
- Two shots have a visible ball despite the original detector returning no track.
  Reviewed ball centers and the original marker calibration feed the existing
  admin calculation. Matching ball information and trajectory artifacts were
  saved. These retain the application's image-coordinate measurement convention.
- One vertical jump used a later camera movement as its peak. The visible jump's
  original calibrated torso displacement supplies the corrected height. Derived
  keyframes, height series and motion curves were updated with before-images.

Twelve failed attempts remain unresolved: nine videos end before the finish, two
broad jumps lack a reliable landing for the selected tracked foot, and one vertical
jump video contains camera handling without the athlete's attempt. A complete
original recording or retest is required; no finish or landing was extrapolated.

The fourteen duplicate jump documents were preserved. Twenty-three historical
failure reports remain as diagnostics, including reports superseded by accepted
revisions. They overlap recording documents and must not be added as new attempts.
The original audit workbook remains unchanged.

## Publication and verification

Publication used the existing `adminReviseRep` callable after checking the reviewed
Firestore before-image and Storage metadata. Every repair was read back and passed
the existing `acceptedRevision` qualification with matching revision and metadata.
Shooting artifacts were separately read back and compared to the reviewed values.
Additional jump artifacts were generation/hash checked, backed up and verified.
Original videos and diagnostic bundles were not rewritten.

At the first-pass checkpoint, the live organization reporting check passed for all
36 roster members. September 16 remained 101 documents / 87 distinct attempts / 14 duplicate documents, with
75 qualifying results (previously 64) and 12 unresolved results. Historical
reporting remains 325 documents, with 255 qualifying results (previously 244).
All seven affected players retained their rep identity sets and team ownership;
unrepaired documents matched the original snapshot.

The private evidence directory is `.netlify/vacaville-rep-investigation/`. Preserve
the original snapshot, publication manifests, source downloads and
`applied-revisions/` journals. Athlete-specific outcomes are in the private
`VACAVILLE_REP_REPAIR_RESULTS.md`; do not commit those files or credentials.

First-pass profile and organization verification is recorded in the private
`verified-player-effects.json`. The web profile calculates scores from rep
measurements and current approved benchmarks. A repaired attempt can add a missing
axis or improve a best value; a weaker repaired attempt can leave the chart score
unchanged. Do not infer a chart score from the number of repaired attempts alone.
The existing admin/coach portal uses the senior-reference chart; the athlete's
current experience uses the age/gender benchmark path. These can display different
scores for the same measurement. Both paths were checked without changing either
scoring implementation.

The current native Stats source also reads rep documents and rebuilds scores; it
does not consume the legacy `players.stats` or `best_reps` maps. Its foreground
refresh reloads those records. The installed mobile build was not verified. Older
August Profile screens contain hardcoded chart values and require a newer build
for that separate screen; changing data caches would not fix that UI limitation.

## Recovery boundary

The admin revision keeps the prior Firestore document, metadata and supported
shooting artifacts. Its existing restore action does **not** restore the extra
vertical/broad jump JSON artifacts changed during this repair. Those have exact
private before-images and verified Storage backups under each affected rep's
`admin_recovery_backups/` path.

A rollback must reconcile the latest live revision, document update time and all
artifact generations against its journal before restoring anything. Restore the
corresponding auxiliary before-images as well as the admin revision, then verify
metadata, reader artifacts and qualification together. Stop on later edits. Do not
use the ordinary revision restore alone for these four jump repairs, discard a
journal to force a retry, or upload/copy videos as part of rollback. Video uploads
can invoke the legacy processor; JSON repair does not require them.

The callable and additional auxiliary writes are separate operations, not a
single cross-service transaction. All eleven runs reached verified completion;
the journals and backups remain necessary for future reconciliation.

## Second pass: historical results and mislabeled attempts

On September 17, the authorized second pass repaired eight more numerical results:
four August change-of-direction times, one September 16 dribbling time and three
September 16 broad jumps. One additional September 16 recording was reclassified
as a broad jump without publishing a distance or height because its landing could
not be measured reliably. These are corrections to existing attempts; category
changes do not create another attempt or necessarily increase the qualifying total.

The four August times use complete original recordings and reviewed event timing.
The dribbling attempt was recorded under change of direction, but visibly includes
the ball and a complete return. The three broad jumps were recorded under vertical
jump. Their saved pose, reviewed jump windows and native broad-jump calculation
provide the replacement measurements. The incomplete fourth broad jump remains
partial with null distance, height and event frames. No missing landing was inferred.

The user confirmed that the physical black ArUco square is **5.875 inches
(0.149225 m)**. The three newly measured broad jumps were corrected from the
historical 7-inch scale using the 47/56 ratio, with consistent derived artifacts.
The four jump results published in the first pass already agree with the
5.875-inch calibration from their original marker corners and saved scale; those results
required no calibration change.

### Classification and duplicate contract

Each category migration retains the existing rep ID, player, recording date and
historical session/rep numbers. The original Storage folder remains an untouched
audit archive. The active canonical folder contains an identical video and pose,
rewritten context/metadata, and reviewed auxiliary artifacts where measurements
are valid. A new session document represents the corrected category; the source
session count is reduced and an empty historical session is retained.

Canonical rep, session changes, existing pathless jump mirror and private duplicate
correction are written together with raw Firestore before-images and update-time
preconditions. The mirror keeps its document identity, clears its height aliases
and records `duplicateOf` pointing to the canonical rep. Cross-drill duplicate
authority is the server-owned, client-denied document
`players/{playerId}/insightMetadata/resultCorrections`, with `schemaVersion: 1`,
`repairId`, `reviewedAtMillis` and a merged `duplicateReps` map. The writable
`duplicateOf` field alone is insufficient authority. Readers must use the matching
reviewed correction contract; preserving the mirror must not create a second
test or retain the mislabeled vertical score.

### Processor guard and recovery

Before copying videos into their corrected folders, the deployed `onVideoUpload`
archive guard was extended by ten exact bucket/path-and-MD5 entries, retaining its
sixteen existing entries. Revision `onvideoupload-00025-vic` was verified active
with **26 guard entries** on September 17. Each of the five copied-video events
was independently verified in the processor logs as skipped without requesting
processing. This was an environment-only extension with the function source
unchanged. The guard receipt is separate from the
concurrent application/reader remediation release and does not establish that
release's status. Preserve the complete guard map during later deployments.

Destination objects are created only if absent and verified by generation and
hash before the Firestore cutover. The admin revision then records the reviewed
result and is read back with its metadata and reader artifacts. The intentionally
partial attempt remains `noPrimaryResult`; it is not an accepted numerical repair.
Storage staging, Firestore cutover and admin revision are separate journaled
operations rather than one transaction across services.

Rollback requires the migration journal in addition to ordinary revision history.
Restore the canonical rep, source/target sessions, mirror and private correction
mapping together under fresh ownership/precondition checks. Handle only destination
objects whose generations belong to that run; the original folder needs no video
rewrite. Stop on later edits or later correction mappings. The ordinary admin
revision restore alone does not undo category, session or duplicate changes.

### Second-pass verification checkpoint

Verification completed at **2026-09-17T21:08:20.691Z**. The September 16
report contains **101 documents / 87 attempts /
14 duplicate documents**, with **74 qualifying
results** and **13 results without a qualifying measurement**.
The cumulative report contains **325 documents /
298 attempts / 27 duplicate documents**,
with **258 qualifying results** and
**40 results without a qualifying measurement**.
Organization testing status is **12 fully tested /
22 partially tested / 2 unrecorded**.

All 36 included athletes retain the same 325 rep document identities and team
assignments. The fifteen earlier revisions and five category migrations reconcile
chronologically with their final rep, session and duplicate-correction documents.
All 36 effective-results responses and both date-mode reports match direct
qualification evidence. Fresh hosted profile checks show the recovered dribbling
and broad-jump results feeding the skill chart. The original reports and repair
receipts remain unchanged.

The original twelve failed September 16 attempts still require complete footage
or retesting. The newly identified incomplete broad jump is a separate unresolved
attempt. Earlier checkpoint figures above remain historical observations, not
current totals. Failure reports and the audit workbook remain unchanged.

Private source recordings, athlete-specific measurements, before-images,
manifests, guard receipts and migration journals remain under
`.netlify/vacaville-rep-investigation/second-pass/`; do not commit them. Preserve
the final verifier output alongside those journals. No credentials, signed media
URLs or individual athlete identifiers belong in the public handoff.

## Later September 17 classification and conditional-estimate follow-up

Two additional September 16 attempts were recorded under Change of Direction
but visibly used a ball. They now appear under one Dribbling session with their
original rep IDs, dates and rep numbers. The source session retains its valid
agility attempt. Both transferred recordings end before a measurable finish:
their primary and unsupported secondary metrics remain null and neither is
qualified. Source recordings and calibration were retained, with exact archived
copies accompanying the destination artifacts. Separate compare-and-set journals
record the rep and session changes and the complete rollback boundary.

Separately, the user authorized one-time conditional estimates from two reviewed
near-finish Dribbling clips. Two server-owned private documents were published
atomically after evidence and source checks. These estimates add labeled skill-map
markers and optional low-confidence planning context; they do not repair a missing
finish or add a measured result. Authenticated reader checks confirmed unchanged
measured rows and qualification, and the additional classification-only athlete
has no estimate. A later qualified Dribbling test suppresses its estimate. No
Agility estimate was published. The failed recordings, audit workbook, historical
repair reports and remaining evidence gaps are preserved.

The archive guard now has 30 entries in `onvideoupload-00026-bup`, retaining all
26 earlier entries and the same processor source. The authenticated reader's
separate source-only release is ACTIVE version 3. The website follow-up is
`6aac666c61025a8e62e8c399`, published at `2026-09-17T22:22:58.156Z` (3:22:58 PM PDT).
See the [production receipt](../deployment/PROVISIONAL_DRIBBLING_PRODUCTION.json)
and [estimate method, limits and recovery contract](PROVISIONAL_DRIBBLING_RECOVERY.md).
Earlier counts above remain checkpoint records; classification-only transfers
and conditional estimates add no qualified results. No workout plan was generated
or activated during this publication.

The later repair evidence remains in the ignored
`.netlify/vacaville-rep-investigation/` directories; backend and website checks
are in `.netlify/provisional-dribbling-release/`. Retain those private receipts
alongside the original journals. Withdrawing an estimate requires its own current
document-version check; undoing a category transfer additionally requires its
session, rep and artifact journal. Neither operation should overwrite a later
review or alter the historical repairs.

## Final September 17 follow-up: confirmed Agility classification

The capture owner subsequently confirmed that a Sprint-labeled attempt was the
no-ball agility test. It now belongs to Change of Direction with the same rep
identity, date and rep numbers. All 31 original Sprint-session objects and the
six other reps remain unchanged; 20 staged destination objects plus two expected
administrative revision before-images preserve the original and reviewed data.
The genuine Sprint attempt is retained. Unsupported Sprint and movement metrics
are cleared, so this correction removes one formerly qualified Sprint result;
the incomplete agility attempt is unqualified.

The reviewed partial shuttle supports a separately labeled conditional Agility
estimate under `partial_shuttle_visual_start_v1`. One version-checked private
document append preserves the existing Dribbling estimate and every prior raw
field. It adds no measured result or recorded finish. After this classification,
authenticated reader and publication checks leave measured rows and qualification
unchanged. Earlier checkpoint totals above remain records of their observation.

The website release is `6aac6cc0bfb1ddbe0a73e636`, published at
`2026-09-17T22:47:35.951Z` (3:47:35 PM PDT), and the authenticated reader is
ACTIVE version 4. The archive guard now contains 32 entries in
`onvideoupload-00027-guw`, with previous guards and processor source preserved.
See the [sanitized receipt](../deployment/PROVISIONAL_AGILITY_PRODUCTION.json)
and [Agility method, limits and recovery handoff](PROVISIONAL_AGILITY_RECOVERY.md).
Private evidence remains in the ignored repair and
`.netlify/provisional-agility-release/` directories. Estimate rollback and
classification rollback require their separate journals and fresh version
checks. No workout plan was generated or activated by this publication.
