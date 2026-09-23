# PoseTek investor exact-script edition V1

Status: timed proof for the user's creative review. The 1080p master and email
delivery follow that review; neither is claimed complete here. Previous video
editions, sources and delivered exports are preserved. This change affects video
source only; no website, native app, backend, athlete result or workout is changed.

## Controlling copy and visual reference

The nine passages in `audio-source/investor-exact-v1.json` are the 203 supplied
words from [Pitch Doc.docx](https://posetek-my.sharepoint.com/:w:/r/personal/dylank_posetek_net/_layouts/15/Doc.aspx?sourcedoc=%7BAB9166BB-8133-4A80-8B6E-D5A3A930F8C1%7D).
The user's September 23 revised exact-script implementation plan controls the
visuals. The earlier 150-second product film is not the narrative template.
There is no rewritten investor speech, new slogan, financial claim or added
spoken closing line. Pronunciation-only substitutions are documented separately;
captions retain the original text, including grammar, `posetek` and `queues`.

Reference lock: PoseTek forest/lime canvas, Barlow Condensed headings, Inter
product UI, IBM Plex Mono evidence labels, authentic recordings and recorded pose
data. Current website/native walkthrough source supplies state and cue behavior.
The setup figure is explicitly illustrative, with a consistent fixed-length rig.

## Timed proof

Composition `PoseTekInvestorExactV1` is 1920×1080 at 30 fps, 5,190 frames / 2:53.
The review export is 1280×720 at the same frame rate and full duration. It has a
small timed-proof label; it is not the final-resolution master.

| Time | Scene |
| --- | --- |
| 0:00–0:14 | Smartphone capture, recorded movement and connected platform |
| 0:14–0:25 | One-marker setup: readiness, hands down, countermovement, takeoff and landing |
| 0:25–0:50 | Original app/field demonstration and original audio only |
| 0:50–0:59 | Recorded on-device processing; all six tests for four seconds; containers form |
| 0:59–1:11 | Anonymous onset-aligned sprint ghost, two labeled 1× passes |
| 1:11–1:27 | Radar categories, recorded values and units, selected focus and plan |
| 1:27–1:52 | Workout request, proposal, save/start, real drill, elapsed clock, set completion and next drill |
| 1:52–2:20 | Explicit ¼× selection; four paused technique observations; completion controls |
| 2:20–2:29 | Dated baseline and clearly illustrative reassessment flow |
| 2:29–2:38 | Connected platform during the exact final supplied sentence |
| 2:38–2:46 | Saved same-athlete left/right kick observation excerpt |
| 2:46–2:51 | Connected platform screens resolve |
| 2:51–2:53 | PoseTek identity; no new spoken copy |

## Timing and evidence safeguards

- App speech comes from the supplied original recording. The narrator and music
  stems are digitally silent for the complete 25–50 second interval.
- A visible field-shot change at movie 35.000 seconds coincides with the phone's
  transition into Scheduled Recording. The early readiness angle is not presented
  as one continuously synchronized shot with the separately timed jump excerpt.
- Spoken `1` begins at movie 39.026 seconds. The first clearly airborne output
  frame is 1201, at 40.033 seconds: 1.007 seconds later, within one 30 fps frame.
  Independent source review locates the toe-release boundary within one frame.
  The complete jump stays at 1×; no freeze, missing movement or speed correction
  is used to create that interval.
- Sprint sources are freshly qualified, checksum-verified and matched to their
  source movies. Verified movement-onset frames 62 / 80 define the shared clock.
  Both original rates are retained (approximately 119.95 fps). The common visible
  interval is 2.2667 seconds. The measured final COM gap is 0.328 m; the film
  makes no equal-distance finish-time claim. One reference is the user-designated
  D1 example, not a measured D1 population. Legacy and MediaPipe landmark layouts
  are rendered from their real available joints, without fabricated detail.
- Profile axes/history retain the original values, units and dates. Visible names
  are removed from every related reconstruction. The skill-map reference is
  explicitly projected and is not a percentile. Future results are not invented.
- Technique uses the complete underlying recorded figure. Its forward-only stops
  are 458 → 472 → 472 → 522. The player stays at frame472 for local frames227–600,
  including the support-foot/arm-balance cue switch. One cue and joint set appears
  at a time. The saved pro pose appears only for available phases; follow-through
  explicitly has no saved reference. Continue/Finish actions are visible, followed
  by Walkthrough complete and Replay/Done.
- Section7 is identified as a recorded-data reconstruction with native controls,
  rather than an actual app capture. The coda is a separate saved comparison
  excerpt of two kicks by the same player, using a neutral native observation.
- The full captured phone image is retained. Any source-native interface clipping
  belongs to the supplied recording; the film does not invent missing controls.

## Source and reproduction

Use the repository checkout for editable dependencies, then install the locked
video npm dependencies and restore the authorized local asset package. Generated
media, athlete identities, private selectors, caches, model weights and inspection
captures stay ignored and must not be committed.

New entry/source: `src/InvestorExactFilm.tsx`, `ExactSetup.tsx`, `ExactSprint.tsx`,
`ExactTechnique.tsx`, `ExactScreens.tsx`. Old compositions remain registered.
`audio-source/EXACT_INVESTOR_AUDIO.md` documents natural-rate synthesis, exact text
locks, the original synthesized score, caption alignment and independent ASR.

```powershell
npm run typecheck
node scripts/prep-exact-footage.mjs
node scripts/prepare-exact-technique.mjs <current-website-technique-data.json>
# Optional authorized source refresh, using private local selection.json:
node scripts/prep-exact-sprint.cjs
npm run stills:exact
npm run proof:exact
npm run verify:exact
```

The renderer copies an explicit asset allowlist, omitting private selection and
source records. It renders a silent picture, then performs one AAC encode from
the PCM narration/music and original app audio. This avoids the AAC delay observed
in a previous Remotion pipeline. The exact edition's default renderer exposes
only stills/proof; final production follows proof approval.

## Review and acceptance artifacts

Ignored `output/investor-exact/` contains the full timed proof, 39-cue SRT,
combined caption JSON, representative 30fps scene frames and `proof-validation.json`.
The audio directory contains all original text/ASR/level/silence checks.
Private sprint provenance records source checksums, timestamps, calibrated origins
and source frame selections. Setup rig checks verified constant limb lengths,
planted feet and one continuous forward flight arc. Both comparison figures were
checked for missing displayed frames and clipping across the full scene.

Review the proof's creative presentation before producing the 1080p master,
compact approved review and final email. Do not treat this file or automated QA
as the user's creative approval.
