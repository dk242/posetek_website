import React from 'react';
import {Freeze,OffthreadVideo,interpolateColors,staticFile} from 'remotion';
import {setupRig} from './ExactSetup';

const C={lime:'#b7f34a',ink:'#f0f5ed',muted:'#a9bdb1',line:'#254036',bg:'#04130e'};
type P=[number,number];
export const EXACT_SETUP_V3_FRAMES=270;
const ease=(frame:number,start:number,end:number)=>{const t=Math.max(0,Math.min(1,(frame-start)/(end-start)));return t*t*(3-2*t);};

/** Remove only idle time from the established rig. The 28-frame raise,
 * 25-frame lower, 40-frame flight and full landing/recovery keep their timing.
 * All geometry comes from the same constant-length, grounded-feet rig as V1.
 */
export function setupRigFrameV3(frame:number){
  const map=[[0,0],[20,36],[48,64],[75,111],[100,136],[124,160],
    [132,176],[144,188],[184,228],[223,267],[270,330]];
  const f=Math.max(0,Math.min(270,frame));
  if(f===270)return 330;
  const i=map.findIndex((p,index)=>index<map.length-1&&f>=p[0]&&f<map[index+1][0]);
  const [a,b]=[map[i],map[i+1]];
  return a[1]+(b[1]-a[1])*(f-a[0])/(b[0]-a[0]);
}
export function setupRigV3(frame:number){return setupRig(setupRigFrameV3(frame));}

function SignAthlete({frame}:{frame:number}){
  const r=setupRigV3(frame);
  const limb=(a:P,b:P,width:number)=><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={C.lime} strokeWidth={width} strokeLinecap="round"/>;
  return <g transform="translate(1025 756)">
    <ellipse cx={r.hip[0]} cy="16" rx="59" ry="9" fill="#020d09" opacity=".65"/>
    {limb(r.farHip,r.farKnee,28)}{limb(r.farKnee,r.farAnkle,27)}
    {limb(r.farShoulder,r.farElbow,23)}{limb(r.farElbow,r.farWrist,23)}
    <line x1={r.shoulder[0]} y1={r.shoulder[1]} x2={r.hip[0]} y2={r.hip[1]} stroke={C.lime} strokeWidth="50" strokeLinecap="butt"/>
    {limb(r.hip,r.knee,29)}{limb(r.knee,r.ankle,27)}
    {limb(r.shoulder,r.elbow,23)}{limb(r.elbow,r.wrist,23)}
    <circle cx={r.head[0]} cy={r.head[1]} r="24" fill={C.lime}/>
    {[r.farAnkle,r.ankle].map((p,i)=><line key={i} x1={p[0]-8} y1={p[1]+5} x2={p[0]+23} y2={p[1]+5} stroke={C.lime} strokeWidth="16" strokeLinecap="round"/>)}
  </g>;
}

/** An intentionally flat printed marker illustration, not a newly generated
 * tracking code or a claim that this drawing itself is accepted by the app.
 */
function FlatMarker(){
  return <g transform="matrix(1 -.11 .57 .73 824 779)">
    <rect x="-5" y="-5" width="78" height="78" fill="#e8eee2" stroke="#75917b" strokeWidth="2"/>
    <rect width="68" height="68" fill={C.bg}/>
    <path fill="#f0f5ed" d="M7 7h20v20H7z M41 7h20v20H41z M7 41h20v20H7z M34 34h10v10H34z M51 36h10v9H51z M34 50h10v11H34z M50 51h11v10H50z"/>
    <path fill={C.bg} d="M12 12h10v10H12z M46 12h10v10H46z M12 46h10v10H12z"/>
  </g>;
}

type PhoneLayer={sourceFrame:number;opacity:number};
/** Authentic screenshot cuts dissolve only inside the fixed phone prop.
 * Frame165 matches the opening; frame0 is fully settled before the outgoing
 * phone morph at local246. The actual rig's source clock is unchanged. */
export function setupPhoneLayersV3(frame:number):PhoneLayer[]{
  const f=Math.max(0,Math.min(269,frame));
  const source=(at:number)=>at<75?165:at<144?405:at<184?451+(at-144):at<223?540:0;
  const boundary=[75,144,184,223].filter(at=>f>=at).at(-1);
  if(boundary===undefined)return [{sourceFrame:source(f),opacity:1}];
  const p=ease(f,boundary,boundary+(boundary===223?12:8));
  return p<1?[{sourceFrame:source(boundary-1),opacity:1},{sourceFrame:source(f),opacity:p}]:[{sourceFrame:source(f),opacity:1}];
}
export const ExactSetupV3:React.FC<{frame:number;hidePhone?:boolean;phoneSourceFrame?:number}>=({frame,hidePhone=false,phoneSourceFrame})=>{
  const f=Math.max(0,Math.min(269,frame));
  const phase=f<20?0:f<75?1:f<100?2:f<144?3:f<184?4:5;
  const labels=['Position','Readiness signal','Hands down','Countermovement','Two-foot takeoff','Balanced landing'];
  // Authentic camera UI excerpts inside an illustrated prop. These are visibly
  // an illustration, not a new synchronized app recording or simulated output.
  const phoneLayers=phoneSourceFrame===undefined?setupPhoneLayersV3(f):[{sourceFrame:phoneSourceFrame,opacity:1}];
  const phaseStarts=[0,20,75,100,144,184],phaseProgress=phase===0?1:ease(f,phaseStarts[phase],phaseStarts[phase]+7);
  return <>
    <svg width="1920" height="930" viewBox="0 0 1920 930">
      <path d="M240 739L1590 739L1730 858L340 858Z" fill="#102e20" stroke={C.line} strokeWidth="2"/>
      <path d="M570 625L1330 422L1515 775Z" fill="#b7f34a05" stroke="#476a42" strokeDasharray="7 9"/>
      <path d="M570 658L472 825M570 658L671 825M570 658L568 851" stroke="#627b6b" strokeWidth="10" strokeLinecap="round"/>
      <path d="M570 618L570 720" stroke="#aabeb0" strokeWidth="8"/>
      {!hidePhone&&<rect x="370" y="522" width="400" height="198" rx="23" fill="#030d08" stroke="#829a8a" strokeWidth="4"/>}
      <FlatMarker/>
      <SignAthlete frame={f}/>
      <g fill={C.muted} fontFamily="Inter" fontSize="23"><text x="387" y="483">Smartphone + tripod</text><text x="789" y="868">One custom marker</text></g>
    </svg>
    {!hidePhone&&<div style={{position:'absolute',left:382,top:534,width:376,height:174,overflow:'hidden',borderRadius:14,background:'#020b07'}}>
      {phoneLayers.map((layer,i)=><div key={i} style={{position:'absolute',inset:0,opacity:layer.opacity,background:'#020b07'}}><Freeze frame={layer.sourceFrame}><OffthreadVideo src={staticFile('product/screen-demo.mp4')} muted style={{display:'block',width:376,height:174,objectFit:'contain'}}/></Freeze></div>)}
    </div>}
    <div style={{position:'absolute',left:99,right:99,top:270,display:'flex',alignItems:'center',justifyContent:'space-between',gap:20}}>{labels.map((label,i)=>{const active=i===phase?phaseProgress:i===phase-1?1-phaseProgress:0,reached=i<phase?1:i===phase?phaseProgress:0;return <div key={label} style={{fontFamily:'Inter,sans-serif',fontSize:23,color:interpolateColors(active,[0,1],[C.muted,C.ink]),opacity:.44+reached*.56,borderTop:`2px solid ${interpolateColors(active,[0,1],[C.line,C.lime])}`,paddingTop:16,flex:1}}><span style={{color:C.lime,fontSize:16,marginRight:9}}>0{i+1}</span>{label}</div>;})}</div>
    <div style={{position:'absolute',left:99,bottom:155,color:C.muted,fontFamily:'Inter,sans-serif',fontSize:18}}>Illustrated workflow · Original PoseTek camera UI · Based on the supplied broad-jump recording</div>
  </>;
};
