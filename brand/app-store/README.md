# PoseTek App Store presentation

Prepared September 18, 2026 from PoseTek Project 2.0 and `posetek-mobile-app`.
Start with [Taiyo's implementation handoff](TAIYO_HANDOFF.md): it identifies
the assets to integrate and the remaining release checks.

## Package contents

| Item | Location | Status and use |
| --- | --- | --- |
| Official app icon | `../../images/brand/posetek-app-icon-1024.png` | Opaque RGB 1024 × 1024 PNG for the native AppIcon catalog |
| Reusable app photo | `../../images/brand/posetek-app-photo-1024.jpg` | JPEG for general brand use; not a standalone TestFlight icon update |
| Editable icon | `../../images/brand/posetek-app-icon.svg` | Outlined vector master; accompanying Inter license |
| Six-slide gallery | `output/iphone-*.png`, `output/ipad-*.png` | Source-derived review previews; genuine release-build captures still required |
| Editable gallery | `gallery.mjs`, `gallery-content.json`, generated `source/` | Repeatable compositor and outlined SVG exports |
| Listing copy | `metadata.json` | English (US) draft to check against the intended binary and account |
| Review | `index.html`, `output/gallery-review.html`, `output/contact-sheet.png` | Main review, standalone gallery and visual overview |
| Evidence | `output/gallery-manifest.json`, [design references](DESIGN_REFERENCES.md) | Capture/pose provenance and external design references |

This is the screenshot sequence beneath an app listing, not a PowerPoint or
app-preview video. Generated files and private capture inputs are ignored by
Git. Authored source, licensed assets and documentation belong in the shared
[website source branch](https://github.com/dk242/posetek_website/tree/codex/official-brand-icon/brand/app-store).

## Visual and product sources

The exterior follows PoseTek's existing evergreen `#04130E`, lime `#B7F34A`,
off-white `#F0F5ED`, Inter and Barlow Condensed identity. Native source determines
the device UI, including **Profile, AI Coach, Drills, Training, Leaderboards**.
Older documentation mentioning Stats/Sessions is superseded by
`CoachPlayerView.swift`. Confirm real iPad adaptation on the release build.

[Runna, Nike and Strava](DESIGN_REFERENCES.md) inform presentation hierarchy,
athletic headlines and readable results. Microsoft Fluent Flat emoji are small
marketing-caption accents outside the native interface. Sanitized homepage
poses supply all 33 landmarks and the 35 canonical connections, including face,
hands and feet. Exports contain no live storage URLs or private recordings.

Website reference: `61ef7cc`; native reference: `944177b`. Source demonstrates
code, not what a currently installed build contains. Keep all claims tied to the
chosen release; no promised gains, medical claims, free/unlimited terms or
unverified recent features. See the [capture brief](capture-brief.md).

## Reproduce and review

From `brand/app-store`, using Node.js 22.18 or later:

```sh
npm ci
npm run render
node validate-gallery.mjs
```

This creates six 1320 × 2868 iPhone images, six 2064 × 2752 iPad images,
outlined SVG exports, contact sheet, review HTML and manifest. The validator
writes `output/gallery-validation.json`; `output/pose-reference-sheet.png`
shows all three recorded poses for visual QA. Review the images after rendering.
`node export-icon.mjs` regenerates the raster icon
formats from the SVG master.

Serve the repository root with `python -m http.server 4186 --bind 127.0.0.1`,
then open `http://127.0.0.1:4186/brand/app-store/`. The exported
`output/gallery-review.html` also opens directly as a local file.

For genuine captures, copy `gallery-input.example.json` to the ignored
`gallery-input.local.json`, supply all six files for both families, and record
the actual build, capture provenance and completed checks:

```sh
npm run render -- --input gallery-input.local.json
```

This is the strict capture-input path; there is no separate `--strict` switch.
Follow the current example and [capture brief](capture-brief.md).
**03-replay requires landscape analysis captures**; the other screens use
portrait captures. The final store canvases remain portrait. A supplied file
does not prove a genuine release screenshot. The manifest keeps final
submission readiness false pending review.

After rendering, reproduce the delivery archives with the supplied native patch
and native asset README:

```sh
python package-delivery.py --native-patch /path/to/native-icon.patch --native-readme /path/to/native/README.md --output-dir /path/to/delivery
```

The script creates artwork/handoff and editable-integration archives for email,
plus a combined full-source archive, with package manifests and checksum checks.
Extract both email archives into the same directory before using the handoff.

## Native icon and publication

Local native commit `d09151ae4f1146b8dfa76327b068c5907d22c8b0`, on
`worktree-posetek-official-icon`, is based on `944177b` and is not pushed to the
native remote. The delivery includes a patch for Taiyo to review and integrate
into the selected Mac release branch. It updates the AppIcon PNG and installed
display name to PoseTek while preserving bundle identity. Separate testing-audit
and privacy/security work retain their own integration and verification process.

Apple gets the icon from the signed build. Updating an already published icon
requires a new version and review; a standalone JPEG cannot replace it.
See [Apple's icon workflow](https://developer.apple.com/help/app-store-connect/manage-app-information/add-an-app-icon)
and [Taiyo's handoff](TAIYO_HANDOFF.md).

Account-specific facts remain to be checked: app record/version, name
availability, Support URL, copyright, categories, privacy, age rating, review
contact and release configuration. Null fields in `metadata.json` mean unknown
facts, not instructions to clear existing fields. The earlier account attempt
reached Apple sign-in; no listing edits, screenshots, build or review submission
were made by that attempt.
