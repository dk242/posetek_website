"""V4: reuse exact V3 speech waveforms, shorten silence, keep continuous score."""
import json
import shutil
from pathlib import Path
import numpy as np
import soundfile as sf
from exact_v3_mix import ROOT, SR, digest, dump, meter, ducked_score, blocks

OUT = ROOT / 'public/audio-investor-exact-v4'
WORK = ROOT / 'audio-source/work/investor-exact-v4'
SOURCE = ROOT / 'public/audio-investor-exact-v3'

def stamp(t):
    ms=round(t*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    WORK.mkdir(parents=True,exist_ok=True)
    t=json.loads((ROOT/'src/investor-exact-v4-timing.json').read_text())
    spec=json.loads((ROOT/'audio-source/investor-exact-v2.json').read_text())
    previous=json.loads((SOURCE/'audio-manifest.json').read_text())
    n=round(t['duration']*SR)
    assert n==5424000
    # Remove only silence after technique narration. All nine speech waveforms remain exact.
    old,sr=sf.read(SOURCE/'narration.wav',always_2d=True)
    cut_a,cut_b=round(94.2*SR),round(100.2*SR)
    assert not old[cut_a:cut_b].any()
    narration=np.concatenate([old[:cut_a],old[cut_b:]])
    assert narration.shape==(n,1) and sr==SR
    sf.write(OUT/'narration.wav',narration,SR,subtype='PCM_24')
    native,native_sr=sf.read(ROOT/'public/product/demo-audio.wav',always_2d=True)
    start,end=round(t['original_demo']['start']*SR),round(t['original_demo']['end']*SR)
    assert native_sr==SR and end-start==len(native) and not narration[start:end].any()
    native_stem=np.zeros((n,2));native_stem[start:end]=native
    voice=np.repeat(narration,2,axis=1)+native_stem
    score,_=sf.read(ROOT/'audio-source/work/investor-exact-v2/bed-leveled.wav',always_2d=True)
    bed,gain,active=ducked_score(score[:n],voice)
    bed*=10**(previous['ducking']['music_calibration_db']/20)
    old_bed,_=sf.read(SOURCE/'bed.wav',always_2d=True)
    unchanged=round(79.4*SR);blend_end=round(80*SR)
    bed[:unchanged]=old_bed[:unchanged]
    blend=np.linspace(0,1,blend_end-unchanged)[:,None]
    bed[unchanged:blend_end]=old_bed[unchanged:blend_end]*(1-blend)+bed[unchanged:blend_end]*blend
    sf.write(OUT/'bed.wav',bed,SR,subtype='PCM_24')
    sf.write(OUT/'native-isolated.wav',native_stem,SR,subtype='PCM_24')
    bed,_=sf.read(OUT/'bed.wav',always_2d=True)
    master_gain=previous['mix']['master_gain_linear']
    raw=voice+bed
    sf.write(OUT/'master.wav',raw*master_gain,SR,subtype='PCM_24')
    master,_=sf.read(OUT/'master.wav',always_2d=True)
    old_master,_=sf.read(SOURCE/'master.wav',always_2d=True)
    assert np.array_equal(master[:unchanged],old_master[:unchanged])
    captions=json.loads((SOURCE/'captions.json').read_text())
    for cue in captions:
        if cue['start']>=100.2:
            cue['start']=round(cue['start']-6,6);cue['end']=round(cue['end']-6,6)
    assert ' '.join(c['text'] for c in captions)==' '.join(p['text'] for p in spec['passages'])
    dump(OUT/'captions.json',captions);dump(OUT/'aligned.json',captions)
    (OUT/'captions.srt').write_text('\n\n'.join(f"{i+1}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}" for i,c in enumerate(captions))+'\n',encoding='utf-8')
    segments=json.loads((SOURCE/'segments.json').read_text())
    for p in segments:
        if p['id'] in ['passage_08','passage_09']:p['start']-=6;p['end']=round(p['end']-6,6)
        assert abs(p['start']-t['passage_starts'][p['id']])<1e-6
        assert p['end']<=t['scene_ends'][p['id']]
    dump(OUT/'segments.json',segments)
    for name in ['passage-captions.json','measurements.json','speech-check.json']:
        shutil.copyfile(SOURCE/name,OUT/name)
    shutil.copyfile(ROOT/'src/investor-exact-v4-timing.json',OUT/'timeline.json')
    measured={}
    for name in ['narration.wav','native-isolated.wav','bed.wav','master.wav']:
        data,audio_sr=sf.read(OUT/name,always_2d=True)
        assert len(data)==n and audio_sr==SR and np.isfinite(data).all() and np.max(np.abs(data))<1
        measured[name]={**meter(OUT/name),'sha256':digest(OUT/name),'samples':n}
    assert -16.5<=measured['master.wav']['integrated_lufs']<=-15.5,measured['master.wav']
    assert measured['master.wav']['true_peak_dbtp']<=-1.5
    vp=blocks(voice,4800);bp=blocks(bed,4800);voiced=vp>10**(-30/10)
    separation=float(10*np.log10(vp[voiced].sum()/bp[voiced].sum()))
    demo_min=float(np.sqrt(blocks(bed[start:end],4800)).min())
    assert abs(separation-16)<.5 and demo_min>1e-6
    report={'passed':True,'version':'investor-exact-v4','duration_seconds':113,'samples':n,'sample_rate':SR,
      'source_timeline':'src/investor-exact-v4-timing.json','timeline_sha256':digest(ROOT/'src/investor-exact-v4-timing.json'),
      'voice':'All nine V3 narration waveforms reused; only silence removed, no synthesis or speed processing.',
      'prefix_pcm_identical_until':79.4,
      'original_demo':{**t['original_demo'],'sample_offset':start,'samples':len(native),'isolated_pcm_identical':True,'source_sha256':digest(ROOT/'public/product/demo-audio.wav')},
      'ducking':{'target_music_below_speech_db':16,'measured_voiced_energy_separation_db':separation,'attack_seconds':.15,'release_seconds':.35,'demo_music_nonzero_all_100ms_blocks':True,'minimum_demo_music_100ms_rms':demo_min},
      'mix':{'master_gain_linear':master_gain,'master_gain_db':previous['mix']['master_gain_db'],'limiter_or_time_warp':False},
      'captions':{'exact_original_203_words':True,'exact_v3_wording':True,'late_passages_shift_seconds':-6,'cues':len(captions),'sha256':digest(OUT/'captions.json')},
      'audio':measured}
    dump(OUT/'audio-manifest.json',report);dump(OUT/'validation.json',report)
    print(json.dumps(report,indent=2))
if __name__=='__main__':main()
