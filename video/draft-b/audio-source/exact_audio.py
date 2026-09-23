"""Measure and assemble the exact authored investor narration without fitting it.

Command: measure. Separate exact_speech_check.py and exact_mix.py perform QA and
assembly. Measurement never chooses a runtime or changes wording to meet a duration.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import subprocess
import tempfile
import numpy as np
import soundfile as sf

ROOT=Path(__file__).resolve().parent
SPEC_PATH=ROOT/'investor-exact-v1.json'
SPEC=json.loads(SPEC_PATH.read_text(encoding='utf-8'))
WORK=ROOT/'work/investor-exact-v1'
OUT=ROOT.parent/'public'/SPEC['output_dir']
WORK.mkdir(parents=True,exist_ok=True)
OUT.mkdir(parents=True,exist_ok=True)
(WORK/'tmp').mkdir(exist_ok=True)
# espeak makes a private DLL copy; keep that temporary file inside this checkout.
tempfile.tempdir=str(WORK/'tmp')

def source_check():
    source=ROOT.parents[3]/'video-product-demo-plan/INVESTOR_EXACT_IMPLEMENTATION_PLAN.md'
    if source.exists():
        originals=re.findall(r'### \d+\. Exact narration\s+> ([^\n]+)',source.read_text(encoding='utf-8'))
        if originals != [p['text'] for p in SPEC['passages']]:
            raise ValueError('Exact source comparison failed')
    for passage in SPEC['passages']:
        assert hashlib.sha256(passage['text'].encode()).hexdigest()==passage['text_sha256']
        pronunciation=passage['text']
        for original,spoken in SPEC['pronunciation_only_substitutions'].items():
            pronunciation=pronunciation.replace(original,spoken)
        if passage.get('tts_terminal_pause',False):
            pronunciation+='.'
        if pronunciation!=passage['tts_text']:
            raise ValueError('Unapproved TTS text change')
    return {'exact_passages':len(SPEC['passages']),'source_comparison':source.exists(),'word_count':sum(len(p['text'].split()) for p in SPEC['passages'])}

def trim(samples,sr):
    active=np.where(np.abs(samples)>.0015)[0]
    if len(active):
        samples=samples[max(0,active[0]-round(.035*sr)):min(len(samples),active[-1]+round(.12*sr))]
    fade=min(round(.008*sr),len(samples)//2)
    samples[:fade]*=np.linspace(0,1,fade)
    samples[-fade:]*=np.linspace(1,0,fade)
    return samples

def measure():
    from kokoro_onnx import Kokoro
    check=source_check()
    tts=Kokoro(str(ROOT/'models/kokoro-v1.0.onnx'),str(ROOT/'models/voices-v1.0.bin'))
    cache_path=WORK/'measurement-cache.json'
    cache=json.loads(cache_path.read_text()) if cache_path.exists() else {}
    rows=[]
    for p in SPEC['passages']:
        key=hashlib.sha256(json.dumps([p['tts_text'],SPEC['voice'],SPEC['language'],SPEC['synthesis_rate']]).encode()).hexdigest()
        path=WORK/f"{p['id']}.wav"
        if cache.get(p['id'],{}).get('key')==key and path.exists():
            samples,sr=sf.read(path)
        else:
            samples,sr=tts.create(p['tts_text'],voice=SPEC['voice'],lang=SPEC['language'],speed=SPEC['synthesis_rate'])
            samples=trim(samples,sr)
            sf.write(path,samples,sr,subtype='PCM_24')
            cache[p['id']]={'key':key}
            cache_path.write_text(json.dumps(cache,indent=2)+'\n')
        seconds=len(samples)/sr
        row={'id':p['id'],'speech_seconds':round(seconds,6),'minimum_scene_seconds':round(np.ceil((seconds+.8)*2)/2,1),'natural_rate':SPEC['synthesis_rate'],'sample_rate':sr,'word_count':len(p['text'].split()),'text_sha256':p['text_sha256']}
        rows.append(row)
        (OUT/'measurements.json').write_text(json.dumps({'source_check':check,'passages':rows,'timeline_locked':False},indent=2)+'\n')
        print(json.dumps(row),flush=True)
    print('Total speech seconds:',round(sum(r['speech_seconds'] for r in rows),3),flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('command',choices=['measure'])
    args=parser.parse_args()
    measure()
