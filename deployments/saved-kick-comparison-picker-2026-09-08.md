# Saved kick comparison picker — 2026-09-08

Status: deployed and public assets verified. Signed-in browser interaction remains unverified.

The admin technique workspace previously chose a left kick and right kick independently. A saved comparison using earlier recordings could therefore be difficult to find after newer kicks arrived. The **Saved comparison** selector now lists saved pairs newest first and selects the latest valid pair when an athlete loads. Manual left/right selectors remain available, selections survive reloads, and pair state belongs to the selected athlete. A saved report cannot introduce a rep omitted by the existing kick filter or override an absent, changed or incorrect foot label.

To review a saved pair, open [Admin → Kick technique](https://posetek.net/admin/analysis), choose the organization and athlete, select **Left versus right**, then choose the saved comparison. Gateway generation, review callables, correction publication and dataset contracts are unchanged by this release.

## Validation and source

- Runtime source: `f05ec43e2da0df8724eb2fc7a7f68afda7f58bde`, committed on `saved-kick-comparison-picker` after review.
- `npm --prefix app test`: 546 tests passed across 24 files.
- Focused `analysisReview.test.ts`: 12 tests passed, including five new regressions for saved-pair defaults, chronological ordering, rep/foot filtering, selection preservation and invalidated sources.
- `npm --prefix app run build`: TypeScript, Vite production build and legacy copy all passed. Existing dependencies, build paths and caches were reused.
- Scoped oxlint: exit 0, with four existing `set-state-in-effect` warnings. `git diff --check` passed.
- Storage remained 11 GiB before and after the build. No dependency install, cache relocation or simulator work occurred.

## Exact release

The frozen publication contains 154 files totaling 55,259,855 bytes. Its manifest SHA-256 is `f9de3aa138cc7250333e6f2d3a3cd3cb57eb5ac382508f756a7ede49a8151bfc`. The generated picker bundle is `assets/AnalysisWorkspace-ZFS2v5hD.js`.

The existing legacy-copy step initially included 17 newly present, untracked iCloud duplicate image files named with ` 2` suffixes. Every duplicate matched its already-public canonical original byte for byte and had no source reference. Only those generated `dist/` copies were omitted before freezing; all source copies and canonical originals were preserved. Their paths and hashes are retained in the receipt. All remaining non-asset files match the predecessor build, excluding the intentionally updated SPA index. This was a packaging correction without another build.

Draft [6aa0731ea06d42b6faafcd78](https://6aa0731ea06d42b6faafcd78--posetek.netlify.app/admin/analysis) passed 154 checks covering all 153 intended public files and the admin route. Netlify excludes the remaining manifest entry, `images/.DS_Store`. All 74 JavaScript/CSS bodies and the admin shell match their frozen SHA-256 values. Both the **Saved comparison** text and existing `shooting` → `kick` statistics mapping were verified in the downloaded bundles. Other binary resources match expected sizes. The 25 HTML files changed by Netlify preserve their parsed content after normalizing only anchor pretty URLs and attribute serialization.

After a fresh ownership check and confirmation that production still pointed to predecessor `6aa061cc30bf0203f6cfb3d9`, the installed Netlify CLI promoted this exact draft using `restoreSiteDeploy`. Publication occurred at **2026-09-08T20:46:43.731Z**. Site readback confirmed the same production ID. All 154 checks passed again against `https://posetek.net` at 20:47:16 UTC. No rebuild or Git push occurred during deployment.

The [machine-readable receipt](saved-kick-comparison-picker-2026-09-08.json) contains the frozen manifest, duplicate-copy scope, preview and production results. The [previous production receipt](kick-technique-review-production-2026-09-08.json) remains unchanged as the predecessor record, including the review-callable release evidence.

## Remaining interaction checks

Public HTTP checks do not verify signed-in behavior. A signed-in admin should still exercise saved-pair selection, reload persistence, manual selection, annotation save/reload, stale-source rejection, publication and export. These checks remain pending because supported Browser/Computer Use was unavailable during this session. No browser-click or athlete-rendering verification is claimed. The root integration task records Vacaville job completion separately.
