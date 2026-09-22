"""Shared CLI settings. No argument preserves the V2 script and work folder."""
from pathlib import Path
import argparse
import json

ROOT = Path(__file__).resolve().parent

def load_config():
    parser = argparse.ArgumentParser()
    parser.add_argument('script_path', nargs='?', help='Script JSON, relative to audio-source unless absolute')
    parser.add_argument('--script', dest='script_option', help='Equivalent named script argument')
    args = parser.parse_args()
    chosen = args.script_option or args.script_path
    script = Path(chosen) if chosen else ROOT / 'script.json'
    if not script.is_absolute():
        script = ROOT / script
    script = script.resolve()
    spec = json.loads(script.read_text(encoding='utf-8'))
    work = ROOT / 'work' if script == (ROOT / 'script.json').resolve() else ROOT / 'work' / script.stem
    out = ROOT.parent / 'public' / spec.get('output_dir', 'audio')
    work.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    if spec['duration'] <= 0:
        raise ValueError('Duration must be positive')
    for seg in spec['segments']:
        if not 0 <= seg['start'] < seg['latest_end'] <= spec['duration']:
            raise ValueError(f"Invalid timing for {seg['id']}")
    return script, spec, work, out
