"""Independent local ASR and exact authored-caption verification per passage."""
import difflib
import hashlib
import json
import re
from faster_whisper import WhisperModel
from exact_audio import ROOT,SPEC,WORK,OUT,source_check

source_check()
model_dirs=list((ROOT/'models/models--Systran--faster-whisper-base.en/snapshots').glob('*/model.bin'))
if not model_dirs:
    raise RuntimeError('The previously installed Whisper base.en model is required; no download is attempted')
model=WhisperModel(str(model_dirs[0].parent),device='cpu',compute_type='int8',cpu_threads=4)

def tokens(text):
    text=text.lower().replace('’',"'")
    text=text.replace('posetek','pose tech').replace('posetech','pose tech').replace('d1','d one').replace('d-1','d one')
    # Queues and cues are homophones; authored captions still retain queues.
    text=text.replace('queues','cues')
    text=text.replace('reevaluation','re evaluation')
    return re.findall(r"[a-z0-9]+(?:'[a-z]+)?",text)

measurements=json.loads((OUT/'measurements.json').read_text())['passages']
reports=[]
all_captions=[]
for p,measured in zip(SPEC['passages'],measurements):
    assert ' '.join(p['caption_phrases'])==p['text'], 'Exact punctuation/casing comparison failed'
    wav=WORK/f"{p['id']}.wav"
    wav_hash=hashlib.sha256(wav.read_bytes()).hexdigest()
    cache=WORK/f"{p['id']}-asr.json"
    prior=json.loads(cache.read_text()) if cache.exists() else None
    if prior and prior['wav_sha256']==wav_hash and prior.get('decoder_version')==2:
        rows=prior['rows']
    else:
        segments,_=model.transcribe(str(wav),language='en',beam_size=5,vad_filter=False,word_timestamps=True,condition_on_previous_text=False,temperature=0)
        rows=[{'start':s.start,'end':s.end,'text':s.text.strip(),'words':[{'start':w.start,'end':w.end,'word':w.word.strip()} for w in s.words]} for s in segments]
        cache.write_text(json.dumps({'wav_sha256':wav_hash,'decoder_version':2,'rows':rows},indent=2)+'\n')
    recognized=[]
    for row in rows:
        for word in row['words']:
            for token in tokens(word['word']):
                recognized.append({**word,'token':token})
    expected=tokens(p['text'])
    matcher=difflib.SequenceMatcher(None,expected,[w['token'] for w in recognized],autojunk=False)
    mappings={}
    differences=[]
    for tag,a,b,c,d in matcher.get_opcodes():
        if tag=='equal':
            mappings.update({a+i:recognized[c+i] for i in range(b-a)})
        else:
            differences.append({'expected':' '.join(expected[a:b]),'recognized':' '.join(w['token'] for w in recognized[c:d])})
    if matcher.ratio()<.86:
        raise RuntimeError(f"Speech agreement requires review for {p['id']}: {matcher.ratio():.3f}")
    cues=[]
    offset=0
    for text in p['caption_phrases']:
        count=len(tokens(text))
        matched=[mappings[i] for i in range(offset,offset+count) if i in mappings]
        if not matched:
            raise RuntimeError(f'Caption has no recognition alignment: {text}')
        cue={'passage':p['id'],'start':round(max(0,matched[0]['start']),3),'end':round(min(measured['speech_seconds'],matched[-1]['end']+.07),3),'text':text}
        cues.append(cue)
        offset+=count
    for a,b in zip(cues,cues[1:]):
        if a['end']>b['start']:
            boundary=round((a['end']+b['start'])/2,3)
            a['end']=boundary
            b['start']=boundary
    if not all(c['start']<c['end'] for c in cues):
        raise RuntimeError('Invalid caption times')
    all_captions.extend(cues)
    report={'id':p['id'],'recognition_agreement':round(matcher.ratio(),4),'differences':differences,'recognized_text':' '.join(r['text'] for r in rows),'caption_exact':True,'audio_sha256':wav_hash}
    reports.append(report)
    print(json.dumps(report),flush=True)
(OUT/'passage-captions.json').write_text(json.dumps(all_captions,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
(OUT/'speech-check.json').write_text(json.dumps({'source_check':source_check(),'voice':'af_heart','natural_rate':SPEC['synthesis_rate'],'independent_model':'Whisper base.en, no prompt','passages':reports,'listening_review':False},indent=2)+'\n')
