# Shared personalized planner

This service is editable source recovered from the image serving the personalized
admin pilot. `SOURCE_BASELINE.json` records the matching Cloud Build archive and
original file hashes. The Cloud Run service's older `buildConfig` is not its serving
source; the active revision's image digest was matched to its successful build.
Runtime code, knowledge assets and synthetic regression fixtures are included.
Private historical evaluation recordings and credentials are excluded.

The website uses four capabilities: `assess_personalized_plan`,
`generate_personalized_plan`, `activate_personalized_plan` and
`discard_personalized_plan`. Current athletes can plan for themselves, current
assigned coaches for their team, current managers for their club, and verified
administrators for all players. Generation creates a draft. Its requester explicitly
reviews and activates it; administrators may also manage existing pilot drafts.
Native schema-3 `generate_training_plan` uses the same evidence-to-objective
methodology and weekly exercise selection. It retains its existing direct
active-plan persistence, schema-3 contract, permissions and daily allowance of one
generation; the web flow still requires
explicit draft activation. Individual-workout editing keeps its existing contract.
See [`PERSONALIZED_PLANNER_METHODOLOGY.md`](../../docs/PERSONALIZED_PLANNER_METHODOLOGY.md)
for evidence qualification, reviewed estimates, exercise mappings, UI behavior
and the native reader boundary. Historical release checkpoints below describe
their original deployments, not the current method's release status.

The current evidence-methodology gateway is live as
`agent-gateway-web-e75e9318d15d`. Website deployment
`6aac7f6c315a6190c054fba7` was published September 17 at 5:35 PM PDT.
The narrow shared Firestore rules update is deployed: personalized assessment
and generation accept optional boolean `useProvisionalEstimates`, with omission
retained for existing callers. Actor checks and activation/discard parameter
allowlists are unchanged. Its emulator suite passed 353 assertions. The final
sanitized release receipt, including the website promotion result, is at
[`EVIDENCE_PLANNER_PRODUCTION.json`](../../deployment/EVIDENCE_PLANNER_PRODUCTION.json).
Do not infer a numerical full-container test count from the historical checkpoint
below; use that final receipt and the immutable build logs.

Each personalized `config/llm.capabilities` entry requires literal `enabled: true`.
`dailyLimitPolicy: "unlimited"` removes its product daily limit. The global feature
gate, trusted identity, current membership, usage ledger and infrastructure quotas
remain enforced. No large numerical sentinel or zero quota is required. Other
capabilities ignore this policy and retain their existing behavior.

## Public review contract

`players/{playerId}/personalizedPlanDraftViews/{draftId}` is server-written. Its ID
matches the private draft. Nonadministrators query by `createdByUid == currentUid`
within the selected player and require current access; each personalized job query
also constrains `requestedByUid` and `playerId`. Revocation or moving a player
revokes reads of previous jobs and views. Clients cannot write drafts, views,
contexts or operation leases. Original draft/context collections remain private.

The explicit projection contains executable schema-3 workouts, safe intake,
assessment and comparison summaries, lifecycle metadata, an opaque comparison
token and expected active-plan revisions. It excludes raw feedback, peer identities,
internal hashes and diagnostics. Activation writes the same safe executable plan
to player-readable `trainingPlans` and retains privileged context separately.
Historical administrator-only pilot drafts need no backfill. Existing saved plans,
workout logs and reservations are preserved by the existing activation contract.

## Delivery and recovery

An atomic transaction claims the job and its player's operation lease together.
Duplicate/competing delivery returns a retryable response. The lease renews every
30 seconds, expires after 120 seconds without renewal, and has a one-hour attempt
deadline. Expired attempts are recoverable. Every model call and final write is
fenced by the current token; stale workers cannot publish or activate. Draft IDs
and activation responses are idempotent. Current authorization and the complete
testing/history baseline are rechecked during activation.

Before deployment, drain personalized and native plan-generation jobs started by
the previous handler.
`Dockerfile.release` overlays only reviewed source and knowledge onto the exact
serving image, preserving its installed dependencies and operating-system layers.
The ordinary `Dockerfile` remains available for a separately validated clean build.

The original web rollout required gateway, Firestore rules, the four explicit
unlimited policies, then the website. The current methodology rollout requires
the gateway and the narrow optional-boolean request rules update before website
promotion. Existing capability policies, including native generation's daily
allowance of one, remain unchanged. Keep a
private receipt with service configuration, active image,
source archive checksums, ruleset/release and config before-images. Recheck the
current revision and each update precondition before mutation. Verify image digest,
`/health`, configuration preservation and current-access reads. No production plan
generation or activation is required for deployment verification. Rollback restores
the prior revision, rules release and only the four config fields, coordinated with
the website; it must not delete drafts or athlete data.

## Maintainer release commands

The September 17 backend release was verified at 08:16:29 UTC: revision
`agent-gateway-web-43b9da983c41`, build
`d6cc8783-9bb5-43bb-aee1-dacc985db265`, image digest
`sha256:b5c8afa9bbfa9c967dd3fb718b6738015b4b9bc8f8855ad99ee99ae52c175cd6`.
Its exact source archive SHA256 is
`43b9da983c4160a30b370ad1cdc897867c4c4d1042fa85f77a5d360e5d171fda`.
The same 1,353 tests passed locally and inside the pinned production-base image;
six excluded private-history tests were skipped. Rules passed 205 assertions and
seven live access checks. These are historical reference values, not permission to
overwrite a newer revision.

Use PowerShell 7, Git, the Google Cloud CLI and an already-authorized operator
account. Run the following stages separately from the repository root, reviewing
each private request/response before proceeding. `cloudbuild.release.yaml` only
builds, tests and publishes an image; it does not deploy anything. Its disposable
test container installs pytest without changing the published image layers.

### Snapshot and drain

Choose the expected revision from the latest reviewed release receipt. Stop on
drift, refresh the review, and take new before-images; never replace the expected
value automatically with whatever is currently live. Keep full service snapshots
private because they can contain runtime configuration and secret references.

```powershell
$ErrorActionPreference = 'Stop'
$project = 'kickai-69dd0'
$region = 'us-west1'
$expectedRevision = 'agent-gateway-web-e75e9318d15d' # Check latest receipt first.
$releaseDir = Join-Path (Get-Location) ('.netlify/gateway-release-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $releaseDir | Out-Null
$serviceName = "projects/$project/locations/$region/services/agent-gateway"
$runUrl = "https://run.googleapis.com/v2/$serviceName"
$docsUrl = "https://firestore.googleapis.com/v1/projects/$project/databases/(default)/documents"
$rulesUrl = "https://firebaserules.googleapis.com/v1/projects/$project"
$caps = @('assess_personalized_plan', 'generate_personalized_plan',
          'activate_personalized_plan', 'discard_personalized_plan')
$drainCaps = @($caps) + @('generate_training_plan')
function Save-Private($name, $value) {
  $file = Join-Path $releaseDir $name
  if (Test-Path -LiteralPath $file) { throw 'Receipt already exists; review it first.' }
  [IO.File]::WriteAllText($file, ($value | ConvertTo-Json -Depth 100))
}
function Api($method, $uri, $body = $null) {
  $token = (gcloud auth print-access-token).Trim()
  if ($LASTEXITCODE -ne 0) { throw 'Operator authentication failed.' }
  $options = @{ Method=$method; Uri=$uri; Headers=@{Authorization="Bearer $token"} }
  if ($null -ne $body) {
    $options.ContentType = 'application/json'
    $options.Body = $body | ConvertTo-Json -Depth 100 -Compress
  }
  Invoke-RestMethod @options | ConvertTo-Json -Depth 100 | ConvertFrom-Json -AsHashtable
}
function Assert-Drained {
  foreach ($cap in $drainCaps) {
    $filters = @(
      @{fieldFilter=@{field=@{fieldPath='capability'};op='EQUAL';value=@{stringValue=$cap}}},
      @{fieldFilter=@{field=@{fieldPath='status'};op='IN';value=@{arrayValue=@{
        values=@(@{stringValue='pending'},@{stringValue='running'})}}}}
    )
    $rows = Api POST "${docsUrl}:runQuery" @{structuredQuery=@{
      from=@(@{collectionId='llmJobs'});where=@{compositeFilter=@{op='AND';filters=$filters}}}}
    if (@($rows | Where-Object { $_.document }).Count) { throw 'Personalized jobs must drain.' }
  }
}
$before = Api GET $runUrl
$routed = @($before.trafficStatuses | Where-Object { $_.percent -gt 0 })
if ($routed.Count -ne 1 -or $routed[0].percent -ne 100 -or
    $routed[0].revision -ne $expectedRevision) { throw 'Unexpected serving revision/traffic.' }
if ($before.template.revision -ne $expectedRevision) { throw 'Another revision is staged; review it first.' }
Assert-Drained
$beforeRules = Api GET "$rulesUrl/releases/cloud.firestore"
$beforeRuleset = Api GET "https://firebaserules.googleapis.com/v1/$($beforeRules.rulesetName)"
$beforeConfig = Api GET "$docsUrl/config/llm"
Save-Private 'before.json' @{service=$before;rulesRelease=$beforeRules;
  ruleset=$beforeRuleset;config=$beforeConfig;at=[DateTime]::UtcNow.ToString('o')}
```

Also save the active revision and its image-matched successful Build resource.
Use that Build's `serviceAccount` as `$buildServiceAccount` below; do not substitute
the runtime service account or infer provenance from the service's old `buildConfig`.
Drain again immediately before staging and promotion. Coordinate a single operator
release window so new planner requests or another deployment do not race the cutover.

### Build the committed source

Commit reviewed source first. Archive only the service tree; the source archive and
all receipts stay in the ignored release directory. The build command supports a
local archive and uses the two validated Docker steps in the checked-in config.
Record the source upload's generation and Build `sourceProvenance`, and verify its
downloaded SHA256 against the local archive before using the output image.

```powershell
if (git status --porcelain -- services/agent-gateway) { throw 'Commit the reviewed service source first.' }
$archive = Join-Path $releaseDir 'source.tar.gz'
git archive --format=tar.gz --output=$archive HEAD:services/agent-gateway
if ($LASTEXITCODE -ne 0) { throw 'Source archive failed.' }
$sourceHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
$version = 'web-' + $sourceHash.Substring(0,12)
$revision = 'agent-gateway-' + $version
$imageTag = "$region-docker.pkg.dev/$project/cloud-run-source-deploy/agent-gateway:$version"
# Set this from the reviewed serving Build's serviceAccount, not a guessed account.
if (-not $buildServiceAccount) { throw 'Review and set the existing Build service account.' }
gcloud builds submit $archive --project=$project --region=$region `
  --config=services/agent-gateway/cloudbuild.release.yaml `
  --service-account=$buildServiceAccount --substitutions="_IMAGE=$imageTag" --async --format=json |
  Set-Content -LiteralPath (Join-Path $releaseDir 'build-submitted.json') -Encoding utf8
if ($LASTEXITCODE -ne 0) { throw 'Build submission failed; inspect receipt before retrying.' }
# Set $buildId from build-submitted.json, then wait for its terminal result.
gcloud builds describe $buildId --project=$project --region=$region --format=json |
  Set-Content -LiteralPath (Join-Path $releaseDir 'build-result.json') -Encoding utf8
$build = Get-Content -Raw (Join-Path $releaseDir 'build-result.json') | ConvertFrom-Json -AsHashtable
if ($build.status -ne 'SUCCESS') { throw 'Build and full container tests must succeed.' }
if ($build.results.images.Count -ne 1) { throw 'Unexpected image result.' }
$imageDigest = ($imageTag -replace ':[^/:]+$', '') + '@' + $build.results.images[0].digest
Save-Private 'source-receipt.json' @{commit=(git rev-parse HEAD);sha256=$sourceHash;
  buildId=$build.id;source=$build.source;provenance=$build.sourceProvenance;image=$imageDigest}
```

Check the build logs for the complete test result; do not remove failing tests to
obtain a publishable image. Archive creation changes the archive hash compared with
the historical ZIP above; runtime files must match the reviewed commit. Docker's
base remains the pinned image in `Dockerfile.release`. Update that dependency base
only as a separately reviewed change.

### Stage, check, then promote

The [Cloud Run v2 PATCH API](https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/patch)
accepts the current `etag`. This workflow copies the full template and traffic list,
changes only image/revision and `GATEWAY_VERSION`, and adds a zero-traffic tag. It
preserves runtime identity, secrets, resource limits, probes, scaling and old tags.
An etag conflict means stop and review; do not retry with a newly fetched etag alone.

```powershell
$current = Api GET $runUrl
if ($current.etag -ne $before.etag) { throw 'Service changed after snapshot.' }
Assert-Drained
$template = $current.template | ConvertTo-Json -Depth 100 | ConvertFrom-Json -AsHashtable
$template.revision = $revision
$template.containers[0].image = $imageDigest
$versionEnv = @($template.containers[0].env | Where-Object { $_.name -eq 'GATEWAY_VERSION' })
if ($versionEnv.Count -ne 1) { throw 'Review unexpected version configuration.' }
$versionEnv[0].value = $version
$traffic = @($current.traffic) + @(@{type='TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION';
  revision=$revision;tag=$version})
$stageRequest = @{name=$serviceName;etag=$current.etag;template=$template;traffic=$traffic}
Save-Private 'stage-request.json' $stageRequest
# Review the private request: only the four intended differences above are allowed.
$stage = Api PATCH "$runUrl`?updateMask=template,traffic" $stageRequest
Save-Private 'stage-operation.json' $stage
# Repeat this GET separately until done=true; stop on error. Do not submit again.
Api GET "https://run.googleapis.com/v2/$($stage.name)"
```

After the operation succeeds, inspect the new revision's successful condition and
exact image digest. Its tag URL is returned in `trafficStatuses`; do not construct
or guess it. The original reviewed revision must still serve all ordinary traffic.

```powershell
$staged = Api GET $runUrl
if ($staged.template.revision -ne $revision -or
    $staged.template.containers[0].image -ne $imageDigest) { throw 'Staged service changed.' }
$tag = @($staged.trafficStatuses | Where-Object { $_.revision -eq $revision -and $_.tag -eq $version })
if ($tag.Count -ne 1 -or -not $tag[0].uri) { throw 'Staged tag is not ready.' }
$health = Invoke-RestMethod "$($tag[0].uri)/health"
if (-not $health.ok -or $health.version -ne $version) { throw 'Staged health mismatch.' }
# Also check: POST {} to /v1/jobs/handle returns missing jobId (200, no DB access);
# POST {} to /v1/chat/stream without credentials returns 401. Neither creates a job.
$routed = @($staged.trafficStatuses | Where-Object { $_.percent -gt 0 })
if ($routed.Count -ne 1 -or $routed[0].revision -ne $expectedRevision -or
    $routed[0].percent -ne 100) { throw 'Serving traffic changed.' }
Assert-Drained
# Compare the full staged template and original traffic tags with stage-request.json.
# Stop on any unexpected difference, even if this candidate's tag remains present.
$promoteTraffic = $staged.traffic | ConvertTo-Json -Depth 100 | ConvertFrom-Json -AsHashtable
foreach ($target in $promoteTraffic) { $target.percent = if ($target.revision -eq $revision) {100} else {0} }
$promoteRequest = @{name=$serviceName;etag=$staged.etag;traffic=@($promoteTraffic)}
Save-Private 'promote-request.json' $promoteRequest
$promotion = Api PATCH "$runUrl`?updateMask=traffic" $promoteRequest
Save-Private 'promote-operation.json' $promotion
Api GET "https://run.googleapis.com/v2/$($promotion.name)"
```

Wait for success, then repeat `/health` at the service's returned `uri`, check that
the explicit new revision serves 100%, and compare the template/traffic before and
after. All other runtime settings and every previous tag must remain unchanged.
Use explicit revisions, never a floating `LATEST` traffic assignment.

### Rules, four config fields, and rollback

Run the rules emulator against the exact candidate first. Before changing rules,
compare the full current deployed rules with the reviewed baseline and re-read
`releases/cloud.firestore`; its `rulesetName` must still equal the before-image.
Create the candidate ruleset from the exact file tested by the emulator:

```powershell
$rulesText = Get-Content -LiteralPath firestore.rules -Raw
$candidate = Api POST "$rulesUrl/rulesets" @{
  source=@{files=@(@{name='firestore.rules';content=$rulesText})}}
$candidateRuleset = $candidate.name
Save-Private 'candidate-ruleset.json' @{ruleset=$candidate;
  sha256=(Get-FileHash -LiteralPath firestore.rules -Algorithm SHA256).Hash}
```

Save the returned ruleset name and exact source SHA256. After reviewing that receipt,
recheck the old release name immediately and publish the candidate with:

```powershell
# $candidateRuleset is the returned name; $beforeRules was saved at preflight.
if ((Api GET "$rulesUrl/releases/cloud.firestore").rulesetName -ne $beforeRules.rulesetName) {
  throw 'Another rules release occurred.'
}
$rulesPublication = Api PATCH "$rulesUrl/releases/cloud.firestore" @{
  release=@{name=$beforeRules.name;rulesetName=$candidateRuleset};updateMask='rulesetName'}
Save-Private 'rules-publication.json' $rulesPublication
```

Rules publication has no document-style compare-and-swap precondition. Maintain the
single operator window through this read/publish/read sequence; if that cannot be
guaranteed, do not publish. Verify the returned live ruleset name and source text.

For config, require the current `config/llm.updateTime` to equal the saved before-image.
If all four policies are already `unlimited`, leave config untouched. Otherwise
prepare one Firestore commit with only the four policy paths masked. `$caps`
contains only personalized capabilities; `$drainCaps` also includes native
generation for draining. Never use the drain list for a capability-policy update:

```powershell
$configNow = Api GET "$docsUrl/config/llm"
if ($configNow.updateTime -ne $beforeConfig.updateTime) { throw 'LLM config changed.' }
$fields = $configNow.fields | ConvertTo-Json -Depth 100 | ConvertFrom-Json -AsHashtable
$needsPolicyUpdate = $false
foreach ($cap in $caps) {
  $entry = $fields.capabilities.mapValue.fields[$cap].mapValue.fields
  if ($entry.enabled.booleanValue -ne $true) { throw 'Capability is not explicitly enabled.' }
  if ($entry.dailyLimitPolicy.stringValue -ne 'unlimited') { $needsPolicyUpdate = $true }
  $entry.dailyLimitPolicy = @{stringValue='unlimited'}
}
if ($needsPolicyUpdate) {
  $request = @{writes=@(@{update=@{name=$configNow.name;fields=$fields};
    updateMask=@{fieldPaths=@($caps | ForEach-Object {"capabilities.$_.dailyLimitPolicy"})};
    currentDocument=@{updateTime=$beforeConfig.updateTime}})}
  Save-Private 'config-request.json' $request
  # Review config-request.json before running the separate commit command below.
}
```

Only when that review found a required policy change, submit its saved request:

```powershell
$requestFile = Join-Path $releaseDir 'config-request.json'
if (-not (Test-Path -LiteralPath $requestFile)) { throw 'No reviewed policy change is required.' }
$request = Get-Content -Raw -LiteralPath $requestFile | ConvertFrom-Json -AsHashtable
$configResult = Api POST "${docsUrl}:commit" $request
Save-Private 'config-commit.json' $configResult
```

Literal `enabled: true` must already hold for each entry. An update-time conflict
requires a fresh review, not an unguarded retry. Read back and compare the entire
config; native capability entries and all other fields must be identical. Finally
perform read-only current-manager checks: own player-scoped views/jobs allowed,
private draft/context/operation collections and another requester's views denied.
Then release the website. Do not generate athlete plans as a deployment probe.

For rollback, coordinate the website first and inspect any jobs created after the
release. Require the serving revision to be the one in this release's receipt; stop
if a newer deployment intervened. Copy the **current** service `etag` into a reviewed
request with the receipt's original full `traffic` array, and call the same PATCH
with `updateMask=traffic`. Wait for the operation and verify the previous image and
health response. Restore only the four config fields with a fresh update-time
precondition (omit a field from `update.fields` while retaining its mask to restore
an originally absent policy). Restore the original ruleset only if the current
rules release is still this release's candidate, using the same single operator
guard. Preserve all intervening unrelated config and all athlete drafts, plans,
logs and reservations. Retain immutable requests, responses, checksums, timestamps
and before-images; public handoff receipts contain only sanitized release metadata.

## Validation

Install the original runtime requirements and pytest into an isolated environment.
Run from this directory with UTF-8 enabled (the Linux runtime uses UTF-8):

```text
python -X utf8 -m pytest -q -p no:cacheprovider
```

On Windows, pytest's temporary directories need an ordinary writable user context.
Six tests requiring excluded private historical tapes are explicitly skipped; all
authored replay fixtures and the remaining recovered suite run offline. The new
`tests/test_personalized_web.py` covers actors, ownership, revocation, public data
projection, metric revision invalidation, unlimited policy, claims and recovery.

From the repository root, use the local demo Firestore emulator:

```text
firebase --config firebase.planner-test.json emulators:exec --only firestore --project demo-personalized-planner "node app/rules-tests/personalizedRules.emulator.mjs"
```

That suite covers all four capabilities, scoped view queries, private context
denials, forged server fields, roster changes and native generation compatibility.
It also covers omitted/true/false estimate preferences, rejects malformed values
and unknown parameters, and rejects the preference on activation/discard requests.
The methodology tests cover server-qualified primary reconciliation, reviewed
estimate identity and supersession, relevant exercise selection, combined
age/level limits in targets and actual work, and evidence drift before activation.
Neither suite contacts production athletes or model providers.
