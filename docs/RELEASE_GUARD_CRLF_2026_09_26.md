# Protected application guard: CRLF recovery — September 26, 2026

This isolated branch fixes the clean-checkout production build failure without changing a protected page, the 1,078-file manifest, the pinned deployment, or the release approval boundary.

## Exact discrepancy

`deployment/homepage-baseline.json` pins `/drillcreation.html` and its duplicate `/drillcreation 2.html` to SHA-1 `1aea46bb035974a1adf4a90bb8c789126d656631`, 36,092 bytes. The tracked `drillcreation.html` checks out on this Mac as 35,175 bytes, SHA-1 `ae35c4489fe37249044d749e1ccb6ded496c4e3e`, with 917 LF endings. Converting those 917 endings to CRLF adds exactly 917 bytes and reproduces the pinned hash and size exactly.

The pinned deployed URL serves 36,088 bytes, SHA-1 `4b51adb5329e4c902660d449e61a7842333e6b50`, because Netlify pretty-URL processing changes the page's `href="sessions.html"` to `href='/sessions'` (including quote changes). The served response is therefore not the original protected file. The previous builder could normalize CRLF to LF but could not reconstruct the original CRLF when Git checked the source out as LF, so the fallback download failed its checksum. The earlier AI incidents production receipt recorded this same cache-seeding workaround for 23 legacy pages and noted automatic Linux builds still failed.

## Narrow correction and verification

`scripts/build-production.mjs` now tries the local bytes, LF-normalized bytes, and CRLF-normalized bytes for a declared local source or exact-hash alias. A candidate is accepted only when **both** size and SHA-1 match that manifest entry. A source with different content still fails. The live application drift check, overlap guard, downloaded-file checksum, and final verification of every preserved output file remain unchanged.

The new fixture test covers both drill aliases with an LF checkout and a rewritten served response, and proves a different local source still fails. The full `node scripts/build-production.mjs` run verified all **1,078** protected files from deployment `6ab788d1c138322f8f9b9911`. `node scripts/test-production-entry.cjs --http-only` independently verified all 1,078 output files, 25 application routes, three Coaches routes, and 920 assets. The 12 production-baseline integration tests passed. Browser and authenticated workflow checks were not performed by this guard-only task.

## Release effect

Once this branch is integrated, a clean checkout can reconstruct the pinned original HTML for these legacy pages without manual cache seeding. Other feature branches still require their own production assembly, preservation check, review, and authorized deployment; this branch deploys nothing and does not update the recorded production baseline. If the live application entry changes before a future build, the drift guard continues to stop the build until a deliberate baseline reconciliation.

## Integration follow-up: historical `/index 2.html`

After the conversion and coach branches were merged for review, the clean production build reached a second guard failure at `/index 2.html`. Its manifest pin is 2,530 bytes, SHA-1 `e4d2dfc372f5554ba31be85fefffac6f1b467847`; the pinned deployment serves 2,525 bytes because Netlify changes the `<noscript>` link's attribute order, quote style, and `/bookPerformanceTest.html` destination to `/bookperformancetest`. The previous recovery substituted a `<noscript>` block from current `index.html`. The conversion branch intentionally changed that current block's link text from “Book a performance test” to “Ask about a performance test,” so it could no longer reconstruct the historical duplicate. This is a build-time preservation dependency on mutable marketing source, not a conversion-page defect.

A scan fetched and hashed **every one of the 1,078 manifest URLs** from the pinned deployment: 1,078 responses succeeded, 51 served bytes differed from the manifest. Fifty are legacy HTML paths/aliases whose 25 declared `localPath` sources in the integration checkout still match their original pins exactly (23 after LF→CRLF, two as raw bytes). The only remaining mismatch was `/index 2.html`. Its exact original `<noscript>` block was extracted from the already checksum-verified pinned cache and committed as `deployment/pinned-index-noscript.html`; the builder uses that snapshot only for historical numbered index aliases, and accepts a reconstructed file only when the **whole file** matches the manifest size and SHA-1. It does not rewrite the current homepage or broaden the manifest. Fixture tests change the current homepage copy and prove preservation still succeeds; altering the pinned snapshot or unrelated served HTML still fails.

For a clean-cache test, the entire pinned deployment cache was moved aside. The uncached `node scripts/build-production.mjs` fetched/reconstructed and verified all 1,078 protected files. `node scripts/test-production-entry.cjs --http-only` independently verified the 1,078 files, 25 app routes, three Coaches routes, and 920 assets. All 12 production-baseline integration tests passed. This correction must also be integrated into the readiness branch before its guarded production assembly; there is no deployment here.
