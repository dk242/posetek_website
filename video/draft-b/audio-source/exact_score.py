"""Original 106 BPM oscillator/noise underscore, derived from Draft B's score."""
import math
import numpy as np

def render_score(duration,sr=48000,bpm=106,transitions=()):
    n=round(duration*sr)
    bed=np.zeros((n,2),dtype=np.float64)
    rng=np.random.default_rng(20260923)
    beat=60/bpm
    def place(x,at,gain=1,pan=0):
        j=round(at*sr)
        if j<0 or j>=n:
            return
        x=x[:n-j]*gain
        if x.ndim==1:
            x=np.column_stack([x*np.sqrt((1-pan)/2),x*np.sqrt((1+pan)/2)])
        bed[j:j+len(x)]+=x
    def note(freq,length,decay):
        t=np.arange(round(length*sr))/sr
        return (np.sin(2*np.pi*freq*t)+.13*np.sin(4*np.pi*freq*t))*np.minimum(t/.006,1)*np.exp(-t/decay)
    def kick():
        t=np.arange(round(.30*sr))/sr
        phase=2*np.pi*(47*t+38*.021*(1-np.exp(-t/.021)))
        return np.sin(phase)*np.exp(-t/.072)*np.minimum(t/.0015,1)
    def hat():
        t=np.arange(round(.07*sr))/sr
        noise=rng.normal(0,1,len(t))
        return (noise-np.concatenate([[0],noise[:-1]]))*np.exp(-t/.015)*np.minimum(t/.002,1)*.26
    def rim():
        t=np.arange(round(.16*sr))/sr
        tones=np.sin(2*np.pi*1710*t)*.17+np.sin(2*np.pi*2330*t)*.07
        return (tones+rng.normal(0,1,len(t))*.08)*np.exp(-t/.025)*np.minimum(t/.001,1)
    roots=[73.416,73.416,58.270,87.307,65.406]
    chords=[[146.832,174.614,220,329.628],[146.832,174.614,220,293.665],[116.541,146.832,174.614,220],[174.614,220,261.626,391.995],[130.813,146.832,195.998,261.626]]
    for block in range(math.ceil(duration/(16*beat))):
        at=block*16*beat
        length=min(16*beat+1,duration-at)
        t=np.arange(round(length*sr))/sr
        env=np.minimum(t/1.4,1)*np.minimum((length-t)/1.2,1)
        pad=np.zeros((len(t),2))
        for f in chords[block%5]:
            pad[:,0]+=np.sin(2*np.pi*f*t)*.013
            pad[:,1]+=np.sin(2*np.pi*f*1.0012*t+.2)*.013
        place(pad*env[:,None],at,.65)
    for b in range(math.ceil(duration/beat)):
        at=b*beat
        if at>duration-2:
            continue
        intensity=.65 if at<4 else 1
        if b%4 in (0,2):
            place(kick(),at,.23*intensity)
        if b%4 in (1,3) and at>4:
            place(rim(),at,.15)
        if at>4:
            place(hat(),at+.5*beat,.034,(-1 if b%2 else 1)*.45)
        if b%4==0:
            place(note(roots[(b//16)%5],1.6,.47),at,.10*intensity)
        if b%4 in (0,3) and 9<at<duration-5:
            f=chords[(b//16)%5][(b//4)%4]*2
            place(note(f,.8,.16),at+.75*beat,.022,(-1 if b%2 else 1)*.3)
    for at in transitions:
        t=np.arange(round(.38*sr))/sr
        noise=rng.normal(0,1,len(t))
        smooth=np.convolve(noise,np.ones(21)/21,mode='same')
        place(smooth*np.sin(np.pi*t/.38)**2,at-.24,.018)
    return bed
