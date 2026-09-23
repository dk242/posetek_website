# Investor exact-script V3

Separate 119-second / 3,570-frame investor review edition. V1/V2 compositions,
sources and exports are preserved. V3 changes video-only source, anonymous
render assets and the mix; no website, mobile or backend behavior changes.

## Copy and continuity

The nine final production passages, 203 words, V2 voice waveform and caption
timing are unchanged. The 1920×1080 composition produces a 1280×720 review.
`src/investor-exact-v3-timing.json` owns the clock and transition anchors.

- 39.7–40.5 s: after full landing/recovery, retract the field panel and smoothly
reflow the existing phone. Keep the original capture at 1×.
- 42.4667–42.9 s: replace only the phone interior with saved broad-jump analysis,
after Processing complete and before spoken 4.8 feet. Carry the same device and
source clock across 46.5 s. Native metrics remain 4.8 ft, 22.1 in, 0.42 s, dynamic height,
Right foot. An explicit Landing-chip action seeks the saved landing frame.
- 47.9–48.5 s: carry the result into the Broad jump tile; show all six names for
four seconds. Containers form 52.5–53.3 s; Change of direction expands 53.3–53.8 s.
- Shared workspaces, screen-interior dissolves, matched phone frames and
nonoverlapping heading fades replace internal cuts. Saved-workout confirmation
precedes session entry. Technique workspace settles before its ¼× menu appears.
- The existing green sign figure/marker and complete native technique sample
remain unchanged. Technique stops 458→472→472→522, with frozen feedback.

## Change of direction evidence

Qualified Example player Session 1/Rep 1 and designated individual D1 reference
Session 1/Rep 2 use saved turnaround frames 371/344. Their original fractional rates
are 119.941062927246/119.942794799805 fps. The shared turn window is −1.2…+1.4 s,
source frames 227–539/200–512. It has one original-speed pass and explicit pauses:

| Movie seconds | Behavior |
|---|---|
|53.8–54.4|Establish anonymous labels and approach pose|
|54.4–55.6|Approach at 1×|
|55.6–58.0|Saved turn, explicitly paused|
|58.0–59.4|Exit at 1×|
|59.4–61.4|Exit paused; approach/turn/exit indicators|
|61.4–62.0|Workspace transition into radar|

Each fixed turn-hip origin is registered to a shared calibrated meter scale and
ground plane. No per-player resizing, gate-length normalization, invented
landmarks or per-frame recentering. Confidence below 0.1 remains omitted.

The courses differ (9.9159 m/9.2857 m); no equal-course race or comparative time
advantage is claimed. Apex is the stored modeled turnaround, not measured foot
contact. The reference's original movie is unavailable; its saved geometry and
fractional processing rate are retained. Private source files/IDs stay outside Git.

## Audio

The existing score now continues under original app speech as requested.
Music is ducked about 16 dB under voiced blocks, with 0.15 s attack/0.35 s release.
The app's isolated PCM stays sample-identical at offset 1,032,000 (21.5 s).
No narration overlaps the native 25-second demonstration.

`public/audio-investor-exact-v3/master.wav` is the complete mixed PCM including
native audio. Mux it **once**; do not add the app track again. One constant master
gain preserves speech dynamics. The local audio receipt records source hashes,
continuous music, summed-mix error, loudness and AAC alignment.

## Reproduce and verify

Use the existing authorized local asset cache and installed video dependencies.
Generated media, private evidence, render staging and speech models remain ignored.

1. Preserve the V2 prepared assets and exact narration. Run
`node scripts/prepare-exact-cod-v3.cjs` for the sanitized turn asset.
2. Run `audio-source/.venv/Scripts/python.exe audio-source/exact_v3_mix.py`.
No TTS regeneration is performed.
3. Run `npm run typecheck`, `npm run stills:exact-v3`, then
`npm run proof:exact-v3`. The renderer stages an explicit anonymous media
allowlist. Local rendering subprocesses may require desktop execution permission.
4. Run `node scripts/verify-exact-v2-source.mjs` to recheck the unchanged source
evidence, then `npm run verify:exact-v3` and
`audio-source/.venv/Scripts/python.exe audio-source/exact_v3_encoded_check.py`
with the proof path. Inspect transition-frame sequences and 1080p key frames.

The proof is for user creative review. Produce the 1080p master, compact final
review, editable media package and approved-edition email after proof approval.
The renderer intentionally exposes only stills/proof modes.
