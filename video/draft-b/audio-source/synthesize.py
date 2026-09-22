"""Render the timed neural voice phrases using local Kokoro.

Each generated file stays in ignored work/. Public text only, no service call.
"""
from pathlib import Path
import json
import hashlib
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
from audio_config import ROOT, load_config

SCRIPT_PATH, SCRIPT, WORK, OUT = load_config()
tts = Kokoro(str(ROOT / 'models/kokoro-v1.0.onnx'), str(ROOT / 'models/voices-v1.0.bin'))
report = []
cache_path=WORK/'voice-cache.json'
cache=json.loads(cache_path.read_text(encoding='utf-8')) if cache_path.exists() else {}

def trim(samples, sr):
    loud = np.where(np.abs(samples) > .0015)[0]
    if len(loud):
        samples = samples[max(0, loud[0]-int(.025*sr)):min(len(samples),loud[-1]+int(.09*sr))]
    fade = min(int(.009*sr),len(samples)//2)
    samples[:fade] *= np.linspace(0,1,fade)
    samples[-fade:] *= np.linspace(1,0,fade)
    return samples

for seg in SCRIPT['segments']:
    speed=seg.get('speed',SCRIPT.get('default_speed',{'hook':.80,'close':.85,'team':1.02}.get(seg['id'],.92)))
    key=hashlib.sha256(json.dumps({'text':seg['text'],'voice':SCRIPT['voice'],'language':SCRIPT['language'],'speed':speed,'window':seg['latest_end']-seg['start'],'max_speed':SCRIPT.get('max_speed')},sort_keys=True).encode()).hexdigest()
    cached=cache.get(seg['id'])
    if SCRIPT_PATH.name!='script.json' and cached and cached['key']==key and (WORK/f"{seg['id']}.wav").exists():
        row={**cached['row'],**seg}
        row['end']=round(seg['start']+row['duration'],6)
        report.append(row)
        print(json.dumps(row),flush=True)
        continue
    samples,sr = tts.create(seg['text'],voice=SCRIPT['voice'],speed=speed,lang=SCRIPT['language'])
    samples=trim(samples,sr)
    window=seg['latest_end']-seg['start']
    attempts=0
    while len(samples)/sr > window and attempts<4:
        speed*= (len(samples)/sr)/window*1.025
        if speed > SCRIPT.get('max_speed',float('inf')):
            raise RuntimeError(f"Narration {seg['id']} needs speed {speed:.3f}; shorten the script to retain a natural pace")
        samples,sr=tts.create(seg['text'],voice=SCRIPT['voice'],speed=speed,lang=SCRIPT['language'])
        samples=trim(samples,sr)
        attempts+=1
    if len(samples)/sr > window:
        raise RuntimeError(f"Narration {seg['id']} exceeds scene: {len(samples)/sr:.3f}s > {window}s")
    sf.write(WORK / f"{seg['id']}.wav",samples,sr,subtype='PCM_24')
    row={**seg,'duration':round(len(samples)/sr,6),'end':round(seg['start']+len(samples)/sr,6),'speed':speed,'sample_rate':sr}
    report.append(row)
    cache[seg['id']]={'key':key,'row':row}
    cache_path.write_text(json.dumps(cache,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(row),flush=True)
(WORK/'voice-timing.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
