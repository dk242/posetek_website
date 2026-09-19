# PoseTek App Store presentation

Updated September 19, 2026 from PoseTek Project 2.0, `posetek-mobile-app` and
five user-supplied app screenshots. Revision 3 is a local review update; the
previously emailed revision 2 remains a historical delivery.
Start with [Taiyo's implementation handoff](TAIYO_HANDOFF.md): it identifies
the assets to integrate and the remaining release checks.

## Package contents

| Item | Location | Status and use |
| --- | --- | --- |
| Official app icon | `../../images/brand/posetek-app-icon-1024.png` | Opaque RGB 1024 × 1024 PNG for the native AppIcon catalog |
| Reusable app photo | `../../images/brand/posetek-app-photo-1024.jpg` | JPEG for general brand use; not a standalone TestFlight icon update |
| Editable icon | `../../images/brand/posetek-app-icon.svg` | Outlined vector master; accompanying Inter license |
| Six-slide gallery | `output/iphone-*.png`, `output/ipad-*.png` | Mixed review: five supplied iPhone screenshots; remaining iPhone panel and all iPad panels are source-derived previews |
| Editable gallery | `gallery.mjs`, `gallery-content.json`, generated `source/` | Repeatable compositor and outlined SVG exports |
| Listing copy | `metadata.json` | English (US) draft to check against the intended binary and account |
| Review | `index.html`, `output/gallery-review.html`, `output/contact-sheet.png` | Main review, standalone gallery and visual overview |
| Evidence | `output/gallery-manifest.json`, [design references](DESIGN_REFERENCES.md) | Capture/pose provenance and external design references |
| Screenshot revision | [SCREENSHOT_UPDATE.md](SCREENSHOT_UPDATE.md) | Photo mapping, resolution/build limitations and local reproduction |

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
poses supply all 33 landmarks and the 35 canonical connections in the generated
pose illustrations. Supplied screenshots preserve the app's actual rendering;
no extra joints are painted onto them. Exports contain no live storage URLs or
raw source recordings. The supplied AI Coach image contains a visible player
name that needs review before external release; it is not copied into public
source or documentation.

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

The command above reproduces the all-illustration baseline. To reproduce the
mixed revision 3 review, use its private sparse input:

```sh
npm run render -- --review-input /path/to/private/review-input.json
node validate-gallery.mjs
```

Review mode accepts the supplied lower-resolution JPEGs and leaves missing
panels as labeled source-derived previews. It records unknown build provenance
without treating the images as current-release captures. See
[SCREENSHOT_UPDATE.md](SCREENSHOT_UPDATE.md) for the five replacements and
caption changes. The low resolution does not block local visual review; obtain
full-resolution originals and verify the build before Apple submission.

For verified release captures, copy `gallery-input.example.json` to the ignored
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

The default preserves version 2 packaging. To package the local screenshot
revision, add `--version v3 --review-input /path/to/private/review-input.json`.
The script creates artwork/handoff, editable-integration and combined full-source
archives with manifests and checksum checks. Revision 3 is prepared locally;
this update does not resend it to Taiyo. Its integration/full packages include
the five supplied files and a relative input index, so keep those packages
private until the visible-name review is complete. Extract matching artwork
and integration archives into the same directory; do not mix versions.

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
