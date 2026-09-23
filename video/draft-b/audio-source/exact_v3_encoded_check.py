"""Validate the once-encoded V3 audio against its fully mixed PCM reference.

Usage: python exact_v3_encoded_check.py path/to/final.mp4 [--output receipt.json]
The reference already includes the original demo; comparison directly against
the unmixed native recording would incorrectly treat continuous music as error.
"""
from pathlib import Path
import argparse
import hashlib
import json
import subprocess

import numpy as np
import soundfile as sf

from exact_v3_mix import ROOT, OUT, SR, digest, dump, meter


def alignment(reference, decoded, start_seconds, end_seconds, radius=96):
    a, b = round(start_seconds * SR), round(end_seconds * SR)
    expected = reference[a:b].mean(axis=1)
    expected = expected - expected.mean()
    scores = []
    for lag in range(-radius, radius + 1):
        actual = decoded[a + lag:b + lag].mean(axis=1)
        actual = actual - actual.mean()
        corr = np.dot(expected, actual) / np.sqrt(np.dot(expected, expected) * np.dot(actual, actual))
        scores.append((float(corr), lag))
    corr, lag = max(scores)
    actual = decoded[a + lag:b + lag].mean(axis=1)
    actual -= actual.mean()
    gain = float(np.dot(expected, actual) / np.dot(expected, expected))
    error = actual - expected * gain
    return {'window_seconds': [start_seconds, end_seconds], 'lag_samples': lag,
            'lag_seconds': lag / SR, 'correlation': corr, 'fitted_gain': gain,
            'gain_db': float(20 * np.log10(abs(gain))),
            'signal_to_error_db': float(10 * np.log10(np.sum((expected * gain) ** 2) / np.sum(error ** 2)))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('movie', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    movie = args.movie.resolve()
    receipt = args.output or movie.parent / 'encoded-audio-validation.json'
    manifest = json.loads((OUT / 'audio-manifest.json').read_text())
    source = OUT / 'master.wav'
    assert digest(source) == manifest['audio']['master.wav']['sha256'], 'Master changed after source validation'
    source_data, sr = sf.read(source, always_2d=True)
    assert sr == SR
    proc = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format',
                           '-of', 'json', str(movie)], capture_output=True, text=True, check=True)
    probe = json.loads(proc.stdout)
    audio_streams = [s for s in probe['streams'] if s['codec_type'] == 'audio']
    assert len(audio_streams) == 1, 'Exactly one fully mixed audio stream is required'
    stream = audio_streams[0]
    assert stream['codec_name'] == 'aac' and int(stream['sample_rate']) == SR
    assert int(stream['channels']) == 2
    assert abs(float(stream.get('start_time', 0))) <= 1 / SR
    decoded = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin',
                              '-i', str(movie), '-map', '0:a:0', '-ac', '2', '-ar', str(SR),
                              '-f', 'f32le', '-'], capture_output=True, check=True)
    data = np.frombuffer(decoded.stdout, dtype='<f4').reshape(-1, 2).astype(np.float64)
    assert len(data) >= len(source_data), 'AAC is shorter than the 119-second program'
    assert len(data) - len(source_data) < 1024, 'Unexpected extra AAC frames'
    assert np.isfinite(data).all()
    # Countdown plus continuous score should have exactly zero encoding lag.
    # A near-unity fitted gain also rejects accidental double native-audio muxing.
    demo_start = manifest['original_demo']['start']
    windows = {
        'countdown_with_music': (demo_start + 11.5, demo_start + 15.2),
        'opening_narration': (1, 10),
        'native_prompt_with_music': (demo_start + .5, demo_start + 8.5),
        'closing_narration': (106, 110),
        'music_only_coda': (112, 117),
    }
    checks = {name: alignment(source_data, data, *window) for name, window in windows.items()}
    for name, result in checks.items():
        assert result['lag_samples'] == 0, f'{name}: {result}'
        assert result['correlation'] > .99, f'{name}: {result}'
        assert abs(result['gain_db']) < .15, f'{name}: likely altered/doubled mix: {result}'
    measured = meter(movie)
    assert -16.5 <= measured['integrated_lufs'] <= -15.5, measured
    assert measured['true_peak_dbtp'] <= -1.0, measured
    native, _ = sf.read(ROOT / 'public/product/demo-audio.wav', always_2d=True)
    isolated, _ = sf.read(OUT / 'native-isolated.wav', always_2d=True)
    start = manifest['original_demo']['sample_offset']
    assert np.array_equal(isolated[start:start + len(native)], native)
    native_pcm_hash = hashlib.sha256(native.tobytes()).hexdigest()
    report = {
        'passed': True, 'version': 'investor-exact-v3', 'movie': str(movie),
        'movie_sha256': digest(movie), 'master_sha256': digest(source),
        'reference': 'Fully mixed PCM master including unchanged native demonstration and continuous music.',
        'sample_rate': SR, 'master_samples': len(source_data), 'aac_decoded_samples': len(data),
        'aac_padding_samples': len(data) - len(source_data), 'audio_codec': stream['codec_name'],
        'duration_seconds': float(stream['duration']), 'alignment_checks': checks,
        'native_stem': {'unchanged_pcm': True, 'sample_offset': start,
                        'source_pcm_sha256': native_pcm_hash, 'lag_samples': 0},
        'levels': measured, 'encoding_lag_samples': 0,
        'continuous_music_verified_in_source': manifest['ducking']['demo_music_nonzero_all_100ms_blocks'],
        'caption_source_unchanged': manifest['captions']['exact_v2_timing_and_bytes'],
    }
    dump(receipt, report)
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
