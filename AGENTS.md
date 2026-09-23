# PoseTek website context

Read `POSETEK_PROJECT_CONTEXT.md` before working on this website. It records the
source version, project background, key files, release workflow, and review results.

`README.md` contains fresh-clone setup, preview, validation, and collaboration steps.

The shared website repository is `https://github.com/dk242/posetek_website.git`.
The user requires website changes to be committed here and the repository updated
for collaborators. Preserve teammates' commits, include required source and assets,
and update the handoff docs with confirmed project decisions. Keep generated output,
local reference captures, dependencies, and credentials out of Git.

The latest recorded production release is `6aac924a597bd46f15cf468a`, published
September 17, 2026 at 6:31:29 PM PDT. Player signup links prefill the current code;
staff can copy existing links or generate a code only when missing. Normal actions
preserve valid codes. Read `deployment/PLAYER_INVITATION_LINKS_PRODUCTION.json`
and `docs/PLAYER_INVITATION_LINKS.md`; no real recipient accounts were claimed
during verification. Evidence-linked personalized planning now
serves the current admin planner and native schema-3 generation through shared
gateway revision `agent-gateway-web-62c05fa8fbde`. Coaching goals are optional.
Admin plans remain drafts until activated; native generation retains its existing
permissions, schema and daily limit of one. The narrow request-rules update permits
only an optional boolean estimate preference. Read
`deployment/EVIDENCE_PLANNER_PRODUCTION.json`,
`deployment/PLANNER_INTENT_PRODUCTION.json` and
`docs/PERSONALIZED_PLANNER_METHODOLOGY.md` before planner changes.
The gateway-only description follow-up lists actual domain minutes without
claiming a lead from nearly equal totals; prescriptions and website bytes remain
unchanged by that release.
The September 16 cohort now has twelve reviewed active schema-3 plans, four
workouts each. Preserve these and their private contexts. Read
`docs/SEP16_TRAINING_PLAN_ROLLOUT.md` and
`deployment/SEP16_TRAINING_PLANS_ACTIVATED.json` before changing cohort plans;
seven age assumptions were intake-only and must not be treated as recorded DOBs.
Reviewed provisional Dribbling and Agility
estimates add explicitly labeled skill-map and optional planning context,
separate from measured results, qualification, rankings and Insights. A confirmed
Sprint-to-Agility classification correction removes the incomplete attempt from
measured Sprint results while preserving the genuine Sprint attempt. Read
`deployment/PROVISIONAL_AGILITY_PRODUCTION.json` and
`docs/PROVISIONAL_AGILITY_RECOVERY.md`; the prior Dribbling receipt remains a
historical checkpoint. The preceding testing audit adds canonical
qualified results, proven duplicate suppression, exact capture media and truthful
pose timing. Read `deployment/TESTING_AUDIT_PRODUCTION.json` and
`docs/TESTING_AUDIT_BUILD_HANDOFF.md`. The protected baseline now has 612 files.
Native candidate `e2c3736` on `codex/testing-audit-remediation` includes durable
capture retention and awaits Taiyo's Mac/iPhone/TestFlight validation; do not deploy
native repository rules. Preserve the 32-entry video archive guard in
`onvideoupload-00027-guw` and the separate historical repair journals.
Expanded Insights includes demographics,
verified testing, workout outcomes and estimated active use for admins,
organization managers and assigned coaches, preserving the account hierarchy,
reviewed personalized web planner and exact Players and
Coaches marketing bytes from `6aab9fbaa73be75422324ba4` and concurrent source
commit `38a817e`. Gateway, rules and personalized configuration are live; native
mobile generation uses the shared methodology above. Native usage is included in the new remediation
branch (the prior `codex/expanded-insights-usage` branch is historical) for Taiyo's Mac/TestFlight release;
it is unavailable until athletes install that build. Read
`deployment/EXPANDED_INSIGHTS_PRODUCTION.json` for the prior Insights receipt,
`docs/insights/EXPANDED_INSIGHTS_HANDOFF.md` for definitions, retention and recovery,
`docs/insights/V2_CONTRACT.md` for the versioned reporting interface, and
`docs/insights/INTEGRATION.md` for the earlier dashboard semantics and
scoped callable deployment, `docs/VACAVILLE_WEBSITE_UPDATE.md` for the prior web rollout,
`deployment/COACHES_PAGE_PRODUCTION.json` for the prior marketing receipt,
`deployment/COACHES_PAGE_UPDATE.md` for the tailored team service and sample data,
`deployment/HOMEPAGE_ANNOTATIONS_2026-09-15.md` for the requested annotations, and
`deployment/SCROLLING_HOMEPAGE_UPDATE.md` for recovery and earlier release decisions.
Continue from the source included in this repository.

The feed feature stack is available in `app/src/pages/feed/` and `functions/`.
Read `docs/FEED_SOURCE_HANDOFF.md` for setup, API contracts and provenance. The
frontend is recovered editable JSX; the backend is original deployed source.
Feed development uses the Vite app at `/feed?preview=1` and requires no reference
capture. Source recovery did not deploy or change the application baseline.

At the initial September 15 review, GitHub main was older than the live homepage.
The user chose the deployed site as the reference. Recovered modules have provenance
beside their code; the other computer's original authored source remains unavailable.
The unchanged deployment `6aa9b6f0d8faf6177db8fd97` remains the tabbed comparison
reference. The current application baseline instead pins the September 17 release
in `deployment/homepage-baseline.json`. On a fresh clone, run
`node scripts/capture-deployed-reference.mjs` before using either preview server.
The ignored capture lives in `.netlify/deployed-reference/6aa9b6f0d8faf6177db8fd97/`.

Run `npm --prefix app run build:marketing` and
`node scripts/serve-homepage-preview.mjs` to review current source at port 4174.
Run `node scripts/serve-deployed-reference.mjs` for the unchanged reference at
port 4173. The ordinary production build preserves 612 application/public files byte-for-byte,
including `/application.html` and its navigation bridge. Keep the live-application
guard enforced and verify the baseline again before another release.

Deliberate application releases use `node scripts/build-application-release.mjs`.
Its optional `--marketing-snapshot` argument accepts a verified manifest to retain
approved marketing bytes, as used for the current release. Follow the web handoff
for preparation, preview, verification and baseline reconciliation; keep local
snapshots and generated output outside Git.

Homepage work primarily belongs in `app/src/pages/home/`; root `index.html`
contains the player entry and metadata. Coaches source is in `app/src/pages/coaches/`
with its entry at `coaches/index.html`. Both audiences share `MarketingHeader.tsx`.
Use the latest applicable release notes,
preserve existing routes and data contracts, and treat mobile source as reference-only.

Update the context guide as the source discrepancy is resolved and new project
decisions are confirmed. Do not infer current offers or production behavior from
older experiment pages or historical test receipts. Preserve historical receipts
as records of their releases.
