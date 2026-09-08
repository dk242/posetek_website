# Personalized planner release — 2026-09-08

Implemented and enabled as an optional verified-admin pilot. The current planner remains the default. No roster plan was activated, superseded, or regenerated in storage during this rollout.

## Main website

[Open the personalized planner](https://posetek.net/admin/programs/personalized). The original [separate preview](https://6aa07614d290c0d3c2ab602a--posetek.netlify.app/admin/programs/personalized) also remains available.

Sign in with a verified PoseTek admin account. Generation creates separate drafts. Compare the evidence, allocation and executable workouts, select the review checkbox, then explicitly choose **Use this plan** for that player. Returning to **Current planner** is always available and does not change plans.

The main-site package preserves deployment `6aa0731ea06d42b6faafcd78`, titled **Admin saved kick comparison picker: verified f05ec43**, created September 8 at 20:42 UTC. That source commit remains unavailable, so the personalized planner uses a separate entry with a visible launcher in the preserved site. All 153 existing served files are verified against their deployed checksums; the original index receives only the marked launcher block. The 62 assets not recoverable from tracked source are archived in the repository (655 KB compressed). See `PRODUCTION_INTEGRATION.md` for build, validation and eventual source-merge instructions.

## Runtime and access controls

- Serving Cloud Run revision: `agent-gateway-personalized-b31a53817d5c` (100%). `/health` returns 200 and that version.
- Immutable image digest: `sha256:3cdf51ccfaf0b77ed96cb40131dbb49e900f9db3892954b70fa10f28d6985caa`.
- Runtime source: adjacent `agent-gateway` commit `b31a53817d5c`; subsequent commit `7fd6ad0` changes tests only.
- The previous serving revision, `agent-gateway-kickev-957b518da965`, was incorporated before building. Its six updated kick-analysis files are preserved.
- Firestore ruleset: `bc652241-4c8f-4066-9acd-31394c5b6c69`, based on live ruleset `99f76810-c916-493d-b9c7-065ee4a30544`. New draft/context paths are admin-readable and server-writable only; new job capabilities are admin-only.
- `personalizedPlannerEnabled` is true. The four new capabilities are explicitly enabled with positive quota configuration (`dailyLimitPerUser: 1`); the existing trusted-admin quota exemption remains in effect. Readback confirmed all previous configuration fields/capabilities were preserved.
- Immutable large contexts use `kickai-69dd0-training-contexts`, with uniform bucket access and public access prevention. The runtime has object read/create permissions. No access policy on the existing media bucket was changed. Legacy context reads remain supported.

## Validation

| Check | Result |
| --- | --- |
| Backend regression suite | 1,331 passed |
| Website suite | 558 passed across 26 files |
| TypeScript and production build | Passed |
| Firestore emulator | 46 assertions passed, including existing client submission |
| Browser fixtures at 1440, 820 and 390px | No page overflow or JavaScript errors; selection retained; reviewed activation submits only a job; controls clear mobile tabs |
| Deployed preview, signed out at 390px | 200 response, correct admin sign-in gate, no overflow/errors |
| Fixed-input offline comparison | Personalized allocation passed 10/10 weeks; current-engine replay passed 0/10 under the new tolerance |
| Production model configuration | Six complete in-memory generations, including a repeated goalkeeper case; all allocation checks passed; active-plan hashes unchanged in all six |

The live validation used the deployed provider/model settings and real catalog/profile reads. Each two-week generation used four model calls, took 8.3–24.6 seconds, and recorded an estimated model cost of $0.0309–$0.0342. These are six pilot measurements, not a general performance guarantee. Live checks intentionally did not activate or persist training plans. Draft persistence and concurrent/idempotent activation were exercised with the transaction test fixtures; the authenticated admin activation pilot remains a user-reviewed step.

`evaluation.json` contains the deterministic comparison, with model verdicts stubbed. `live-validation.json` contains the separate live summary. Private replay inputs, raw contexts and validation scripts remain outside the website repository/build, in `outputs/planner-implementation`.

## Fallback and remaining acceptance

Use the current page/engine for everyday fallback. To pause the pilot, set only `config/llm.personalizedPlannerEnabled` to false; retain discard capability configuration, the current gateway, and draft access protections. Running generation may finish as a draft but cannot automatically activate. Do not restore the old ruleset: its legacy descendant fallback does not protect the new draft collections. Do not route traffic blindly to the pre-preview gateway after new large contexts exist: an emergency code rollback must retain the new private-bucket routing/legacy-read compatibility and `TRAINING_CONTEXT_BUCKET` setting. Neither page switching nor deployment rollback restores player data.

The pilot remains optional until Dylan accepts the concrete page and plan quality. Curriculum review also remains open: nine authored passing/receiving draft entries are prepared in `curriculum-review.json`, but lack attached demo media and were not published. Receiving has no published coverage in the sampled catalog, and ball mastery remains outside the current executable policy. Those constraints are shown in the preview. No content was relabelled or published to make allocation checks pass.
