import React from 'react';
import {AbsoluteFill,Audio,Sequence,Freeze,OffthreadVideo,interpolate,staticFile,useCurrentFrame} from 'remotion';
import timing from './investor-exact-v2-timing.json';
import {Fonts,Heading,Panel,Label,Platform,CapturePhone,ExactBrand,nativeCues} from './InvestorExactFilm';
import {ProductMovementPreview} from './ProductPoseV2';
import {ExactSetupV2} from './ExactSetupV2';
import {ExactBroadJumpV2} from './ExactBroadJumpV2';
import {ExactSprintV2} from './ExactSprintV2';
import {ExactTechniqueV2,ExactKickReviewV2} from './ExactTechniqueV2';
import {ExactPlayerProfileV2,ExactPlanBuilderV2,ExactGuidedWorkoutV2,ExactProgressReviewV2} from './ExactScreensV2';

export const EXACT_V2_DURATION=timing.duration_frames;
const C={bg:'#04130e',panel:'#0a211a',lime:'#b7f34a',ink:'#f0f5ed',muted:'#a9bdb1',line:'#254036'};
const mono='"IBM Plex Mono",monospace';
const linear=(f:number,a:number,b:number)=>interpolate(f,[a,b],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
const ease=(f:number,a:number,b:number)=>{const u=linear(f,a,b);return u*u*(3-2*u);};
type Cue={start:number;end:number;text:string};
type Props={audioEnabled?:boolean;captions?:Cue[]};

// Scene overlaps consume existing time. Only layout containers animate: recorded
// coordinates and media clocks keep their original speed, then freeze at the end.
function SceneTime({duration,at,kind,children}:{duration:number;at:number;kind:string;children:(f:number)=>React.ReactNode}){
 const f=useCurrentFrame(),enter=at===0?1:ease(f,0,15),exit=ease(f,duration,duration+15);
 const dx=kind==='phone'?0:kind==='evidence'?(1-enter)*90-exit*65:(1-enter)*45-exit*45;
 const dy=kind==='resolve'?(1-enter)*28:0;
 return <AbsoluteFill style={{background:C.bg,opacity:enter*(1-exit),transform:`translate(${dx}px,${dy}px) scale(${kind==='phone'?1:1-(1-enter)*.014-exit*.018})`}}><Freeze frame={Math.min(f,duration-1)}>{children(Math.min(f,duration-1))}</Freeze></AbsoluteFill>;
}
function Opening({frame}:{frame:number}){
 const t=ease(frame,360,374),padding=13-3*t;
 return <><div style={{opacity:1-t}}><Platform frame={frame} opening/></div>{frame>=360&&<div style={{position:'absolute',left:96+(370-96)*t,top:396+(522-396)*t,width:610+(400-610)*t,padding,border:'2px solid #829a8a',boxSizing:'border-box',background:'#030d08',borderRadius:27-4*t}}><Freeze frame={165}><OffthreadVideo src={staticFile('product/screen-demo.mp4')} muted style={{display:'block',width:'100%',borderRadius:14}}/></Freeze></div>}</>;
}
function Setup({frame}:{frame:number}){
 const t=ease(frame,255,269);
 return <><div style={{opacity:1-t}}><Heading label="02 / CAPTURE WORKFLOW" title="Smartphone, custom marker and athlete"/><ExactSetupV2 frame={frame} hidePhone={frame>=255}/></div>
 {frame>=255&&<div style={{position:'absolute',left:370+(96-370)*t,top:522+(319-522)*t,width:400+(1175-400)*t,padding:10+3*t,border:'2px solid #567461',boxSizing:'border-box',background:'#010a06',borderRadius:23+3*t}}><Freeze frame={0}><OffthreadVideo src={staticFile('product/screen-demo.mp4')} muted style={{display:'block',width:'100%',borderRadius:14+2*t}}/></Freeze></div>}</>;
}
function Demo({frame}:{frame:number}){
 const result=frame>=570,shot=frame>=300,rep=ease(frame,629,642),caption=nativeCues.find(c=>frame/30>=c.start&&frame/30<c.end);
 return <><Heading label="03 / ORIGINAL APP DEMONSTRATION" title={rep>0?'Broad jump · Recorded result':result?'Recorded result':'Broad jump — guided capture'}/>
 <div style={{position:'absolute',left:result?330:96,top:result?258:278,width:result?1260:1175,opacity:1-rep}}>
 <Label style={{fontSize:18,color:C.lime,marginBottom:17}}>ORIGINAL PHONE RECORDING</Label>
 <div style={{padding:13,border:'2px solid #567461',background:'#010a06',borderRadius:26}}><OffthreadVideo src={staticFile('product/screen-demo.mp4')} muted style={{display:'block',width:'100%',borderRadius:16}}/></div></div>
 {!result&&<div style={{position:'absolute',left:1378,top:245,width:365}}><Label style={{fontSize:18,color:C.lime,marginBottom:16}}>{shot?'JUMP EXCERPT · 1×':'FIELD RECORDING · SETUP'}</Label><div style={{position:'relative',width:365,height:649,borderRadius:18,overflow:'hidden',border:`1px solid ${C.line}`,background:C.bg}}>
 <Sequence durationInFrames={300} layout="none"><OffthreadVideo src={staticFile('investor-exact/field-readiness.mp4')} muted style={{width:365,height:649,objectFit:'contain'}}/></Sequence>
 <Sequence from={300} durationInFrames={270} layout="none"><OffthreadVideo src={staticFile('investor-exact/field-jump.mp4')} muted style={{width:365,height:649,objectFit:'contain'}}/></Sequence>
 {frame>=300&&frame<309&&<div style={{position:'absolute',inset:0,background:C.bg,clipPath:`inset(0 ${ease(frame,300,309)*100}% 0 0)`}}/>}</div></div>}
 {rep>0&&<div style={{position:'absolute',left:96,top:235,opacity:rep,transform:`translateY(${(1-rep)*18}px)`}}><ExactBroadJumpV2 frame={frame>=735?132+frame-735:Math.max(0,frame-629)}/></div>}
 <Label style={{position:'absolute',left:result?330:96,top:929,fontSize:18,opacity:1-rep}}>Original app audio · {result?'Processing wait shortened':shot?'Jump excerpt timed to the original countdown · 1×':'Setup excerpt · Complete movement follows at 1×'}</Label>
 {caption&&<div style={{position:'absolute',left:120,right:120,top:975,textAlign:'center',fontSize:29}}>{caption.text}</div>}</>;
}
function SixTests({frame}:{frame:number}){
 if(frame<60)return <><Heading label="03 / MOVEMENT CAPTURE" title="On-device movement analysis"/><Panel><ExactBroadJumpV2 frame={200} sourceFrame={299} paused/></Panel></>;
 const testFrame=frame-60,boxes=ease(testFrame,120,144),expand=ease(frame,204,218);
 return <><Heading label="03 / MOVEMENT CAPTURE" title="Six tests"/><div style={{position:'absolute',left:96,right:96,top:243,display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:22,opacity:1-expand}}>{['Sprint','Vertical jump','Broad jump','Dribbling','Change of direction','Shooting'].map((name,i)=><div key={name} style={{height:315,position:'relative',overflow:'hidden',borderRadius:14,background:`rgba(10,33,26,${boxes})`,transform:frame>=204&&i===0?`scale(${1+ease(frame,204,219)*.03})`:'none'}}>
 <div style={{position:'absolute',left:48,top:-7}}><ProductMovementPreview index={i} f={testFrame}/></div><svg width="100%" height="100%" viewBox="0 0 561 315" style={{position:'absolute',inset:0}}><rect x="1" y="1" width="559" height="313" rx="13" fill="none" stroke={C.line} strokeWidth="2" pathLength="1" strokeDasharray="1" strokeDashoffset={1-boxes}/></svg>
 <div style={{position:'absolute',left:25,bottom:18,fontSize:28,fontWeight:600}}><span style={{fontFamily:mono,fontSize:17,color:C.lime,marginRight:20}}>0{i+1}</span>{name}</div></div>)}</div>{frame>=204&&<div style={{position:'absolute',left:96,top:287-52*expand,transform:`scale(${561/1728+(1-561/1728)*expand})`,transformOrigin:'0 0',opacity:expand}}><ExactSprintV2 frame={0}/></div>}</>;
}
const planFrame=(f:number)=>f<30?45:f<48?109:f<68?138:f<110?165+(f-68)*1.74:f<122?238:f<180?285+(f-122)*2.35:425+(f-180);
function Identity({frame}:{frame:number}){return <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',opacity:1-ease(frame,33,39)}}><ExactBrand large/><div style={{fontFamily:mono,fontSize:25,color:C.muted,marginTop:35,letterSpacing:3}}>posetek.net</div></div>;}
export const InvestorExactFilmV2:React.FC<Props>=({audioEnabled=false,captions=[]})=>{
 const f=useCurrentFrame(),caption=captions.find(c=>f/30>=c.start&&f/30<c.end),demo=f>=645&&f<1395;
 const visual=(id:string,frame:number):React.ReactNode=>{
  switch(id){
   case 'opening':return <Opening frame={frame}/>;
   case 'setup':return <Setup frame={frame}/>;
   case 'original-demo':return <Demo frame={frame}/>;
   case 'six-tests':return <SixTests frame={frame}/>;
   case 'sprint':return <><Heading label="04 / PERFORMANCE COMPARISON" title="Example player and D1 reference"/><Panel><ExactSprintV2 frame={frame}/></Panel></>;
   case 'profile':return <><Heading label="05 / PROFILE AND PLANNING" title="The skill map and its supporting results"/><Panel><ExactPlayerProfileV2 frame={frame}/></Panel></>;
   case 'planning':return <><Heading label="05 / PROFILE AND PLANNING" title="Selected focus → personalized training plan"/><Panel><ExactPlanBuilderV2 frame={planFrame(frame)}/></Panel></>;
   case 'training':return <><Heading label="06 / GUIDED TRAINING" title="Guided workout session"/><Panel><ExactGuidedWorkoutV2 frame={frame}/></Panel></>;
   case 'technique':return <><Heading label="07 / TECHNIQUE OBSERVATION" title="AI Kick Analysis"/><Panel><ExactTechniqueV2 frame={frame}/></Panel></>;
   case 'retest':return <><Heading label="08 / RETESTING" title="Reassessment and the next training focus"/><Panel><ExactProgressReviewV2 frame={frame*1.8}/></Panel></>;
   case 'closing-passage':case 'platform':return <Platform frame={frame}/>;
   case 'two-kick-review':{const u=ease(frame,120,134);return <><div style={{opacity:u}}><Platform frame={0}/></div><div style={{opacity:1-u}}><Heading label="RECORDED TWO-KICK REVIEW" title="Two kicks from the same example player"/></div><div style={{position:'absolute',left:96+(787-96)*u,top:235+(348-235)*u,transform:`scale(${1-(1-340/1728)*u})`,transformOrigin:'0 0',opacity:1-u*.8}}><ExactKickReviewV2 frame={frame}/></div></>;}
   case 'identity':return <Identity frame={frame}/>;
   default:throw Error('Unknown V2 scene '+id);
  }
 };
 return <AbsoluteFill style={{background:C.bg,color:C.ink,fontFamily:'Inter,sans-serif',overflow:'hidden'}}><Fonts/>
 {timing.scenes.map(s=><Sequence key={s.id} from={s.start} durationInFrames={s.end-s.start+15}><SceneTime at={s.start} duration={s.end-s.start} kind={['setup','original-demo','six-tests'].includes(s.id)?'phone':['sprint','profile','planning'].includes(s.id)?'evidence':['platform','identity'].includes(s.id)?'resolve':'panel'}>{frame=>visual(s.id,frame)}</SceneTime></Sequence>)}
 {f<3531&&<div style={{position:'absolute',left:96,right:96,top:51,display:'flex',alignItems:'center',justifyContent:'space-between'}}><ExactBrand/><Label style={{fontSize:16,letterSpacing:1}}>INVESTOR PRESENTATION · V2 TIMED PROOF</Label></div>}
 {caption&&!demo&&<div style={{position:'absolute',left:120,right:120,top:962,minHeight:66,display:'flex',alignItems:'center',justifyContent:'center',textAlign:'center',fontSize:29,lineHeight:1.3,padding:'7px 22px',boxSizing:'border-box',background:'#04130ef8',borderRadius:10}}>{caption.text}</div>}
 {audioEnabled&&<><Audio src={staticFile('audio-investor-exact-v2/master.wav')}/><Sequence from={645} durationInFrames={750}><Audio src={staticFile('product/demo-audio.wav')}/></Sequence></>}
 </AbsoluteFill>;
};
