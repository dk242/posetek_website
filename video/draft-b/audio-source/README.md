# Draft B audio

## Coaching V3 and investor V1

The optional script argument selects an isolated build without changing the
original V2 `script.json`. Omitting it still uses V2 and the original `work/`.
Named variants use `work/<script-name>/` and the output directory in their JSON.

```powershell
& .venv/Scripts/python.exe synthesize.py coaching-v3.json
& .venv/Scripts/python.exe mix.py coaching-v3.json
& .venv/Scripts/python.exe check_speech.py coaching-v3.json
& .venv/Scripts/python.exe validate_audio.py coaching-v3.json

& .venv/Scripts/python.exe synthesize.py investor-v1.json
& .venv/Scripts/python.exe mix.py investor-v1.json
& .venv/Scripts/python.exe check_speech.py investor-v1.json
& .venv/Scripts/python.exe validate_audio.py investor-v1.json
```

`--script investor-v1.json` is equivalent to the positional argument. The neural
voice, models, licenses and original 106 BPM score remain the same. Each variant
defines its own transition sounds. New variant synthesis caches completed phrases
using their text, voice, language, speed and duration window; V2 retains its
uncached generation behavior.

- **Coaching V3:** 52 seconds, output `../public/audio-v3/`. The assessment occupies
  4–9 seconds, with voice starts at 4.15, 5.55 and 6.75 seconds. Subsequent V2
  phrases move three seconds earlier. The close says “PoseTek. Start with
  evidence. Train what’s next.” The last phrase ends at 51.338 seconds.
- **Investor V1:** 90 seconds, output `../public/audio-investor-v1/`. Scene starts
  are 0, 8, 17, 33, 43, 54, 64, 75 and 84 seconds. The product section has
  individual narration starts at 17.18, 22.18 and 27.18 seconds to match testing,
  coach/player insight and guided training. The final invitation ends at 89.768
  seconds. The opening and mission received small pacing trims; all subsequent
  approved wording is preserved, including “planned player subscription”.

Investor captions retain the authored text, split at no more than 55 characters.
The speech check aligns these short cues to matching words in an independent local
Whisper transcription and keeps them inside measured scene speech extents. It
does not replace authored text with recognition guesses. Run speech QA after
mixing because a new mix regenerates provisional caption timing.

Both variants produce `audio-manifest.json`, `speech-check.json` and
`validation.json` beside their WAV files. Validation checks exact sample counts,
speech fit, unclipped audio, caption ordering/text fidelity, and delivery levels.
These automated checks do not claim subjective listening review.

## Original V2

This build produces a 55-second coach-focused audio master, aligned narration,
an original restrained 106 BPM underscore, and phrase captions. Narration uses
the preset American English `af_heart` voice; no person's voice was cloned.
The script spells the spoken company name `Pose Tech`, while captions retain
`PoseTek`.

## Reproduce

Requires Python 3.12+ and FFmpeg on PATH. From this directory in PowerShell:

```powershell
python -m venv .venv
& .venv/Scripts/python.exe -m pip install -r requirements.txt
& .venv/Scripts/python.exe fetch_models.py
& .venv/Scripts/python.exe synthesize.py
& .venv/Scripts/python.exe mix.py
```

`fetch_models.py` downloads the official kokoro-onnx release assets and checks
their recorded SHA-256 hashes. Models, the virtual environment, and work files
are ignored. WAV outputs under `../public/audio-v2/` are ignored too. Keep generated
media out of Git; retain the editable script and score. The generated caption
data and manifest are reproduced alongside the audio on each build.

`script.json` is the narration source. Its 21 phrase starts align to the revised
assessment, club, player, guided-session, retest and CTA scenes. The last spoken
phrase ends at 53.000 seconds, leaving two seconds for the music to resolve.

## Outputs

- `master.wav`: stereo 48 kHz/24-bit PCM, 55.000 seconds; -16.02 LUFS integrated,
  -1.65 dBTP measured true peak.
- `narration.wav`: mono 48 kHz/24-bit PCM, padded to 55 seconds; -17.02 LUFS.
- `bed.wav`: stereo 48 kHz/24-bit PCM, 55 seconds; -30.65 LUFS after ducking.
- `captions.json`: 21 phrase cues in `{start, end, text}` format, seconds.
- `captions.srt`: equivalent subtitle file.
- `segments.json`: scene narration timing and synthesis settings.
- `audio-manifest.json`: exact durations, channel counts, levels, licenses and hashes.

Caption boundaries use measured silent intervals in the synthesized speech at
10 ms resolution. They are phrase boundaries, not a claim of phoneme-accurate
forced alignment. All speech fits its scene without truncation or time stretching.
The final mix has no clipped samples. The production agent cannot listen to
audio directly; waveform, timing, levels and speech transcription are the
available automated checks. A local Whisper base.en transcription recovered the
full intended message, including the company name as "Pose tech". It transcribed
"focused training" as "focus training" and "sets and time" as "sets in time"; no substantive
message, URL, number, or outcome promise was added. The company URL is displayed
on the end card rather than spoken.

To repeat the optional transcription check:

```powershell
& .venv/Scripts/python.exe -m pip install faster-whisper==1.2.1
& .venv/Scripts/python.exe check_speech.py
```

## Provenance

- [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), v1.0: Apache-2.0 model.
- [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx), 0.6.1: MIT runtime.
- [Preset voice documentation](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md).
- Score and transition air sounds are generated by `mix.py` from oscillators and
  seeded noise. There are no downloaded music tracks, loops, or audio samples.
- The narration describes a development cycle. It makes no improvement promise
  and does not attribute the sample retest difference to the displayed drill.

Only model downloads require network access. Voice generation and mixing run
locally; no private source media, athlete records, or account credentials are
sent to a voice service.
