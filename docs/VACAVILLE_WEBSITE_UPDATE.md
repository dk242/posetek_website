# Vacaville roster and website update

## Status

**Source prepared; production deployment and final live verification are pending.**
This handoff records the approved September 17, 2026 follow-up to the completed
[data repair](VACAVILLE_DATA_REPAIR.md). It does not claim that the new website,
gateway, Firestore rules or planner configuration are already serving users.
The release operator will create
[`deployment/VACAVILLE_WEBSITE_PRODUCTION.json`](../deployment/VACAVILLE_WEBSITE_PRODUCTION.json)
after verification, with the actual source, deployment and rules receipts.

The latest confirmed homepage receipt remains
[`DRILL_VIDEO_COACH_PRODUCTION.json`](../deployment/DRILL_VIDEO_COACH_PRODUCTION.json)
until a newer verified receipt is recorded. Historical deployment, migration and
planner documents remain records of their original releases. This document
supersedes their admin-only personalized-preview rollout instructions for the
approved website update described below.

## Workbook reconciliation

The updated workbook is saved in the operator's OneDrive as **Operations Updated.xlsx**.
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
Actual production configuration readback belongs in the forthcoming receipt.

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
their final results and serving revisions must be recorded before marking the
release verified.

## Deliberate application release

Run from the repository root using the configured Node 22 toolchain:

```powershell
node app/node_modules/typescript/bin/tsc -b app
npm --prefix app test
node --test scripts/application-release.test.mjs
node scripts/build-application-release.mjs
```

[`build-application-release.mjs`](../scripts/build-application-release.mjs) first
runs the existing guarded homepage build. That build verifies the live pinned
application and assembles the complete public output. The application release
then runs Vite, copies only the newly compiled `dist/assets/` files into
`production-dist/assets/`, and replaces `production-dist/application.html` with
the compiled entry plus the existing homepage navigation bridge. It does not run
the legacy file-copy step or publish arbitrary repository-root files.

The builder rejects baseline drift and conflicting asset names. It verifies that
the homepage, existing assets and unrelated static files remain unchanged; only
the application entry is intentionally replaced. Its local build manifest is
`.netlify/application-release-build.json`. The complete deployable directory is
**`production-dist/`**, not the repository root, `dist/` or `marketing-dist/`.

Ordinary `node scripts/build-production.mjs` remains the homepage-preservation
path and does not include fresh application source. Do not disable its
live-application guard. After a verified application release, deliberately
reconcile the preservation baseline to the new serving application before the
next ordinary homepage release.

Review a Netlify draft built from this exact output before promoting it. Verify
account navigation, each authorized web planner role, draft lifecycle behavior,
legacy URLs, homepage navigation, preserved asset hashes and the absence of the
Insights prototype. Deploy gateway/rules/configuration in a coordinated order
with readback; a website deployment alone does not enable the new permissions.
Record the actual releases and recovery instructions in the production receipt.

## Validation recorded so far

| Check | Recorded result |
| --- | --- |
| App test inventory | 758 expected tests. The preceding full run passed 757 and exposed one outdated navigation assertion; the updated three-test navigation suite passed. A final full-suite receipt is pending. |
| Focused hierarchy, roster, navigation, organization and editor regression selection | 51 passed. These tests overlap the app suite and are not an additional 51 tests to add to its total. |
| TypeScript | Passed after the hierarchy and navigation changes. |
| Targeted hierarchy diff checks | Passed. |
| Integrated browser review, backend/rules validation and production readback | Pending final release receipts. |

Tests include migrated players with stale legacy pointers, shared coach/team
assignments, absent or malformed staff membership, rosters beyond the global
search cap, explicit truncation, retained signup controls and return links, and
unchanged coach difficulty-source resolution. Keep synthetic test fixtures
separate from private athlete data.
