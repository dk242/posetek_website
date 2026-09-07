This is a prepared, **not deployed** release for club organization support. It updates exactly 19 gen1 HTTP Cloud Functions in `kickai-69dd0/us-central1`; `release-manifest.json` lists every endpoint and source hash. Sixteen new endpoints use the reviewed `functions/` runtime. The three existing athlete-sharing endpoints use the separate [scoped sharing candidate](sharing/README.md). `aiCoachStreamProxy`, other services, rules, hosting and data are outside this deployer's mutation scope.

The existing baseline was read on September 7, 2026: Node.js 22, 256 MB, 60-second sharing timeout, `kickai-69dd0@appspot.gserviceaccount.com`, public HTTP invoker IAM. The new logo callable uses 120 seconds. No local Functions dependencies are installed: `gcloud functions deploy` uploads small, explicitly curated source directories and performs dependency resolution in remote Cloud Build. The installed gcloud 565.0.0 deploy help was checked for these flags. Actual build/deployment behavior is pending.

The release script has separate offline `prepare`, read-only `snapshot`, and mutating `deploy` commands. Preparation creates a private plan containing exact argument arrays, source hashes and environment-file hashes. Deployment rejects changed source, changed ignore rules, extra source files, changed environment files, changed endpoint scope, changed baseline/IAM, mismatched rollback archives, disabled secret versions, or incomplete validation before applying a plan. It deploys sequentially, preserves existing sharing IAM/settings, records each version in a private journal and verifies that the existing AI proxy is unchanged. Failure stops the rollout; a partial journal must be reviewed before retrying.

Current verification: 12 scoped-sharing dispatch tests and 12 deployment-tool tests passed. The latter cover exact endpoint/source scope and the release rejection boundaries, including proof that incomplete SDK evidence stops before any gcloud call. Real Firebase SDK authorization, secret/runtime IAM, cloud build, deployed protocol/signing and final product checks remain pending. Root tracks web/native/gateway validation separately; a passing mock test cannot replace those checks.

Run preparation from the web repository, using fresh private output paths:

```bash
python3 deployments/club-organization/functions-release.py snapshot --output /private/tmp/club-function-baseline
python3 deployments/club-organization/sharing/prepare.py \
  --baseline /private/tmp/posetek-club-function-deploy-private/sharing-baseline-source \
  --output /private/tmp/club-sharing-source
python3 deployments/club-organization/functions-release.py prepare \
  --source functions \
  --sharing-source /private/tmp/club-sharing-source \
  --sharing-manifest deployments/club-organization/sharing/source-manifest.json \
  --baseline /private/tmp/club-function-baseline/baseline.json \
  --output /private/tmp/club-function-release \
  --share-secret-version 1
```

Version `1` is a preparation example, not evidence that a secret exists. The read-only audit found `ATHLETE_SHARE_SIGNING_KEY` absent. Before release, create a high-entropy secret using stdin or a mode-600 temporary file without logging its value; pin the actual enabled numeric version and regenerate the plan if it differs. Grant the runtime account `roles/secretmanager.secretAccessor` on that secret only. Grant/verify `iam.serviceAccounts.signBlob` on the signing account (normally `roles/iam.serviceAccountTokenCreator` on the runtime account itself) and object-read access for athlete artifacts. The logo function additionally needs object creation in the reviewed branding prefix; Firestore services need the existing server-side datastore access. Inspect existing grants first and add only missing capabilities. The operator needs function create/update and IAM-policy rights, `iam.serviceAccounts.actAs` on the runtime account, and the existing Cloud Build/service-agent prerequisites. The deployer does not change project, service-account, bucket or secret IAM automatically.

Keep read-only IAM/secret metadata evidence private. Useful checks are `gcloud secrets versions describe VERSION --secret=ATHLETE_SHARE_SIGNING_KEY --project=kickai-69dd0`, `gcloud secrets get-iam-policy ATHLETE_SHARE_SIGNING_KEY --project=kickai-69dd0`, `gcloud iam service-accounts get-iam-policy kickai-69dd0@appspot.gserviceaccount.com --project=kickai-69dd0`, and the project's/bucket's current IAM policies. Verify effective permissions, including inherited policies; a direct-policy omission alone does not prove access is missing.

Create a private evidence JSON using the prepared plan's `planHash` and combined `sourceManifestHash`. Every name in `plan.requiredVerification` must map to `true` under `checks`, backed by the relevant test/IAM receipts. `rollbackSources` must contain all three existing sharing endpoint names, each with the absolute private baseline ZIP path and its SHA-256. This evidence records completed checks; do not mark unrun checks true. The current private baseline archive is `sharing-baseline.zip` under `/private/tmp/posetek-club-function-deploy-private`; its hash is pinned in the sharing manifest. All three serving sharing functions had the same source-upload identifier and Firebase source hash, recorded in the sanitized manifest.

Only after those checks, review and run the explicit mutation:

```bash
python3 deployments/club-organization/functions-release.py deploy \
  --plan /private/tmp/club-function-release/plan.json \
  --evidence /private/tmp/club-function-release/evidence.json \
  --journal /private/tmp/club-function-release/deployment-journal.json
```

The script prints no config or secret values. Private CLI receipts may contain runtime configuration and must not be committed. It verifies runtime/IAM/labels after each deploy; download the newly serving sources and compare their file hashes to the two source manifests to substantiate the source labels. Then verify callable envelopes, unauthenticated rejection on privileged methods, verified-email claim, invite replay rejection, manager/coach/team isolation, assignment revocation, club signed sharing and unchanged nonclub sharing. Confirm artifact signing and public logo access. Migration must follow successful production authorization checks across scoped rules, gateway and these functions.

Rollback evidence includes the original source ZIP/file hashes, complete private function metadata/IAM snapshots, and the version journal. Before migration, a function rollback can redeploy that exact extracted baseline for only the three sharing endpoints, restore their saved settings/IAM, remove only the added signing-secret binding and release label, and review deletion of the sixteen newly created functions. Do not blindly restore baseline rules/gateway/sharing after players have migrated: that would restore old authorization paths. After migration, preserve the club access guards or first execute the reviewed, preconditioned data rollback as part of a coordinated rollback. Never overwrite athlete changes that happened after migration.

The first authorized rollout attempt was rejected locally by gcloud because `deployment-callable` is a reserved label key. All five existing regional functions were verified byte-for-byte unchanged and no new function was created. The deployer now sets only `posetek-club-source`, preserving preexisting Firebase labels automatically; a regression test covers that command boundary. The new signing secret and its sole runtime accessor binding remain in place. A fresh baseline and plan are required for the corrected attempt.

The corrected attempt (2026-09-07 22:01Z) created `getClubContext` but gcloud reported "Setting IAM policy failed" for its public invoker binding, so the deployer stopped after that first operation with zero confirmed functions and the other fifteen new callables never created; the three sharing endpoints were not touched. Preparation now recognises a `posetek-club-source` function whose live policy lacks the `allUsers` invoker binding as a `resume` operation: its settings and environment are kept and only `--allow-unauthenticated` is reapplied. Deployment applies gcloud's own documented remediation (`functions add-iam-policy-binding … --member=allUsers --role=roles/cloudfunctions.invoker`) once for a created or resumed function and still requires the binding on readback. Take a fresh snapshot and plan before that retry; the plan summary reports `resumedFunctions`.

The resumed rollout (2026-09-07 23:05Z) created the fifteen remaining callables, confirmed the resumed one, and updated `createAthleteResultsShare` with its signing secret, but then halted on that function's readback because gcloud rewrites the `deployment-tool` label from `cli-firebase` to `cli-gcloud` on every deploy; memory, timeout, service account, environment, ingress, secret binding and invoker IAM were all unchanged. The runtime comparison now ignores that tool-owned label alongside `deployment-callable`. Preparation also recognises a function whose `posetek-club-source` label already equals the plan's source hash, whose invoker binding is present and, for sharing endpoints, whose signing-secret binding is present, as a `verified` operation: deployment skips the gcloud call and only performs the readback checks, so a retry after a partial rollout does not redeploy identical sources. The plan summary reports `verifiedFunctions`.
