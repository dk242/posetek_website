# PoseTek App Store presentation

Prepared September 18, 2026 from the PoseTek Project 2.0 website and native app.
This package contains the new official P icon, an editable six-panel gallery,
and App Store copy. It is not a claim that the App Store or TestFlight has been
updated.

## Deliverables and status

- **Icon:** `../../images/brand/posetek-app-icon-1024.png` is the opaque RGB
  1024 × 1024 native icon; the adjacent SVG is the outlined master and JPG is
  the requested reusable app photo. The isolated native branch has the PNG in
  its existing AppIcon catalog.
  The same native commit sets the installed app's display label to PoseTek.
- **Gallery:** six branded review layouts with source-grounded sample interfaces.
  Exports are visibly labeled previews. Fresh native captures are required
  before App Store upload; see `capture-brief.md` and the export manifest.
- **Copy:** `metadata.json` contains the name, subtitle, promotional text,
  description, keyword list, links and conditional release note. Null fields
  remain unresolved account facts, not blank values to overwrite in Connect.
- **Publication:** App Store Connect opened to the Apple sign-in screen in Edge.
  No account record, version, permissions or existing metadata could yet be
  inspected. No metadata was saved, screenshots uploaded, review submitted or
  iOS build archived/uploaded by this task.

## Editorial and visual direction

The user chose PoseTek's existing identity. The dominant source is the public
website: evergreen #04130E, lime #B7F34A, offwhite #F0F5ED, Inter body text and
Barlow Condensed headings. The story moves from testing to evidence, a training
focus, a guided session and retesting. The native repository supplies the feature
definitions. Keep the product's exact spelling **PoseTek** in customer copy;
KickAI remains the existing internal Xcode project and bundle identity.

| Decision | Source | Purpose |
| --- | --- | --- |
| P badge and three exact colors | `MarketingHeader.tsx`, `home.scss` | Honor the user's selected existing logo |
| Test → review → train → retest | `HomePage.tsx`, live `https://posetek.net/` | Explain the whole player-development journey |
| Six drill names and movement playback | Native `docs/ARCHITECTURE.md` | Describe implemented functionality accurately |
| Workout instructions, sets and rest | Native `WorkoutPlayerView.swift` | Show a practical training action |
| No promised gains or invented real athletes | User's project context and Apple accurate-metadata rules | Keep the promotional claims grounded |
| Preview labels until captures exist | Native-capture audit and `MOBILE_APP_SHOWCASE.md` | Distinguish authored layouts from release screenshots |

Website reference: `61ef7cc`; native reference: `944177b`. Source confirms code,
not the currently installed App Store/TestFlight build. Do not add unreleased
testing remediation, expanded Insights, provisional estimates, medical claims,
free/unlimited claims, or paid-plan terms without checking the actual release.

## Review and reproduce

From `brand/app-store`, run `npm ci` then `npm run render`. This writes six
1320 × 2868 iPhone PNGs, six 2064 × 2752 iPad PNGs, a contact sheet, standalone
gallery review HTML, a manifest and outlined SVG exports. Generated `output/`
and `source/` files stay outside Git. Font assets and their licenses are included.
`node export-icon.mjs` regenerates both raster icon formats from the SVG master.

The full review page is `brand/app-store/index.html`. Serve the repository root
locally, for example with `python -m http.server 4186 --bind 127.0.0.1`, then open
`http://127.0.0.1:4186/brand/app-store/`. It displays the icon, device-specific
gallery and copy buttons for every prepared text field. The standalone exported
gallery page at `output/gallery-review.html` also opens directly as a local file.

For native screenshots, copy `gallery-input.example.json` to the ignored
`gallery-input.local.json`, point its fields at the twelve genuine device
captures, record the actual build/provenance and completed capture checks, then
run `npm run render -- --input gallery-input.local.json`. Incomplete capture sets
are rejected. The manifest distinguishes supplied device captures from preview
illustrations and always requires final release review; supplying files does
not by itself establish App Store eligibility.

## Applying the package in App Store Connect

After sign-in, identify the existing KickAI/PoseTek record by its app ID and
bundle identifier (`Nolan-Jetter.KickAI` in the inspected source). Preserve its
existing record, SKU, bundle ID and live commercial settings. Capture the
current editable metadata for rollback, then apply the prepared copy only to
the intended editable locale/version. Name availability and field editability
must be checked in the account. Preserve other locales.

The name/subtitle, description, keywords and promotional text were prepared for
English (US). The suggested categories are proposals, not saved selections.
The icon appears in TestFlight after a new signed build is uploaded and processed;
it is not independently replaced by uploading the JPEG.

The existing public privacy page was rendered and verified at
`https://posetek.net/privacy`; its contact section lists `support@posetek.app`.
`https://posetek.net/coaches` exposes `dylank@posetek.net`. A dedicated technical
support URL was not verified, and the ownership/monitoring of those inboxes was
not tested. Retain the existing valid Support URL if present, or establish an
appropriate public support page before saving a replacement.

## Remaining record-specific requirements

Inspect and preserve or deliberately update these once the account is available:

- Legal copyright holder, app name availability and exact version/locale.
- Existing support URL, pricing, availability, categories and purchase terms.
- App Privacy and age-rating answers based on actual collection, third-party
  practices and app content. Marketing copy cannot establish these answers.
- Review contact, any required reviewer sign-in account, and accurate setup
  instructions for recording tests; do not put credentials in this repository.
- Current release build, device support, icon, screenshots and applicable
  export-compliance/content-rights declarations.

No optional app-preview video was fabricated: a real preview should be captured
from the release app if desired. A video is not required to use this screenshot
gallery. A new agreement or unsupported declaration must not be guessed.

## Native release

The mobile worktree is on `worktree-posetek-official-icon`, commit `d09151a`,
based on main `944177b`, under the PoseTek Project 2.0 project's ignored
asset-worktree folder.
Integrate its icon commit into the chosen native release, keeping the independent
testing-audit and privacy changes. Follow `docs/brand/README.md` there for the
Mac `scripts/validate.sh compile-device`, iPhone/iPad checks and signed upload.
Windows cannot run the Xcode release workflow. Asset validation is not a native
build or installed-device test.

## Apple references

- [App icon workflow](https://developer.apple.com/help/app-store-connect/manage-app-information/add-an-app-icon)
- [Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications)
- [App information fields](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information)
- [Platform metadata limits and support URL](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information)
- [Accurate metadata](https://developer.apple.com/app-store/review/guidelines/#accurate-metadata)
- [App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy)
- [Age rating questionnaire](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating)
