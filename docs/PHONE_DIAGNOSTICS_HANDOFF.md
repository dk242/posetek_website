# Phone diagnostics — implementation checkpoint

Status: **in progress — code complete, physical/deployed verification outstanding; locally integrated into main, not released or deployed**. Paired mobile plan:
`PoseTek-mobile-app/docs/plans/PHONE_DIAGNOSTICS_AND_TRIAGE_PLAN.md`.
The validated paired `phone-diagnostics-triage` branches integrate through local non-fast-forward
merges; physical/deployed checks remain release gates and do not hold the source branches open. This is additive diagnostic evidence, not a metric,
leaderboard, testing-station authorization or athlete-identity source.

## Contracts and sources

`processingAttempts/{attemptId}` indexes immutable capture/actor/event/build identity,
the monotonic lifecycle sequence and latest run. `failureCases` schema 2 preserves
schema-1 viewing and uses stable `processing-<run UUID>`, `capture-<attempt UUID>`,
`setup-<setup UUID>`, `launch-<original launch UUID>`, and `system-<payload SHA-256>` IDs. A missing terminal journal
means interrupted/unknown; it does not establish OOM. Attempt IDs, station run IDs,
processing run IDs and pre-athlete setup IDs have separate meanings.

Changed surfaces: `failureDashboard.html`, Firestore/Storage diagnostic rules,
`functions/diagnostic-uploads.js`, `functions/diagnostic-retention.js`, and their
exports in `functions/index.js`. Both rule sets exclude new diagnostic roots from
the website's legacy broad fallbacks. Schema-2 artifact reads are verified-admin
only. Original reporters can read authorized metadata, but cannot directly upload
schema-2 objects through Storage Rules. Schema-1 compatibility is retained.

`beginDiagnosticUpload` validates the immutable original reporter, current athlete
access or event/organization setup authority, bounded path/MIME/length/hash, and
retention state before issuing a Google resumable upload session. It tags video
`posetekLocalProcessed: true`. The app keeps session URIs in memory only, uses
file-based MOV uploads and never records these credentials in diagnostics. New
requests after revocation fail. Already-issued sessions are capabilities and can
remain active until completed/cancelled or expired; this is not instantaneous
revocation of an in-flight upload. No download URLs or service-account keys are issued.

Google documents a one-week session lifetime. Issuance is serialized with retention
claims through a server timestamp; cleanup waits eight days after the latest session
issuance so an abandoned session cannot resurrect deleted artifacts. See
[Google's resumable-upload contract](https://docs.cloud.google.com/storage/docs/resumable-uploads).
The SDK's `metadata.contentLength` is sent as `X-Upload-Content-Length`; production
transport/length enforcement still needs verification with the deployed callable.

## Retention and holds

`acknowledgeDiagnosticArtifacts` and `acknowledgeDiagnosticAttempt` stamp the first complete-artifact acknowledgement.
`setDiagnosticInvestigationHold` accepts verified administrators only and manages a
hold plus up to 64 reference IDs. `cleanupDiagnosticArtifacts` checks at most 50
incident documents and 50 attempt documents per sweep, using a rotating cursor so held/partial rows do not
starve later candidates. It is **disabled unless** `config/diagnosticsRetention.enabled`
is explicitly true. No enabling configuration has been written.

Default retention is seven days after acknowledgement for diagnostic-only video and
30 days for the remaining allowlisted bundle objects, extended by the upload-session
safety window above. Holds and references block deletion. A transaction claims cleanup
before deleting objects; client writes and late session issuance then fail. Partial
deletion can retry, missing objects are harmless, and metadata remains a tombstone.
Ordinary athlete archive prefixes are never enumerated or deleted. Declared original calibration
PNG objects (at most four immutable observation IDs/hashes) are included in bundle cleanup.
Terminal acknowledged attempt manifests expire after 30 days only if no incident, hold or
explicit reference protects them. Retention preserves metadata tombstones.

The mobile uploader also preserves rejected pre-bundle profile frames, accepted standalone
calibration, original actor-only launch evidence, measured video metadata, and local archive
handoff receipts. A successful retry uses original input/calibration hashes and a new linked run;
unfinished native work is never replayed automatically.

## Validation and release gates

Validated source: website `60c84c0`, mobile `1160a8f`. Exact source/build/log hashes and
suite counts are recorded in mobile `tools/diagnostics/validation/2026-09-23.json`.

- Paired mobile canonical rules suite: 689 emulator tests passed before this handoff;
  final exact-source receipt is in the mobile `firebase/test-results/verification.json`.
- Both rule variants have focused real-emulator assertions for original attribution,
  sequence, scope, closed-event setup, revoked metadata access, broker-only uploads,
  admin-only byte access and cleanup protections. 58 additional assertions passed (60 TAP tests including parent suites).
- Backend upload/retention tests: 16 passed, including revocation, path/size/hash rejection,
  holds/references, disabled cleanup, partial deletion recovery and the upload-session window.
- Function entrypoint syntax passes. No new callable, trigger or scheduler was deployed.
- Mobile device, simulator test and signed runtime compilation passed; 56 focused XTests in
  10 suites passed. Current-source support-copy, scrolling settings, recovery empty state and
  dismissal passed on the canonical simulator. Signed-in populated viewer/retry UI,
  physical-iPhone fault/lock/offline/auth-switch/overhead tests, and controlled crash/dSYM
  acceptance remain unverified. The independent reviewer could not run because Claude
  Code was not authenticated. No independent approval is claimed.

Do not deploy this checkpoint as a complete feature. Run callable integration/transport tests and verify the
exact production rules source before seeking release approval. Deployment must include
`beginDiagnosticUpload` before a new app can send schema-2 artifacts. Keep retention
disabled until its deployed fault/concurrency checks pass. Deploy only the website rule
source approved for production, never the mobile lockdown rules wholesale.

Rollback must preserve existing schema-1 behavior, source attempt/outbox files, durable
prepared commits and diagnostic authorization tombstones. Do not clear pending phone
evidence merely because uploads are unavailable. No remote push, release, configuration
write, cleanup, real athlete write or issue mutation was performed for this checkpoint.

## Prepared scoped release commands — not executed

From this website checkout, after release approval and reconciliation against the then-live
rules source, rerun the paired real-emulator tests and the focused backend tests. Keep the
retention enable flag absent/false. The scoped Firebase commands are:

```sh
node --test functions/diagnostic-uploads.test.js functions/diagnostic-retention.test.js
firebase deploy --project kickai-69dd0 --config firebase.json --only functions:beginDiagnosticUpload,functions:acknowledgeDiagnosticArtifacts,functions:acknowledgeDiagnosticAttempt,functions:setDiagnosticInvestigationHold,functions:cleanupDiagnosticArtifacts
firebase deploy --project kickai-69dd0 --config firebase.json --only firestore:rules,storage
```

Do not run these from mobile or combine them with a hosting/full-functions deploy. The viewer
must use this repository's protected-baseline website release workflow. Before distributing
the app, verify broker upload/readback, wrong-account/revoked access, oversized bytes, partial
acknowledgement, hold/delete races and session expiry using authorized test evidence. The local
unit and rules tests do not establish those deployed transport/IAM results. No retention enable
command is supplied until its fault/concurrency acceptance passes.
