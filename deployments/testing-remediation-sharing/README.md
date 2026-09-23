# Testing remediation: compatible sharing overlay

Prepare the two existing share-read callables from the exact captured serving
source, never the root `functions/index.js`. Production retains unsigned links
for unmigrated athletes; signed club shares receive the same verified result
values and identity-checked media resolver as authenticated readers.

`baseline.json` pins all eight live source files from getAthleteResultsShare v9
and getAthleteSharedRepArtifacts v8. It contains hashes only. The private runtime
configuration, signing secret binding, environment, service account, IAM and
other live settings must be retained during deployment.

```powershell
node deployments/testing-remediation-sharing/prepare.cjs .netlify/testing-remediation/getAthleteResultsShare-source .netlify/testing-remediation/sharing-candidate
node --test functions/effective-results.test.js deployments/testing-remediation-sharing/prepare.test.cjs
```

Preparation refuses an existing destination or any live-source drift. It keeps
`index.js`, package files, sharing issuance/authorization modules and runtime
configuration byte-identical, changes only the signed club result/media handlers,
and adds reviewed evidence modules plus the compatible recording-path helper.
Unsigned legacy dispatch, migration guards and Free Record remain unchanged.
The final candidate contains unrelated old exports; deploy **only**
`getAthleteResultsShare,getAthleteSharedRepArtifacts`, preserving their live
configuration and signing secret. Do not deploy the whole codebase. The two new
authenticated effective-result endpoints have their own isolated source package.

Before replacing either endpoint, capture current version/source/config/IAM and
verify it still matches this baseline. After rollout, download each deployed source
and compare every candidate byte, then check live signed-club read/media and
revoked/wrong-team denial, ordinary legacy-share compatibility and Free Record.
An unavailable evidence fetch must fail the read instead of returning raw metrics.

Rollback restores the exact prior source and captured configuration only if the
current function still matches this release. Preserve signed club migration
boundaries; never restore pre-migration unsigned behavior for club athletes.
No athlete records, rules, TTL policy or historical receipts are changed here.
