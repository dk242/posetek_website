# Effective recorded results and media

`getAthleteEffectiveResults({ playerId, drill? })` returns `{ version: 1, reps }`.
The optional drill is one of shooting, sprint, jump, broadJump,
changeOfDirection or dribbling. Free Record retains its separate existing reader.
Every allowlisted rep includes identity/presentation fields, `createdAtMillis`,
measurement/frame fields, and:

```text
resultStatus: { qualified: boolean, reason: string,
                duplicate: boolean, revisionId: string | null }
```

Authenticated results also include `storageFolder`, the validated exact rep or
immutable capture folder, or null when ownership/identity is ambiguous. Native
readers join artifacts by that exact folder; they must not guess numeric paths
when the field is null. Shared rows omit this field and use the scoped media
endpoint. Snake/camel and height-unit aliases preserve reviewed nulls consistently.

The server reads the same generation-pinned processing evidence, failure links,
accepted revisions and duplicate rules as Expanded Insights. Unqualified and
duplicate measurements are null. Explicit nulls in reviewed rep fields cannot be
revived by old metadata. Broad-jump horizontal distance and secondary jump height
remain separate: invalid/nonpositive height does not invalidate distance. Missing
legacy vertical-jump peak frames use original ordered `key_frames.json` only when
bounded by the original torso series; explicit null revision fields remain null.

Authorized callers are the canonical athlete, verified PoseTek admin, current
organization manager or assigned coach, or bound legacy roster coach. Access is
checked before work and again before returning. Identity, evidence or transport
failures never return raw numeric fallbacks. Consumers must show unavailable/retry.

`getAthleteRepMedia({ playerId, drill, repId })` returns `artifactUrls`, `mediaUrl`,
`source` (recording/diagnostic/unavailable), `expiresAtMillis` and `resultStatus`.
URLs last 15 minutes and pin the inspected object generation. Reused folders with
conflicting explicit sidecar identities never supply another attempt's footage.
Fallback diagnostic footage requires the exact Firestore failure owner/rep and a
matching original report owner path/rep. Reports, logs and contact data are never
returned. Consumers must reconcile status with the list before displaying metrics.

Signed club sharing uses these same result/media functions. Its live deployment
must use the compatible overlay in `deployments/testing-remediation-sharing`,
because unmigrated athletes retain the existing unsigned legacy share protocol.
Do not replace that serving dispatcher with root `functions/index.js`.

`getTeamLeaderboard` retains its existing team/legacy roster authorization and
names-plus-measurement whitelist while qualifying through the same internal
reader. Only qualified nonduplicate reps leave that projection. Athlete clients
therefore never need direct access to teammates' rep documents or media paths.
Its exact live-source overlay is `deployments/testing-remediation-leaderboard`.

## Immutable captures and audited duplicate corrections

New native captures use `{player}/{drill}/sessionN/kickN/capture_<32hex>/file` with
matching `captureId` and fixed rep ID. An explicit capture path never falls back
to the enclosing numeric folder. Session/rep numbers are presentation labels;
recording dates and IDs break ties, and absoluteRepNumber may be absent.

A reviewed cross-drill correction can identify an old pathless mirror with
`rep.duplicateOf = canonicalRepId`. That mobile-writable field alone is ignored.
The server must also find this protected document:

```text
players/{playerId}/insightMetadata/resultCorrections
{ schemaVersion: 1, repairId: "audited-repair-id", reviewedAtMillis: 123,
  duplicateReps: { mirrorRepId: canonicalRepId } }
```

The existing rules deny client access to insightMetadata. Both IDs must exist
within this same player's inventory, the mirror's duplicateOf must match, and the
target cannot itself be a duplicate. Self-links, missing targets, chains and
cycles are rejected. Keep original measurements and the private repair before-
images. `projectInsightRecords` already watches insightMetadata changes, so a
correction invalidates/rebuilds reporting without altering athlete history.

## Validation and release

Focused tests live in `effective-results.test.js`, `insights-v2-qualification.test.js`,
`athlete-storage-paths.test.js` and `insights-entrypoints.test.js`. The shared evidence
reader is also exercised through complete Insights projection tests. Existing
rep-revision/review/social tests cover their old contracts; immutable capture
revision tests verify no writes escape into a reused numeric folder.

Deploy the new authenticated callables with the separate reviewed source bundle.
Insights needs its scoped release to pick up the shared reader and capture event
paths. Existing revision/review/social-media endpoints require parser-only overlays
from `deployments/testing-remediation-paths`. Preserve configuration, IAM, signing
secrets, private-path rules and all TTL policies. The new readers do not mutate
recordings, measurements, profiles or diagnostic history.
