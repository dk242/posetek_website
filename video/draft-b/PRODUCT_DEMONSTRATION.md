# PoseTek product demonstration V1

Production handoff, September 22, 2026. The composition is **150 seconds**, **1920 × 1080**, **30 fps**. This is a separate product demonstration; the earlier coaching and investor editions remain intact.

## Brief and reference lock

The user-provided **Pitch Doc** controls the story: accessible movement analysis, personalized training and coaching support, demonstrated through an assessment-to-training cycle. The approved production plan and supplied phone/field recordings are retained locally. Private document links, athlete identifiers, source URLs and raw measurements do not belong in these tracked notes.

Visual direction follows the established PoseTek film and current product: forest `#04130e`, panel `#0a211a`, lime `#b7f34a`, pale ink `#f0f5ed`; Inter for interface text, Barlow Condensed for display headings and IBM Plex Mono for metadata. Refero's motion and typography guidance supplements this existing-product reference lock. Preserve functional actions and readable source material rather than adding ornamental transitions.

The phone/tripod/custom-marker field setup is an explanatory illustration. Its athlete is a simple keyframed illustration, not a camera measurement, an exact equipment blueprint or a product-generated scene. The real field recording provides the practical setup reference. No private technology stack or model capability is inferred from visual inspiration.

## Locked composition

| Film time | Duration | Content |
| --- | ---: | --- |
| 0:00–0:13 | 13 sec | Accessible development proposition and connected product introduction |
| 0:13–0:21 | 8 sec | Illustrated phone, tripod, custom marker and player setup |
| 0:21–0:46 | 25 sec | Authentic app and field recordings, original app audio |
| 0:46–0:51 | 5 sec | Six named tests visible together |
| 0:51–1:07 | 16 sec | Two recorded vertical jumps; source timing and calibration retained |
| 1:07–1:19 | 12 sec | Player profile, all five skill categories and recorded evidence |
| 1:19–1:34 | 15 sec | Multiweek plan, then separate session request, proposal and save/start |
| 1:34–1:47 | 13 sec | Guided workout, actual approved drill footage and explicit completion |
| 1:47–1:57 | 10 sec | Recorded left/right kick comparison and saved coaching observation |
| 1:57–2:03 | 6 sec | Reconstructed AI Coach conversation |
| 2:03–2:15 | 12 sec | Recorded baseline and an illustrative next-assessment flow |
| 2:15–2:30 | 15 sec | Connected development system and `posetek.net` invitation |

`src/ProductFilm.tsx` is the authoritative scene clock: 4,500 frames. Product panels occupy 1,728 × 700 pixels at film position `(96, 235)`. Captions sit beneath the panels. `PlayerProfile` advances every 72 local frames, giving each of five categories 2.4 seconds. The final category holds until the enclosing scene transitions into the plan; it does not wrap back to the first category.

## What is recorded, reconstructed or illustrative

**Authentic assessment footage.** The 25-second app segment uses the supplied screen and field recordings. Orientation is corrected and the recordings are aligned manually using the shared hand-raise event. This is a visual edit; frame-perfect synchronization is not claimed and audio correlation was inconclusive. The complete rep remains at normal speed. Idle time and the post-capture processing wait are shortened, with the edit disclosed on screen. Original app prompts and the original result are retained. This is live setup guidance followed by on-device analysis of a recorded rep, not a claim of instantaneous continuous biomechanical feedback.

The app interval has no narration or score. `audio-product-v1/master.wav` deliberately contains silence there; `ProductFilm` adds `product/demo-audio.wav` separately. Both visible video tracks are muted to avoid duplicate prompts or microphone echo. The final combined soundtrack passes the level and synchronization checks recorded below. Recognition timestamps are an editing aid, not proof of subjective listening review.

**Recorded pose comparisons.** The film uses the exact selected source poses, events, timing metadata and qualified results. It aligns the relevant event without stretching either recording. Fixed transforms preserve motion, ground position and physical scale; missing tracking stays masked. Inspection pauses are labeled. The comparison view is an editorial visualization, not a claim that the current app already supplies this cross-player interface. Do not replace source movement with generated poses.

The selected reference performance does not establish a normative D1 population, a percentile or guaranteed development outcome. The bundled native benchmark dataset is projected. Profile scores use the native default reference and score model; the chart visibly discloses that reference, while recorded measurements remain distinct.

**Native product reconstructions.** `src/ProductScreens.tsx` reconstructs the checked SwiftUI workflows for film readability. It is not a recording of a live app session. Source behavior was audited against clean native commit `d09151a`, based on cached `944177b`; this does not verify current installed builds, live feature flags or device acceptance of later native candidates.

- The multiweek program is an example. It is separate from today's workout builder. The session builder selects time and energy, types a focus, visibly waits, shows **Proposed workout**, and requires **Save and start workout**. Plan and prescription examples are labeled; no live generation or athlete-plan mutation occurs.
- Guided training uses the existing approved Figure-8 and wall-pass footage. The session clock and prescription are demonstrative. **Complete set** and **Next drill** are explicit player actions. Do not imply automatic rep counting, automatic completion or a per-exercise countdown. Unpublished exercise drafts are excluded.
- The two-kick review uses two distinct verified left/right kicks. The saved comparison's source hashes match the selected pose, metadata and ball artifacts. Its coaching cue is preserved from that saved report; a single recorded pair does not establish a repeatable asymmetry. Native staff generate comparisons; players can replay saved reports.
- The subsequent AI Coach response is a clearly labeled illustrative follow-up grounded in the saved cue. It does not represent a new live model request, fresh technique analysis or a guaranteed result. Live coaching uses the platform gateway and authenticated context.
- Progress shows real dated baseline results. The later assessment steps are explicitly illustrative; no future result or growth curve is invented. Current schema-3 training programs do not generate retest weeks or automatically schedule or prompt assessments. Retesting is arranged by the player and coach.

## Entry points and private asset preparation

| File | Purpose |
| --- | --- |
| `src/index.ts` / `src/Root.tsx` | Register composition `PoseTekProductV1` |
| `src/ProductFilm.tsx` | Scene clock, setup illustration, paired footage, captions and audio |
| `src/ProductPose.tsx` | Recorded jump and kick comparison components |
| `src/ProductScreens.tsx` | Profile, builder, guided workout, coaching and progress components |
| `scripts/prep-product-poses.cjs` | Read-only retrieval and validation of the authorized source selection |
| `scripts/prep-product-footage.mjs` | Reproduce local cuts, orientation, SDR conversion, app audio and combined captions |
| `scripts/prep-product-profile.mjs` | Display-only profile preparation from qualified records and checked native benchmarks |
| `audio-source/product-demo.json` | Narration, caption text, timing windows and reserved app-audio interval |
| `scripts/render.mjs` | Stills, motion proof and master rendering |
| `scripts/finalize-product.mjs` | Keep the encoded picture; mux one AAC encode from original PCM with sample-exact app-audio placement |
| `scripts/review-product.mjs` | Two-pass 640 × 360 review copy under the direct email attachment limit |

Keep `public/`, `output/`, dependencies, originals, raw athlete records, source receipts, tokens and local selection files out of Git. The normal product render stages only the allowlisted playback assets under `output/product/render-assets/`, excluding raw source material and retrieval credentials.

Required local inputs are `public/product/{poses.json,profile.json,screen-demo.mp4,field-demo.mp4,demo-audio.wav}`, the two approved drill MP4s, local font files, and `public/audio-product-v1/{master.wav,captions.json}`. Original footage and the private edit/synchronization receipts remain outside the staged playback assets. A fresh clone cannot render the private demonstration from Git alone; restore the authorized local asset package or perform the scoped read-only retrieval first.

`prep-product-poses.cjs` expects the private selection file and the existing authorized Firebase CLI login. Its retrieval is read-only; it does not create model jobs or modify athlete records. Optional environment variables select the source checkout, selection file and Python runtime. Do not put those private selections or credentials into this document.

From `video/draft-b`, regenerate the display profile after source preparation, passing the checked native source root:

```powershell
node scripts/prep-product-profile.mjs 'PATH_TO_CHECKED_NATIVE_SOURCE'
```

The script excludes unqualified and duplicate results, preserves source dates and saves provenance hashes. It uses the native best-valid-result and category aggregation logic, including the matching-course dribbling adjustment. The default projected reference is a disclosed reconstruction choice, not an assertion of personalized demographic calibration.

## Render and review

Use the locked package dependencies. From `video/draft-b`:

```powershell
npm ci
npm run typecheck
node scripts/prep-product-footage.mjs --verify-only
node scripts/render.mjs stills product
node scripts/render.mjs proof product
node scripts/render.mjs final product
node scripts/review-product.mjs
```

From `video/draft-b/audio-source`, using the prepared local runtime:

```powershell
& .venv/Scripts/python.exe synthesize.py product-demo.json
& .venv/Scripts/python.exe mix.py product-demo.json
& .venv/Scripts/python.exe check_speech.py product-demo.json
& .venv/Scripts/python.exe validate_audio.py product-demo.json
```

See `audio-source/README.md` for runtime setup, model/license provenance and automated audio checks. For selective still review, append comma-separated frame numbers, for example `node scripts/render.mjs stills product 180,4290`. The full output target is `output/product/PoseTek-Product-Demonstration-V1.mp4`; the render script also produces frame PNGs and a named motion-proof MP4. Generated captions and audio receipts remain in the private local output package.

## Validation and delivery

Completed September 22, 2026. The final master is 150.000 seconds, 4,500 frames at 30 fps, 1,920 × 1,080, H.264/AAC, 23,765,742 bytes. Its SHA-256 is `eadf15796f24ed50201fc2041f5eb681a5fc10b12b0cec979986345b3e7df394`.

- All scenes received key-frame review. A 57-second motion proof covered the authentic demonstration and both comparisons. The final encoded profile, guided session, scene transitions and closing were inspected at delivery resolution.
- Pose review verified source-rate sampling, event alignment, common-ground jump calibration, fixed kick registration, complete visible geometry and explicit paused states. All eight saved-analysis source hashes match. Cached originals now also require their source MD5 before reuse.
- TypeScript, preparation-script syntax, Git diff checks and tracked-source privacy review pass. Missing/malformed display profile data fails rendering. The allowlisted pose playback data contains only consumed display fields; full private provenance remains separate.
- The complete master and compact copy decode without errors. Final integrated loudness is **−16.01 LUFS**, true peak **−1.50 dBTP**. Narration, score and combined generated master are exactly silent from 21–46 seconds. The encoded app interval matches the prepared original audio with **0.999991 correlation and zero measured lag**. This checks encoded placement, not frame-perfect synchronization of the two camera recordings.
- Initial Remotion audio had 42.667 ms of AAC delay. `finalize-product.mjs`, automatically called by the final product render, copies the video stream unchanged and mixes the original PCM tracks once before AAC encoding. Native audio begins at sample 1,008,000 at 48 kHz. The retained `-render.mp4` is the pre-fix intermediate and is not the deliverable.
- The complete SRT has 47 ordered, non-overlapping cues, including nine original-app prompts. Narration passed unprompted recognition against its script. Direct subjective audio listening was unavailable; automated transcription, waveform, timing and level checks are documented without claiming a listening review.

The compact review is 640 × 360 at 15 fps, 150.000 seconds, 2,720,508 bytes, with SHA-256 `f29fa7c4cc597c030322bfc208fe6ed59573cf744b7859439749e0dcfb45b0b5`. It is an email preview; use the master for detailed review or presentation.

The authorized self-delivery was sent September 22 at 5:25 PM PDT with the compact MP4 attached and links to the full master and SRT in the connected Google Drive. Uploads were read back by ID and byte size. Outlook returned both sent and received copies with attachments. Private links and message IDs remain only in `output/product/delivery-receipt.json`. `output/product/final-validation.json`, `final-mux.json`, footage and pose manifests contain the local verification records. Delivery does not imply the user's creative approval of this new cut.

Website deployment, athlete records and production feature configuration were not changed. Earlier coaching and investor editions remain intact.
