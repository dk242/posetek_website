# Website source integration — 2026-09-09

Status: merged, pushed and published 2026-09-09; local and deployed HTTP validation passed. Interactive acceptance remains outstanding.

The integration preserves Nolan's local main `ad136f3` (10 commits beyond the common base) and Dylan's GitHub main `eed6667` (8 commits beyond the common base). Both histories share `a5b9580`. The interrupted merge observed earlier had been reset before this work began; the checkout was clean. An incremental Git bundle at `/private/tmp/posetek-website-pre-integration-20260909.bundle` preserves both parent refs and verifies against the common base, which remains in repository history.

## Combined behavior

- Preserve kick technique review, annotations, correction history, dataset exports and saved bilateral comparison selection.
- Preserve the optional personalized planner, reviewed draft activation logic, shared athlete badges, signup codes and refreshed admin surfaces.
- Keep both routes/home entries and the refreshed four-section header with the technique-review shortcut. Its shortcut now uses in-app navigation.
- Keep the canonical `shooting: "kick"` stats mapping; both histories already agreed on behavior and differed only in explanatory comments.
- Publish the complete merged application from `dist`. The temporary `/personalized-app/` split and injected document bridge are retired from the active build. Historical archived assets remain tracked for evidence; the compatibility build script delegates to the normal application build.

No backend handlers, athlete records, active plans or mobile source were changed by this integration. The mobile GitHub main was independently verified as `f3cb9a2`, equal to local main: the previously unpushed 72 commits were already synchronized by the time implementation began. Its 11 untracked space-2 copies remain untouched; ten matched tracked originals during the earlier inspection and the other was a differing plan document, not additional app code. Existing secondary local branches in both repositories contain no commits outside their respective main histories.

## Validation

- Frontend: **579 tests passed across 28 files**, including three new combined-navigation regressions, saved-comparison selection and personalized draft baseline ordering checks.
- Functions: **83 tests passed**. Functions source is unchanged by the merge.
- TypeScript and production build: passed using existing dependencies; normal build and compatibility entry both exercised.
- Lint: exit zero with existing warnings. JavaScript script syntax and diff whitespace checks passed.
- Local HTTP verification: **19 deep links** serve the unified entry; all **63 generated JS/CSS assets** match their built bytes. The JSON receipt freezes all output files and hashes.
- Browser interaction remains unrun: the Browser plugin bootstrap failed with `Importing module "node:process" is not allowed in node_repl`; the existing Playwright test harness could not find installed Chrome. The initial local-server `listen EPERM` was resolved by ordinary approved execution, and HTTP-only checks passed. No browser, simulator or dependency cache was installed.
- Free disk space remained approximately 9.9 GiB. No mobile build or simulator workflow was run.

## Release prerequisite and remaining checks

Live source downloads verified `adminReviseRep` and `adminRestoreRepRevision` already contain byte-identical local `rep-revisions.js` and `athlete-storage-paths.js`; the older queued requirement to deploy those handlers before a website push is satisfied. Their live update timestamps are September 8 at 07:23 and 07:24 UTC. No redeployment was necessary.

A separate `getTeamLeaderboard` comparison found the deployed projection still omits `markerDistance` and `dribble_foot`. This is the existing foot/timing release gap, not a merge regression; deployment and cross-client parity verification remain pending. Do not claim the athlete leaderboard path is fully released based on Git synchronization.

## Published release

Nolan explicitly approved the website bundle upload, GitHub main push and automatic Netlify deployment after the initial automatic-review rejection. Both GitHub and serving production were rechecked unchanged before release. All 158 local output files still matched the frozen receipt.

- Preview: `6aa1a383181c5dbc8813fcec`, [immutable candidate](https://6aa1a383181c5dbc8813fcec--posetek.netlify.app). All 19 deep links and 63 exact generated JS/CSS asset checks passed.
- Normal Git push: GitHub main advanced from `eed6667` to `a8477be`, preserving both parent histories; no force push.
- Automatic production deployment: `6aa1a3b8dd4bbb0008aee897`, source `a8477be1dbc76975d46eb8ab653afb2aae8cb096`, published at **2026-09-09T18:22:22.865Z**. Netlify reported ready with no error.
- Live [posetek.net](https://posetek.net): all 19 deep links and all 63 generated JS/CSS files passed exact-byte comparison with the tested local build. The remote build therefore reproduced the verified application assets.
- The documentation-only verification commit follows the runtime release; it does not change the tested application or build configuration. The release JSON retains preview/production receipts and the original output manifest.

The earlier release hold is resolved. No callable redeploy, athlete-data mutation or mobile build was performed. The pre-integration production baseline remains recorded for history as `6aa0973690a4730008ed43f4`; do not restore one parent's application over the combined release without preserving both feature sets.

Signed-in saved-pair selection/reload, annotation save/reload/export, real planner draft review/activation, and outstanding mobile device checks remain acceptance work. These were not silently marked passed. The automated suites cover their pure logic and mocked backend contracts, not authenticated production interactions.
