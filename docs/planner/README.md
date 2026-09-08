# Personalized planner preview

The existing `/admin/programs` page remains the default. `/admin/programs/personalized` is an optional admin preview; returning to the current page never applies, discards or restores a plan. The existing individual builder remains available on player details.

## Implemented flow

1. Select players and the familiar schedule, setting and equipment.
2. **Preview priorities** uses the server assessment policy without creating a training plan.
3. **Generate drafts** submits separate jobs. Jobs remain visible after navigation/reload.
4. Review the evidence, uncertainty, curriculum exclusions, target/actual minutes and side-by-side workouts.
5. Select the review checkbox and **Use this plan** for that player. Activation has its own job and result. It is never part of generation.

The preview uses recent dated results only (180 days). Missing/undated results are not scored as zero. Existing benchmark/peer adjustments remain bounded; a versioned within-player priority additionally considers a primary score from 65 to below 85 when it trails the strongest measured category by at least 20 points. That signal is labelled low-confidence and is not described as a peer percentile. The existing difficulty ceiling remains authoritative.

Legal whole doses are allocated jointly across each week. Accepted weeks must meet total time, dose/frequency/eligibility, core retention, progression and independent model checks, plus domain error within `max(5 minutes, 10% of target)`. A measured priority must receive actual work. Transitions are shown separately. Infeasible combinations return a reason instead of silently replacing the priority.

## Contracts

Schema version remains 3. Engine versions are separate: `current-2026-09-08` and `personalized-v1`. Existing `generate_training_plan` clients retain the current engine. Server acceptance pins the version on planner jobs; new requests require an explicit supported version.

New admin-only job capabilities:

| Capability | Result |
| --- | --- |
| `assess_personalized_plan` | Proposed priorities, evidence status and curriculum report |
| `generate_personalized_plan` | A ready draft ID, without activation |
| `activate_personalized_plan` | Version-checked active plan ID; replay is idempotent |
| `discard_personalized_plan` | Terminal discarded draft |

Drafts live in `players/{id}/personalizedPlanDrafts`; private immutable contexts live in `personalizedPlanDraftContexts`. Large contexts retain the `trainingPlanContexts/` object prefix and use the private bucket selected by `TRAINING_CONTEXT_BUCKET`. Neither collection is athlete-readable or client-writable. Existing plan editors still receive their normal immutable `trainingPlanContexts` after activation.

The preview deployment uses the dedicated `kickai-69dd0-training-contexts` bucket with uniform bucket access and public access prevention. The gateway can read and create immutable objects there, but cannot overwrite/delete them. Context reads check this bucket first and fall back to the original bucket for older references. Existing pose artifacts continue using their original bucket. This avoids changing access policies on existing uploaded media.

Activation compares the reviewed token and active plan revisions, current profile and coach note, own testing and matched peer context, used catalog rows, workout history/reservations, and schedule revision in a transaction. It revalidates every workout against current constraints before atomically superseding active plans, creating the replacement/context and incrementing the schedule counter. It never edits logs or reservations. Concurrent changes require a newly generated comparison. Retries cannot activate twice, and an already activated draft cannot later reactivate itself.

Drafts retain their generation start date. Generate a fresh draft on a later day; the server will not silently shift its calendar. The stored expiry is seven days, but activation also requires the same local start date.

## Release controls and fallback

`config/llm.personalizedPlannerEnabled` must be literal `true`. Each of the four capabilities also requires explicit `enabled: true` and a positive integer `dailyLimitPerUser`; the existing global and v3 release gates still apply. Missing configuration fails closed. Discard can remain enabled while personalized submissions are disabled.

Turning the flag off rejects queued/new submissions when they reach authorization. Already running generation can finish as a draft on its pinned version; it never switches engines or activates automatically. Existing saved drafts remain readable. The current planner remains available independently of this flag. Switching pages does not roll back an activated plan.

The baseline website is tagged `planner-current-2026-09-08` (commit `61b7d53`). The gateway was recovered from the exact serving Cloud Run source and tagged with the same baseline name in the adjacent `agent-gateway` repository. A subsequent production kick-analysis release was incorporated before the candidate was built; its planner algorithm did not change.

Do not make the preview the default until Dylan accepts its pilot behavior. Do not automatically regenerate or replace roster plans as part of rollout.

## Verification and remaining content work

`evaluation.json` records a five-player deterministic comparison using captured inputs and stubbed model verdicts. All ten personalized weeks met the new allocation tolerance; the current-engine replay met it in zero of ten. The previously identical goalkeeper/midfielder prescriptions diverged. This measures allocation behavior, not live model quality.

The test suite covers authorization, missing/stale evidence, version routing, short/long schedules, allocation fit, read-only preflight/drafts, idempotent activation, changed profiles/catalog/testing/peers/history, concurrent writes, and immutable context compatibility. The browser checks cover 1440px, 820px and 390px, long names, selection round trips and activation controls above mobile tabs. `firebase.planner-test.json` uses a demo project only; the rule suite verifies admin-only draft access and current-client compatibility.

`curriculum-review.json` contains nine existing authored passing/receiving draft entries prepared for content review. They have setup, execution and dose definitions, but no attached demo media; they remain unpublished. Receiving has no published coverage in the sampled catalog. Ball mastery has published entries but is excluded by the existing executable planner policy. The preview reports these limitations explicitly; no drill was relabelled or published to make percentages appear complete. Content acceptance and demo production remain separate from enabling the supported pilot cases.

Validation scripts and private fixtures are in the workspace's `outputs/planner-implementation` directory, outside the website and build output. Production release IDs and live validation results are recorded in `RELEASE.md` when rollout completes.
