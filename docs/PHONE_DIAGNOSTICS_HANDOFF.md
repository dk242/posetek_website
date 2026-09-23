# Phone diagnostics — implementation checkpoint

Status: **in progress; not release-ready, deployed, or merged**. Paired mobile plan:
`PoseTek-mobile-app/docs/plans/PHONE_DIAGNOSTICS_AND_TRIAGE_PLAN.md` on branch
`phone-diagnostics-triage`. This is additive diagnostic evidence, not a metric,
leaderboard, testing-station authorization or athlete-identity source.

## Contracts and sources

`processingAttempts/{attemptId}` indexes immutable capture/actor/event/build identity,
the monotonic lifecycle sequence and latest run. `failureCases` schema 2 preserves
schema-1 viewing and uses stable `processing-<run UUID>`, `capture-<attempt UUID>`,
`setup-<setup UUID>`, and `system-<payload SHA-256>` IDs. A missing terminal journal
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

`acknowledgeDiagnosticArtifacts` stamps the first complete-artifact acknowledgement.
`setDiagnosticInvestigationHold` accepts verified administrators only and manages a
hold plus up to 64 reference IDs. `cleanupDiagnosticArtifacts` checks at most 50
incident documents per sweep, using a rotating cursor so held/partial rows do not
starve later candidates. It is **disabled unless** `config/diagnosticsRetention.enabled`
is explicitly true. No enabling configuration has been written.

Default retention is seven days after acknowledgement for diagnostic-only video and
30 days for the remaining allowlisted bundle objects, extended by the upload-session
safety window above. Holds and references block deletion. A transaction claims cleanup
before deleting objects; client writes and late session issuance then fail. Partial
deletion can retry, missing objects are harmless, and metadata remains a tombstone.
Ordinary athlete archive prefixes are never enumerated or deleted. Attempt-manifest
expiry and original multi-observation cleanup remain unfinished in the paired plan.

## Validation and release gates

- Paired mobile canonical rules suite: 689 emulator tests passed before this handoff;
  final exact-source receipt is in the mobile `firebase/test-results/verification.json`.
- Both rule variants have focused real-emulator assertions for original attribution,
  sequence, scope, closed-event setup, revoked metadata access, broker-only uploads,
  admin-only byte access and cleanup protections. See the mobile plan for the final count.
- Backend upload/retention tests: 12 passed, including revocation, path/size/hash rejection,
  holds/references, disabled cleanup, partial deletion recovery and the upload-session window.
- Function entrypoint syntax passes. No new callable, trigger or scheduler was deployed.
- Swift type checking, new XCTest recovery cases, signed-in populated viewer/support UI,
  physical-iPhone fault/lock/offline/auth-switch/overhead tests, and controlled crash/dSYM
  acceptance remain unverified. The independent reviewer could not run because Claude
  Code was not authenticated. No independent approval is claimed.

Do not deploy this checkpoint as a complete feature. Finish the paired plan's remaining
implementation, compile the app, run callable integration/transport tests and verify the
exact production rules source before seeking release approval. Deployment must include
`beginDiagnosticUpload` before a new app can send schema-2 artifacts. Keep retention
disabled until its deployed fault/concurrency checks pass. Deploy only the website rule
source approved for production, never the mobile lockdown rules wholesale.

Rollback must preserve existing schema-1 behavior, source attempt/outbox files, durable
prepared commits and diagnostic authorization tombstones. Do not clear pending phone
evidence merely because uploads are unavailable. No remote push, release, configuration
write, cleanup, real athlete write or issue mutation was performed for this checkpoint.
