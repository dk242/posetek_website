# Netlify → Firebase Hosting migration

Status on 2026-09-25: preparation only. `https://posetek.net` is still served by Netlify
(DNS at Cloudflare: apex A `75.2.60.5`, `www` CNAME `posetek.netlify.app`). Nothing in
this change touches the live Netlify site, the live Firebase Hosting channel, DNS,
Functions or rules.

## Baseline archive

`scripts/build-production.mjs` preserves the 899 files of the pinned deploy in
`deployment/homepage-baseline.json`. It used to download missing files from that Netlify
deploy URL. Netlify's pretty-URL processing rewrites served HTML (links become
`href='/sessions'`, attributes are reordered), so 51 HTML files could never match their
recorded hashes from a download. Builds only worked from the original machine's cache or a
CRLF checkout.

The exact uploaded bytes are now archived in the private, versioned bucket
`gs://kickai-69dd0-website-baselines/<deploymentId>/` (us-west1), recorded as `archive` in
the manifest. 50 of the 51 HTML files are the repository sources with CRLF line endings.
`/index 2.html` was reconstructed from the served copy by restoring the original
`<a style="color:#b7f34a" href="/bookPerformanceTest.html">` from commit `71340b5`. All
899 files were verified by SHA-1 and size after a round trip through the bucket. The
builder reads the archive with the current `gcloud` login and also accepts LF→CRLF
conversion of tracked sources.

## File-name case

Netlify lists deploy files in lowercase and serves paths case-insensitively. Firebase
Hosting is case-sensitive. The manifest recorded 776 files in lowercase while the code
requests them in their original case (`/assets/AdminHome-BIAmXIyR.js`, `/sprintPage.html`),
which would have broken the application on Firebase. Manifest paths now use the original
case: the repository file name where one exists, otherwise the single casing that the
built files reference. No file is referenced in more than one casing, and nothing references
the lowercase names. SHA-1 and size entries are unchanged. Netlify is unaffected because it
ignores case.

`scripts/reconcile-homepage-baseline.mjs` still builds manifests from a Netlify inventory
and would reintroduce lowercase paths. Do not reconcile from Netlify again before cutover.

## Hosting configuration

`firebase.json` now publishes `production-dist` and mirrors `netlify.toml`:

- `cleanUrls` reproduces Netlify's pretty URLs (`/page.html` → 301 `/page`).
- 23 regex redirects map the lowercase pretty URLs that Netlify issued for mixed-case
  pages (for example `/sprintpage`) to the real page (`/sprintPage`).
- `/coaches` rewrites to `coaches/index.html`; everything else falls back to
  `/application.html`.
- HTML, extensionless routes, and unhashed JS/CSS are `no-cache`. `/assets/**` and
  `/marketing/assets/**` are immutable.

The Hosting ignore list still excludes `backfill-session-summaries.html` and
`images/logo-export.html`. Both are live on Netlify today.
`deployments/club-organization/hosting_release.py` requires `public: "dist"` and rejects
redirects; it was written for the earlier non-production site and does not apply to this
configuration.

## Verification

A crawl of 1,069 URLs (every built file, SPA routes, and each legacy page as `.html`,
extensionless, lowercase and uppercase) against the local Hosting emulator matched
production for status, redirect target (ignoring case), content type, SPA fallback, and every
non-HTML body. The emulator runs on a case-insensitive disk, so it cannot prove case
behavior. Only all-uppercase URLs are known to differ: Netlify redirects them, while Firebase
will serve the application's 404 route.

Preview channel `netlify-migration` (expires 2026-10-02) was deployed, but every path on
both project Hosting sites, live included, returns Google's "Site Not Found" page, even
`/__/firebase/init.json`. This predates the migration work. Check the Hosting page in the
Firebase console for a disabled or suspended site before continuing.

## Remaining steps

1. Resolve the "Site Not Found" state, then repeat the crawl against the preview channel.
2. Decide whether the backfill and logo-export pages should be served.
3. Lower Cloudflare TTLs; add `posetek.net` and `www.posetek.net` as custom domains on site
   `kickai-69dd0`; switch the A/CNAME records (DNS only while the certificate provisions).
   Leave MX, SPF and verification TXT records unchanged.
4. Keep Netlify available for one week as rollback, then update README, AGENTS.md and the
   release documents, and retire `netlify.toml`.
