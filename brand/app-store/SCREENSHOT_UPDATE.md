# Revision 3 — supplied screenshot update

September 19, 2026. The user supplied five images and requested replacements in
the gallery. This revision uses those actual screenshot pixels for iPhone panels
01–05 and adjusts captions to describe what each image shows. The last iPhone
panel and all six iPad panels remain labeled source-derived previews.

This is a local review revision. The earlier revision 2 handoff was emailed;
these revision 3 packages have not been sent as part of this update. The icon,
native integration patch and App Store listing-copy draft are unchanged.

## Image mapping

Photo numbers refer to the user's attachment order, not gallery order.

| Supplied image | Gallery panel | Screen and caption treatment |
| --- | --- | --- |
| Photo 2 — portrait, 588 × 1280 | `iphone-01-evidence` | Profile skill map and agility details. Keep “Start with evidence” and describe exploring results behind scores. |
| Photo 4 — portrait, 588 × 1280 | `iphone-02-tests` | Actual Drills chooser. Keep the six-performance-test story and the native extra navigation options. |
| Photo 1 — landscape, 1280 × 588 | `iphone-03-replay` | Left/right shooting-pose comparison, green/yellow figures and guided walkthrough. Caption: “Compare both sides.” Preserve landscape within the portrait store canvas. |
| Photo 3 — portrait, 588 × 1280 | `iphone-04-focus` | AI Coach. Caption: “Ask your AI Coach.” Replace the previous skill-map-specific description. |
| Photo 5 — portrait, 588 × 1280 | `iphone-05-session` | Training hub/plan overview. Caption: “See your next workout.” Describe plan and weekly targets; do not claim this image shows workout execution. |
| No supplied replacement | `iphone-06-retest` | Existing source-derived results-history preview. |
| No supplied tablet captures | All six iPad panels | Existing source-derived tablet previews; no phone screenshot is stretched into an iPad interface. |

The photo pixels and native pose figure are preserved proportionally. The
generated MediaPipe-33 illustration remains available in source previews and
the pose reference sheet; it is not overlaid on the supplied screenshot. The
left/right walkthrough is not labeled a sprint measurement, live recording or
verified comparison result.

## Review status and privacy

All five supplied files are reduced-resolution JPEGs. Their original device,
app version and build number were not provided. They are suitable for checking
the composition and caption choices locally. Rendering them into a larger PNG
does not restore missing detail or establish release provenance.

The AI Coach screenshot contains a visible player name. It is retained in the
private local review as supplied; that name is not reproduced in tracked
documentation. Confirm its approved release use or replace it before sharing
the updated artwork externally or submitting it to Apple. Do not interpret
inclusion in local review as a privacy/release attestation.

Original images, private input JSON and generated compositions remain outside
public Git. Source-code and documentation changes can be shared without them.
The local integration/full archive intentionally includes the five originals
and `brand/app-store/gallery-review.local.json`, which points to the bundled
`brand/app-store/review-inputs/` originals, so the review can be reproduced; handle that archive
as private review material. No live bucket access or private cloud URL is
needed for rendering.

## Reproduce the review

The local working input is `gallery-review.local.json`, pointing to the five
original files under ignored `screenshot-input/user-2026-09-19/`. From
`brand/app-store`:

```sh
npm ci
npm run render -- --review-input gallery-review.local.json
node validate-gallery.mjs
```

`--review-input` accepts sparse per-device replacements. Missing panel entries
remain source-derived previews. Each entry can be a file path or an object with
`file` and optional `headline`, `description`, `eyebrow`, `screenTitle` overrides.
`headline` is an array of exactly two nonempty display lines. Paths are relative to the input JSON.
The public `review-input.example.json` illustrates the interface without private
images or a player identity. The private input records unknown build provenance;
it does not assert `currentBuildConfirmed` or `privacyReviewed`.

Choose one input mode per run. `--review-input` supports local composition from
partial/unverified images; `--input` remains the strict release-capture path,
requiring all six panels for both device families, sufficient resolution,
correct orientation, verified build identity and completed privacy checks.
Both produce assets that still need final release review. Do not set release
attestations just to make the supplied reduced-resolution images pass.

The schema-3 output manifest uses `mode: "user-supplied-review"`, records five
provided/review captures and `platformSupplied: { "iphone": 5, "ipad": 0 }`,
and retains false build/privacy confirmations, both platform-candidate flags
and `submissionReady`. Each replaced image has kind
`user-supplied-screenshot-review`, its effective caption, input dimensions,
format, hash and warnings; other images keep their preview status.
Inspect both the manifest and
the images: the original five inputs must remain byte-identical, the landscape
comparison must stay landscape, and AI Coach/Training captions must match the
replaced screens.

## Package and prepare for release

After the review render, create version 3 packages with the private input:

```sh
python package-delivery.py --version v3 --review-input gallery-review.local.json --native-patch /path/to/native-icon.patch --native-readme /path/to/native/README.md --output-dir /path/to/delivery
```

The output names are `posetek-app-store-handoff-v3.zip`,
`posetek-app-store-integration-v3.zip` and
`posetek-app-store-full-source-v3.zip`. The default packager version remains v2
for compatibility. Extract matching handoff/integration versions together;
use the packaged relative input index when reproducing outside the original
checkout. Do not combine a v2 artwork archive with v3 integration assets.

Before Apple upload, obtain original full-resolution captures of the intended
release for the five revised views, the retest panel and all tablet panels.
Keep the revised iPhone caption overrides when preparing strict release input;
the same file-plus-copy object format works with `--input`. String-only entries
use the default gallery captions. Confirm visible identity
approval, build/version, feature availability and App Store Connect slots.
The complete process remains in [capture-brief.md](capture-brief.md) and
[TAIYO_HANDOFF.md](TAIYO_HANDOFF.md).
