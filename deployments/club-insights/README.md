# Scoped getClubInsights release

This tool targets exactly `getClubInsights`, generation 1, Node 22, in
`us-central1` / `kickai-69dd0`. It does not deploy the broad `functions/index.js`,
other callables, hosting, rules or indexes, and never writes athlete records.
The callable retains its authenticated, nonanonymous caller contract and 120-second
timeout. The adjacent wrapper exposes only this endpoint.

The source ZIP contains exactly six files: the scoped `index.js`,
`club-insights.js`, `club-access.js`, `athlete-storage-paths.js`, and the existing
`package.json` / `package-lock.json`. Relative dependency closure, lockfile root
dependencies, Node runtime, caller helper and callable export are checked against
the website source. The original package/lock pair is retained; no local install
or dependency regeneration is performed. Credentials, test fixtures, private
snapshots, unrelated handlers and local dependencies are excluded from the ZIP.

## Prepare and validate

Run from the repository root with Python 3.12 and Node 22. The owner session file
is an ignored private JSON file containing `access_token` and `expires_at` (Unix
milliseconds). Obtain/renew it through the already-authorized operator workflow;
the tool never stores a refresh token or prints credential/config bodies.

```powershell
python deployments/club-insights/release.py --mode dry-run `
  --run-dir .netlify/insights-function-release `
  --credential-file .netlify/owner-session.json

node --test functions/club-insights.test.js
node --test deployments/club-insights/scoped-entrypoint.test.cjs
python -m unittest discover -s deployments/club-insights -p test_release.py -v
```

Use a new ignored run directory for each newly reviewed plan. Dry-run performs
remote reads only and creates private local source/provenance receipts. It snapshots
the region's function inventory, target IAM and the runtime donor. If the target
already exists, it also downloads that exact version's source ZIP for rollback.
For a new target, the donor is the existing `getTeamLeaderboard`; only the listed
runtime fields are copied, with function-specific identity values adjusted.
Nonstandard network/secret/encryption settings require separate review and cause
the tool to stop. An existing target's runtime and IAM are preserved, with only
the explicit 120-second timeout and source ownership labels allowed to change.

The September 17 tooling validation passed 18 offline Python tests and 3 scoped
entrypoint tests; handler validation passed 16 tests. On Windows, the ordinary
user context may be needed for temporary-directory ACLs and Node test processes.
All tooling tests use fake APIs and synthetic data; none needs owner credentials.

After **all three commands succeed for the prepared source**, copy
`evidence-template.json` to `evidence.json` in that run directory and set
`handlerTests`, `scopedEntrypointTests` and `releaseToolTests` to `true`. Keep its
`planHash` and `sourceSha256` unchanged. This records executed checks, not an approval
request. Review `plan.json`, its six-file manifest and the private before-image.
If source changes after preparation, make and validate a new plan before deploying.

## Deploy and verify

Coordinate a single operator deployment window. The generation-1 Functions update
API has no version compare-and-swap field: this tool checks the complete live
inventory immediately before source upload and again before the narrow mutation,
but cannot make that remote check-to-write interval atomic. It refuses detected
drift; do not bypass it by editing the snapshot.

```powershell
python deployments/club-insights/release.py --mode deploy `
  --run-dir .netlify/insights-function-release `
  --credential-file .netlify/owner-session.json
```

If the result is `deploying`, wait for normal build progress, then repeat **the
same command with the same run directory**. The persisted operation is polled;
the source is not uploaded or deployed again. A new callable receives its standard
public transport invoker binding only after the completed operation's version,
runtime and downloaded source match the reviewed plan. Firebase authentication
and current club authorization remain inside the handler. The IAM update uses
the freshly read policy's etag and retains other bindings. Existing target IAM is
never rewritten. Do not create a second plan to retry an uncertain mutation.

```powershell
python deployments/club-insights/release.py --mode verify `
  --run-dir .netlify/insights-function-release `
  --credential-file .netlify/owner-session.json
```

Verify is read-only remotely. It checks the recorded version, every downloaded
source file hash, runtime settings, IAM and unchanged unrelated function inventory.
Source files are compared independently of ZIP timestamps/compression, and both
archive hashes remain in the receipts. Repeating deploy after a confirmed
deployment runs this verification without mutations.

Then perform functional read checks through the website or callable client:
unauthenticated and anonymous callers denied; current assigned staff allowed;
wrong-team/revoked staff denied; the expected bounded summary returned. Keep any
athlete-bearing response private. This tool does not automatically call the
endpoint or claim those functional checks passed.

If an HTTP timeout occurs between sending the function mutation and recording its
operation, the journal remains an unconfirmed intent. The tool stops rather than
blindly retrying. Inspect the operation/function version and source privately,
resolve the outcome and review recovery with the operator. Do not delete the
journal to force another deployment. Failed operations and unexpected configuration
also require review; there is no automatic rollback.

## Rollback and receipts

```powershell
python deployments/club-insights/release.py --mode rollback `
  --run-dir .netlify/insights-function-release `
  --credential-file .netlify/owner-session.json
```

Coordinate the website first. Rollback requires the confirmed release's current
version, source ownership and unchanged IAM; it stops if a newer release intervened.
For a target that existed before this release, it restores the private original
source archive, original labels and timeout, then verifies source, runtime and IAM.
For a target this release created, rollback deletes **only this owned callable**.
It does not delete or alter organization/player data. Repeat the same rollback
command while `rolling-back`; completed rollback is rechecked without mutations.

Keep the whole ignored run directory: `before.json`, `plan.json`, `source.zip`,
optional `rollback.zip`, evidence, deployment/rollback journals and `verified.json`.
The plan hashes its before-image and source manifest. Never commit these private
artifacts or signed URLs. Public handoff metadata may contain the endpoint,
version, source/plan hashes, verification timestamps and test outcomes.

The tool uses the scoped [Functions v1 update API](https://docs.cloud.google.com/functions/docs/reference/rest/v1/projects.locations.functions/patch),
with only `sourceUploadUrl,labels,timeout` in update masks. Its
[signed source uploads](https://docs.cloud.google.com/functions/docs/reference/rest/v1/projects.locations.functions/generateUploadUrl)
carry the required ZIP headers and deliberately carry no owner Authorization header.
