# Taiyo — PoseTek App Store handoff

Prepared September 18, 2026 for **taiyow@posetek.net**.

The official lime-green P icon, revised six-image gallery and English (US)
listing copy are prepared for integration. **The gallery currently contains
source-derived previews, not upload-ready native screenshots.** The signed iOS
build and final App Store Connect application remain your release steps.

## Open the package

Extract the delivery ZIP(s) into the same directory, preserving their paths,
then open `START_HERE.html` or `brand/app-store/index.html`. If artwork and
integration arrive in separate attachments, extract both into that directory.

| Deliverable | Path from extracted package root | Use |
| --- | --- | --- |
| Native icon PNG | `images/brand/posetek-app-icon-1024.png` | 1024 × 1024 opaque RGB source for AppIcon |
| Reusable JPEG photo | `images/brand/posetek-app-photo-1024.jpg` | General brand/avatar use |
| Outlined icon master | `images/brand/posetek-app-icon.svg` | Editable master with exact website badge geometry |
| iPhone gallery | `brand/app-store/output/iphone-01-evidence.png` through `iphone-06-retest.png` | Six 1320 × 2868 review layouts |
| iPad gallery | `brand/app-store/output/ipad-01-evidence.png` through `ipad-06-retest.png` | Six 2064 × 2752 review layouts |
| Listing copy | `brand/app-store/metadata.json` | Copy from fields or review-page buttons |
| Capture requirements | `brand/app-store/capture-brief.md` | Twelve genuine captures needed |
| Native integration patch | `native/0001-Brand-adopt-the-official-PoseTek-P-app-icon-and-disp.patch` | Reviewed Git patch, including the binary icon |
| Native asset notes | `native/README.md` | Scope and Xcode/device verification |
| Provenance/references | `brand/app-store/output/gallery-manifest.json`, `brand/app-store/DESIGN_REFERENCES.md` | Asset/capture status and sources |

The email handoff uses two complementary archives:
`posetek-app-store-handoff-v2.zip` contains artwork and documentation;
`posetek-app-store-integration-v2.zip` contains the editable generator and native
patch. The combined `posetek-app-store-full-source-v2.zip` also includes
outlined SVG exports and the contact sheet. Use the archive manifest/checksums
to verify the received package before integration.

Full editable source is on
[the website brand branch](https://github.com/dk242/posetek_website/tree/codex/official-brand-icon/brand/app-store).
Email attachments can omit larger editable exports; the repository provides the
reproducible compositor and authored assets. This document is an implementation
handoff, not a claim of Apple submission or email receipt.

## 1. Integrate the icon into the native release

The native work is local commit
`d09151ae4f1146b8dfa76327b068c5907d22c8b0` on
`worktree-posetek-official-icon`, based on `944177b`. It has **not been
pushed** to the native remote. A remote `git fetch` alone will not provide it.

Review the attached patch on an owned Mac checkout and integrate it into the
branch actually intended for release. If that commit is available in your local
Git object database, cherry-pick it. Otherwise use the supplied patch. Apply one
method, not both. In the selected native integration branch, for the patch route:

```sh
git apply --stat /path/to/native/0001-Brand-adopt-the-official-PoseTek-P-app-icon-and-disp.patch
git apply --check /path/to/native/0001-Brand-adopt-the-official-PoseTek-P-app-icon-and-disp.patch
git am /path/to/native/0001-Brand-adopt-the-official-PoseTek-P-app-icon-and-disp.patch
```

If the check fails because the chosen branch changed the same files, review and
resolve the actual conflict. Do not overwrite unrelated assets or use force.
Follow the mobile repository's ownership and branch conventions.

The patch replaces
`KickAI/Assets.xcassets/AppIcon.appiconset/posetek_app_icon_1024x1024.png` and
sets `CFBundleDisplayName = PoseTek`. It includes the vector master/license
and native handoff notes. It does not change Swift features, bundle identity,
marketing version or build number.

Do not force the independent testing-audit candidate `e2c3736` or unrelated
privacy/security changes into this brand release. If they are part of your
chosen release branch, preserve and verify them under their own handoffs.

In an owned Mac primary checkout, open `KickAI.xcworkspace` and follow native
`docs/BUILD_AND_TESTING.md`, including:

```sh
scripts/validate.sh compile-device
```

Verify the installed icon and PoseTek label on iPhone and iPad. Check small
home-screen size and system masking. Then choose the next unused build number,
archive and sign through the normal Xcode release workflow, and upload to the
existing app record. Confirm the processed build's icon in TestFlight.

**The JPEG is not an icon-upload shortcut.** Apple uses the icon bundled through
Xcode; changing a published icon requires a new app version and review.
[Apple icon workflow](https://developer.apple.com/help/app-store-connect/manage-app-information/add-an-app-icon).

## 2. Replace gallery previews with genuine captures

The revised previews follow native navigation and styling, use small Fluent
emoji caption accents, and replace the previous 14-point pose with recorded
33-landmark poses and all 35 canonical connections. They remain illustrations.

Follow [capture-brief.md](capture-brief.md) to capture the intended build:

1. Profile overview.
2. Drills chooser.
3. **Landscape** session analysis with an approved completed sprint rep.
4. Profile skill map/category details.
5. Guided workout.
6. Sprint dashboard/history.

Capture all six separately on iPhone and iPad. Other than landscape analysis,
screens are portrait. A landscape analysis screenshot is fitted within a
portrait App Store canvas; do not manufacture a portrait analysis interface.
Use approved demo data and the actual native UI. Do not paint extra pose joints
onto screenshots to make a release appear to support something it does not.

For the full editable source, run the package from `brand/app-store` with Node
22.18+:

```sh
npm ci
npm run render -- --input gallery-input.local.json
node validate-gallery.mjs
```

Prepare `gallery-input.local.json` from the example, with all twelve file paths,
actual build identity, capture provenance and completed checks. The `--input`
path checks the supplied capture set; there is no separate `--strict` flag.
Review every export and the manifest. Its `submissionReady: false` is
intentional: image generation cannot establish Apple eligibility or replace
final release review. Do not simply remove preview labels from illustrations.

## 3. Apply the English (US) listing copy

Open the existing KickAI/PoseTek record in App Store Connect. Match its bundle
identifier against the actual release; the inspected native source uses
`Nolan-Jetter.KickAI`. No numeric Apple app ID has been verified in this task.
Preserve the existing record, SKU, bundle identifier and other localizations.

Before editing, retain the existing version's metadata/screenshots as a rollback
reference and confirm that the intended version and locale are editable.
Use `metadata.json` as the copy source:

| Connect field | Prepared value/source |
| --- | --- |
| Name | **PoseTek: Soccer Training** |
| Subtitle | **Test. Review. Train. Repeat.** |
| Promotional text | `promotionalText` |
| Description | `description` — paste plain text with its line breaks |
| Keywords | `keywords` |
| Marketing URL | `https://posetek.net/` |
| Privacy Policy URL | `https://posetek.net/privacy` |
| What's New | `whatsNewDraftForIconRelease`, only for a binary that includes the icon; combine with its other verified changes |

Confirm name availability and all feature claims on the selected release.
Preserve meaningful limits and missing-data labels in screenshots. Do not
claim guaranteed gains, medical benefits, prices or unverified features.
Apple sets field limits and requires a functioning support destination:
[version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information).

The Support URL, copyright and age rating are unresolved in the draft; **null
does not mean clear the existing value**. Preserve a valid existing Support URL
or supply a verified public contact page. `Sports` and `Health & Fitness`
are category proposals, not saved account choices. Check the legal copyright
holder, current pricing, territories and purchase terms in the account.

Review App Privacy and age-rating answers using actual app/SDK behavior.
The marketing package does not answer those questionnaires. Preserve accurate
existing declarations unless a verified change requires an update.
[App Privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy);
[age rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating).

## 4. Upload, check and submit the intended release

Upload only the final reviewed screenshot compositions into the appropriate
iPhone and iPad slots, ordered 01–06. Do not upload preview illustrations,
contact sheets, SVGs, the manifest or handoff documents as screenshots. The
target dimensions are listed in
[Apple's screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications).

Select the processed build containing the icon. Complete the record's actual
review contact, authorized reviewer access and setup instructions, applicable
export-compliance/content-rights information and other required fields. Keep
review credentials out of this repository and email package.

Check the product-page preview for truncation, order and branding; compare the
selected binary with every illustrated feature and the installed icon. Confirm
the release option with the existing release process. Then use the account's
normal review/submission workflow.
[Apple submission steps](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/submit-an-app).

Record the chosen version/build, capture provenance, uploaded slot counts,
metadata changes, submission state and unresolved checks in the release handoff.
A successful upload is not a published release; verify the final TestFlight/App
Store presentation after processing/review.

## Pose data and asset provenance

The website `index.html` is the marketing entry point, not the backend.
Homepage figures use checked-in sanitized pose snapshots and projection data.
Authenticated replay separately obtains `pose.json` and metadata through
authorized Firebase/GCS artifact access. Gallery exports do not depend on live
bucket access and include no signed URLs or private source recordings.

The static figures retain indices 0–32, canonical connections and source
proportions. Their reconstructed depth is a visualization estimate, not a
calibrated body scan or a promise about measurement precision. Detailed sources
and the third-party reference boundaries are in [DESIGN_REFERENCES.md](DESIGN_REFERENCES.md).
