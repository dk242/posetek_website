"""Optional local transcription sanity check; pip install faster-whisper==1.2.1.

This checks speech content, not the subjective quality of a human listening pass.
The small English model stays under ignored models/. No text prompt is provided.
"""
from pathlib import Path
import json
import difflib
import re
from faster_whisper import WhisperModel
from audio_config import ROOT,load_config

SCRIPT_PATH,SPEC,WORK,OUT=load_config()
model=WhisperModel('base.en',device='cpu',compute_type='int8',download_root=str(ROOT/'models'),cpu_threads=4)
segments,info=model.transcribe(str(OUT/'master.wav'),language='en',beam_size=5,vad_filter=True,word_timestamps=True)
rows=[]
for seg in segments:
    row={'start':seg.start,'end':seg.end,'text':seg.text.strip(),'words':[{'start':w.start,'end':w.end,'word':w.word.strip(),'probability':w.probability} for w in seg.words]}
    rows.append(row)
    print(json.dumps({k:v for k,v in row.items() if k!='words'}),flush=True)
(WORK/'transcription-check.json').write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')

def tokens(text):
    text=re.sub(r'posetek', 'pose tech', text, flags=re.I).replace('’', "'")
    return re.findall(r"[a-z0-9]+(?:'[a-z]+)?",text.lower())

caps=json.loads((OUT/'captions.json').read_text(encoding='utf-8'))
if any('caption_phrases' in s for s in SPEC['segments']):
    scene_rows=json.loads((WORK/'voice-timing.json').read_text(encoding='utf-8'))
    rebuilt=[]
    for seg,measured in zip(SPEC['segments'],scene_rows):
        if 'caption_phrases' not in seg:
            rebuilt.extend(c for c in caps if measured['start']-.01<=c['start']<=measured['end']+.01)
            continue
        phrases=seg['caption_phrases']
        total=sum(len(tokens(t)) for t in phrases)
        elapsed=0
        for text in phrases:
            start=measured['start']+measured['duration']*elapsed/total
            elapsed+=len(tokens(text))
            end=measured['start']+measured['duration']*elapsed/total
            rebuilt.append({'start':start,'end':end,'text':text})
    caps=rebuilt
actual=[]
for row in rows:
    for word in row['words']:
        for token in tokens(word['word']):
            actual.append({**word,'token':token})
expected=[]
offsets=[]
for cue in caps:
    words=tokens(cue['text'])
    offsets.append((len(expected),len(expected)+len(words)))
    expected.extend(words)
matcher=difflib.SequenceMatcher(None,expected,[w['token'] for w in actual],autojunk=False)
wordmap={}
differences=[]
for tag,a,b,c,d in matcher.get_opcodes():
    if tag=='equal':
        wordmap.update({a+i:actual[c+i] for i in range(b-a)})
    else:
        differences.append({'expected':' '.join(expected[a:b]),'recognized':' '.join(w['token'] for w in actual[c:d])})
if SPEC.get('align_captions',False):
    if matcher.ratio()<.85:
        raise RuntimeError(f'Speech recognition agreement too low to align captions: {matcher.ratio():.3f}')
    scene_timings=json.loads((WORK/'voice-timing.json').read_text(encoding='utf-8'))
    for cue,(a,b) in zip(caps,offsets):
        scene=next(s for s in scene_timings if s['start']-.01<=cue['start']<=s['end']+.01)
        observed=[wordmap[i] for i in range(a,b) if i in wordmap]
        if observed:
            cue['start']=round(max(scene['start'],min(observed[0]['start'],scene['end']-.1)),3)
            cue['end']=round(min(scene['end'],max(observed[-1]['end']+.055,cue['start']+.10)),3)
    for a,b in zip(caps,caps[1:]):
        if a['end']>b['start']:
            boundary=(a['end']+b['start'])/2
            a['end']=round(boundary,3)
            b['start']=round(boundary,3)
    if not all(c['start']<c['end'] for c in caps):
        raise RuntimeError('Caption alignment produced an invalid cue')
    (OUT/'captions.json').write_text(json.dumps(caps,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    def stamp(t):
        ms=round(t*1000)
        return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
    (OUT/'captions.srt').write_text('\n\n'.join(f"{i+1}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}" for i,c in enumerate(caps))+'\n',encoding='utf-8')
    manifest=json.loads((OUT/'audio-manifest.json').read_text(encoding='utf-8'))
    manifest['captions']='Trusted script text split into short cues, aligned to matched words in independent Whisper base.en transcription; clipped to measured scene speech extents.'
    (OUT/'audio-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
report={'script':SCRIPT_PATH.name,'recognition_agreement':round(matcher.ratio(),4),'differences':differences,'caption_cues':len(caps),'captions_aligned':SPEC.get('align_captions',False),'listening_review':False}
(OUT/'speech-check.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,indent=2),flush=True)
