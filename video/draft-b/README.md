# PoseTek video productions

## Investor exact-script edition

The separate September 23 investor edition follows all nine supplied passages
verbatim. See [EXACT_INVESTOR_V1.md](EXACT_INVESTOR_V1.md) for the 2:53 timeline,
source evidence, reproduction and required proof review before master/email.
Run `npm run proof:exact` for the timed review. Previous editions below remain
historical exports and are not the controlling copy for this investor edition.

Editable PoseTek marketing films built from the approved
September 21 storyboard and September 22 revision/investor plan. The user authorized production and email delivery on
September 21, 2026. This project does not modify or deploy the website.

## Current editions

| Edition | Picture | Purpose |
| --- | --- | --- |
| `exact` / `PoseTekInvestorExactV1` | 173s, 1920 × 1080 composition; 720p proof | Nine exact passages and the revised investor visual plan |
| `product` / `PoseTekProductV1` | 150s, 1920 × 1080, 30fps | Supplied app/field recordings, verified movement comparisons and the assessment-to-training cycle |
| `v3` / `PoseTekCoachesV3` | 52s, 1080 × 1920, 30fps | Tighter six-test scene and brand-led closing |
| `investor` / `PoseTekInvestorV1` | 90s, 1920 × 1080, 30fps | Mission, product, first club partner, model and expansion strategy |
| `v2` / `PoseTekDraftBV2` | 55s, 1080 × 1920, 30fps | Preserved previous coaching cut |

The prior product demonstration has historical source and production notes in [PRODUCT_DEMONSTRATION.md](PRODUCT_DEMONSTRATION.md). Its adapted narration was superseded by the exact-script investor edition above. It requires an authorized local asset package; the generic asset preparation command below does not retrieve the private comparison recordings.

The September 22 investor film intentionally omits monetary amounts, financial
forecasts and SAFE terms. Its source boundaries are in
[INVESTOR_SOURCE_NOTES.md](INVESTOR_SOURCE_NOTES.md). Current production checks
and delivery receipts are in [PRODUCTION_V3_INVESTOR.md](PRODUCTION_V3_INVESTOR.md).

## Render

Requires Node.js 22+, Python 3.12+ and FFmpeg on PATH.

```powershell
cd video/draft-b
npm ci
npm run prepare-assets
```

Follow `audio-source/README.md` to reproduce the narration, original score and
captions. Then run:

```powershell
npm run typecheck
node scripts/render.mjs stills v3
node scripts/render.mjs proof v3
node scripts/render.mjs final v3
node scripts/render.mjs stills investor
node scripts/render.mjs proof investor
node scripts/render.mjs final investor
node scripts/render.mjs stills product
node scripts/render.mjs proof product
node scripts/render.mjs final product
```

Current masters are `output/v3/PoseTek-Coaches-V3.mp4` and
`output/investor/PoseTek-Investor-V1.mp4`. Omit the edition argument for the
preserved V2 render at `output/v2/PoseTek-Draft-B-V2-Clubs-and-Coaches.mp4`.
`npm run studio` opens the editable Remotion project. Final renders include audio
and captions read by the render script; Studio's default props are silent.

## Source and media

- `src/ProductFilm.tsx` / `ProductPose.tsx` / `ProductScreens.tsx`: 150-second product demonstration, authentic app audio, source-derived comparison motion and labeled native UI reconstructions.
- `src/FilmV3.tsx` / `RevisionScenesV3.tsx`: scoped 52-second coaching revision.
- `src/InvestorFilm.tsx`: purpose-built landscape investor composition.
- `src/Film.tsx`: seven timed scenes, brand treatment, coach sample, training
  preview, captions and transitions. The original pose recording and coach
  sample are imported directly from website source.
- `src/RevisionScenes.tsx`: simultaneous six-test demonstrations, club/team/player
  drilldown and the guided workout with elapsed session time, set completion and
  the next drill. Club coverage is illustrative; roster/workout examples come
  from the current coach samples.
- `src/PoseVisual.tsx`: deterministic perspective projection of the existing 3D
  landmarks, a 10-degree camera orbit and the source ball placement. Only the
  camera and presentation move; landmark coordinates are unchanged.
- `audio-source/`: editable narration, original 106 BPM synthesis, local neural
  voice generation, subtitle alignment, verification and model provenance.
- `scripts/prepare-assets.mjs`: prepares verified source footage and brand fonts.
- `scripts/render.mjs`: renders edition-specific style frames, motion proofs or masters.

The original Figure-8 footage was already available locally at
`.netlify/drill-demo-source/figure-8-1788831834526194.mp4`; its SHA-256 is verified
against `app/src/pages/home/product/media/provenance.json`. It is autorotated and
normalized to portrait 1080 × 1920 at 30 fps, without retaining original audio.
The product-preview crop emphasizes the feet, ball and cones. If the original is
unavailable on another machine, preparation explicitly falls back to the public
406 × 720 website derivative; its visual quality differs from this production
render. Obtain the same approved original for a matching high-resolution rebuild.

Brand fonts are Barlow Condensed 700, Inter 400/600 and IBM Plex Mono 400, fetched
from Google Fonts into the ignored local public directory. The palette, wordmark
treatment and fine skeleton colors follow current website source.

The held hero pose contains estimated depth; it is not a calibrated body scan.
All six recorded test sequences play at their source frame rates without interpolation.
Northfield FC, U13 and Alex Rivera are fictional website examples. Alex's focus,
58/100 Control score, Figure-8 drill and 7.12/6.94-second comparison are kept
consistent. The film labels the sample and the illustrative change, and does not
claim that the pictured drill produced that change. The phone is labeled as a
product preview rather than represented as a native app recording.

## Review and delivery

Style frames were inspected across every scene and a 26-second motion proof
was rendered before the full export. Review covered mobile legibility, caption
clearance, sample continuity, honest comparison scale, source pose colors and
positions, and original-footage quality. The opening pose was enlarged and its
lines strengthened after review. Source typechecking passes.

Audio checks include exact timing, no clipping, loudness measurements, phrase
caption bounds and automated transcription. There was no direct listening review
available in the production runtime; details and measured levels are in
`audio-source/README.md`. Final media checks and export hashes are recorded with
the [V2 production and delivery handoff](PRODUCTION_V2.md).

Generated movies, previews, reference media, audio, models, dependencies and private
delivery links stay out of Git. Only editable source and handoff documentation are
committed. The original Draft B remains unchanged.

## V2 revision

The user approved 55 seconds, six moving tests together before their containers,
a club-to-team-to-player view, and the next drill within the current session.
The timer is elapsed session time, consistent with the native app reference.
The second approved original clip is `wall-pass-1788468661750095.mov`; asset
preparation checks its provenance hash and normalizes it like Figure-8.
V1 remains preserved locally and documented in [PRODUCTION.md](PRODUCTION.md).

## Investor map provenance

`src/us-map.json` contains the contiguous US outline from Natural Earth 1:110m
country data, which is public domain. The source URL is recorded with the data.
The map illustrates an expansion strategy; it does not depict customer locations.

## Investor exact-script V2 (119-second review)

The separate shorter edition follows the nine final production passages exactly.
See [EXACT_INVESTOR_V2.md](EXACT_INVESTOR_V2.md) for the revised transitions,
recorded broad-jump metrics, source limits, shared clock, reproduction and review gate.
Use `npm run proof:exact-v2` and `npm run verify:exact-v2`. Previous exports remain
unchanged. The final master, editable media package and email follow proof approval.
