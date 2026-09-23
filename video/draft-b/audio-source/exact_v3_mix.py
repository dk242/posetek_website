"""Mix the unchanged V2 voice and native demo once, with a continuous score.

Run with audio-source/.venv/Scripts/python.exe audio-source/exact_v3_mix.py.
Only investor-exact-v3 output/work folders are written. No TTS is performed.
"""
from pathlib import Path
import hashlib
import json
import re
import shutil
import subprocess

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'public/audio-investor-exact-v2'
OUT = ROOT / 'public/audio-investor-exact-v3'
WORK = ROOT / 'audio-source/work/investor-exact-v3'
SR = 48000
TARGET_LUFS = -16.0
PEAK_CEILING = -1.6  # Headroom for the single final AAC encode.


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def dump(path, data):
    Path(path).write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


def meter(path):
    proc = subprocess.run(['ffmpeg', '-hide_banner', '-nostdin', '-i', str(path),
                           '-af', 'loudnorm=I=-16:TP=-1.6:LRA=7:print_format=json',
                           '-f', 'null', '-'], capture_output=True, text=True, check=True)
    result = json.loads(re.findall(r'\{[\s\S]*?\}', proc.stderr)[-1])
    return {'integrated_lufs': float(result['input_i']),
            'true_peak_dbtp': float(result['input_tp']),
            'loudness_range_lu': float(result['input_lra'])}


def blocks(x, width=480):
    """Channel-averaged 10 ms powers; exact 119 s source has no trailing block."""
    return np.mean(x.reshape(-1, width, x.shape[1]) ** 2, axis=(1, 2))


def ducked_score(score, speech):
    # An RMS sidechain controls only the music. No speech samples are processed.
    # 100 ms measurement smooths waveform cycles; 150 ms lookahead lets the score
    # settle before a word. Attack/release are exponential time constants.
    width = 480
    frame_seconds = width / SR
    voice_rms = np.sqrt(np.convolve(blocks(speech), np.ones(10) / 10, mode='same'))
    score_rms = np.sqrt(np.convolve(blocks(score), np.ones(10) / 10, mode='same'))
    active = voice_rms > 10 ** (-38 / 20)
    desired = np.ones(len(active)) * .85
    desired[active] = np.minimum(.85, voice_rms[active] * 10 ** (-16 / 20)
                                 / np.maximum(score_rms[active], 1e-8))
    desired = np.maximum(desired, .04)
    future = np.minimum.reduce([np.pad(desired[k:], (0, k), mode='edge')
                                for k in range(16)])
    gain = np.zeros(len(active))
    previous = future[0]
    for i, target in enumerate(future):
        tau = .15 if target < previous else .35
        coefficient = np.exp(-frame_seconds / tau)
        previous = coefficient * previous + (1 - coefficient) * target
        gain[i] = previous
    samples = np.interp(np.arange(len(score)), np.arange(len(gain)) * width, gain)
    samples[:round(.45 * SR)] *= np.linspace(0, 1, round(.45 * SR))
    samples[-2 * SR:] *= np.linspace(1, 0, 2 * SR)
    return score * samples[:, None], gain, active


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    timing = json.loads((ROOT / 'src/investor-exact-v3-timing.json').read_text())
    specification = json.loads((ROOT / 'audio-source/investor-exact-v2.json').read_text())
    for field in ('duration', 'duration_frames', 'fps', 'original_demo', 'passage_starts',
                  'scene_ends', 'transitions', 'visual_only_coda'):
        assert timing[field] == specification['timeline'][field], field
    assert timing['music']['continuous'] and timing['music']['duck_db'] == 16
    assert timing['music']['attack_seconds'] == .15 and timing['music']['release_seconds'] == .35
    n = round(timing['duration'] * SR)
    demo = timing['original_demo']
    start, end = round(demo['start'] * SR), round(demo['end'] * SR)
    assert n == 5712000 and start == 1032000 and end - start == 1200000
    native_path = ROOT / 'public/product/demo-audio.wav'
    score_path = ROOT / 'audio-source/work/investor-exact-v2/bed-leveled.wav'
    preserved = [SOURCE / 'narration.wav', native_path, score_path,
                 *[SOURCE / name for name in ('captions.json', 'captions.srt', 'segments.json',
                     'passage-captions.json', 'measurements.json', 'speech-check.json', 'timeline.json')]]
    before = {str(p.relative_to(ROOT)): digest(p) for p in preserved}
    narration, sr = sf.read(SOURCE / 'narration.wav', always_2d=True)
    native, native_sr = sf.read(native_path, always_2d=True)
    score, score_sr = sf.read(score_path, always_2d=True)
    assert sr == native_sr == score_sr == SR
    assert narration.shape == (n, 1) and native.shape == (1200000, 2) and score.shape == (n, 2)
    assert not narration[start:end].any()
    native_stem = np.zeros((n, 2))
    native_stem[start:end] = native
    voice = np.repeat(narration, 2, axis=1) + native_stem
    bed, duck_gain, active = ducked_score(score, voice)
    # Calibrate the overall balance after smoothing. Otherwise brief weak
    # phonemes would bias the sidechain and make the score much too quiet.
    # Energy is measured only in 100 ms blocks containing clear speech.
    voice_power = blocks(voice, 4800)
    music_power = blocks(bed, 4800)
    voiced_blocks = voice_power > 10 ** (-30 / 10)
    separation_before = 10 * np.log10(np.sum(voice_power[voiced_blocks])
                                      / np.sum(music_power[voiced_blocks]))
    music_calibration_db = separation_before - timing['music']['duck_db']
    bed *= 10 ** (music_calibration_db / 20)
    sf.write(OUT / 'native-isolated.wav', native_stem, SR, subtype='PCM_24')
    sf.write(OUT / 'bed.wav', bed, SR, subtype='PCM_24')
    # Re-read the delivered PCM stem so the summation is exactly reproducible.
    bed, _ = sf.read(OUT / 'bed.wav', always_2d=True)
    raw = voice + bed
    sf.write(WORK / 'mix-raw.wav', raw, SR, subtype='FLOAT')
    raw_level = meter(WORK / 'mix-raw.wav')
    master_gain_db = min(TARGET_LUFS - raw_level['integrated_lufs'],
                         PEAK_CEILING - raw_level['true_peak_dbtp'])
    master_gain = 10 ** (master_gain_db / 20)
    sf.write(OUT / 'master.wav', raw * master_gain, SR, subtype='PCM_24')
    for name in ('narration.wav', 'captions.json', 'captions.srt', 'segments.json',
                 'passage-captions.json', 'measurements.json', 'speech-check.json'):
        shutil.copyfile(SOURCE / name, OUT / name)
    shutil.copyfile(ROOT / 'src/investor-exact-v3-timing.json', OUT / 'timeline.json')
    shutil.copyfile(SOURCE / 'captions.json', OUT / 'aligned.json')
    shutil.copyfile(native_path, OUT / 'demo-audio.wav')
    captions = json.loads((OUT / 'captions.json').read_text(encoding='utf-8'))
    assert ' '.join(c['text'] for c in captions) == ' '.join(p['text'] for p in specification['passages'])
    stem, _ = sf.read(OUT / 'native-isolated.wav', always_2d=True)
    master, _ = sf.read(OUT / 'master.wav', always_2d=True)
    assert np.array_equal(stem[start:end], native)
    assert not stem[:start].any() and not stem[end:].any()
    error = float(np.max(np.abs(master - raw * master_gain)))
    assert error <= 2 ** -23
    # Check every 100 ms in the demo, not only an aggregate RMS.
    demo_music_rms = np.sqrt(np.mean(bed[start:end].reshape(-1, 4800, 2) ** 2, axis=(1, 2)))
    assert np.min(demo_music_rms) > 1e-6
    # Report observed separation over clearly voiced 100 ms blocks. The duck
    # target is 16 dB; attack/release and score transients create variation.
    voice_rms = np.sqrt(blocks(voice, 4800))
    music_rms = np.sqrt(blocks(bed, 4800))
    voiced = voice_rms > 10 ** (-30 / 20)
    separation = 20 * np.log10(voice_rms[voiced] / np.maximum(music_rms[voiced], 1e-12))
    integrated_separation = float(10 * np.log10(np.sum(voice_rms[voiced] ** 2)
                                                / np.sum(music_rms[voiced] ** 2)))
    assert abs(integrated_separation - 16) < .01
    measured = {}
    for name in ('narration.wav', 'native-isolated.wav', 'bed.wav', 'master.wav'):
        path = OUT / name
        data, audio_sr = sf.read(path, always_2d=True)
        assert audio_sr == SR and len(data) == n and np.isfinite(data).all() and np.max(np.abs(data)) < 1
        measured[name] = {**meter(path), 'sha256': digest(path), 'samples': len(data),
                          'duration_seconds': len(data) / SR, 'channels': data.shape[1]}
    assert -16.5 <= measured['master.wav']['integrated_lufs'] <= -15.5, measured['master.wav']
    assert measured['master.wav']['true_peak_dbtp'] <= -1.5
    assert all(digest(ROOT / path) == sha for path, sha in before.items())
    report = {
        'version': 'investor-exact-v3', 'passed': True, 'duration_seconds': n / SR,
        'sample_rate': SR, 'samples': n, 'source_timeline': 'src/investor-exact-v3-timing.json',
        'timeline_sha256': digest(ROOT / 'src/investor-exact-v3-timing.json'),
        'voice': 'Unchanged af_heart V2 narration; no new synthesis or time processing.',
        'score': 'Original 106 BPM oscillator/noise score. No third-party samples.',
        'source_hashes': before, 'v2_sources_unchanged': True,
        'mux_instruction': 'Mux master.wav as the only audio stream, once to AAC. It already includes the native demonstration.',
        'original_demo': {**demo, 'sample_offset': start, 'samples': len(native),
                          'source_sha256': digest(native_path), 'isolated_pcm_identical': True,
                          'isolated_lag_samples': 0, 'no_speech_or_native_processing': True},
        'ducking': {'target_music_below_speech_db': 16, 'attack_seconds': .15,
                    'release_seconds': .35, 'lookahead_seconds': .15,
                    'music_calibration_db': float(music_calibration_db),
                    'measured_voiced_energy_separation_db': integrated_separation,
                    'measurement': 'RMS energy over clearly voiced 100 ms blocks; transient percentile variation reported separately.',
                    'minimum_demo_music_100ms_rms': float(np.min(demo_music_rms)),
                    'demo_music_nonzero_all_100ms_blocks': True,
                    'voiced_separation_db_p10_median_p90': np.percentile(separation, [10, 50, 90]).tolist()},
        'mix': {'method': 'Linear sum of unchanged narration, unchanged placed native PCM, and ducked score; one constant master gain.',
                'master_gain_db': master_gain_db, 'master_gain_linear': master_gain,
                'raw_levels': raw_level, 'expected_mix_max_error': error,
                'expected_mix_tolerance': 2 ** -23, 'limiter_or_time_warp': False},
        'captions': {'exact_original_203_words': True, 'exact_v2_timing_and_bytes': True,
                     'cues': len(captions), 'sha256': digest(OUT / 'captions.json'),
                     'aligned_json': 'Exact alias of captions.json; existing V2 timing.'},
        'audio': measured,
    }
    dump(OUT / 'audio-manifest.json', report)
    dump(OUT / 'source-validation.json', report)
    dump(OUT / 'validation.json', report)
    dump(WORK / 'duck-envelope.json', {'interval_seconds': .01, 'gain': duck_gain.tolist(),
                                      'speech_active': active.astype(int).tolist()})
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
