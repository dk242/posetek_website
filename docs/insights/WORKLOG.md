# Club insights — worklog

Branch `worktree-club-insights`. Website repo only; the mobile app and gateway are untouched.

## Goal

A `/insights` page where club coaches, club managers and PoseTek admins see, per team:
who is recording, how often, and whether each player's key drill metric is improving.

## Decisions (2026-09-16)

- **No Prometheus/Grafana in the prototype.** Per-player history is product data, not
  system telemetry. Player IDs as Prometheus labels are an unbounded-cardinality problem,
  phones cannot be scraped, and Grafana cannot enforce club/team access. Grafana is kept
  for a later internal ops view (phase 4). Agreed with the user.
- **Data source is existing Firestore reps.** `players/{id}/reps` already has `repType`,
  metrics and `createdAt`. No new instrumentation, no app release.
- **Server-side aggregation in a callable** (`functions/club-insights.js`), gated by the
  same predicates as `getTeamLeaderboard` (`club-access.js`). Players are not allowed;
  this is a staff view. Only weekly aggregates leave the server, never raw reps.
- **One primary metric per drill**, first present field wins, and a series never mixes
  fields (the jump fields are in different units).
- **Reps without `createdAt` are counted as `undatedReps`**, not silently dropped.
- **Standalone page** at `/insights`, per the user.

## Prototype scope

- [x] `functions/club-insights.js` + `club-insights.test.js`
- [x] export `getClubInsights` in `functions/index.js`
- [x] `app/src/pages/insights/` page, pure helpers + vitest
- [x] `/insights` route in `App.tsx`
- [x] verification: node tests, app lint/test/build
- [ ] deploy the callable (not done; needs `deployments/club-organization/functions-release.py`)
- [ ] try it against real club data (not done)

Not in scope: deploy, rules changes, mobile changes, feature/screen tracking.

## Known limits of the prototype

- Reads every rep for every rostered player on each load (same as the leaderboard).
  Fine for tens of players; will get slow and costly for large clubs.
- "Usage" means recorded reps only. Opening the app, viewing results, AI chat and
  web visits are invisible.
- Weeks are UTC Monday-start buckets, not club-local time.
- Nothing has been checked against production data; the share of reps missing
  `createdAt` is unknown.

## Roadmap after the prototype

1. **Feature usage events.** Add Firebase Analytics to iOS behind a facade like
   `Diagnostics`, GA4 on the web, a closed event vocabulary (drill_started,
   drill_completed, results_viewed, ai_chat_opened, plan_viewed), and BigQuery export.
   Needs a privacy/consent review first — athletes include minors.
2. **Serve usage from BigQuery** through a callable using the same club access check.
   Coaches never get direct BigQuery or console access.
3. **Precomputed rollups.** A scheduled function (or an on-write trigger on reps) keeps
   `organizations/{id}/insightsWeekly/{teamId_week}` so the page stops scanning reps.
4. **Internal ops view for PoseTek staff.** Grafana (or Cloud Monitoring dashboards)
   over Cloud Run request/latency/error metrics, gateway `llmUsage` cost, and processor
   failures. Google Managed Service for Prometheus if custom metrics are needed.
5. **Richer improvement analysis.** Per-drill units, benchmark bands
   (`lib/benchmarks.ts`), rolling personal bests, "no activity in N days" alerts.
6. **Admin cross-club view.** Totals across organizations for PoseTek admins.

## Log

### 2026-09-16 — prototype built

What exists:
- `getClubInsights({organizationId, teamId, weeks=1..26})` → `{teamName, weeks[], players[{lastActiveMillis,
  undatedReps, weeklyReps[], drillCounts, metrics[{drill, field, lowerIsBetter, weeklyBest[]}]}]}`.
  Access: verified `@posetek.net` admin, or an active member where `memberCanAccessPlayer` allows the team
  (manager = any team in own club, coach = assigned teams). Players and legacy coaches get `permission-denied`.
- `/insights` page: org picker (admins / multi-club), team + period pickers, summary tiles, team reps-per-week
  bar chart, sortable player table with per-week counts, and a player panel with a best-per-week trend chart
  per drill metric. The report UI is `InsightsReport.tsx`, a pure-props component, so it is testable without Firebase.

Evidence:
- `node --test functions/*.test.js`: 126 pass, 0 fail (includes 6 new).
- Mutation check: with the member access check removed, the "callers without access" test fails.
- `npm --prefix app test`: 49 files, 723 tests pass. `npm --prefix app run build`: succeeds.
- `oxlint` on the new files: 2 warnings (set-state-in-effect, ref-in-cleanup), the same kinds already present in
  `OrganizationPage.tsx` and the admin views.
- Visual check: a temporary Vite harness with synthetic data, screenshotted in headless Chrome at 1280px and
  inside a 390px iframe. Found and fixed unrounded y-axis ticks and a player detail nested in the horizontally
  scrolling table. Harness files were deleted afterwards.

Not verified:
- Never ran against the Functions emulator or production. `src/lib/firebase.ts` always targets production,
  so the full page flow (auth → getClubContext → getClubInsights) has not been exercised end to end.
- Real rep field coverage (which jump field is populated, share of reps without `createdAt`) is unknown.

Decisions:
- Player detail renders as its own card below the table, not an expanded table row, so phone users don't
  scroll charts sideways.
- No link to `/insights` was added from `/organization`: PORTING.md says a page owns its folder. Add it when
  the callable is deployed.

### 2026-09-16 — review fixes

An independent review found no authorization or data-leak defect. Fixed:
- A failed org switch left stale teams with the selection cleared. Selection now changes only when the load
  succeeds; the page also has a Refresh button.
- Roster above 200 was cut silently. It now returns `rosterTruncated` and the page says so.
- `lastActiveMillis` is clamped to now and rounded to the UTC day.
- The trend compared raw values but displayed rounded ones; it now compares the displayed values.
- Charts were rebuilt on every render; their data is now memoized.
- A `repType` of `constructor` crashed the callable (it hit `Object.prototype` in the metric lookup), and
  `__proto__` lost counts. Both found by a new test; such names now count as `unknown`.

Evidence after fixes: functions 128/128 pass (8 in `club-insights.test.js`), app 49 files / 723 tests pass,
build succeeds, same 2 lint warnings.

Open, needs a product decision:
- **Reps from a player's previous club are included** (same as `getTeamLeaderboard`). Decide whether new club
  staff should see pre-transfer history; if not, reps need an organization stamp or a transfer date to filter on.
- **Read cost:** every load reads all reps for every rostered player, regardless of the period. Acceptable
  for a pilot; roadmap item 3 (rollups) is the fix. A `createdAt >=` query bound would cut reads but lose
  undated counts and all-time last-active.
- A `not-found` vs `permission-denied` difference reveals whether a team id belongs to an org. Same as the
  leaderboard; low risk.
