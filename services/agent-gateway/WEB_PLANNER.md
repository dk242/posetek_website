# Personalized web planner

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
Native `generate_training_plan` and individual-workout editing retain their
previous contracts and allowances.

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

Before deployment, drain personalized jobs started by the previous pilot handler.
`Dockerfile.release` overlays only reviewed source and knowledge onto the exact
serving image, preserving its installed dependencies and operating-system layers.
The ordinary `Dockerfile` remains available for a separately validated clean build.

Release order is gateway, Firestore rules, the four explicit unlimited policies,
then the website. Keep a private receipt with service configuration, active image,
source archive checksums, ruleset/release and config before-images. Recheck the
current revision and each update precondition before mutation. Verify image digest,
`/health`, configuration preservation and current-access reads. No production plan
generation or activation is required for deployment verification. Rollback restores
the prior revision, rules release and only the four config fields, coordinated with
the website; it must not delete drafts or athlete data.

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
Neither suite contacts production athletes or model providers.
