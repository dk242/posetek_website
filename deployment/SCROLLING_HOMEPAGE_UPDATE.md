# Scrolling homepage update — September 15, 2026

## Published release

The user authorized production publication. Netlify promoted the exact validated
draft `6aa9fd38c6863f74b02380e9` to [posetek.net](https://posetek.net) on September 15,
2026 at 7:25:58 PM PDT (`2026-09-16T02:25:58.402Z`).
Pinned release: https://6aa9fd38c6863f74b02380e9--posetek.netlify.app.
The [production receipt](SCROLLING_HOMEPAGE_PRODUCTION.json) records publication
and verification. Live HTTP and published-file checks passed; the results below
distinguish local, hosted draft, and production checks.

This was a manual Netlify release; its source was uncommitted at publication.
The repository handoff now includes that implementation and the subsequent nine
annotation updates. See `ANNOTATION_UPDATE_PRODUCTION.json` for the later release
and the root README for collaborator setup. Previous production
`6aa9b6f0d8faf6177db8fd97` remains the unchanged tabbed reference and application
baseline; each production receipt records its release-specific rollback target.

## Brief and reference lock

Designing the public PoseTek homepage for soccer clubs, coaches, and players.
Goal: explain how testing becomes a practical next training step and let visitors
explore the product before booking a performance test.
Tone: precise, athletic, progressive; dark green, lime, condensed headings, measured
movement graphics, and interactive product demonstrations.
Path: direct implementation of the user's explicitly selected combination.

The two references are immutable Netlify releases:

- **Structure and story:** September 13, 4:36 PM PDT,
  `6aa73378185ce440bbf18168` (“Correct mobile admin tab padding”).
  Its five public homepage bundles matched the existing editable source build
  byte for byte. This establishes homepage equivalence, not application parity.
- **Visuals and interactions:** September 15, 2:44 PM PDT,
  `6aa9b6f0d8faf6177db8fd97` (“Compact interactive homepage preview”).
  Public output is pinned in `.netlify/deployed-reference/` with a hash manifest.
  Original source is unavailable. Demo recovery preserves published data and logic
  while replacing bundled framework imports with this project's dependencies.

## Decisions

| Decision | Basis |
| --- | --- |
| A long scrolling page with all capabilities present | Explicit user request; September 13 structure |
| Retain the evidence → review → compare → train → retest narrative | Earlier copy and documented PoseTek methodology |
| Separate movement, technique, AI Coach, and workout sections | Explicit user request; removes top-level showcase tabs |
| Keep local drill/phase/question selectors within demonstrations | These operate a capability rather than hide whole product sections |
| Preserve current hero reconstruction and recorded measurement data | September 15 visual/behavior reference |
| Show the sample athlete profile between analysis and guidance | Earlier structure makes the connection from measurements to training clear |
| Coach planning action scrolls to and seeds the workout planner | Adapts existing cross-tab action to the new scrolling journey |
| Load demonstrations near the viewport and retain state afterward | Long-page performance and continuity; existing motion/lifecycle conventions |
| Pause animation/timers offscreen and honor reduced motion | Existing behavior and Refero motion/craft guidance |
| Keep sample/recorded labels and public booking/sign-in routes | Existing product contracts; avoid presenting demonstrations as real account data |

Homepage implementation did not modify application source. For the subsequent
authorized release, `homepage-baseline.json` was reconciled to the full file
inventory of the September 15 reference. The review server remains a local-only
combination of marketing output and captured application; it is not a deploy command.

## Local implementation validation (before release reconciliation)

- 85 homepage tests passed across nine files; six homepage/application navigation
  tests passed. TypeScript passed. Svelte check: zero errors, zero warnings.
- Marketing production build passed. Its lazy Three.js hero chunk retains the
  existing size warning; it is not part of the initial entry download.
- Scoped lint passed for the changed page/loader/hero and recovered technique and
  product modules. `git diff --check` passed.
- Recorded data checksum tests passed. Technique initial rendered markup matched
  the published component, except its newly explicit accessible selector label.
- Product verification matched 45 published dose combinations and 1,791 reducer
  transitions, exact coach data, and original CSS rules.
- Browser reviewed at desktop, 390px phone, and 320px narrow phone widths. Movement
  drill changes, pause, keyboard scrubbing, technique phases/measurements/reference,
  profile selection, all coach question states, and the planner flow were exercised.
- Coach handoff prefills 20 minutes of dribbling and focuses the workout section.
  A second identical handoff resets/reseeds intentionally via `requestId`.
  Ordinary scrolling keeps all demo state mounted. The running workout timer was
  unchanged while offscreen, then resumed on return.
- Workout intake/edit/review/start, set completion/rest, pause, skipped summary,
  and a 15-minute low-energy shooting sample were checked. User-triggered stage
  changes reveal their focus heading below the fixed header; timer ticks do not scroll.
- All page IDs are unique and in-page links resolve. No top-level showcase tablist
  remains. Mobile navigation opens/closes and selecting a link closes it.
- Preview `/`, `/index.html`, `/signin`, `/privacy`, booking paths, and the homepage
  navigation bridge resolve. All 24 checked entry assets returned HTTP 200 with
  appropriate content types. No application code or baseline hashes changed.
- No browser errors or warnings were observed in the new homepage flows.

At this local-review stage, the production baseline mismatch remained unresolved
and no publication had occurred. The following release work supersedes that
historical limitation. No authenticated application acceptance test or backend/data
change was performed.

## Release reconciliation and production verification

- The full Netlify inventory for `6aa9b6f0d8faf6177db8fd97` supplied the new baseline;
  the partial 88-file visual-reference capture was not used as a complete backup.
- The modern manifest preserves 171 application/public files byte-for-byte,
  including `/application.html` and `/marketing/home-navigation.js`. Every retained
  file passed SHA-1 and size verification. Only `/index.html` and marketing assets
  are replaced by the homepage build.
- The build guard now compares live `/application.html` directly with the modern
  manifest. It no longer renames an app index or reinjects the already-present
  navigation bridge for this baseline. Legacy behavior remains supported.
- CLI-generated `/netlify.toml` metadata is recorded separately rather than treated
  as a served asset to preserve; Netlify regenerates it. The five effective header
  rules and one application fallback redirect were retained.
- Five baseline integration tests and six navigation tests passed. The baseline
  tests confirm exact modern/legacy preservation and rejection of live drift,
  corrupt downloads, and overlapping marketing paths.
- Production build passed. Hosted draft checks passed for two homepage routes,
  all 171 preserved files, 22 application routes, and 74 application assets.
- Hosted draft browser checks confirmed the AI Coach's 20-minute workout handoff,
  workout start, and pause without browser errors.
- That same verified draft was promoted to production without rebuilding. Consult
  the production receipt for live-domain verification results.
- Live HTTP checks passed for the same two homepage routes, 171 preserved files,
  22 application routes, and 74 application assets.
- Live browser smoke checks confirmed movement recording switching, technique
  phase selection, the sign-in screen, and the booking calendar. No form or
  account action was performed.
- Published deployment inventory: 195 files. All 194 files in `production-dist`
  exactly matched their published SHA-1 hashes and sizes. The one additional file
  is Netlify-generated `netlify.toml`; all 171 application/public baseline files
  remained unchanged. The broader interactive acceptance pass was on the hosted
  draft, followed by the listed live smoke checks.

## Local review

```powershell
node scripts/capture-deployed-reference.mjs # Once on a fresh clone
npm --prefix app run build:marketing
node scripts/serve-homepage-preview.mjs
```

Open http://127.0.0.1:4174. The unchanged September 15 capture can separately be
served with `node scripts/serve-deployed-reference.mjs` at port 4173. Both servers
bind to localhost and accept read-only requests. They are not hosting services.

The project guide lists the active source folders and recovery provenance.
Recovery scripts are one-time tools, not build steps; rerunning them may replace
intentional subsequent edits. Normal builds use the recovered files included
with the source and do not depend on the ignored reference capture.
