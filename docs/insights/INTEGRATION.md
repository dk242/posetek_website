# Team Insights integration

**Live at [posetek.net/insights](https://posetek.net/insights).** Deployment
`6aabb282bcbad486db278962` was published September 17, 2026 at 2:31:39 AM PDT
from source `55d46ea`. It integrates Taiyo's `609faa0` Team Insights prototype
into the existing application. The original [worklog](WORKLOG.md) remains a
record of the prototype. See the [production receipt](../../deployment/TEAM_INSIGHTS_PRODUCTION.json)
for verified release hashes, checks and recovery IDs.

## Product and access contract

- Verified PoseTek admins enter from Admin and select a canonical organization.
- Organization managers can inspect every team in their organization.
- Active coaches can inspect only their currently assigned canonical teams.
- Teams without a coach account remain available to managers and admins under
  their existing names. This feature creates no staff accounts or invitations.
- Organization and team selections travel in the URL. Links back to accounts,
  organization management and player details retain the relevant context.
- Loading, inaccessible teams, empty rosters and truncated results have explicit
  states. Switching organizations clears the previous report while loading.

## Meaning of the figures

The report describes recorded-document activity for the current canonical team
roster. It is not an audit of independently successful tests or app-open usage.
Failed and duplicate outputs can contribute to activity counts; missing dates,
incomplete records and query limits are disclosed. Trends use available positive
primary metrics and exclude explicitly invalid or incomplete processing.

Historical records follow the current player profile, including history recorded
before a transfer. Weeks start Monday in UTC. These semantics preserve the
prototype's comparisons; the separately verified testing workbook uses its own
qualification rules and America/Los_Angeles capture-date boundary. The dashboard
does not replace that workbook or claim equivalent testing coverage.

Only allowlisted names, aggregate counts and metric series leave the callable.
It does not return contacts, raw records, Storage URLs, private notes or traces.
The service checks current membership again before responding and omits players
who have moved or been deleted during the request. Reads and concurrency are
bounded; partial histories are visibly marked.

## Design reference and decisions

Direct implementation follows the existing product and Taiyo's prototype, using
the Refero direct-build workflow and bundled focus/forms craft guidance.

| Decision | Existing reference | Reason |
| --- | --- | --- |
| Green portal, lime charts, compact summary tiles | Insights prototype and pose-portal styles | Preserve PoseTek's established visual identity |
| Contextual quiet-button links | Accounts and Organization pages | Make entry and return navigation consistent |
| Scrollable weekly table and separate detail card | InsightsReport | Retain readable time-series comparisons on narrow screens |
| Explicit activity labels and limits | Backend aggregation contract | Prevent document counts being mistaken for successful testing |

## Validation and release

Use the focused Insights frontend and backend tests, role/access regressions,
TypeScript, application build/composition checks, and browser verification of
admin and staff flows. Coach restrictions and revocation cases use synthetic
fixtures; live verification is read-only and never generates a plan.

Deploy only the new `getClubInsights` callable using
[`deployments/club-insights/`](../../deployments/club-insights/), verify it, then
promote a reviewed application artifact. No Firestore rules, personalized gateway,
recordings, workbook, or native mobile changes are part of this release.

Build the complete site with `scripts/build-application-release.mjs`, preserving
the approved marketing snapshot. Publish a preview from `production-dist/` and
promote that exact artifact after verification. Record the previous production
deployment; reconcile `deployment/homepage-baseline.json` only after readback.
Keep owner tokens, live responses, local source packages and release captures
under ignored `.netlify/` paths. Never add them to Git.

The recorded release passed 835 frontend tests, TypeScript, 16 handler and 3
wrapper tests, 48 existing backend regressions, 18 release-tool tests and 25
composition checks. All four live manager team rosters matched canonical records;
admin access and signed-out/cross-organization denial passed. Hosted admin and
manager sign-ins, player results/context and a 390px, 26-week layout passed;
coach restrictions and revocation were exercised with synthetic fixtures.
The deployed six-file source package was downloaded and checksum-verified.
The ordinary marketing build subsequently preserved all 270 application files.
