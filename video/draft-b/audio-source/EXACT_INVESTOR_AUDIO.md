# Exact investor narration

`investor-exact-v1.json` contains the nine supplied narration passages and the
agreed 173-second scene clock. All 203 words, their order, original casing,
grammar, spelling and punctuation are preserved in `text` and final captions.
This is a separate edition; no previous script, mix or output is overwritten.

The model reads at its natural rate of 1.0. There is no duration fitting,
time-stretching, rewritten copy or added closing line. The preset `af_heart`
American English voice is from Kokoro-82M v1.0 (Apache-2.0), using kokoro-onnx
0.6.1 (MIT). No person's voice was cloned.

Only the separate `tts_text` field handles pronunciation: `posetek` becomes
`Pose Tech`, and `professional/d1` becomes `professional, D one`. Passage 6
includes a synthesis-only terminal pause to avoid a repeated trailing syllable.
That pause adds no spoken word and does not alter caption punctuation. The source
word `queues` is retained. Independent ASR may spell its sound `cues`; caption text
is never copied from that recognition result.

## Reproduce

Use the existing local Python environment and model files, or install the same
dependencies from `requirements.txt` and obtain the recorded Kokoro models with
`fetch_models.py`. The current checkout uses read-access junctions to the existing
`.venv` and `models`; all outputs and caches remain in this new checkout.

```powershell
& .venv/Scripts/python.exe exact_audio.py measure
& .venv/Scripts/python.exe exact_speech_check.py
& .venv/Scripts/python.exe exact_mix.py
```

The measurement step checks the nine exact passages against the approved local
implementation plan when available and always checks their recorded SHA-256
hashes. It validates the permitted pronunciation transformations separately.
Per-passage synthesis caching uses the complete TTS text, voice, language and
natural rate; no old audio version is reused as narration.

## Timing and original demonstration

The final passage speech durations are 13.104, 9.641, 7.624, 8.619, 10.945,
5.976, 10.314, 5.446 and 6.182 seconds. The nine starts are 0.35, 14.35,
50.35, 59.35, 71.35, 99.15, 112.35, 140.35 and 149.35 seconds. The final supplied
sentence ends at 155.532 seconds. The visual coda begins at 158 and resolves at
173 seconds without new narration.

All three soundtrack stems contain exact digital silence from **25.000 to
50.000 seconds**. The compositor must supply the separately verified original
25-second demonstration audio, unchanged, in that interval. Its original audible
prompts and captions are separate from the nine-passage narration. The music
fades outside the demonstration interval and resolves during the visual coda.

The 106 BPM score is original oscillator/noise synthesis derived from the prior
PoseTek video score. It contains no downloaded music, loops or audio samples.

## Outputs and checks

Outputs are under `../public/audio-investor-exact-v1/`:

- `master.wav`, `narration.wav`, `bed.wav`: 48 kHz/24-bit PCM stems.
- `captions.json`, `captions.srt`: exact authored narration with aligned times.
- `passage-captions.json`: the same cues relative to their source passages.
- `timeline.json`, `segments.json`, `measurements.json`: the agreed clock and
  measured natural speech.
- `speech-check.json`, `audio-manifest.json`, `validation.json`: content checks,
  licensing, hashes, loudness, durations, clipping and demo-silence verification.

Independent local Whisper base.en recognition uses no text prompt. It matches
all nine passages after explicit company-name, D1, homophone and hyphen
normalization. The separate caption fidelity check compares exact characters,
including original casing and punctuation, without that normalization.
The agent cannot listen directly to audio and does not claim a subjective
listening review. Generated audio, model files and caches stay out of Git.
