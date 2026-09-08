# Workout planner personalization: implementation and fallback plan

Status: proposed implementation plan. No new page, engine, feature switch, or activation workflow has been implemented by this document.

## Outcome

Players with meaningfully different assessed development needs should receive meaningfully different training prescriptions, even when duration, sessions per week, minutes per session, and setting match. Differences may be in domain emphasis, drill choice, dose, or progression. Similar needs may legitimately produce similar plans; random variety is not an acceptance criterion.

Keep the current planner page and current generation behavior available throughout development and rollout. Start the new planner as an optional admin preview. Existing active plans and athlete completion records are not changed by previewing, comparing, or switching planner pages.

## Evidence motivating the work

The September 8 investigation sampled five active plans, not the entire population:

- Testing metrics were present in the saved assessments. Four sampled plans had no metric-driven change from their baseline training mix; one striker's low ball-speed result changed shooting from 35% to 40%.
- A goalkeeper and defensive midfielder had different target allocations but identical recorded drills, sets, reps, rests, and estimated durations across their two-week plans.
- Peer comparison was unavailable in all five; the public assessment reported an insufficient cohort. Whether this reflects valid filtering, a relationship-resolution defect, or both needs investigation.
- Eligible ball-mastery and receiving curriculum was unavailable in those contexts, and passing capacity was limited.
- All five used the default maximum difficulty of 5 and had no coach feedback.

These findings justify tracing assessment through selection; they do not establish that every player receives identical plans or that every absent adjustment is incorrect.

## Preserve the existing planner first

### Pages and navigation

| Surface | Initial behavior |
| --- | --- |
| `/admin/programs` | Existing Programs page and current generator remain the default. |
| `/admin/programs/personalized` | New optional page, labelled **Personalized planner — Preview**. |
| Existing player details | Keep the existing builder. Add an **Open personalized planner** link carrying the selected player. |
| Both planner pages | Provide a visible **Current planner / Personalized planner** switch, retaining organization/team/player selection where authorized. |
| Existing workout editor and athlete portal | Continue reading the existing v3 executable plan shape. |

Retain current signup-code displays, copy controls, Vacaville branding, and responsive admin styling. Scope new styles to the new page. Switching pages must not submit, cancel, apply, or overwrite a plan. Show ongoing jobs explicitly; navigation is not cancellation.

### Preserve generation behavior, not just HTML

- Before implementation, capture the actual deployed website source in a reviewed commit/tag, including the currently uncommitted UI work and `shooting -> kick` correction. The repository's current HEAD alone is not that deployed baseline.
- The last verified website deployment in this task was Netlify `6aa05687fda0b26f17cce8be` at `https://posetek.net`. Reconfirm it when implementation begins and record any newer deployment instead.
- Identify and record the deployed training gateway revision, source, prompt/configuration versions, and dependencies. Do not assume the mobile contract documents exactly describe the serving implementation.
- Preserve the current algorithm behind an explicit server-resolved engine version. Give the personalized engine a separate version; new engine selection is available only to authorized admins during preview.
- Requests without a new engine selector retain current behavior, including mobile and other existing clients. Add any selector to request validation/rules explicitly; it must not bypass existing authorization or validation.
- Engine version is separate from `planVersion`/plan schema. Continue emitting compatible v3 plans unless a separately reviewed requirement proves that insufficient.
- Pin the resolved engine version when a job is accepted so a deployment or switch cannot silently change an in-flight job's implementation. Record it on jobs, contexts, drafts, and activated plans.
- Keep shared authentication, eligibility, time, dose, and frequency checks active for both engines. Versioning is not a way to retain a known correctness or access-control defect.
- Save catalog/configuration snapshots for reproducible comparisons. A planner switch must not silently rewind the live catalog, player profiles, or recorded results.

A website deployment rollback is an emergency recovery measure, not the everyday fallback. The everyday fallback is the still-available current page plus current engine.

## Phase 1 — Trace and reproduce the loss of personalization

Scope: training gateway investigation, read-only evidence capture, and an offline comparison harness.

1. Find the serving `generate_training_plan` implementation and its assessment, allocation, selection, repair, and persistence paths.
2. Create private, versioned replay fixtures for the observed goalkeeper/midfielder pair, the striker whose metrics changed allocation, similar-profile controls, and incomplete-evidence cases. Keep identifying information and raw coach notes out of public fixtures/reports.
3. Trace the same inputs through: normalized metrics; base mix; metric/peer/coach adjustments; catalog eligibility/capacity; selected drills/doses; actual minutes; final validation.
4. Capture diagnostics showing where two different target mixes converge. Check candidate ranking, repeated default selections, dose packing, allocation error, repair behavior, and any template or fallback path. Treat each as a hypothesis until verified.
5. Establish baseline generation success rate, target-versus-actual error, unexplained duplicate prescriptions, generation time, and model usage/cost.

Exit criteria: a reproducible case explaining the convergence, plus a report distinguishing assessment limitations from selection limitations. No production plan is replaced to run this investigation.

## Phase 2 — Make the assessed priorities explicit

Scope: assessment policy, gateway diagnostics, and tests.

- For each supported priority, record the domain, supporting metric IDs/values, reference or peer basis, confidence/data completeness, source, and intended change to training emphasis.
- Audit the current thresholds and input validity before changing them. A small difference between players should not automatically become a significant deficit.
- Distinguish benchmark-relative gaps, within-player development priorities, peer gaps, and coach-requested emphasis in the explanation. Do not describe a within-player ranking as a peer percentile.
- Audit peer membership resolution, age/gender/protocol filters, metric availability, and the evidence window. Restore missing valid comparisons if there is a defect; retain the minimum-cohort rule when the data truly do not qualify.
- When evidence is insufficient, expose a neutral/default assessment and its reason. Missing data must not be treated as a zero score.
- Keep position, age, available equipment, setting, and coach feedback as separate influences. Preserve the current coach/admin-controlled difficulty cap; inferred level is not permission to increase it.
- Version any threshold/weight change and review examples before enabling it. Bounds must keep any single metric or note from dominating the plan unexpectedly.

Exit criteria: known test cases produce explainable priorities; valid metric changes move the intended target allocation; low-confidence and missing evidence do not create unsupported claims.

## Phase 3 — Make the selected work follow the individual allocation

Scope: weekly allocation, candidate ranking, dose selection, progression, and validation in the personalized engine.

1. Calculate feasible weekly domain targets from the assessment and requested schedule before filling workouts.
2. Check available legal weekly capacity using eligible drills, settings/equipment, legal doses/rest, and frequency caps. Record target adjustments caused by unavailable capacity before selection.
3. Rank suitable drills by fit to the player's priorities and required stimulus, then assemble legal doses against the remaining domain-minute budget. Preserve continuity/progression and allow shared drills when they fit.
4. Compute actual domain minutes with the existing shared time formula. Count transitions consistently and separately from domain work.
5. Validate total time AND target-domain coverage. A plan must not pass simply because it fills the requested minutes.
6. Use bounded repair attempts to improve allocation fit. If a priority still cannot be met, return a specific limitation or failed draft; do not silently replace its training time with unrelated work.
7. Generate the explanation from the final validated assessment and prescription. Do not write a personalized rationale for an unchanged generic prescription.

Proposed starting tolerance for offline evaluation: each nonzero weekly domain target should be within `max(5 minutes, 10% of that domain's target minutes)` of its feasible target. This is a proposed product setting, not an existing engine guarantee; calibrate it against short schedules and legal whole doses in Phase 1. A measured priority must receive meaningful actual work and cannot be rounded away. Preserve all existing hard time, dose, age, eligibility, frequency, progression, and semantic checks; do not loosen them just to raise generation success.

Exit criteria: the observed target-convergence case no longer produces unexplained identical prescriptions, and accepted drafts meet the agreed allocation tolerance or clearly document a feasible adjusted target. If no feasible allocation exists, generation stops with an actionable explanation.

## Phase 4 — Address curriculum constraints

Scope: catalog audit, content work, and visibility of capacity restrictions. Run the audit alongside Phases 1–3; content availability may limit the pilot's scope.

- Inventory published eligible drills by domain, setting, equipment, age/difficulty, dose range, and weekly frequency capacity.
- Separate missing curriculum from existing drills excluded by the current player's constraints or by catalog metadata defects.
- Review the absent ball-mastery/receiving coverage and constrained passing capacity found in the sampled contexts.
- Prepare actual drill additions or metadata corrections for review, including instructions/demo media and executable dose/rest definitions. Do not relabel unrelated drills merely to satisfy a percentage.
- Report substitutions and their impact on the target mix. Flag players/settings whose needs cannot yet be supported.
- Snapshot the catalog for comparisons so a content update does not masquerade as an algorithm improvement.

Exit criteria: eligible capacity is accurately reported, the selected pilot cases have sufficient curriculum, and unsupported priorities are visible instead of silently redistributed.

## Phase 5 — Add the new page with reviewable drafts

Scope: new admin UI plus an additive, authorized gateway draft/activation lifecycle.

Page flow:

1. Select organization/team/players and the familiar schedule settings.
2. Review each player's evidence status and proposed priorities.
3. Choose **Generate draft**. Show per-player queued/running/complete/failed progress and specific failures.
4. Review **Why this plan?**, showing contributing test results, priority confidence, target versus actual minutes, curriculum limitations, and differences from the active plan.
5. Inspect the workout list and doses; compare current and proposed plans side by side.
6. Choose **Use this plan** for a reviewed player or explicitly selected batch. Draft generation alone does not activate anything.

Backend requirements:

- Store experimental drafts separately from active `trainingPlans`, with admin-only access and no athlete exposure. Do not write a draft to the active collection and rely on UI filtering to hide it.
- Reuse the compatible v3 executable shape in the draft payload and retain immutable generation context/version references.
- Add a server-authorized activation operation that checks the selected player, ready draft, relevant current profile/catalog constraints, and expected active plan/revision. Recheck relevant workout/log state at activation.
- Activation atomically supersedes the applicable active plan and creates the new active plan. Make retries idempotent so repeated clicks or connection retries cannot activate twice.
- If the active plan or relevant context changed after draft creation, require a refreshed comparison/revalidation rather than overwriting it silently.
- Report batch activation separately from batch generation, with per-player success/failure. Do not imply an entire batch is atomic.
- Never modify historical plans, completed/in-progress workout evidence, or time worked merely to make an experimental plan fit. Follow the existing plan replacement policy for in-progress work and make it explicit in review.

UI requirements: retain the emerald/lime admin theme, mobile bottom navigation, keyboard access, readable comparison tables, and safe spacing above fixed controls. The current planner remains reachable throughout this flow. Restore selection when switching pages; do not carry an unreviewed activation action across pages.

Exit criteria: admins can compare drafts without affecting athletes, understand why work differs, and explicitly activate a validated plan without duplicate writes or lost updates.

## Phase 6 — Evaluate, pilot, and retain the fallback

### Evaluation matrix

Hold schedule, equipment, catalog version, and engine configuration constant while varying one input at a time:

| Case | Expected evidence |
| --- | --- |
| Materially weaker speed with sufficient valid evidence | An explained speed priority and corresponding actual work, subject to existing bounds. |
| Materially weaker ball control | A relevant supported priority and prescription change. |
| Similar metrics and profile | Similar plans are allowed; no artificial variety requirement. |
| Different position or age | Explainable changes where the policy calls for them. |
| Coach emphasis | Bounded changes attributed to the note, without exposing raw private text. |
| Missing/stale/invalid tests or unavailable peers | Explicit uncertainty/default behavior; no fabricated deficit or percentile. |
| Restricted equipment, setting, or difficulty | Only eligible drills; clear unavailable-capacity reporting. |
| Short/long schedules and multiweek plans | Legal time/doses/frequency, meaningful priorities, and measurable progression. |
| Repeated runs | Individual priority coverage is stable even if equally suitable drill choices vary. |
| Current engine and older clients | Existing request routing, rendering, and workflows remain compatible. |

Use deterministic assessment/allocation tests and fixed seeds or stubbed model outputs where supported; repeat actual model runs to measure variance rather than requiring word-for-word output equality.

### Release sequence

1. Verify the baseline source/deployment archive and the current planner fallback before new runtime changes.
2. Deploy version routing and draft support with the new UI/engine disabled by default. Existing requests continue to the current engine.
3. Run offline comparisons and server-side authorization/activation tests. Inspect desktop, tablet, and 390px layouts.
4. Enable the new page for an admin pilot while leaving the current page as the default. Review draft quality, failure causes, latency, and cost.
5. Activate only reviewed pilot plans. Compare the results against the baseline metrics and agreed acceptance tolerances.
6. Make the personalized planner the default only after Dylan accepts the concrete pilot behavior and page. Keep a visible **Current planner** fallback; do not remove it without a later decision.

### Fallback behavior

- An admin can return to the current planner immediately without a redeploy.
- An operational server switch can disable new personalized submissions; the UI hides/disables that submission action while continuing to show existing job/draft status.
- Pin in-flight jobs to their chosen engine and define whether they finish as drafts or are explicitly cancelled. Turning a flag off does not silently resubmit them to another engine.
- Drafts remain reviewable or discardable, and active plans remain intact when switching the page or engine default.
- Returning to the current planner does not undo a previously activated plan. Any restoration is a separate explicit, authorized, version-checked action following the existing replacement policy; it must preserve subsequent player activity. Do not offer automatic mass data rollback.
- Keep both UI and backend release records. An emergency deployment rollback must be compatible with the additive draft/version data already written.

Exit criteria: personalization improves measured allocation fit, controls remain valid, pilot quality is accepted, and the fallback is demonstrated rather than merely documented.

## Implementation map and dependencies

| Area | Existing entry point / planned work |
| --- | --- |
| Admin routing | `src/pages/admin/AdminPage.tsx`: add the optional nested planner route without replacing current routes. |
| Current batch UI | `src/pages/admin/views/GeneratePrograms.tsx`: retain behavior; add the switch/entry link. |
| Current individual UI | `src/pages/admin/views/PlayerDetail.tsx`: retain builder; link to a preselected personalized draft flow. |
| Requests and progress | `src/pages/admin/lib/planJobs.ts`, `programBatch.ts`: preserve current request behavior; add separate typed draft/version operations. |
| Statistics serialization | `src/pages/coach-dashboard/lib/logic.ts`: preserve the corrected `kick` vocabulary and regression coverage. |
| New page | Proposed `views/PersonalizedPrograms.tsx` with separately scoped styles and reusable read-only comparison components. |
| Engine and persistence | Locate the deployed gateway repository/revision in Phase 1; implement/version assessment, allocation validation, draft jobs, and activation there. Do not implement a second client-side generator. |
| Contracts and rules | Coordinate gateway request/schema contracts, admin draft reads, server-only writes/activation, client compatibility, and existing mobile readers before enabling the feature. |
| Curriculum | Audit and separately review catalog additions/corrections; pin snapshots for evaluation. |

Suggested delivery increments: (A) baseline preservation + replay evidence; (B) assessed priorities + catalog capacity report; (C) versioned selection/validation + draft persistence; (D) optional page + comparisons + activation; (E) pilot, acceptance, and default decision. Each increment has its own validation evidence and remains independently reviewable.

This plan does not authorize automatic regeneration or replacement of the roster's existing plans. Implementation should first produce comparable drafts and a working fallback, then present those concrete results for the pilot/default decision.
