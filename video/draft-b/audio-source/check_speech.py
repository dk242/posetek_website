"""Optional local transcription sanity check; pip install faster-whisper==1.2.1.

This checks speech content, not the subjective quality of a human listening pass.
The small English model stays under ignored models/. No text prompt is provided.
"""
from pathlib import Path
import json
from faster_whisper import WhisperModel

ROOT=Path(__file__).resolve().parent
model=WhisperModel('base.en',device='cpu',compute_type='int8',download_root=str(ROOT/'models'),cpu_threads=4)
segments,info=model.transcribe(str(ROOT.parent/'public/audio/master.wav'),language='en',beam_size=5,vad_filter=True,word_timestamps=True)
rows=[]
for seg in segments:
    row={'start':seg.start,'end':seg.end,'text':seg.text.strip(),'words':[{'start':w.start,'end':w.end,'word':w.word.strip(),'probability':w.probability} for w in seg.words]}
    rows.append(row)
    print(json.dumps({k:v for k,v in row.items() if k!='words'}),flush=True)
(ROOT/'work/transcription-check.json').write_text(json.dumps(rows,indent=2)+'\n',encoding='utf-8')
