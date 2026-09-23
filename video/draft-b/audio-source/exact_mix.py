"""Assemble measured natural-rate narration only after the scene clock is agreed."""
import hashlib
import json
import re
import subprocess
import numpy as np
import soundfile as sf
from exact_audio import SPEC,WORK,OUT,source_check
from exact_score import render_score

check=source_check()
timeline=SPEC.get('timeline')
if not timeline:
    raise RuntimeError('Timeline is not locked; obtain passage starts and original-demo interval first')
SR=48000
duration=timeline['duration']
N=round(duration*SR)
measurement=json.loads((OUT/'measurements.json').read_text())['passages']
by_id={p['id']:p for p in measurement}
voice_ranges=[]
demo=timeline['original_demo']
assert demo['end']-demo['start']==25

def ffmpeg(args):
    r=subprocess.run(['ffmpeg','-hide_banner','-nostdin','-y',*map(str,args)],capture_output=True,text=True)
    if r.returncode:
        raise RuntimeError(r.stderr)
    return r.stderr

def levels(path,target=-16):
    out=ffmpeg(['-i',path,'-af',f'loudnorm=I={target}:TP=-1.5:LRA=7:print_format=json','-f','null','-'])
    return json.loads(re.findall(r'\{[\s\S]*?\}',out)[-1])

def normalize(source,dest,target):
    x=levels(source,target)
    filt=f"loudnorm=I={target}:TP=-1.5:LRA=7:measured_I={x['input_i']}:measured_TP={x['input_tp']}:measured_LRA={x['input_lra']}:measured_thresh={x['input_thresh']}:offset={x['target_offset']}:linear=true"
    ffmpeg(['-i',source,'-af',filt,'-ar',SR,'-c:a','pcm_s24le',dest])

narration=np.zeros(N)
placed=[]
for p in SPEC['passages']:
    start=timeline['passage_starts'][p['id']]
    end=start+by_id[p['id']]['speech_seconds']
    if end>timeline['scene_ends'][p['id']]:
        raise RuntimeError(f"Natural narration overruns {p['id']}; extend the scene, do not speed it up")
    if start<demo['end'] and end>demo['start']:
        raise RuntimeError('Narration intersects original-audio demonstration')
    dest=WORK/f"{p['id']}-48k.wav"
    ffmpeg(['-i',WORK/f"{p['id']}.wav",'-af','highpass=f=75,lowpass=f=10500,acompressor=threshold=0.16:ratio=2:attack=15:release=120:makeup=1','-ar',SR,'-c:a','pcm_s24le',dest])
    samples,_=sf.read(dest)
    active=samples[np.abs(samples)>.01]
    samples*=.13/max(np.sqrt(np.mean(active**2)),.0001)
    j=round(start*SR)
    narration[j:j+len(samples)]+=samples
    voice_ranges.append((start,end))
    placed.append({'id':p['id'],'start':start,'end':round(end,6),'duration':by_id[p['id']]['speech_seconds'],'rate':1.0,'text':p['text']})
sf.write(WORK/'narration-raw.wav',narration,SR,subtype='PCM_24')
normalize(WORK/'narration-raw.wav',OUT/'narration.wav',-17)

bed=render_score(duration,SR,SPEC['bpm'],timeline.get('transitions',[]))
sf.write(WORK/'bed-raw.wav',bed,SR,subtype='PCM_24')
normalize(WORK/'bed-raw.wav',WORK/'bed-leveled.wav',-28)
bed,_=sf.read(WORK/'bed-leveled.wav',always_2d=True)
gain=np.ones(N)*.85
for start,end in voice_ranges:
    a=max(0,round((start-.16)*SR)); b=round(start*SR); c=round(end*SR); d=min(N,round((end+.3)*SR))
    gain[a:b]=np.minimum(gain[a:b],np.linspace(.85,.56,b-a))
    gain[b:c]=.56
    gain[c:d]=np.minimum(gain[c:d],np.linspace(.56,.85,d-c))
gain[:round(.45*SR)]*=np.linspace(0,1,round(.45*SR))
gain[-round(2*SR):]*=np.linspace(1,0,round(2*SR))
# Score fades outside the reserved interval. Every sample inside is zero.
a=round(demo['start']*SR); b=round(demo['end']*SR); fade=round(.45*SR)
gain[a-fade:a]*=np.linspace(1,0,fade)
gain[a:b]=0
gain[b:b+fade]*=np.linspace(0,1,fade)
bed*=gain[:,None]
sf.write(OUT/'bed.wav',bed,SR,subtype='PCM_24')
narration,_=sf.read(OUT/'narration.wav')
mix=bed+np.column_stack([narration,narration])
sf.write(WORK/'mix-raw.wav',mix,SR,subtype='PCM_24')
normalize(WORK/'mix-raw.wav',OUT/'master.wav',-16)
# Resampling can leave one PCM least-significant bit at a silent boundary.
# Preserve the reserved demonstration interval as exact digital silence.
final_mix,final_sr=sf.read(OUT/'master.wav',always_2d=True)
final_mix[a:b]=0
sf.write(OUT/'master.wav',final_mix,final_sr,subtype='PCM_24')

local_caps=json.loads((OUT/'passage-captions.json').read_text(encoding='utf-8'))
caps=[{'start':round(timeline['passage_starts'][c['passage']]+c['start'],3),'end':round(timeline['passage_starts'][c['passage']]+c['end'],3),'text':c['text']} for c in local_caps]
assert ' '.join(c['text'] for c in caps)==' '.join(p['text'] for p in SPEC['passages'])
assert all(a['end']<=b['start'] for a,b in zip(caps,caps[1:]))
assert all(not (c['start']<demo['end'] and c['end']>demo['start']) for c in caps)
(OUT/'captions.json').write_text(json.dumps(caps,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
def stamp(t):
    ms=round(t*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
(OUT/'captions.srt').write_text('\n\n'.join(f"{i+1}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}" for i,c in enumerate(caps))+'\n',encoding='utf-8')
(OUT/'segments.json').write_text(json.dumps(placed,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
(OUT/'timeline.json').write_text(json.dumps(timeline,indent=2)+'\n',encoding='utf-8')
measurement_doc=json.loads((OUT/'measurements.json').read_text())
measurement_doc['timeline_locked']=True
(OUT/'measurements.json').write_text(json.dumps(measurement_doc,indent=2)+'\n')
report={'version':SPEC['version'],'duration_seconds':duration,'sample_rate':SR,'voice':'af_heart','model':'Kokoro-82M v1.0, Apache-2.0','runtime':'kokoro-onnx 0.6.1, MIT','natural_rate':1.0,'score':'Original oscillator/noise synthesis at 106 BPM; no third-party audio samples.','source_check':check,'exact_caption_text':True,'caption_cues':len(caps),'original_demo_reserved_silence':demo,'original_demo_note':'This soundtrack is silent for the complete demonstration; the compositor supplies the separately verified original demo audio and its captions.','audio':{}}
for name in ['narration.wav','bed.wav','master.wav']:
    path=OUT/name
    data,sr=sf.read(path,always_2d=True)
    assert sr==SR and len(data)==N and np.isfinite(data).all() and np.max(np.abs(data))<1
    assert np.max(np.abs(data[a:b]))==0, f'{name} has sound in original demo'
    level=levels(path)
    report['audio'][name]={'duration':len(data)/sr,'channels':data.shape[1],'integrated_lufs':float(level['input_i']),'true_peak_dbtp':float(level['input_tp']),'demo_max_abs':float(np.max(np.abs(data[a:b]))),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
assert -17<report['audio']['master.wav']['integrated_lufs']<-15
assert report['audio']['master.wav']['true_peak_dbtp']<=-1
(OUT/'audio-manifest.json').write_text(json.dumps(report,indent=2)+'\n')
(OUT/'validation.json').write_text(json.dumps({'passed':True,'exact_203_words':True,'exact_caption_case_and_punctuation':True,'all_passages_natural_rate':True,'all_passages_fit':True,'no_voice_or_music_during_demo':True,'no_clipping':True,'duration':duration,'caption_cues':len(caps)},indent=2)+'\n')
print(json.dumps(report,indent=2),flush=True)
