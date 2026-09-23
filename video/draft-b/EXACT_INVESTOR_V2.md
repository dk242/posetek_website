# Investor exact-script V2

Separate 119-second investor timed proof at 30 fps (3,570 frames). V1 and all
previous compositions/exports are preserved. This edition changes only video
source and prepared media; no website, mobile-app or backend behavior changes.

## Creative and source lock

- All nine passages and 203 words match V1 and the final production Word copy.
- Forest/lime, landscape 1920×1080 composition; review export 1280×720.
- `src/investor-exact-v2-timing.json` owns the scene, narration, original-audio
  and ending clock. Transitions overlap inside that clock.
- Blank lime crosswalk-style athlete, fixed limb lengths, flat printed marker,
  original landscape PoseTek camera UI. Only idle setup holds are shortened.
- Original 25-second demonstration at 21.5–46.5 seconds. Original PCM audio is
  mixed once at sample 1,032,000. No narration/music occurs during this interval.
  The explicit field-camera edit remains at 31.5 seconds. First clearly airborne
  output frame is 1,096 (36.533333 seconds), against the original spoken “1” at
  35.526 seconds: 1.007333 seconds, within one 30-fps frame of 1.00 seconds.
- After Processing complete, the designated recorded broad-jump analysis becomes
  fully visible before the spoken 4.8-foot result. Native metrics: 4.8 ft distance,
  22.1 in peak height, 0.42 s flight, dynamic current-frame COM height, Right foot.
  The original capture movie was not archived. Recorded pose/analysis JSON is
  available; 120 fps is source-declared and 1280×720 geometry is inferred from
  matching normalized/pixel marker corners. This is a labeled reconstruction,
  not a newly located screen recording or a frame match to the separate camera.
  Original low-confidence landmarks remain filtered; no joint repair is invented.
- All six test names appear together for four seconds before containers form.
- One sprint pass uses the checked individual D1 reference, original fractional
  frame rates and calibrated shared interval. No replay or race-time inference.
- All radar categories/supporting metrics appear together. Workout UI animation
  is compressed; real drill footage and timer advance at normal speed.
- Technique selects quarter-speed and stops at 458 / 472 / 472 / 522. Each cue
  holds about 4.3–4.5 seconds; the contact pose never moves between its two cues.
  Follow-through has no saved professional pose. Continue/Finish leads to the
  native completion state with Replay/Done. The coda is a paused same-athlete
  comparison excerpt, not a completed second professional-reference walkthrough.
- Future retesting and workout prescriptions remain labeled illustrative.

## Voice and timing

The same local Kokoro `af_heart` voice is freshly synthesized, without waveform
time stretching. An engine setting of 1.10 produced only 4.6% shorter speech and
could not fit the approved clock. Setting 1.20 produces 69.663667 seconds against
V1's 77.849832 seconds: 10.5% shorter / 11.75% faster actual delivery, consistent
with the approved approximately 10% brisker read. This setting is an engine
control, not a claim that the delivered narration is 20% faster.

Exact caption comparison includes original casing, punctuation and grammatical
wording. Independent local ASR aligns captions and checks speech; its recognition
of “And grades” as “Engrades” is a word-boundary ambiguity, not an input rewrite.
Review the audible proof along with the original script before master approval.

## Reproduction

Use the existing installed video dependencies and local speech models. All media,
private source audits and generated outputs remain ignored by Git.

1. Prepare the sanitized broad-jump and preview assets using
   `node scripts/prepare-exact-broadjump-v2.cjs` and
   `node scripts/prep-exact-v2-preview.mjs`. Their private inputs are the verified local source cache; no remote
   writes are performed. Preserve the existing exact-edition footage, sprint,
   technique, profile, fonts and approved drill clips.
2. Run `audio-source/.venv/Scripts/python.exe audio-source/exact_v2_audio.py measure`,
   then `exact_v2_speech_check.py`, then `exact_v2_mix.py` with the same interpreter.
3. Run `npm run typecheck`, `npm run stills:exact-v2`, `npm run proof:exact-v2`,
   then `npm run verify:exact-v2` and
   `audio-source/.venv/Scripts/python.exe audio-source/exact_v2_encoded_check.py`. Local speech DLL/browser subprocesses may need
   the desktop execution permission already used for V1.
4. The proof renderer stages an explicit media allowlist. It creates a silent
   picture, then performs one AAC encode from the source PCM tracks. Native audio
   start is derived from the same timing manifest.

## Review and delivery gate

The timed proof is for creative review. A 1080p final master, compact final review,
editable media package and approved-version email follow user proof approval.
This implementation does not treat the instruction to create V2 as proof approval.
The renderer intentionally exposes only stills/proof modes. Validation receipts
and complete captions accompany the proof under `output/investor-exact-v2/`.
