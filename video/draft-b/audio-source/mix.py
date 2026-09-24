"""Build the original 106 BPM score, aligned narration, captions, and final mix.

No music samples are used. Seeded noise, sine waves, and simple oscillators form
the entire score. ffmpeg performs EQ, transparent dynamics, and loudness passes.
"""
from pathlib import Path
import hashlib
import json
import math
import re
import subprocess
import numpy as np
import soundfile as sf

ROOT=Path(__file__).resolve().parent
WORK=ROOT/'work'
SPEC=json.loads((ROOT/'script.json').read_text(encoding='utf-8'))
OUT=ROOT.parent/'public'/SPEC.get('output_dir','audio')
OUT.mkdir(parents=True,exist_ok=True)
TIMINGS=json.loads((WORK/'voice-timing.json').read_text(encoding='utf-8'))
SR=48000
N=SR*SPEC['duration']
RNG=np.random.default_rng(20260921)

def run(args):
    p=subprocess.run(['ffmpeg','-hide_banner','-nostdin','-y',*map(str,args)],capture_output=True,text=True)
    if p.returncode:
        raise RuntimeError(p.stderr)
    return p.stderr

def loudness(source):
    msg=run(['-i',source,'-af','loudnorm=I=-16:TP=-1.5:LRA=7:print_format=json','-f','null','-'])
    return json.loads(re.findall(r'\{[\s\S]*?\}',msg)[-1])

def normalize(source,target,dest):
    first=run(['-i',source,'-af',f'loudnorm=I={target}:TP=-1.5:LRA=7:print_format=json','-f','null','-'])
    x=json.loads(re.findall(r'\{[\s\S]*?\}',first)[-1])
    params=f"loudnorm=I={target}:TP=-1.5:LRA=7:measured_I={x['input_i']}:measured_TP={x['input_tp']}:measured_LRA={x['input_lra']}:measured_thresh={x['input_thresh']}:offset={x['target_offset']}:linear=true"
    run(['-i',source,'-af',params,'-ar',SR,'-c:a','pcm_s24le',dest])

def resample_voice(p):
    dest=WORK/(p.stem+'-48k.wav')
    run(['-i',p,'-af','highpass=f=75,lowpass=f=10500,acompressor=threshold=0.16:ratio=2:attack=15:release=120:makeup=1','-ar',SR,'-c:a','pcm_s24le',dest])
    return sf.read(dest)[0]

narration=np.zeros(N,dtype=np.float64)
captions=[]
speech_ranges=[]
for seg in TIMINGS:
    p=WORK/f"{seg['id']}.wav"
    x=resample_voice(p)
    # Match scene narration level while preserving the natural short-term dynamics.
    active=x[np.abs(x)>.01]
    rms=np.sqrt(np.mean(active**2))
    x=x*(.13/max(rms,.0001))
    start=round(seg['start']*SR)
    narration[start:start+len(x)] += x
    speech_ranges.append((seg['start'],seg['end']))
    # Sentences map to measured silence runs in the generated waveform.
    phrases=[s.strip() for s in re.findall(r'[^.!?]+[.!?]?',seg['display']) if s.strip()]
    step=int(SR*.01)
    energy=np.array([np.sqrt(np.mean(x[i:i+step]**2)) for i in range(0,len(x),step)])
    quiet=energy<.0045
    beginnings=np.where(np.diff(quiet.astype(int),prepend=0)==1)[0]
    endings=np.where(np.diff(quiet.astype(int),append=0)==-1)[0]
    pauses=[(a*.01,(b+1)*.01) for a,b in zip(beginnings,endings)
            if (b-a)>=8 and a*.01>.2 and (b+1)*.01 < len(x)/SR-.14]
    selected=sorted(sorted(pauses,key=lambda z:z[1]-z[0],reverse=True)[:len(phrases)-1])
    if len(selected)!=len(phrases)-1:
        raise RuntimeError(f"Cannot align phrases to pauses for {seg['id']}: {pauses}")
    starts=[0]+[b for a,b in selected]
    ends=[a for a,b in selected]+[len(x)/SR]
    for phrase,a,b in zip(phrases,starts,ends):
        captions.append({'start':round(seg['start']+a,3),'end':round(seg['start']+b,3),'text':phrase})
sf.write(WORK/'narration-raw.wav',narration,SR,subtype='PCM_24')
normalize(WORK/'narration-raw.wav',-17,OUT/'narration.wav')

bed=np.zeros((N,2),dtype=np.float64)
beat=60/SPEC['bpm']

def place(x,at,amplitude=1,pan=0):
    j=round(at*SR)
    if j<0 or j>=N:
        return
    x=x[:N-j]*amplitude
    if x.ndim==1:
        # Equal-power stereo placement.
        x=np.column_stack([x*np.sqrt((1-pan)/2),x*np.sqrt((1+pan)/2)])
    bed[j:j+len(x)] += x

def sine_note(freq,duration,decay):
    t=np.arange(round(duration*SR))/SR
    env=np.minimum(t/.006,1)*np.exp(-t/decay)
    return (np.sin(2*np.pi*freq*t)+.13*np.sin(2*np.pi*2*freq*t))*env

def kick():
    t=np.arange(round(.30*SR))/SR
    phase=2*np.pi*(47*t+38*.021*(1-np.exp(-t/.021)))
    return np.sin(phase)*np.exp(-t/.072)*np.minimum(t/.0015,1)

def hat(duration=.07):
    n=round(duration*SR)
    t=np.arange(n)/SR
    noise=RNG.normal(0,1,n)
    high=noise-np.concatenate([[0],noise[:-1]])
    return high*np.exp(-t/.015)*np.minimum(t/.002,1)*.26

def rim():
    t=np.arange(round(.16*SR))/SR
    tones=np.sin(2*np.pi*1710*t)*.17+np.sin(2*np.pi*2330*t)*.07
    noise=RNG.normal(0,1,len(t))*.08
    return (tones+noise)*np.exp(-t/.025)*np.minimum(t/.001,1)

roots=[73.416,73.416,58.270,87.307,65.406]
chords=[[146.832,174.614,220.000,329.628],
        [146.832,174.614,220.000,293.665],
        [116.541,146.832,174.614,220.000],
        [174.614,220.000,261.626,391.995],
        [130.813,146.832,195.998,261.626]]
for block in range(math.ceil(SPEC['duration']/(16*beat))):
    at=block*16*beat
    duration=min(16*beat+1,SPEC['duration']-at)
    if duration<=0:
        continue
    t=np.arange(round(duration*SR))/SR
    env=np.minimum(t/1.4,1)*np.minimum((duration-t)/1.2,1)
    pad=np.zeros((len(t),2))
    for k,freq in enumerate(chords[block%len(chords)]):
        pad[:,0]+=np.sin(2*np.pi*freq*t)*.013
        pad[:,1]+=np.sin(2*np.pi*(freq*1.0012)*t+.2)*.013
    pad*=env[:,None]
    place(pad,at,.65)
for b in range(math.ceil(SPEC['duration']/beat)):
    at=b*beat
    if at>SPEC['duration']-1.4:
        continue
    intensity=.65 if at<4 else 1
    if b%4 in (0,2):
        place(kick(),at,.23*intensity)
    if b%4 in (1,3) and at>4:
        place(rim(),at,.15)
    if at>4:
        place(hat(),at+.5*beat,.034,(-1 if b%2 else 1)*.45)
    if b%4==0:
        root=roots[min(b//16,4)]
        place(sine_note(root,1.6,.47),at,.10*intensity)
    if b%4 in (0,3) and 9<at<SPEC['duration']-5:
        chord=chords[min(b//16,4)]
        freq=chord[(b//4)%len(chord)]*2
        place(sine_note(freq,.8,.16),at+.75*beat,.022,(-1 if b%2 else 1)*.3)
# Soft air movement supports scene changes, with no conspicuous sweep per card.
for at in [3.78,11.76,23.76,37.76,45.76,49.76]:
    n=round(.38*SR)
    t=np.arange(n)/SR
    noise=RNG.normal(0,1,n)
    smooth=np.convolve(noise,np.ones(21)/21,mode='same')
    swish=smooth*np.sin(np.pi*t/.38)**2
    place(swish,at,.018)
sf.write(WORK/'bed-raw.wav',bed,SR,subtype='PCM_24')
normalize(WORK/'bed-raw.wav',-28,WORK/'bed-leveled.wav')
bed,_=sf.read(WORK/'bed-leveled.wav',always_2d=True)
gain=np.ones(N)*.93
for a,b in speech_ranges:
    before=max(0,int((a-.16)*SR))
    onset=int(a*SR)
    finish=int(b*SR)
    release=min(N,int((b+.3)*SR))
    gain[before:onset]=np.minimum(gain[before:onset],np.linspace(.93,.6,onset-before))
    gain[onset:finish]=.6
    gain[finish:release]=np.minimum(gain[finish:release],np.linspace(.6,.93,release-finish))
gain[:int(.32*SR)]*=np.linspace(0,1,int(.32*SR))
gain[-int(1.8*SR):]*=np.linspace(1,0,int(1.8*SR))
bed*=gain[:,None]
sf.write(OUT/'bed.wav',bed,SR,subtype='PCM_24')
narration,_=sf.read(OUT/'narration.wav')
mix=bed+np.column_stack([narration,narration])
sf.write(WORK/'mix-raw.wav',mix,SR,subtype='PCM_24')
normalize(WORK/'mix-raw.wav',-16,OUT/'master.wav')
(OUT/'captions.json').write_text(json.dumps(captions,indent=2)+'\n',encoding='utf-8')
(OUT/'segments.json').write_text(json.dumps(TIMINGS,indent=2)+'\n',encoding='utf-8')
def srt_time(t):
    ms=round(t*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
(OUT/'captions.srt').write_text('\n\n'.join(f"{i+1}\n{srt_time(c['start'])} --> {srt_time(c['end'])}\n{c['text']}" for i,c in enumerate(captions))+'\n',encoding='utf-8')
report={'voice':SPEC['voice'],'model':'Kokoro-82M v1.0, Apache-2.0','runtime':'kokoro-onnx 0.6.1, MIT','bpm':SPEC['bpm'],'score':'Original procedural synthesis. No third-party music or audio samples.','sample_rate':SR,'duration_seconds':SPEC['duration'],'captions':'Sentence/phrase boundaries aligned to waveform silence runs on a 10 ms grid; not word-level alignment.','audio':{}}
for name in ['narration.wav','bed.wav','master.wav']:
    p=OUT/name
    x,sr=sf.read(p)
    measurement=loudness(p)
    report['audio'][name]={'duration':len(x)/sr,'channels':1 if x.ndim==1 else x.shape[1],'sample_peak_dbfs':round(20*np.log10(np.max(np.abs(x))),3),'integrated_lufs':float(measurement['input_i']),'true_peak_dbtp':float(measurement['input_tp']),'loudness_range_lu':float(measurement['input_lra']),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
for filename in ['kokoro-v1.0.onnx','voices-v1.0.bin']:
    report[filename+'_sha256']=hashlib.sha256((ROOT/'models'/filename).read_bytes()).hexdigest()
(OUT/'audio-manifest.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,indent=2))
