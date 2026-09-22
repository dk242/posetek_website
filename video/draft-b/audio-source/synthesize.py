"""Render the seven scene-length neural voice clips using local Kokoro.

Each generated file stays in ignored work/. Public text only, no service call.
"""
from pathlib import Path
import json
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

ROOT = Path(__file__).resolve().parent
SCRIPT = json.loads((ROOT / 'script.json').read_text(encoding='utf-8'))
WORK = ROOT / 'work'
WORK.mkdir(exist_ok=True)
tts = Kokoro(str(ROOT / 'models/kokoro-v1.0.onnx'), str(ROOT / 'models/voices-v1.0.bin'))
report = []

def trim(samples, sr):
    loud = np.where(np.abs(samples) > .0015)[0]
    if len(loud):
        samples = samples[max(0, loud[0]-int(.025*sr)):min(len(samples),loud[-1]+int(.09*sr))]
    fade = min(int(.009*sr),len(samples)//2)
    samples[:fade] *= np.linspace(0,1,fade)
    samples[-fade:] *= np.linspace(1,0,fade)
    return samples

for seg in SCRIPT['segments']:
    speed={'hook':.80,'close':.85,'team':1.02}.get(seg['id'],.92)
    samples,sr = tts.create(seg['text'],voice=SCRIPT['voice'],speed=speed,lang=SCRIPT['language'])
    samples=trim(samples,sr)
    window=seg['latest_end']-seg['start']
    if len(samples)/sr > window:
        speed=(len(samples)/sr)/window*1.025
        samples,sr=tts.create(seg['text'],voice=SCRIPT['voice'],speed=speed,lang=SCRIPT['language'])
        samples=trim(samples,sr)
    if len(samples)/sr > window:
        raise RuntimeError(f"Narration {seg['id']} exceeds scene: {len(samples)/sr:.3f}s > {window}s")
    sf.write(WORK / f"{seg['id']}.wav",samples,sr,subtype='PCM_24')
    row={**seg,'duration':round(len(samples)/sr,6),'end':round(seg['start']+len(samples)/sr,6),'speed':speed,'sample_rate':sr}
    report.append(row)
    print(json.dumps(row),flush=True)
(WORK/'voice-timing.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
