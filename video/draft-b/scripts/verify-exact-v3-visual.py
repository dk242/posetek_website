"""Encoded-picture checks complement human inspection, not an aesthetic score."""
from pathlib import Path
import json
import subprocess
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'output/investor-exact-v3'
FILM = OUT / 'PoseTek-Investor-Exact-V3-Timed-Proof.mp4'
OLD = ROOT / 'output/investor-exact-v2/PoseTek-Investor-Exact-V2-Timed-Proof.mp4'

def frames(path):
    result = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path),
        '-vf', 'scale=192:108', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'],
        check=True, capture_output=True)
    return np.frombuffer(result.stdout, np.uint8).reshape(-1, 108, 192).astype(np.float32)

picture = frames(FILM)
previous = frames(OLD)
# Caption/brand changes excluded; the measured region is the main visual.
delta = np.abs(np.diff(picture[:, 23:94, 9:183], axis=0)).mean(axis=(1, 2))
old_delta = np.abs(np.diff(previous[:, 23:94, 9:183], axis=0)).mean(axis=(1, 2))
cuts = [{'frame': f, 'seconds': f/30, 'v2_mean_pixel_step': float(old_delta[f-1]),
         'v3_mean_pixel_step': float(delta[f-1])} for f in (1215, 1455)]
holds = []
for name, start, end, x0, x1, y0, y1 in [
    ('COD turn', 1668, 1740, 12, 180, 34, 81),
    ('backswing', 2419, 2548, 13, 111, 36, 81),
    ('contact support', 2555, 2690, 13, 111, 36, 81),
    ('contact arm', 2690, 2822, 13, 111, 36, 81),
    ('follow through', 2847, 2976, 13, 111, 36, 81),
]:
    samples = picture[start:end, y0:y1, x0:x1]
    variation = np.abs(samples-samples[0]).mean(axis=(1, 2))
    holds.append({'name': name, 'frames': [start, end-1],
        'maximum_mean_luma_variation': float(variation.max()),
        'passed': bool(variation.max() < 1)})
timing = json.loads((ROOT/'src/investor-exact-v3-timing.json').read_text())
boundaries = [{'seconds': s['start']/30, 'scene': s['id'],
    'boundary_mean_pixel_step': float(delta[s['start']-1]),
    'transition_peak_mean_pixel_step': float(delta[max(0,s['start']-25):s['start']+2].max())}
    for s in timing['scenes'][1:]]
checks = [
    {'name': '3570 decoded frames', 'passed': len(picture)==3570},
    {'name': 'Two reported abrupt-cut pixel steps reduced',
     'passed': all(c['v3_mean_pixel_step'] < c['v2_mean_pixel_step']*.3 for c in cuts)},
    {'name': 'Feedback poses remain still in encoded picture',
     'passed': all(h['passed'] for h in holds)},
]
report = {'passed': all(c['passed'] for c in checks), 'checks': checks,
    'reported_cuts': cuts, 'paused_pose_regions': holds, 'scene_boundaries': boundaries,
    'limits': ['Pixel deltas are diagnostics; creative transition acceptance remains visual.',
               'Contact cues intentionally change highlights; underlying pose identity is checked in source.']}
(OUT/'encoded-visual-validation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report, indent=2))
if not report['passed']:
    raise SystemExit(1)
