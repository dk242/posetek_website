# Immutable capture path compatibility

`adminReviseRep` v3, `adminSaveAnalysisReview` v1 and `getSocialMedia` v4 were
captured read-only on September 17. Their serving parsers reject the new
`sessionN/kickN/capture_<32hex>/file` layout. This overlay replaces only
`athlete-storage-paths.js` in each exact captured source bundle. Source and
configuration inventories and IAM policies are kept privately by the operator.

```powershell
node deployments/testing-remediation-paths/prepare.cjs adminReviseRep .netlify/testing-remediation/path-compatibility/adminReviseRep-source .netlify/testing-remediation/path-compatibility/adminReviseRep-candidate
```

Repeat separately for `adminSaveAnalysisReview` and `getSocialMedia`. Preparation
verifies every source hash against `baseline.json` and refuses drift or an existing
output. Existing runtime configuration, package files, handler code and unrelated
exports remain exact. Deploy only the named endpoint from its own candidate,
preserving its captured runtime/resources/environment/secrets/service account/IAM.
Never deploy all exports from these recovered historical bundles.

`adminRestoreRepRevision` restores the recorded revision folder directly and
`adminExportAnalysisReviews` uses stored review snapshots; neither runs the path
parser in that operation, so neither needs this rollout. Insights, signed sharing
and the two new authenticated reader endpoints receive the same parser through
their separately reviewed release packages.

Validation: parser tests cover old forms, malicious paths, exact immutable capture
folders and mismatching capture identities; rep-revision, review and social handler
regressions still pass. Verify deployed source bytes and unchanged configuration
and IAM, then exercise capture-folder playback/review with authorized synthetic
fixtures before the Mac release. No historical recordings or data are changed.
