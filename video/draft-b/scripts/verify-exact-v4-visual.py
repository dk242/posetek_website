"""Inspect encoded V4 continuity, stationary evidence and prefix preservation."""
from pathlib import Path
import json,subprocess,hashlib
import numpy as np
from PIL import Image,ImageDraw,ImageFilter
ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/'output/investor-exact-v4'
MASTER=OUT/'PoseTek-Investor-Exact-V4-1080p.mp4'
PROOF=OUT/'PoseTek-Investor-Exact-V4-Timed-Proof.mp4'
OLD=ROOT/'output/investor-exact-v3/PoseTek-Investor-Exact-V3-Timed-Proof.mp4'
def frame(file,n,size=(1280,720)):
    w,h=size
    p=subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-ss',f'{n/30:.9f}','-i',str(file),'-frames:v','1','-vf',f'scale={w}:{h}:flags=lanczos','-pix_fmt','rgb24','-f','rawvideo','-'],capture_output=True,check=True)
    return np.frombuffer(p.stdout,dtype=np.uint8).reshape(h,w,3).copy()
checks=[]
def check(name,passed,observed=None):checks.append({'name':name,'passed':bool(passed),'observed':observed})
def psnr(a,b):
    mse=np.mean((a.astype(float)-b.astype(float))**2)
    return 99 if mse==0 else float(10*np.log10(255**2/mse))
prefix=[]
for f in [350,634,945,1096,1203,1280,1395,1446,1606,1668,1848,2019,2348]:
    a=frame(MASTER,f);b=frame(OLD,f)
    a[:80,750:]=0;b[:80,750:]=0 # only the edition/proof label changes
    # Native720 CSS text rasterization differs from1080 downsampling. Compare
    # structure at a3px low-pass, alongside exact earlier-function source checks.
    aa=np.asarray(Image.fromarray(a).filter(ImageFilter.GaussianBlur(3)))
    bb=np.asarray(Image.fromarray(b).filter(ImageFilter.GaussianBlur(3)))
    prefix.append({'frame':f,'raw_psnr':psnr(a,b),'structural_psnr':psnr(aa,bb)})
check('Earlier layout and recorded content match V3 across resolution change',min(p['structural_psnr'] for p in prefix)>34,prefix)
frozen=[]
for a,b in [(2430,2490),(2510,2590),(2610,2680),(2730,2780)]:
    aa=frame(MASTER,a)[245:550,80:749];bb=frame(MASTER,b)[245:550,80:749]
    score=psnr(aa,bb);frozen.append({'frames':[a,b],'psnr':score})
check('Encoded technique poses stationary throughout each feedback hold',min(x['psnr'] for x in frozen)>42,frozen)
# A 180-frame platform interval changes in all three panels.
panel_changes={}
for name,(x0,y0,x1,y1) in {'phone':(66,268,466,303),'pose':(526,251,750,438),'platform':(816,235,1210,510)}.items():
    a=frame(MASTER,3000)[y0:y1,x0:x1];b=frame(MASTER,3135)[y0:y1,x0:x1]
    panel_changes[name]=float(np.mean(np.abs(a.astype(float)-b.astype(float))))
check('Closing phone, recorded pose and platform all animate',all(x>.1 for x in panel_changes.values()),panel_changes)
frames=[2382,2390,2440,2520,2640,2760,2810,2826,2976,2985,3018,3045,3105,3135,3164,3165,3170,3174,3178,3183,3200,3213,3225,3255,3264,3309,3320,3351,3357,3363,3378]
for group,subset in [('technique',frames[:8]),('platform',frames[8:14]),('cycle',frames[14:])]:
    rows=(len(subset)+2)//3
    sheet=Image.new('RGB',(1440,rows*298),(13,20,17));d=ImageDraw.Draw(sheet)
    for i,f in enumerate(subset):
        im=Image.fromarray(frame(MASTER,f,size=(480,270)));x=(i%3)*480;y=(i//3)*298
        sheet.paste(im,(x,y));d.text((x+12,y+277),f'{f/30:.3f} s / frame {f}',fill=(185,240,160))
    sheet.save(OUT/f'encoded-{group}-review.jpg',quality=93)
for f in [2520,2760,3018,3174,3225,3264,3320,3378]:
    Image.fromarray(frame(MASTER,f,size=(1920,1080))).save(OUT/f'encoded-{f}-1080.png')
    Image.fromarray(frame(PROOF,f)).save(OUT/f'encoded-{f}-720.png')
# Scan each revised encoded output frame for a whole-layout pop.
p=subprocess.run(['ffmpeg','-v','error','-ss','79.4','-i',str(MASTER),'-vf','scale=320:180','-pix_fmt','gray','-f','rawvideo','-'],capture_output=True,check=True)
data=np.frombuffer(p.stdout,dtype=np.uint8).reshape(-1,180,320)
delta=np.mean(np.abs(np.diff(data.astype(float),axis=0)),axis=(1,2))
check('No abrupt whole-frame jump in revised sequence',float(delta.max())<16,{'max_mean_luma_delta':float(delta.max()),'frame':int(delta.argmax()+2383),'threshold':16})
report={'passed':all(c['passed'] for c in checks),'checks':checks,'review_sheets':['encoded-technique-review.jpg','encoded-platform-review.jpg','encoded-cycle-review.jpg']}
(OUT/'encoded-visual-validation.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report,indent=2))
if not report['passed']:raise SystemExit(1)
