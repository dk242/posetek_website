"""Check rendered duration, speech fit, caption fidelity, and delivery levels."""
import json
import re
import numpy as np
import soundfile as sf
from audio_config import load_config

path,spec,work,out=load_config()
timings=json.loads((out/'segments.json').read_text(encoding='utf-8'))
captions=json.loads((out/'captions.json').read_text(encoding='utf-8'))
manifest=json.loads((out/'audio-manifest.json').read_text(encoding='utf-8'))
assert len(timings)==len(spec['segments'])
for seg in timings:
    assert seg['end'] <= seg['latest_end'] + .00001, seg['id']
for name,channels in [('narration.wav',1),('bed.wav',2),('master.wav',2)]:
    data,sr=sf.read(out/name,always_2d=True)
    assert sr==48000 and len(data)==round(spec['duration']*sr), name
    assert data.shape[1]==channels, name
    assert np.isfinite(data).all() and np.max(np.abs(data))<1, name
master=manifest['audio']['master.wav']
assert -17 <= master['integrated_lufs'] <= -15
assert master['true_peak_dbtp'] <= -1
assert all(0<=c['start']<c['end']<=spec['duration'] for c in captions)
assert all(a['end']<=b['start'] for a,b in zip(captions,captions[1:]))
assert all(len(c['text'])<=spec.get('max_caption_characters',200) for c in captions)
words=lambda text: re.findall(r"[a-z0-9]+(?:'[a-z]+)?",text.lower().replace('’',"'"))
assert words(' '.join(c['text'] for c in captions))==words(' '.join(s['display'] for s in spec['segments']))
summary={'script':path.name,'duration_seconds':spec['duration'],'caption_cues':len(captions),'shortest_caption_seconds':round(min(c['end']-c['start'] for c in captions),3),'last_speech_end':timings[-1]['end'],'master_lufs':master['integrated_lufs'],'master_true_peak_dbtp':master['true_peak_dbtp'],'passed':True}
(out/'validation.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
print(json.dumps(summary,indent=2))
