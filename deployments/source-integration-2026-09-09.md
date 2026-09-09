# Website source integration — 2026-09-09

Status: code complete, local validation passed; external release approval and interactive acceptance outstanding.

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

Automatic approval review rejected the preview upload because the combined proprietary website bundle and external Netlify destination need specific approval. No preview or production release occurred. The main push is withheld because the linked Netlify site automatically deploys main. The unchanged production baseline is deployment `6aa0973690a4730008ed43f4`, GitHub commit `eed6667`.

After explicit release approval: recheck repository ownership, GitHub main and the serving Netlify deployment; reconcile any newer partner work; publish the frozen `dist` candidate to the existing PoseTek site's preview; run `node scripts/test-production-entry.cjs <previewURL> --http-only` (plus browser mode when available); push the normal merged main history without force. Verify the automatic production build and repeat serving-entry/asset checks against production. If the remote build has different generated hashes, retrieve and inspect its output before claiming exact-byte equivalence. Any emergency website rollback must preserve both feature sets; do not deploy one parent's app alone.

Signed-in saved-pair selection/reload, annotation save/reload/export, real planner draft review/activation, and outstanding mobile device checks remain acceptance work. These were not silently marked passed. The automated suites cover their pure logic and mocked backend contracts, not authenticated production interactions.
