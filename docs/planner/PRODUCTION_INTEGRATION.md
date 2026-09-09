# Main-site admin integration

The personalized planner and kick technique-review tools share the same application and refreshed admin header. `/admin/programs` remains the current planner; `/admin/programs/personalized` is the optional reviewed-draft planner. `/admin/analysis` retains saved bilateral comparisons, annotations, corrections and exports. Both features are reachable from admin home; the header retains its four compact navigation tabs and technique-review shortcut.

## Build and routing

`npm --prefix app run build` produces `dist`, published by `netlify.toml`. `node scripts/build-production.mjs` delegates to that same build for compatibility. All SPA deep links use `/index.html`; existing legacy files continue to be copied by `app/scripts/copy-legacy.mjs`. The build no longer downloads or combines a separate serving application, and no document bridge is injected.

The September 8 composition assets and manifest under `deployment/` are retained as historical rollback evidence. They are not inputs to the current build and must not be published over the merged source. The split-entry instructions and deployment IDs in `RELEASE.md` describe that historical release.

## Verification

Run frontend tests, Functions tests, lint and the production build. `scripts/test-production-entry.cjs [baseURL]` checks 19 deep links use the unified entry, all built JS/CSS match served bytes, and real signed-out admin gates and browser history work at 1440, 820 and 390px without overflow or JavaScript errors. Without a URL it serves `dist` locally. `--http-only` runs route/asset checks when no browser is available and explicitly records browser checks as unrun. Set `PLAYWRIGHT_MODULE_PATH` to an existing Playwright installation if the app does not have one; it uses installed Chrome.

`AdminNavigation.test.tsx` verifies both home entries, the current-planner fallback, the technique-review shortcut and the four-section refreshed header. Existing review and planner suites verify saved-comparison helpers, revision behavior and draft baseline comparison. Signed-in annotation save/export and real draft activation remain separate acceptance checks; public browser checks do not establish those results.

Before a release, compare the current GitHub head and published Netlify deployment with the integration receipt. Preserve independent releases. Backend/runtime protections and fallback procedures remain in `RELEASE.md`; website synchronization does not activate player plans or modify completion records.
