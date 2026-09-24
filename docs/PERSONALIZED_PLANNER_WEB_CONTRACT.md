# Shared personalized planner — web contract

The contract text below was kept in `services/agent-gateway/WEB_PLANNER.md` while a
copy of the agent-gateway lived in this repository. **That copy is retired.** The
gateway lives only in `python-video-processor/Services/agent-gateway` and is
released only through its `scripts/release.sh`; the release commands that used to
accompany this text deployed a `git archive` of the website copy and no longer
apply. See `AGENTS.md` (§ Agent gateway) and the mobile repo's
`docs/plans/GATEWAY_CONSOLIDATION_AND_RELEASE_PLAN.md` (decisions D1/D2, §3.3).

What remains here is the part the website depends on: which capabilities it calls,
what the server-written public projection contains, and the delivery/recovery
guarantees the web flow is built against. Historical release checkpoints and
revision names elsewhere in this repo describe their original deployments, not the
current release status.

See [`PERSONALIZED_PLANNER_METHODOLOGY.md`](PERSONALIZED_PLANNER_METHODOLOGY.md)
for evidence qualification, reviewed estimates, exercise mappings, UI behavior and
the native reader boundary.

## Capabilities

The website uses four capabilities: `assess_personalized_plan`,
`generate_personalized_plan`, `activate_personalized_plan` and
`discard_personalized_plan`. Current athletes can plan for themselves, current
assigned coaches for their team, current managers for their club, and verified
administrators for all players. Generation creates a draft. Its requester explicitly
reviews and activates it; administrators may also manage existing pilot drafts.
Native schema-3 `generate_training_plan` uses the same evidence-to-objective
methodology and weekly exercise selection. It retains its existing direct
active-plan persistence, schema-3 contract, permissions and daily allowance of one
generation; the web flow still requires explicit draft activation. Individual-workout
editing keeps its existing contract.

Each personalized `config/llm.capabilities` entry requires literal `enabled: true`.
`dailyLimitPolicy: "unlimited"` removes its product daily limit. The global feature
gate, trusted identity, current membership, usage ledger and infrastructure quotas
remain enforced. No large numerical sentinel or zero quota is required. Other
capabilities ignore this policy and retain their existing behavior.

Personalized assessment and generation accept an optional boolean
`useProvisionalEstimates`; omission is retained for existing callers. Actor checks
and the activation/discard parameter allowlists are unchanged.

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

Before a gateway deployment, drain personalized and native plan-generation jobs
started by the previous handler.

A rollout requires the gateway and any request-rules change before website
promotion. Existing capability policies, including native generation's daily
allowance of one, remain unchanged. Keep a private receipt with service
configuration, active image, source archive checksums, ruleset/release and config
before-images. Recheck the current revision and each update precondition before
mutation. Verify image digest, `/health`, configuration preservation and
current-access reads. No production plan generation or activation is required for
deployment verification. Rollback restores the prior revision, rules release and
only the four config fields, coordinated with the website; it must not delete
drafts or athlete data.

## Validation from this repository

The gateway's own test suite runs in `python-video-processor/Services/agent-gateway`.
The website-side rules suite for these capabilities runs here, against the local demo
Firestore emulator:

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

## Historical receipts

- [`../deployment/EVIDENCE_PLANNER_PRODUCTION.json`](../deployment/EVIDENCE_PLANNER_PRODUCTION.json)
  — final sanitized receipt for the evidence-methodology release, including the
  website promotion result. Do not infer container test counts from narrative
  checkpoints; use this receipt and the immutable build logs.
- [`../deployment/PLANNER_INTENT_PRODUCTION.json`](../deployment/PLANNER_INTENT_PRODUCTION.json)
  and [`../deployment/VACAVILLE_WEBSITE_PRODUCTION.json`](../deployment/VACAVILLE_WEBSITE_PRODUCTION.json)
  — earlier receipts. Their `services/agent-gateway/...` paths are preserved as
  records of the tree that was deployed at the time; that path no longer exists.
