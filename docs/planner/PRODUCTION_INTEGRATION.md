# Main-site integration

The personalized planner is served at `/admin/programs/personalized`. The default Programs page, admin home and individual player details show an **Open personalized planner** link for signed-in admins. The current planner remains the fallback. No plan is activated by navigation.

The latest production kick-comparison source (`f05ec43`) is still absent from GitHub. Production therefore uses two document entry points temporarily. This is an additive deployment, not a rebuild of the older local kick tools.

## Reproducible production build

Run `npm --prefix app ci`, then `node scripts/build-production.mjs`. Publish only `production-dist` using the repository's `netlify.toml`. The normal `npm --prefix app run build` remains useful for local full-app development; it must not be published alone while source recovery is outstanding.

`deployment/production-baseline.json` pins the immutable deployment `6aa0731ea06d42b6faafcd78` and file hashes. The build verifies the live shell still matches that preserved application, builds the planner under `/personalized-app/`, then reconstructs the existing site's 153 served files. Each original file must match its deployment checksum. Exact matching tracked files are used, including original filename case and LF normalization of Windows checkouts. The remaining published assets are retained as compressed, checksum-verified files in `deployment/preserved-assets`, so the build does not depend on Netlify retaining the old deployment. A cache and immutable-download fallback are also available. A missing or mismatched file stops the build.

The original root HTML receives one marked block loading the small launcher script and its scoped stylesheet. Removing that block must reproduce the original checksum. Existing JavaScript, CSS, media and legacy pages are untouched. Netlify's reserved, non-public configuration file is replaced by the reviewed repository configuration to add the planner rewrite. The original SPA catch-all is retained.

The launcher owns one named element and does not change original control handlers or submit jobs. It restores requested organization/roster selection through those existing controls. It appears only beside the existing signed-in admin navigation on supported pages. Disabled or unavailable players are never forced into the current builder. Bulk selections of filtered-out rows cannot be recovered from the old application's DOM, so verify selection after switching from a filtered current roster. The planner itself retains its normal complete selection state and persisted job progress.

Cross-entry links perform document navigation so the old application always handles existing kick tools and the planner application handles its own page. Browser history and programmatic navigation are also handled; both entries retain their existing Firebase authorization. The launcher disappears from non-admin pages, sign-in gates and rep editors. It waits while the current roster form is submitting.

## Verification and maintenance

- TypeScript and production build passed; all 153 original served files passed preservation checks.
- Entry tests at 1440, 820 and 390px covered launcher visibility, selection restoration, disabled players, document navigation and non-admin exclusion without submitting any plan.
- The composed Netlify preview loaded both real application bundles and the admin gates without asset failures or JavaScript errors. The launcher was also checked against the actual preserved DOM/styles using synthetic readiness markup; this does not claim a live authenticated activation.
- Earlier planner validation remains recorded in `RELEASE.md` and `live-validation.json`.

The browser entry suite is `scripts/test-production-entry.cjs`. It requires Playwright (installed in the app or selected with `PLAYWRIGHT_MODULE_PATH`) and Chrome. It serves synthetic fixtures locally and writes screenshots/reports under the ignored app cache; it never connects to player data or submits real jobs. Live composed-page checks and release evidence are in the workspace's `outputs/planner-implementation` directory.

Before each production release, compare the live Netlify deployment with the reviewed release record. Do not overwrite a newer independent release. Keep the immutable baseline deployment available. Once the actual kick source is merged, remove the manifest composition and launcher adapter together, return the Netlify build to the normal full-app build, and verify the merged routes before publishing.

The runtime feature flag, draft access protections and private context bucket remain as documented in `RELEASE.md`. This website release changes no backend code, training plan or completion record.
