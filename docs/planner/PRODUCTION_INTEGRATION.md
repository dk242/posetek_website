# Main-site admin integration

The production Programs page at `/admin/programs` links to the personalized planner at `/admin/programs/personalized`. Admin home and player details also provide entries. Both planners share the refreshed admin application, with complete selection handled by their React components. The current planner remains the default and fallback. Navigation does not activate plans.

## Route ownership

The latest production kick-comparison source (`f05ec43`) is still absent from GitHub. Two document entries temporarily preserve those newer tools while shipping the approved admin UI and signup codes.

| Route | Serving application |
| --- | --- |
| Admin home, organizations, accounts, player/coach profiles, drill library/forms, workout editor, both planners | Refreshed admin entry under `/personalized-app/` |
| `/admin/analysis` and descendants | Preserved production app |
| `/admin/accounts/player/:playerId/results` and descendants, including rep tools | Preserved production app |
| Non-admin website | Preserved production app |

The explicit analysis/results exceptions in `netlify.toml` precede the general admin rewrite. `deployment/admin-routes.js` mirrors this contract; the browser entry suite checks both against representative deep links. Cross-entry links load a document so each workspace uses its proper application. Same-entry navigation, browser history and Firebase authorization remain intact. The bridge does not select players or submit jobs.

Technique review remains accessible from admin home and the header. On compact screens four bottom tabs remain visible; technique review has a separate accessible header shortcut. The preserved header adapter adds only labels and its owned shortcut, leaving original links and handlers intact.

## Reproducible production build

Run `npm --prefix app ci`, then `node scripts/build-production.mjs`. Publish only `production-dist` with the repository's `netlify.toml`. The ordinary app build is for local development and must not replace the composed release while source recovery is outstanding.

`deployment/production-baseline.json` pins immutable deployment `6aa0731ea06d42b6faafcd78`. The build verifies the live root still belongs to that preserved application, builds the refreshed app under `/personalized-app/`, then reconstructs the existing site's 153 served files. Each original file must match its deployment checksum. Exact matching tracked files are used, with original filename case and verified LF normalization. Remaining assets are compressed in `deployment/preserved-assets`; a checksum-verified cache and immutable-download fallback are also available.

Original root HTML receives one marked block loading the document bridge and scoped theme. Removing that block must reproduce the original checksum. Existing JavaScript, CSS, media and legacy files remain unchanged. Netlify's non-public configuration is replaced by the reviewed repository configuration.

The preserved analysis/results screens use a separately compiled copy of the **same** `admin.scss` and `admin-surfaces.scss` as the refreshed app, plus `deployment/preserved-admin.scss` for header markup compatibility. Doubled admin-root specificity makes the theme reliable when legacy route styles load later. Every selector remains admin-scoped. The generated theme has a content-hashed filename.

## Validation

- TypeScript and all 558 website tests pass.
- Refreshed components passed 36 route/viewport fixture checks at 1440, 820 and 390px, including copy success/failure, missing/stale codes, dialogs, editor controls, batch-bar clearance and standalone organization style isolation.
- Personalized fixtures passed draft review/activation-job and fallback selection checks at all three widths. These are local synthetic data; no real plan was activated.
- `scripts/test-production-entry.cjs [baseURL]` verifies 19 real rewrite destinations, real sign-in gates, both document entries, history, preserved-header presentation, four mobile tabs, public style isolation and asset/JavaScript errors. Omit the URL to serve the composed output locally. It uses Playwright selected through `PLAYWRIGHT_MODULE_PATH` (or installed in the app) and Chrome.
- Workspace QA evidence is stored outside the publish directory under `outputs/admin-ui-qa` and `outputs/planner-implementation`. The live signed-out checks and synthetic readiness/header checks do not claim an authenticated production activation.

The mobile reference was rechecked against `posetek-mobile-app` origin/main `1841566`: `CoachSurface`, `PoseTekProfileBackground`, and `AdminShellView`. Emerald gradient, lime accent, card/input corners, typography and safe-area-aware navigation match the approved website adaptation. Mobile source was not changed.

Before a production release, compare the live deployment with the reviewed release record. Do not overwrite an independent release. When the actual kick source is merged, remove composition and the bridge together, use the normal full-app build, and verify the merged routes.

Backend/runtime protections and fallback procedures remain in `RELEASE.md`. This website update changes no backend code, player plans or completion records.
