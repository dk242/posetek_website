# PoseTek Draft B — Clubs & Coaches

Editable 55-second, 1080 × 1920, 30 fps marketing film built from the approved
September 21 storyboard. The user authorized production and email delivery on
September 21, 2026. This project does not modify or deploy the website.

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
npm run stills
npm run proof
npm run render
```

The final file is `output/v2/PoseTek-Draft-B-V2-Clubs-and-Coaches.mp4`.
`npm run studio` opens the editable Remotion project. Final renders include audio
and captions read by the render script; Studio's default props are silent.

## Source and media

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
- `scripts/render.mjs`: renders style frames, a 26-second proof or the master.

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
