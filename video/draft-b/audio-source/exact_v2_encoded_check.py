"""Verify countdown PCM alignment in the final AAC-encoded timed proof."""
from pathlib import Path
import json
import subprocess
import numpy as np
import soundfile as sf

root=Path(__file__).resolve().parent.parent
out=root/'output/investor-exact-v2'
timing=json.loads((root/'src/investor-exact-v2-timing.json').read_text())
movie=out/'PoseTek-Investor-Exact-V2-Timed-Proof.mp4'
decoded=out/'encoded-audio-qa.wav'
subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(movie),
                '-map','0:a:0','-ac','1','-ar','48000','-c:a','pcm_f32le',str(decoded)],check=True)
native,sr=sf.read(root/'public/product/demo-audio.wav',always_2d=True)
encoded,encoded_sr=sf.read(decoded,always_2d=True)
assert sr==encoded_sr==48000
native=native.mean(axis=1);encoded=encoded.mean(axis=1)
# Restrict correlation to the original countdown, excluding unrelated speech.
a=round(11.5*sr);b=round(15.2*sr);start=round(timing['original_demo']['start']*sr)
reference=native[a:b]
rows=[]
for lag in range(-48,49):
    candidate=encoded[start+a+lag:start+b+lag]
    rows.append((float(np.corrcoef(reference,candidate)[0,1]),lag))
correlation,lag=max(rows)
assert lag==0, f'Encoded countdown shifted by {lag} samples'
assert correlation>.99, f'Encoded countdown disagrees: {correlation}'
assert len(encoded)/sr>=timing['duration']
receipt={'passed':True,'sampleRate':sr,'countdownLagSamples':lag,
         'countdownCorrelation':correlation,'spokenOneSeconds':35.526,
         'firstClearlyAirborneFrame':1096,'takeoffSeconds':1096/30,
         'intervalSeconds':1096/30-35.526,'toleranceSeconds':1/30,
         'sourceAudioReservedInterval':timing['original_demo']}
assert abs(receipt['intervalSeconds']-1)<=receipt['toleranceSeconds']
(out/'encoded-audio-validation.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
