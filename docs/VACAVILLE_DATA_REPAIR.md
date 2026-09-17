# Vacaville September 16 data repair

## Status and approved result

**The production repair was applied and verified.** The CLI completed verification
at September 17, 2026, 06:58:26 UTC; an independent live verification passed at
06:59:29 UTC. The operator also confirmed that the existing director account can
see all four teams in the mobile app. Website and mobile application source and
deployments were unchanged by this repair.

The repair corrected ownership, organization access and roster records. It
did not change measurements, reprocess recordings or merge suspected duplicate
processing results. The reconciled roster contains 36 athletes: 16 girls and 20
boys, including a six-player team. One existing athlete received seven confirmed
reps recorded under a temporary demo profile. Three records for another athlete
were consolidated into the selected existing profile, retaining 12 reps across the
two recording dates. The director's existing account now has canonical organization
manager access.

The September 16 audit contains 101 rep documents and 23 failure reports. These
overlap and must not be presented as 124 separate attempts. Fourteen rep documents
lack an explicit Storage path; they remain preserved and flagged for a later
measurement audit. The date window is September 16 in `America/Los_Angeles`, or
`2026-09-16T07:00:00Z` through, but excluding, `2026-09-17T07:00:00Z`. Recording
session timestamps and upload timestamps must remain distinct.

This document intentionally excludes athlete identities, account identifiers,
contact details, signup codes, credentials and private backup contents. Existing
historical deployment and migration receipts remain unchanged.

## Scoped upload processor guard

The existing Storage finalize processor was active and would otherwise process
copied videos. Its recovered handler was updated with a narrow archive guard and
deployed as revision `onvideoupload-00023-nef` before copying recordings. Recovery
used the active May revision's source. A later failed July revision was not the
running implementation and was not used as the baseline.

The private environment configuration contains exactly 16 SHA-256 path hashes and
their archived MD5 checksums, covering eight video paths at both their original and
destination locations. Matching archived bytes are skipped; an event missing its
checksum at a known archived path is also skipped. Different bytes at the same
path, other uploads and body scans follow the original handler. The guard does not
trust a client-supplied migration metadata flag. Logs for the repair showed eight
archive skips and zero new processing requests from the copied recordings.

The guard's source and handler integration tests are in
[`functions/legacy-upload-processor/`](../functions/legacy-upload-processor/).
Keep the private path/checksum configuration out of Git. Keep the guard effective
for source restoration during rollback as well as destination copies. A future
repair requires its own reviewed coverage; this narrow configuration does not
protect unrelated recording paths.

## Private manifest and execution

[`scripts/data-repair.cjs`](../scripts/data-repair.cjs) accepts an explicit private
manifest; it does not discover or select athletes to change. The manifest contains
full raw Firestore before-images with update-time preconditions, complete planned
replacement fields, exact Storage generations and checksums, destination paths,
explicit JSON rewrites and a source cleanup list. Review full replacements for
preservation of every unrelated field, including literal dotted field names.

Keep the manifest, snapshot, audit workbook and run directory in an ignored private
directory inside the repository. The commands below use example private paths;
substitute the reviewed manifest and keep the same run directory for retries.
The tool uses the existing Firebase CLI Google login without putting credentials
in the manifest or command line.

```powershell
node scripts/data-repair.cjs --manifest .netlify/private-data-repair/manifest.json --run-dir .netlify/private-data-repair/run --mode dry-run
node scripts/data-repair.cjs --manifest .netlify/private-data-repair/manifest.json --run-dir .netlify/private-data-repair/run --mode apply
node scripts/data-repair.cjs --manifest .netlify/private-data-repair/manifest.json --run-dir .netlify/private-data-repair/run --mode verify
node scripts/data-repair.cjs --manifest .netlify/private-data-repair/manifest.json --run-dir .netlify/private-data-repair/run --mode rollback
```

Run `apply` only after the Storage processor guard is verified. Apply downloads and
checksums all original object bytes before remote mutations, copies objects,
creates destination rep/session documents, atomically commits the ownership and
roster changes with a receipt marker, verifies readback, then removes the specified
source objects. Each uncertain response is reconciled against recorded intent and
the exact manifest. Unexpected document edits, object generations or destination
contents stop the run.

The private run directory retains the manifest, before-images, original object
metadata and bytes, SHA-256/MD5 checksums, transformed outputs and a journal of
verified generations and document update times. Preserve it for recovery; the
public repository contains only the generic tool, synthetic tests and sanitized
handoff. Never change a manifest after starting its run or discard its journal to
force a retry.

`verify` checks the committed receipt, planned document contents, copied bytes and
source cleanup. `rollback` restores original object bytes and document fields
before removing repair-created destinations, and refuses to overwrite subsequent
changes. Restored objects receive new Storage generations; recreated Firestore
documents receive new system creation times. Original application timestamps are
restored from their recorded fields. External processor jobs and other asynchronous
side effects are outside the runner's rollback boundary, which is why the processor
guard is required before apply.

## Ownership and access invariants

- Preserve the selected existing athlete identities and signup invitations. Retire
  duplicate profiles only after their full subcollection inventory is accounted
  for, and remove their private signup invitations and every associated code index.
- Copy recording folders under the destination player document ID and rewrite
  operational references. Preserve calibration artifacts, incomplete results,
  videos and original timestamps. Remap colliding session numbers consistently in
  documents, paths and reprocessing sidecars; retain rep IDs and measurements.
- Preserve diagnostic report identities, reporter identities, original error text
  and dates while updating their player and recording references. Keep diagnostic
  bundle locations that are independent of player identity.
- Update only affected derived player caches. Preserve unrelated values and retain
  suspected duplicate rep documents. Team insights and leaderboards read canonical
  assignments and reps; check activity projections after their triggers settle.
- Establish manager authority in the canonical organization membership and keep
  organization directory fields, coach mirrors and team rosters consistent. Mirror
  fields alone do not grant authority. Verify the current mobile organization view
  after signing out and back in; an older installed build may lack that view.

## Verification and handoff

Run the focused synthetic suite with:

```powershell
node --test scripts/data-repair.test.cjs functions/legacy-upload-processor/repair-guard.test.cjs
```

Nineteen runner tests and seven guard tests passed. Tests cover drift and collision
refusal, checksum failure, copied and rewritten
objects, interrupted responses, partial preparation, cleanup retries, rollback,
concurrent edits and recovery of a restore that completed before its generation
was journaled. CLI mode coverage verifies authorization after original source
objects have been removed; field comparisons account for Firestore's equivalent
empty-container wire representations. The guard tests execute the actual handler
with mocked Storage and HTTP clients, confirming that archived events perform no
Storage API or processor work while ordinary MOV uploads and body scans retain
their contracts. Live processing behavior was checked separately in the logs.

Live CLI verification confirmed all 58 manifest document operations, 85 copied
objects, one in-place diagnostic JSON rewrite and cleanup of the 85 original
objects. The private journal retains the before-images and original bytes.

Independent live verification confirmed:

- The complete inspected rep inventory remains 360 documents before and after;
  5,536 original field checks preserve measurements and timestamps, and all 333
  checked session links resolve. This historical total differs from the 101
  documents in the September 16 audit.
- The consolidated profile has 12 reps, the corrected existing profile has seven,
  and the temporary demo retains its one unrelated August rep. Retired signup
  invitations and code indexes are absent.
- The organization has 38 profiles, including the two excluded demonstration/test
  profiles, with 36 athletes and exactly six players on the reused team. Thirty-two
  unrelated player assignments are unchanged.
- All 86 destination object generations/checksums and 11 rewritten JSON artifacts
  match the manifest. Structured recording and session references resolve.
- Website playback checks passed for the transferred sprint and remapped historical
  broad-jump session 3. Current session 1 and remapped historical sessions 2/3 retain
  distinct labels; all referenced artifacts passed checksum verification.
- All 41 activities for the seven affected canonical athletes match recomputed
  feed projections. No transferred activity remains under the temporary demo or
  either retired profile; no manual feed rebuild was necessary.

- [x] Repeating live `apply` with the original manifest and run directory completed
  verification at September 17, 2026, 07:01:31.434 UTC with zero remote mutation
  attempts. Object generations and the document journal remained unchanged. The
  private repeat-verification receipt records this result.
