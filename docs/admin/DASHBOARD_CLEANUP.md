# Admin dashboard cleanup

Implemented September 22, 2026 on `taiyo-cleaning-dashboard`. This is a source
change only; it has not been deployed.

## Result

- `/admin` now opens the expanded Insights overview inside the authenticated
  admin shell instead of showing a menu of feature cards.
- The admin header has a compact top bar with the PoseTek identity, shared
  organization/team scope switcher, and account menu. A second row contains six
  regular tabs: Overview, Accounts, Organizations, Planner, Technique review,
  and Drill library.
- Community feed is available from the account menu and is explicitly marked
  as a surface outside the admin console.
- Admin scope stays in `orgId` and `teamId` query parameters as users move
  between tabs. The embedded Insights controls defer organization/team scope to
  the admin header.
- `/insights` remains a standalone staff route with its own header and access
  behavior. It shares the visual cleanup, chart theme, period controls, and
  expandable metric definitions.

## Overview report

The admin overview uses the existing `getClubInsightsV2` response. No server
contract or database write changed. It adds:

- four KPI tiles with small trend lines sourced from the existing daily testing,
  workout, and usage series;
- a Needs attention panel sourced from `testing.needsReview`,
  `testing.unmatchedFailureReports`, and the `noRecordedTests` status count;
- direct links into Accounts and Technique review with the current scope;
- testing coverage and team distribution bars with the existing click-to-filter
  behavior and accessible tables.

The earlier doughnut charts are horizontal bars. Status colors follow an ordered
good/warning/danger/neutral scale from `app/src/pages/insights/chartTheme.ts`.
Metric-definition wording is unchanged and now lives in expandable “About these
numbers” disclosures.

## Theme and responsive behavior

`app/src/styles/admin-theme.scss` is the shared admin/Insights token source. It
defines three surfaces, one border, primary/muted text, the PoseTek lime accent,
and semantic status colors. Admin and Insights use border-separated surfaces,
8/12/16px radii, no background glow or grid, and no decorative gradients.

Below 760px the admin tabs scroll horizontally. They do not wrap or become a
fixed bottom bar. Deep player/result/rep routes receive a shared breadcrumb.
Focus rings remain visible and all admin/Insights motion is disabled when the
user requests reduced motion.

## Development preview and screenshots

In development only, `/admin?preview=1` bypasses Firebase session setup and uses
the synthetic expanded report from `insights/lib/preview.ts`. The guard is
`import.meta.env.DEV`; production builds do not expose this bypass.

Install Chromium once, then capture all target widths:

```powershell
npx playwright install chromium
npm --prefix app run screenshot:admin -- --label=current
```

The script captures 1440, 1024, and 390px pages under the ignored
`artifacts/admin-dashboard/<label>/` directory. The local implementation pass
kept `before` and `after` sets there for comparison; generated images are not
source artifacts and are not committed.

## Verification

Run from the repository root:

```powershell
npm --prefix app run lint
npm --prefix app test
npm --prefix app run build
```

The implementation pass completed TypeScript compilation, 898 frontend tests,
the application build, and responsive Playwright screenshots. Lint completed
with the repository's existing warning set and no errors. The Vite build retains
its existing large-chunk warning.

Do not deploy from this document. Application publication still uses the guarded
`node scripts/build-application-release.mjs` workflow and a reviewed draft.
