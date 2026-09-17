# Vacaville September 16 measurement recovery

The user authorized repairs after the roster and ownership repair. On September
17, eleven failed September 16 attempts were repaired in production: four dribbling
times, one change-of-direction time, three broad jumps, two shots and one vertical
jump. Each original rep document received an audited admin revision. Rep identity,
recording date, session, player and team ownership were preserved.

This is a data repair, with no application, function, rule or website deployment.
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

The live organization reporting check passed for all 36 roster members. September
16 remains 101 documents / 87 distinct attempts / 14 duplicate documents, with
75 qualifying results (previously 64) and 12 unresolved results. Historical
reporting remains 325 documents, with 255 qualifying results (previously 244).
All seven affected players retained their rep identity sets and team ownership;
unrepaired documents matched the original snapshot.

The private evidence directory is `.netlify/vacaville-rep-investigation/`. Preserve
the original snapshot, publication manifests, source downloads and
`applied-revisions/` journals. Athlete-specific outcomes are in the private
`VACAVILLE_REP_REPAIR_RESULTS.md`; do not commit those files or credentials.

Final profile and organization verification is recorded in the private
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
