# September 16 testing audit remediation

This release addresses the software causes behind the original
`PoseTek_Testing_Roster_Audit_2026-09-16.xlsx`. The workbook remains historical
evidence. Its two issue sheets contain 264 overlapping issue rows; they are not
264 distinct failed attempts. Athlete-level evidence and recovery journals remain
private and must not be committed to this repository.

## Agreed release scope

Prepare and deploy the Firebase/web fixes, and push the native source for Taiyo's
Mac validation and TestFlight release. Retain source footage for all six measured
tests. COD and dribbling use coach-controlled Finish with a 60-second safety stop;
the processor must still observe the required completed movement. Historical
attempts without adequate evidence remain unavailable or require retesting.

## Audit coverage

| Original issue category | Rows | Software response and evidence boundary |
|---|---:|---|
| Negative value review | 17 | Validate broad-jump height independently of horizontal distance; rejected height is unavailable, never an absolute-value correction. |
| Video unavailable | 64 | Resolve original media from the exact attempt; permit an owner/rep-verified diagnostic recording when available. New native captures require retained video before final cloud acknowledgement. A missing historic file cannot be recreated by a UI fix. |
| Zero primary result | 28 | Failed/missing calculations stay unavailable and out of scores. Cards, details and charts consume the same server qualification. |
| Card/detail mismatch | 9 | Do not promote rejected intermediate metadata fits into results. These nine original broad-jump mismatches had failed processing evidence. |
| Missing metric | 38 | Emit peak frame/strike foot in new captures; recover bounded legacy peak indices only from the verified four-entry artifact format. Explicitly cleared review fields remain cleared. |
| Duplicate label | 26 | Preserve records; suppress proven mirrors, distinguish separate captures and use immutable capture identities for future uploads. |
| Visual review | 41 | Respect keypoint confidence, coordinate validity, aspect ratio and authoritative video/frame timing. Unknown timing permits manual inspection; software changes do not certify every historical pose. |
| Coverage gaps | 4 | Keep truthful coverage. Missing successful tests need a recoverable complete recording or a new attempt. |
| September 16 failure reports | 23 | Preserve diagnostics and accepted admin revisions; longer COD/dribbling recording avoids the former fixed ten-second cutoff. Incomplete movement cannot produce a valid result. |
| September 16 documents without Storage path | 14 | Preserve historical jump mirrors for audit, exclude proven duplicates from results, and stop creating new duplicate writes. |

## Data and service contracts

- Authenticated result readers are `getAthleteEffectiveResults` and
  `getAthleteRepMedia`. They recheck current athlete/organization access and expose
  qualified values or explicit unavailable states. Media URLs are short-lived and
  pinned to the inspected object generation.
- The existing unsigned legacy sharing protocol is retained. Signed club shares
  apply the canonical results/media resolver and recheck revocation.
- Dedicated authenticated drill links use the same current admin, organization
  membership and athlete ownership checks as the main portal. The existing team
  leaderboard preserves its scoped names/metric whitelist and qualifies results
  before returning them; athletes cannot use it to retrieve teammate evidence.
- New measured captures use
  `player/drill/sessionN/kickN/capture_<32 lowercase hex>/<filename>`, with
  `repId = captureId` and an explicit `storagePath`. Numeric labels are not an
  identity. Existing recordings remain readable. New capture children never fall
  back to a different legacy folder.
- The legacy upload processor recognizes reviewed native archive metadata
  `posetekLocalProcessed=true`, `posetekContextVersion=1` only for the six measured
  test folders. Existing exact-path/checksum archive guards remain intact.
- Reviewed cross-test mirrors require a private server-owned
  `players/{playerId}/insightMetadata/resultCorrections` document:
  `schemaVersion: 1`, a nonempty `repairId`, positive `reviewedAtMillis`, and
  `duplicateReps: { mirrorRepId: canonicalRepId }`. The mirror must also carry
  the matching `duplicateOf`; both IDs must exist in the same player inventory.
  Self references, chains and cycles are rejected. A client-written `duplicateOf`
  alone cannot suppress a result. Changes to this private document reproject
  Insights through the existing trigger.

## Release verification and Mac handoff

The final website is live as `6aac59bb9c49063e622aa65a`, published September 17,
2026 at 2:22:42 PM PDT (`2026-09-17T21:22:42.725Z`), from application source
[`053d322`](https://github.com/dk242/posetek_website/commit/053d322ba62e6ce3847a2171e4834ab1b75e78bb).
The [production receipt](../deployment/TESTING_AUDIT_PRODUCTION.json) records the
verified Firebase scopes. All 445 local files match the 446-file published
inventory; 413 application/public files are pinned by the baseline. Approved
Players and Coaches pages and marketing assets are preserved byte-for-byte.

The two authenticated readers are version 2. Sharing readers are versions 11
and 10; team leaderboard is version 2; all eight Insights endpoints/triggers are
version 2. The source-only path updates are `adminReviseRep` version 4,
`adminSaveAnalysisReview` version 2 and `getSocialMedia` version 5. The upload
processor retains revision `onvideoupload-00025-vic` and all 26 exact archive
guards. Existing function configuration and IAM were preserved; no rules or TTL
policy changes were needed. All 41 unrelated function definitions/source versions
remain unchanged. No initial IAM baseline exists for every unrelated function,
so the unchanged-IAM verification is limited to the scoped release receipts.

Validation passed 924 frontend tests, TypeScript, 232 backend/compatibility tests,
19 release-verifier tests, 15 baseline/navigation checks and 84 final cloud
inventory checks. Signed-in production checks covered rejected secondary height,
failed card/detail parity, recovered jump peak navigation, original and diagnostic
video playback, timed pose seek, dedicated admin drill links and scoped Insights.
The diagnostic sample played to its final pose frame and a phase seek paused at
the corresponding video timestamp. These checks do not certify every historical
pose or infer missing timing for older recordings.

Native source is pushed on
[`codex/testing-audit-remediation`](https://github.com/athelyticsOG/posetek-mobile-app/tree/codex/testing-audit-remediation),
commit [`e2c3736`](https://github.com/athelyticsOG/posetek-mobile-app/commit/e2c37363ca0f29e068dcb65fbd373d94f3120fad),
based on main `944177b`; Insights usage is already included. Taiyo should follow
the [native Mac handoff](https://github.com/athelyticsOG/posetek-mobile-app/blob/codex/testing-audit-remediation/docs/plans/TESTING_AUDIT_REMEDIATION_HANDOFF.md).
The branch preserves existing app/extension identities and version 1.1/build 4.
Taiyo must choose the next unused App Store Connect build number and verify
signing on the owned primary Mac checkout. No signing credentials or Apple
account access were changed.

Native status is **in progress — code complete, verification outstanding**.
Windows source review and added regression tests do not establish Swift
compilation or passing XCTest. Run the repository's guarded `scripts/validate.sh`
workflow, then complete the physical-iPhone acceptance matrix before archiving
and uploading to TestFlight. That matrix includes all six tests, incomplete
movement, recording interruption, offline restart, account switches, lost upload
acknowledgement, preservation of later admin revisions and 30/60/120/240-FPS
playback. Older installed builds do not discover the new immutable capture
children; update recording and reviewing devices together. No message was sent
to Taiyo.

## Historical evidence and follow-up files

The final independent repair checkpoint at `2026-09-17T21:08:20.691Z` preserves
all 325 rep IDs across 36 athletes: 258 qualifying results, 27 proven duplicate
documents and 40 remaining attempts without a qualifying measurement. Twelve
athletes have all six categories, 22 have partial coverage and two are unrecorded.
All 40 qualifying vertical jumps expose a bounded peak frame. See the separately
verified [recovery handoff](VACAVILLE_REP_RECOVERY.md) for the nineteen numerical
recoveries and one classification-only correction across both passes.

All 64 original video-unavailable rows were checked against the deployed media
resolver's evidence and object metadata, including two documented ownership
reassignments. Thirteen have verified diagnostic footage; 51 have no matching
footage in the current normal/diagnostic resolver locations. Separate external
archives were not searched by this check. Bulk availability used read-only
semantic replay without generating signed URLs; actual signing and playback were
verified separately in the hosted samples.

The original workbook remains unchanged. The private companion folder is
`PoseTek/Operations/PoseTek_Testing_Audit_Remediation_2026-09-17/` beside the source
workbook. `issue-disposition.csv` maps all 264 issue rows to current qualification,
software response and video availability; `roster-coverage-follow-up.csv` lists
current coverage for all 36 athletes. `REMAINING_CATEGORY_GAPS.md` distinguishes
the nine September 16 attendees still missing ten profile categories from failed
repeat attempts already covered by another valid result. A missing historic video
does not itself require a retest when valid category coverage already exists.
Use a complete separately retained original or a new attempt where a required
measurement remains absent. Keep these athlete-level files outside Git.

## Recovery boundary

The immediately preceding web candidate is `6aac51aec6abea278de64a84`; it contains
the main audit fixes but precedes the dedicated admin-link correction. The earlier
pre-audit website was `6aabc66e9bcc60cc5c2ee12c`. Before rollback, capture current
deployment/source versions and reconcile the protected baseline. Keep additive
result/media services and immutable capture compatibility while any new mobile
build is installed. Use the per-endpoint saved source/configuration/IAM receipts
and a fresh drift check for any scoped backend rollback; never redeploy the full
historical functions index or the native rules bundle.

Do not reset the Firestore private reporting rules or retention policies during
rollback. Do not overwrite historical repair revisions. The original workbook,
failure reports, source recordings and duplicate records remain evidence.
Reversing a historical category migration requires its private repair journal;
restoring only a metric revision does not undo session and duplicate mappings.

## September 17 follow-up: provisional Dribbling context

The later website release is `6aac666c61025a8e62e8c399`, published at
`2026-09-17T22:22:58.156Z` (3:22:58 PM PDT), from source `e1c4101` on
`codex/provisional-dribbling-recovery`. The release figures and verification
above remain records of the earlier testing-audit checkpoint. The current
[production receipt](../deployment/PROVISIONAL_DRIBBLING_PRODUCTION.json) and
[estimate handoff](PROVISIONAL_DRIBBLING_RECOVERY.md) record the follow-up.

Two near-finish Dribbling clips support separately labeled conditional estimates
on authenticated skill maps and optional low-confidence planning context. The
finish remains unrecorded. Estimates add no qualified result, completed category,
overall rating, ranking or Insights value and are not returned by shared readers.
The scoped authenticated reader is ACTIVE version 3; measured result projections
were identical before and after deployment and estimate publication. No Agility
estimate or workout plan was published by this follow-up.

Two further mislabeled attempts now belong to one Dribbling session. Their rep
IDs, dates and original footage were preserved; unsupported metrics remain null,
and both remain unqualified. The original successful agility attempt is intact.
The separate private migration journals retain all source, session and artifact
before-images. The video archive guard is now 30 entries in
`onvideoupload-00026-bup`, with the prior 26 entries and processor source preserved.
Use that current map for future releases, while retaining the older receipts.

Production contains 494 verified local files and 495 inventory entries. The
reconciled baseline protects 462 application/public files, with approved marketing
bytes unchanged. Production review confirmed both labeled estimates, unchanged
measured counts and the enabled, reversible planning option; no generation was
submitted. Baseline/release tests passed 19/19. The initial frontend suite had
928 passes and one home-pose timeout; its isolated rerun passed 10/10. The later
six-test provisional suite passed 6/6, and TypeScript plus 402 preview HTTP checks
across 11 routes passed. Backend checks passed 37 workspace tests and 32 packaged
candidate tests; one private fixture was intentionally omitted from the package
after passing in the workspace. This is not a new complete-suite pass claim.
Taiyo's native candidate and outstanding Mac/iPhone/TestFlight work are unchanged.

## Later September 17 follow-up: provisional Agility context

The current website is `6aac6cc0bfb1ddbe0a73e636`, published at
`2026-09-17T22:47:35.951Z` (3:47:35 PM PDT), from source `64b1dca`.
Read the [Agility production receipt](../deployment/PROVISIONAL_AGILITY_PRODUCTION.json)
and [method and recovery handoff](PROVISIONAL_AGILITY_RECOVERY.md). Earlier
release counts and receipts above remain historical checkpoints.

A confirmed no-ball agility attempt was corrected from Sprint to Change of
Direction with its original identity, date and artifacts preserved. Its missing
finish remains unmeasured; obsolete Sprint measurements are cleared and the
other genuine Sprint attempt is unchanged. This classification removes one
formerly qualifying Sprint result. A separate private estimate append adds only
labeled Agility coaching context, preserving the existing Dribbling entry.
Neither estimate contributes measured results, completion or Insights.

The authenticated reader is ACTIVE version 4. Its source-only deployment and
estimate publication preserve measured responses from the post-classification
checkpoint. The full current video guard has 32 entries in
`onvideoupload-00027-guw`; preserve all prior entries and historical journals.
The website's 542 local files match 543 inventory entries, with 510 protected
application/public files and approved marketing unchanged. Native acceptance
and display remain unchanged. No workout plan was generated or activated.
