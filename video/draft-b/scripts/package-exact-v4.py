"""Assemble the self-contained, sanitized V4 editable source package."""
from pathlib import Path
import hashlib,json,re,shutil,zipfile
ROOT=Path(__file__).resolve().parent.parent
REPO=ROOT.parent.parent
OUT=ROOT/'output/investor-exact-v4'
PACKAGE=OUT/'editable-source'
VIDEO=PACKAGE/'video/draft-b'
VIDEO.mkdir(parents=True,exist_ok=True)
def copy(p,dest=None):
    dest=dest or PACKAGE/p.relative_to(REPO)
    dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest)
seen=set()
def dependency(p):
    p=p.resolve()
    if p in seen:return
    assert p.is_relative_to(REPO),p
    seen.add(p);copy(p)
    if p.suffix not in ('.ts','.tsx','.js','.jsx'):return
    code=p.read_text(encoding='utf-8')
    specs=re.findall(r"(?:from\s*|import\s*)['\"](\.[^'\"]+)['\"]",code)
    for spec in specs:
        q=p.parent/spec
        options=[q]+[q.with_suffix(e) for e in ['.ts','.tsx','.js','.jsx','.json']]+[q/('index'+e) for e in ['.ts','.tsx']]
        found=next((x for x in options if x.is_file()),None)
        if found is None:raise RuntimeError(f'Missing {spec} from {p}')
        dependency(found)
dependency(ROOT/'src/InvestorExactFilmV4.tsx')
copy(ROOT/'src/index.ts')
(VIDEO/'src/Root.tsx').write_text("""import React from 'react';
import {Composition} from 'remotion';
import {InvestorExactFilmV4,EXACT_V4_DURATION} from './InvestorExactFilmV4';
export const Root=()=> <Composition id="PoseTekInvestorExactV4" component={InvestorExactFilmV4} durationInFrames={EXACT_V4_DURATION} fps={30} width={1920} height={1080}/>;
""",encoding='utf-8')
for name in ['package.json','package-lock.json','tsconfig.json','EXACT_INVESTOR_V4.md']:
    copy(ROOT/name)
copy(ROOT/'scripts/render-exact-v4.mjs')
copy(ROOT/'scripts/review-exact-v4.mjs')
assets=['figure-8.mp4','wall-pass.mp4','investor-exact-v2/preview-poses.json','product/screen-demo.mp4','investor-exact-v2/broadjump.json','investor-exact/profile.json','investor-exact/field-readiness.mp4','investor-exact/field-jump.mp4','investor-exact/technique.json','investor-exact-v3/cod.json']
assets += ['fonts/'+p.name for p in (ROOT/'public/fonts').glob('*.woff2')]
assets += ['audio-investor-exact-v4/'+p.name for p in (ROOT/'public/audio-investor-exact-v4').iterdir() if p.suffix in ['.wav','.json','.srt']]
for name in assets:copy(ROOT/'public'/name)
copy(ROOT/'audio-source/investor-exact-v2.json')
copy(ROOT/'audio-source/exact_v4_mix.py')
copy(ROOT/'audio-source/exact_v3_mix.py')
copy(ROOT/'audio-source/exact_v4_encoded_check.py')
for name in ['source-validation.json','master-validation.json','encoded-audio-validation.json','visual-review.json']:
    if (OUT/name).exists():copy(OUT/name,VIDEO/'verification'/name)
if (OUT/'PoseTek-Investor-Exact-V4.srt').exists():copy(OUT/'PoseTek-Investor-Exact-V4.srt',VIDEO/'captions.srt')
readme="""# PoseTek investor V4 — editable delivery
113 seconds, 1920 x 1080, 30 fps. All nine production-script passages are exact.

Open a terminal in video/draft-b. Install Node 22 and FFmpeg, then run:
    npm ci
    npm run typecheck
    node scripts/render-exact-v4.mjs master

For the emailed two-part package, extract Source-and-Audio.zip and
Recorded-Media.zip into the same parent directory. Both archives share the
PoseTek-Investor-Exact-V4 root. The complete single ZIP is also saved locally.
On Windows, use a short extraction path, such as C:/PoseTek-V4. An existing
Chrome executable may be supplied through REMOTION_BROWSER_EXECUTABLE.

The output is output/investor-exact-v4/PoseTek-Investor-Exact-V4-1080p.mp4.
The package registers only V4; supporting older modules are dependencies.
Included app source files are read-only video reference dependencies, not a site release.

Timing: src/investor-exact-v4-timing.json
Main composition: src/InvestorExactFilmV4.tsx
Technique: src/ExactTechniqueV4.tsx
Closing: src/ExactClosingV4.tsx
Narration captions: public/audio-investor-exact-v4/captions.json
Delivery captions (including original app speech): captions.srt

Audio stems are provided at 48 kHz / 24-bit PCM:
narration.wav, native-isolated.wav, bed.wav and the complete master.wav.
master.wav already contains the original demonstration: do not add it again.
The mixer source documents the exact original-cache workflow. Rendering this
package uses the included V4 master directly and does not need those earlier caches.
Edit stems in an audio editor if further timing changes are required.

All original media is included by explicit allowlist. No authentication tokens,
private account IDs, external service access or production writes are needed.
Recorded data is not a license to invent new athlete measurements.
See video/draft-b/EXACT_INVESTOR_V4.md for evidence and calibration limits.
"""
(PACKAGE/'README.md').write_text(readme,encoding='utf-8')
files=[p for p in PACKAGE.rglob('*') if p.is_file() and not any(x in p.relative_to(PACKAGE).parts for x in ('output','node_modules','.cache')) and p.name!='FILES.json']
manifest={str(p.relative_to(PACKAGE)).replace('\\','/'):{'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()} for p in files}
(PACKAGE/'FILES.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
zip_path=OUT/'PoseTek-Investor-Exact-V4-Editable-Source.zip'
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for p in files+[PACKAGE/'FILES.json']:z.write(p,'PoseTek-Investor-Exact-V4/'+str(p.relative_to(PACKAGE)).replace('\\','/'))
with zipfile.ZipFile(zip_path) as z:assert z.testzip() is None
for suffix,media in [('Source-and-Audio',False),('Recorded-Media',True)]:
    part=OUT/f'PoseTek-Investor-Exact-V4-{suffix}.zip'
    with zipfile.ZipFile(part,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for p in files+[PACKAGE/'FILES.json']:
            if (p.suffix=='.mp4')==media or (media and p==PACKAGE/'README.md'):
                z.write(p,'PoseTek-Investor-Exact-V4/'+str(p.relative_to(PACKAGE)).replace('\\','/'))
    with zipfile.ZipFile(part) as z:assert z.testzip() is None
    assert part.stat().st_size<104857600
    print(json.dumps({'part':part.name,'bytes':part.stat().st_size}))
print(json.dumps({'file':str(zip_path),'bytes':zip_path.stat().st_size,'source_files':len(seen),'packaged_files':len(files)+1,'sha256':hashlib.sha256(zip_path.read_bytes()).hexdigest()},indent=2))
