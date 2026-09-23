# PoseTek investor exact-script V4

113 seconds / 3,390 frames, 1920 × 1080 at 30 fps. Separate composition
PoseTekInvestorExactV4. V1–V3 source and exports remain unchanged.

## Direction and evidence

The user approved implementation and email delivery of this edition. The nine
production passages (203 words), existing af_heart voice and original app audio
are retained. No spoken copy was rewritten or synthesized. The first 79.4 seconds
of mixed PCM are byte-identical to V3. Passages 8–9 and their captions move six
seconds earlier; only silence is removed from the narration waveform.

| Decision | Reference | Application |
|---|---|---|
| Forest/lime, type, landscape geometry | Approved V3 film | Reuse existing tokens, phones, workspaces and caption anchor |
| Shorter feedback | Approved V4 plan | 2.6 / 3.2 / 3.2 / 2.5 s holds, one-second completion |
| Motion as continuity and hierarchy | Refero motion craft + V4 plan | One opaque moving card, fixed stage labels, sequential text fades |
| Animated connected platform | Existing app capture, saved jump, V3 screens | Muted six-second phone excerpt, two complete recorded jump replays, profile → plan → train |
| Test → Data → Plan → Retest | Approved V4 storyboard + recorded profile | Recorded 7.48 s baseline, illustrative close-control plan, pending assessment |

All changes are confined to video sources and sanitized video assets. No website,
mobile, backend, public API, athlete record or production configuration changed.

## Clock

- 0–79.4 s: V3 footage, comparison, script and transitions unchanged.
- 79.4–94.2 s: shortened technique review. Explicit quarter-speed selection;
  forward stops 458 → 472 → 472 → 522. The contact pose is completely stationary
  through support-foot and arm-balance feedback. Continue/Finish remain visible.
  Source coordinate playback remains quarter speed; only feedback holds shrink.
- 94.2–99.5 s: existing retesting passage and illustrative next steps.
- 99.5–105.5 s: dynamic platform during exact final sentence.
- 105.5–111.7 s: new connected assessment/evidence/plan/retest cycle.
- 111.7–113 s: PoseTek identity and score resolve.

The closing phone uses source seconds 10–16 at 1× and is muted. The separate
broad-jump renderer uses source slots 120–360 at the declared 120 fps. Each
three-second replay has two seconds of movement, recovery hold and a 0.4-second
fade-through reset. The source frame changes back to the start only at zero
opacity; joints are never interpolated. Two full repetitions fit the scene.
These are distinct examples, not synchronized capture/pose claims.

Recorded broad-jump metrics remain 4.8 ft, 22.1 in, 0.42 s, changing recorded
height and Right foot. The original movie was not archived; missing or
low-confidence joints remain omitted. Change-of-direction calibration, the
individual D1 reference, unequal-course limits and countdown alignment are
unchanged from the verified V3 sources.

The final cycle uses the separate recorded profile's Ball Control / Dribbling
shuttle 7.48 s baseline, September 2, 2026. The close-control plan and its
Figure-8/Wall-pass prescriptions remain illustrative. Retesting is pending.
No new result, improvement, generated plan activation or cohort standard is claimed.

## Reproduce

Use Node 22, FFmpeg on PATH and the locked npm dependencies. Restore the
authorized asset package; ignored media and audio are not in Git.

    npm ci
    npm run typecheck
    node scripts/render-exact-v4.mjs stills
    node scripts/render-exact-v4.mjs master
    node scripts/verify-exact-v4-proof.mjs master
    node scripts/review-exact-v4.mjs

The timing manifest is src/investor-exact-v4-timing.json. The master is
public/audio-investor-exact-v4/master.wav and already includes the app audio:
mux exactly once. The renderer uses a strict media allowlist and silent picture
render, then one AAC encode of that complete PCM mix.

For source-cache regeneration, exact_v4_mix.py reuses the original V3 narration,
V3 score level and prepared V2 score. The editable delivery includes the finished
V4 PCM and isolated stems; no voice model download is needed to render it.

## Review and delivery

Source checks cover exact script/captions, continuous scene clock, preserved
V3 sources and export, unchanged earlier renderer functions, correct frozen
technique frames, quarter-speed increments, two full 1× jump repetitions,
invisible resets, muted closing phone, calibrated COD source hash and audio.

Inspect 720p and 1080p frames and motion around the revised transitions.
Final receipts record encoded dimensions/frame count, complete decode, loudness,
sample alignment, preserved assets, captions and delivery readback. Private links,
mail IDs and source provenance stay in ignored output, not Git.

## Completed verification

The master and720p review decode completely and contain exactly3,390 frames.
Master:24,885,381 bytes, SHA-256
78703c942e6925336c5fd10685861605ba31f460d6000b57e19b36822322f29e.
Final AAC measures-16.33 LUFS/-1.84 dBTP, with zero-sample alignment lag.
All52 source checks and four encoded-picture checks pass. Source typography and
recorded content before79.4s remain unchanged; resolution-dependent rasterization
is handled separately from content checks. The assembled editable package passes
TypeScript and renders an independent frame using the installed browser override.

Authorized delivery completed September23,2026 at10:40:53 UTC. Outlook mailbox
readback confirms the matching message with an attachment. Five private Drive
uploads were verified by metadata and size:master,720p review,SRT,and two source
archives. Source/audio and recorded media unzip into one project; the complete
single ZIP is also saved locally. No public sharing permission was created.
