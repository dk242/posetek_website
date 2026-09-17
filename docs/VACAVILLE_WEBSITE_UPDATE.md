# Vacaville roster and website update

The later [Team Insights integration](insights/INTEGRATION.md) supersedes this
release's development-only Insights decision and its application baseline.
This document and receipt retain the earlier workbook/planner rollout details.

## Status

**Live at [posetek.net](https://posetek.net).** Netlify deployment
`6aaba570721b0d41e0eabf90` was published September 17, 2026 at 1:33:55 AM PDT
(`2026-09-17T08:33:55.137Z`), using application source `1cc6637`.
This is the approved follow-up to the completed [data repair](VACAVILLE_DATA_REPAIR.md).
The gateway, Firestore rules and personalized configuration are also live; gateway
revision `gatewayweb43b9da983c41` serves the updated backend. See
[`deployment/VACAVILLE_WEBSITE_PRODUCTION.json`](../deployment/VACAVILLE_WEBSITE_PRODUCTION.json)
for the complete deployment, verification and recovery receipts.

The homepage, `/coaches` entry and 30 marketing assets retain the exact approved
bytes from marketing deployment `6aab9fbaa73be75422324ba4`. Concurrent marketing
commit `38a817e` remains in the shared history and source. Historical deployment,
migration and planner documents remain records of their original releases. This document
supersedes their admin-only personalized-preview rollout instructions for the
approved website update described below.

## Workbook reconciliation

The updated workbook is saved in the operator's OneDrive Operations folder as
**PoseTek_Testing_Roster_Audit_2026-09-16_Updated.xlsx**.
It preserves existing contact information, notes and historical audit sheets.
The roster contains 36 athletes: 16 girls and 20 boys. Its current testing
classifications are:

| Classification | Athletes |
| --- | ---: |
| Fully tested | 10 |
| Partially tested | 24 |
| No recorded tests | 2 |
| No successful tests | 0 |

The approved source audit contains 325 records: 244 qualifying positive/complete
records, 54 records without a qualifying primary result, and 27 pathless jump
documents excluded from independent-attempt counts. Metadata was read for all
297 reviewed Storage folders. These categories already make up the 325 source
records; they must not be relabeled as 325 independent testing attempts. Earlier
dated audits remain intact.

Athlete identities, account IDs, contact details, signup codes, private workbook
contents, source manifests and backups are excluded from this repository.

## Canonical account hierarchy

The Accounts page now opens organizations into managers, assigned coaches and team
rosters. It uses `getClubContext` for club membership and team information, and
player `organizationId`/`teamId` for roster ownership. Historical organization
arrays, coach mirrors and player coach pointers cannot override a migrated
athlete's canonical team.

Managers are shown separately and can inspect all organization teams. Coaches may
have several teams, and a team may have several coaches; athlete totals are
deduplicated. Teams whose names include a coach label remain available without
creating an account or granting access. Unassigned players, teams without linked
coaches, inactive staff, invitations, independent legacy coaches and unavailable
legacy organizations have explicit presentation.

The global name/email search reports its 500-player cap. Organization rosters
load independently of that search, with a reported 2,000-player bound and visible
service limits. Read failures offer retry. Selection changes, refreshes and Auth
changes invalidate stale responses. Signup controls and the existing difficulty
inheritance policy are preserved.

Optional `orgId`, `teamId` and `coachId` query parameters preserve return context
through account, athlete, results, rep-tool and workout-editor navigation.
Organization management accepts organization/team links and can assign a current
team to an unassigned organization player.

The teammate Insights prototype remains in source and is available only in Vite
development mode. `/insights` is not included in this production application
release. `/dashboard` was already present in the pinned production application;
it is not a newly introduced prototype route.

## One personalized planner across the website

The approved web workflow is **assess or generate a draft, review it, then
explicitly activate or discard it**. Admin Programs uses `/admin/programs`; the
older `/admin/programs/personalized` address redirects while retaining selection.
Staff enter through `/programs` or their organization/team. Athlete web planning
uses the same personalized engine and draft-review workflow.

Opening a page, inspecting a roster or generating a draft does not replace an
active plan. Activation retains the existing version, context, schedule and
concurrency checks. The website's previous generator entry points are replaced by
the personalized workflow. Native mobile requests to `generate_training_plan`
retain their existing engine and behavior; this rollout does not change native
mobile source or deploy a mobile application.

The four capabilities are `assess_personalized_plan`,
`generate_personalized_plan`, `activate_personalized_plan` and
`discard_personalized_plan`. The approved configuration has **no daily caps for
these four capabilities**, expressed explicitly as `dailyLimitPolicy: "unlimited"`
with `enabled: true`. This does not disable authentication, membership checks,
global/feature switches, operation ownership, concurrency protection or limits on
other capabilities. Missing or invalid personalized configuration fails closed.
Production configuration readback is recorded in the production receipt.

## Backend and privacy boundaries

The gateway source is maintained under [`services/agent-gateway/`](../services/agent-gateway/).
Personalized authorization permits the bound athlete, current assigned coach,
current organization manager or verified PoseTek admin. Current ownership and
membership are checked again when work executes and when draft lifecycle changes
commit. The separate individual-workout mutation policy remains unchanged.

Non-admins may read and act on only their own drafts while they retain current
access to the athlete. The server publishes an explicit allowlisted projection
to `players/{playerId}/personalizedPlanDraftViews/{draftId}`. Raw private drafts,
immutable draft/plan contexts, private coach feedback, peer identities and internal
model diagnostics are not exposed by granting access to this review projection.
Existing athlete-private workspace and memory restrictions remain in place.
Personalized job-result reads also require current athlete access.

Drafts, draft views and contexts remain server-written. The per-athlete
`personalizedPlanOperations/current` lease is server-only; it coordinates
competing and retried operations without granting a client authority to activate
or overwrite plans. Personalized quota/accounting uses stable operation identity
for retries. Backend tests and Firestore emulator tests cover these boundaries;
their results and serving revisions are recorded in the production receipt.

## Deliberate application release

Run from the repository root using the configured Node 22 toolchain:

```powershell
node app/node_modules/typescript/bin/tsc -b app
npm --prefix app test
node --test scripts/application-release.test.mjs
node scripts/build-application-release.mjs
```

For an application release that must retain an already approved marketing build,
the optional `--marketing-snapshot` argument accepts a verified local manifest:

```powershell
node scripts/build-application-release.mjs --marketing-snapshot .netlify/approved-marketing-snapshot.json
```

The example path must contain an operator-prepared manifest with its deployment
ID, absolute source directory, complete page/asset paths, sizes and SHA-1 hashes,
and served-path hashes. The builder checks the local bytes and current production
marketing before restoring them. It rejects missing coverage, path escapes,
symbolic links and case-insensitive conflicts. This release used that option to
preserve the approved Players and Coaches pages. Keep local snapshot locations
and generated manifests out of Git.

[`build-application-release.mjs`](../scripts/build-application-release.mjs) first
runs the existing guarded homepage build. That build verifies the live pinned
application and assembles the complete public output. The application release
then runs Vite, copies only the newly compiled `dist/assets/` files into
`production-dist/assets/`, and replaces `production-dist/application.html` with
the compiled entry plus the existing homepage navigation bridge. It does not run
the legacy file-copy step or publish arbitrary repository-root files.

The builder rejects baseline drift and conflicting asset names, including
case-insensitive collisions. It verifies that the homepage, Coaches page,
existing assets and unrelated static files remain unchanged; only the application
entry is intentionally replaced. Identical assets already present in the baseline
are reused. Its local build manifest is
`.netlify/application-release-build.json`. The complete deployable directory is
**`production-dist/`**, not the repository root, `dist/` or `marketing-dist/`.

Ordinary `node scripts/build-production.mjs` remains the homepage-preservation
path and does not include fresh application source. Do not disable its
live-application guard. The current baseline is reconciled to deployment
`6aaba570721b0d41e0eabf90` and contains **228 application/public files**. It includes
the updated application and 57 genuinely new asset paths; compiled-output asset
counts also include reused paths. Future application releases must deliberately
reconcile this baseline again before an ordinary homepage release.

Review a Netlify draft built from this exact output before promoting it. Verify
account navigation, each authorized web planner role, draft lifecycle behavior,
legacy URLs, homepage navigation, preserved asset hashes and the absence of the
Insights prototype. Deploy gateway/rules/configuration in a coordinated order
with readback; a website deployment alone does not enable the new permissions.
Record the actual releases and recovery instructions in the production receipt.

## Recorded release validation

| Check | Recorded result |
| --- | --- |
| Frontend | 811 tests passed across 59 files; TypeScript passed. Focused selections overlap this total. |
| Gateway | 1,353 tests passed in each of two runs; six private-fixture tests were explicitly skipped. |
| Firestore authorization | 205 emulator assertions and seven live permission checks passed. |
| Release composition, navigation and snapshot checks | 26 passed, including 11 application-release checks covering case-insensitive asset overlap. |
| Published inventory | 261 Netlify files, including all 260 local artifact files and one platform-generated metadata file. |
| Marketing preservation | Homepage, Coaches entry and 30 marketing assets match the approved marketing release exactly. |
| Live browser | Fresh manager sign-in showed all four teams and enabled the authorized six-player batch. No plan-generation or activation request was submitted. Further browser and preservation-build details are in the production receipt. |

Tests include migrated players with stale legacy pointers, shared coach/team
assignments, absent or malformed staff membership, rosters beyond the global
search cap, explicit truncation, retained signup controls and return links, and
unchanged coach difficulty-source resolution. Keep synthetic test fixtures
separate from private athlete data.
