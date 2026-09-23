# Operator source-only deployment helpers

These tools are limited to the exact reviewed functions. They use the existing
Firebase CLI account without printing its token. Prepare stores immutable source,
original function definition and IAM privately; apply checks for drift twice and
patches only the source field. Neither tool grants permissions nor changes runtime,
resources, environment, secrets, triggers, retry policy or IAM.

For generation 2 `onVideoUpload`:

```powershell
node deployments/testing-remediation-upload/source-only.cjs prepare .netlify/testing-remediation/upload-release .netlify/testing-remediation/onVideoUpload-before.json
node deployments/testing-remediation-upload/source-only.cjs apply .netlify/testing-remediation/upload-release
node deployments/testing-remediation-upload/source-only.cjs verify .netlify/testing-remediation/upload-release
```

Preparation accepts only the reviewed original serving source. It captures fresh
configuration and Cloud Run service IAM, packages the four tracked legacy-upload
source files and preserves the existing private archive map. Add any separately
authorized exact path/MD5 archive protection before preparation, then verify it
remains present before copying recovery videos. This helper never changes the map.

For either sharing read endpoint, the three immutable-path compatibility
endpoints, or the canonical team leaderboard, prepare its exact source overlay first and supply its separately
captured **single function** definition JSON (not the whole inventory):

```powershell
node deployments/testing-remediation-upload/v1-source-only.cjs prepare adminReviseRep .netlify/testing-remediation/revise-release .netlify/testing-remediation/path-compatibility/adminReviseRep-candidate .netlify/testing-remediation/path-compatibility/adminReviseRep-before.json
node deployments/testing-remediation-upload/v1-source-only.cjs apply adminReviseRep .netlify/testing-remediation/revise-release
```

Allowed generation-1 endpoints are `getAthleteResultsShare`,
`getAthleteSharedRepArtifacts`, `adminReviseRep`, `adminSaveAnalysisReview`,
`getSocialMedia`, and `getTeamLeaderboard`. Each has a separate run directory and captured baseline. Apply
sequentially. The shared source preserves the unsigned legacy dispatcher; do not
substitute the root functions index. The native path overlays change only the
recording parser in each endpoint's exact source.

The helpers journal intent before PATCH. If acknowledgement is lost, apply refuses
a blind retry. Use verify, inspect the saved operation and current source/version,
and reconcile; a failed verification is not permission to overwrite a new release.
Verification requires ACTIVE state, exact archive bytes, unchanged protected
configuration and unchanged IAM. Platform source repackaging may require an
independent per-file comparison before accepting a different archive hash; the
tool does not silently accept it. Keep all source, config and operation receipts
ignored. Rollback uses the verified original archive and configuration after an
explicit current-version/source/IAM check; these scripts do not automate rollback.

Run `node --test deployments/testing-remediation-upload/source-only.test.cjs`.

The source-only masks and credential-free signed ZIP uploads follow the official
[Functions v2 PATCH](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/patch)
and [source upload](https://docs.cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/generateUploadUrl)
contracts. Service policies are read through
[Cloud Run getIamPolicy](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/getIamPolicy).
