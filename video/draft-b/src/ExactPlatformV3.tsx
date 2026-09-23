import React from 'react';
import {Freeze,OffthreadVideo,staticFile} from 'remotion';
import {Heading,Label} from './InvestorExactFilm';
import {ProductMovementPreview} from './ProductPoseV2';
import {ExactPlayerProfileV3,ExactPlanBuilderV3} from './ExactScreensV3';

const C={bg:'#04130e',panel:'#0a211a',lime:'#b7f34a',line:'#254036'};
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const ease=(f:number,a:number,b:number)=>{const t=clamp((f-a)/(b-a),0,1);return t*t*(3-2*t);};

/** Stable source snapshots at shared-phone handoffs. No modulo replay resets. */
export const PLATFORM_PHONE_V3_BOUNDS={left:96,top:396,width:610};
export const platformPhoneSourceFrameV3=(frame:number,opening=true)=>opening?clamp(frame,0,165):165;
export function ExactCapturePhoneV3({frame,width=580}:{frame:number;width?:number}){
  return <div style={{width,padding:13,border:'2px solid #6b8475',borderRadius:27,background:'#020b07',boxShadow:'0 22px 80px #0006'}}>
    <Freeze frame={clamp(frame,0,749)}><OffthreadVideo src={staticFile('product/screen-demo.mp4')} muted style={{display:'block',width:'100%',borderRadius:13}}/></Freeze>
  </div>;
}

export type ExactPlatformV3Props={frame:number;opening?:boolean;reveal?:boolean;hidePhone?:boolean;hidePose?:boolean;hideMovement?:boolean;phoneSourceFrame?:number;poseFrame?:number};
/** The established PoseTek platform composition, with one-pass motion and
 * stationary ending states. Shared elements may be hidden by the parent while
 * it carries their exact bounds/content into another scene. */
export function ExactPlatformV3({frame,opening=false,reveal=false,hidePhone=false,hidePose=false,hideMovement=false,phoneSourceFrame,poseFrame}:ExactPlatformV3Props){
  const capture=opening?ease(frame,12,45):reveal?ease(frame,0,18):1;
  const pose=opening?ease(frame,90,120):reveal?ease(frame,25,45):1;
  const platform=opening?ease(frame,210,240):reveal?ease(frame,60,80):1;
  const phone=phoneSourceFrame??platformPhoneSourceFrameV3(frame,opening);
  const movement=poseFrame??(opening?clamp(frame-90,0,180):180);
  const firstLink=opening?ease(frame,90,150):1,secondLink=opening?ease(frame,210,270):1;
  return <>
    <Heading label={opening?'01 / POSETEK':'09 / CONNECTED PLATFORM'} title={opening?'Smartphone capture. Movement analysis. Connected platform.':'Testing, training and coaching assistance'}/>
    <svg width="1920" height="1080" style={{position:'absolute',inset:0}}>
      <path d="M716 548H821M1110 548H1217" fill="none" stroke={C.line} strokeWidth="2"/>
      <circle cx={770+firstLink*36} cy="548" r="4" fill={C.lime} opacity={pose}/>
      <circle cx={1160+secondLink*36} cy="548" r="4" fill={C.lime} opacity={platform}/>
    </svg>
    {!hidePhone&&<div style={{position:'absolute',left:96,top:396,opacity:capture}}><ExactCapturePhoneV3 frame={phone}/><Label style={{marginTop:26,textAlign:'center'}}>Smartphone</Label></div>}
    {!hidePose&&!hideMovement&&<div style={{position:'absolute',left:787,top:348,width:340,height:365,opacity:pose,borderRadius:19,border:'1px solid '+C.line,background:C.panel}}>
      <div style={{transform:'scale(.76)',transformOrigin:'0 0',width:448,height:235}}><ProductMovementPreview index={2} f={movement}/></div>
      <div style={{padding:'27px 26px 0',fontSize:23,color:C.lime}}>Captured movement</div><Label style={{padding:'15px 26px',fontSize:16}}>Computer vision</Label>
    </div>}
    <div style={{position:'absolute',left:1220,top:289,width:604,height:490,opacity:platform}}>
      <div style={{width:1728,height:700,transform:'scale(.35)',transformOrigin:'0 0',border:'3px solid '+C.line,borderRadius:22,overflow:'hidden'}}><ExactPlayerProfileV3 frame={200}/></div>
      <div style={{position:'absolute',top:222,left:45,width:1728,height:700,transform:'scale(.3)',transformOrigin:'0 0',boxShadow:'0 30px 60px #0008',border:'3px solid '+C.line,borderRadius:22,overflow:'hidden'}}><ExactPlanBuilderV3 frame={197}/></div>
      <Label style={{position:'absolute',top:463,width:604,textAlign:'center'}}>Connected platform</Label>
    </div>
    <Label style={{position:'absolute',left:96,top:879,fontSize:18}}>Recorded PoseTek movement · Reconstructed product views</Label>
  </>;
}
