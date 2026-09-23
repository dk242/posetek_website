import React,{CSSProperties,useEffect,useState} from 'react';
import {AbsoluteFill,Audio,Sequence,Freeze,OffthreadVideo,continueRender,delayRender,cancelRender,interpolate,staticFile,useCurrentFrame} from 'remotion';
import {ProductMovementPreview} from './ProductPose';
import {ExactSetup} from './ExactSetup';
import {ExactSprint} from './ExactSprint';
import {ExactTechnique,ExactKickReview} from './ExactTechnique';
import {ExactPlayerProfile,ExactPlanBuilder,ExactGuidedWorkout,ExactProgressReview} from './ExactScreens';

export const EXACT_DURATION=5190;
export const EXACT_SCENES=[
 {id:'opening',start:0,end:420}, {id:'setup',start:420,end:750},
 {id:'original-demo',start:750,end:1500}, {id:'six-tests',start:1500,end:1770},
 {id:'sprint',start:1770,end:2130}, {id:'profile',start:2130,end:2610},
 {id:'training',start:2610,end:3360}, {id:'technique',start:3360,end:4200},
 {id:'retest',start:4200,end:4470}, {id:'closing-passage',start:4470,end:4740},
 {id:'two-kick-review',start:4740,end:4980}, {id:'platform',start:4980,end:5130},
 {id:'identity',start:5130,end:5190}
];
const C={bg:'#04130e',panel:'#0a211a',lime:'#b7f34a',ink:'#f0f5ed',muted:'#a9bdb1',line:'#254036',mint:'#c1f5e5'};
const mono='"IBM Plex Mono",monospace',head='"Barlow Condensed",sans-serif';
const ease=(f:number,a:number,b:number)=>interpolate(f,[a,b],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
type Cue={start:number;end:number;text:string};
type Props={audioEnabled?:boolean;captions?:Cue[]};
function Fonts(){const [handle]=useState(()=>delayRender('Load exact edition fonts'));useEffect(()=>{Promise.all([['Barlow Condensed','barlow-700.woff2','700'],['Inter','inter-400.woff2','400'],['Inter','inter-600.woff2','600'],['IBM Plex Mono','plex-400.woff2','400']].map(async([name,file,weight])=>{const font=new FontFace(name,`url(${staticFile('fonts/'+file)})`,{weight});await font.load();(document.fonts as unknown as {add:(f:FontFace)=>void}).add(font);})).then(()=>continueRender(handle)).catch(cancelRender);},[handle]);return null;}
export function ExactBrand({large=false}:{large?:boolean}){return <div style={{display:'flex',alignItems:'center',gap:large?24:13,fontWeight:600,fontSize:large?77:27,letterSpacing:large?9:3}}><div style={{width:large?102:42,height:large?102:42,background:C.lime,color:C.bg,display:'grid',placeItems:'center',fontSize:large?76:31,borderRadius:3,position:'relative'}}>P<span style={{position:'absolute',right:-1,bottom:-1,width:large?21:10,height:large?21:10,background:C.bg}}/></div>POSETEK</div>;}
function Label({children,style={}}:{children:React.ReactNode;style?:CSSProperties}){return <div style={{fontFamily:mono,fontSize:20,color:C.muted,...style}}>{children}</div>;}
function Heading({label,title}:{label:string;title:string}){return <div style={{position:'absolute',left:96,right:96,top:122}}><Label style={{fontSize:17,color:C.lime,letterSpacing:2}}>{label}</Label><div style={{fontFamily:head,fontSize:62,fontWeight:700,lineHeight:1.06,marginTop:10}}>{title}</div></div>;}
function Panel({children}:{children:React.ReactNode}){return <div style={{position:'absolute',left:96,top:235,width:1728,height:700}}>{children}</div>;}
function Scene({at,duration,children}:{at:number;duration:number;children:(frame:number)=>React.ReactNode}){return <Sequence from={at} durationInFrames={duration}><SceneTime>{children}</SceneTime></Sequence>;}
function SceneTime({children}:{children:(f:number)=>React.ReactNode}){const f=useCurrentFrame();return <AbsoluteFill style={{background:C.bg}}>{children(f)}</AbsoluteFill>;}

function CapturePhone({frame,width=580}:{frame:number;width?:number}){return <div style={{width,padding:13,border:'2px solid #6b8475',borderRadius:27,background:'#020b07',boxShadow:'0 22px 80px #0006'}}><Freeze frame={Math.min(270,Math.max(0,frame))}><OffthreadVideo src={staticFile('product/screen-demo.mp4')} muted style={{display:'block',width:'100%',borderRadius:13}}/></Freeze></div>;}
function Platform({frame,opening=false,reveal=false}:{frame:number;opening?:boolean;reveal?:boolean}){
 const capture=opening?ease(frame,12,45):reveal?ease(frame,0,18):1,pose=opening?ease(frame,90,120):reveal?ease(frame,25,45):1,platform=opening?ease(frame,210,240):reveal?ease(frame,60,80):1;
 return <>
 <Heading label={opening?'01 / POSETEK':'09 / CONNECTED PLATFORM'} title={opening?'Smartphone capture. Movement analysis. Connected platform.':'Testing, training and coaching assistance'}/>
 <svg width="1920" height="1080" style={{position:'absolute',inset:0}}><path d="M716 548H821M1110 548H1217" fill="none" stroke={C.line} strokeWidth="2"/><circle cx={770+ease(frame%90,0,90)*36} cy="548" r="4" fill={C.lime} opacity={pose}/><circle cx={1160+ease(frame%90,0,90)*36} cy="548" r="4" fill={C.lime} opacity={platform}/></svg>
 <div style={{position:'absolute',left:96,top:396,opacity:capture}}><CapturePhone frame={frame%270}/><Label style={{marginTop:26,textAlign:'center'}}>Smartphone</Label></div>
 <div style={{position:'absolute',left:787,top:348,width:340,height:365,opacity:pose,borderRadius:19,border:`1px solid ${C.line}`,background:C.panel}}><div style={{transform:'scale(.76)',transformOrigin:'0 0',width:448,height:235}}><ProductMovementPreview index={2} f={Math.max(0,frame-90)%90}/></div><div style={{padding:'27px 26px 0',fontSize:23,color:C.lime}}>Captured movement</div><Label style={{padding:'15px 26px',fontSize:16}}>Computer vision</Label></div>
 <div style={{position:'absolute',left:1220,top:289,width:604,height:490,opacity:platform}}>
  <div style={{width:1728,height:700,transform:'scale(.35)',transformOrigin:'0 0',border:`3px solid ${C.line}`,borderRadius:22,overflow:'hidden'}}><ExactPlayerProfile frame={200}/></div>
  <div style={{position:'absolute',top:222,left:45,width:1728,height:700,transform:'scale(.3)',transformOrigin:'0 0',boxShadow:'0 30px 60px #0008',border:`3px solid ${C.line}`,borderRadius:22,overflow:'hidden'}}><ExactPlanBuilder frame={425}/></div>
  <Label style={{position:'absolute',top:463,width:604,textAlign:'center'}}>Connected platform</Label>
 </div>
 <Label style={{position:'absolute',left:96,top:879,fontSize:18}}>Recorded PoseTek movement · Reconstructed product views</Label>
 </>;
}
const nativeCues:Cue[]=[{start:1.3,end:2.6,text:'Person is in view.'},{start:4.82,end:7.7,text:'You are in position. Put your hands up when ready.'},{start:9.2,end:10.35,text:'Starting drill.'},{start:11.88,end:12.55,text:'3'},{start:12.94,end:13.6,text:'2'},{start:14.026,end:14.7,text:'1'},{start:19.9,end:20.95,text:'Processing complete.'},{start:21.42,end:23.25,text:'Your broad jump was 4.8 feet.'},{start:23.64,end:24.7,text:'Ready for next rep.'}];
export {nativeCues};
function PairedDemo({frame,audioEnabled}:{frame:number;audioEnabled:boolean}){
 const result=frame>=570,shot=frame>=300,cut=frame>=300&&frame<305,caption=nativeCues.find(c=>frame/30>=c.start&&frame/30<c.end);
 return <>
 <Heading label="03 / ORIGINAL APP DEMONSTRATION" title={result?'Recorded result':'Broad jump — guided capture'}/>
 <div style={{position:'absolute',left:result?330:96,top:result?258:278,width:result?1260:1175}}>
  <Label style={{fontSize:18,color:C.lime,marginBottom:17}}>ORIGINAL PHONE RECORDING</Label>
  <div style={{padding:13,border:'2px solid #567461',background:'#010a06',borderRadius:26}}><OffthreadVideo src={staticFile('product/screen-demo.mp4')} muted style={{display:'block',width:'100%',borderRadius:16}}/></div>
 </div>
 {!result&&<div style={{position:'absolute',left:1378,top:245,width:365}}>
  <Label style={{fontSize:18,color:C.lime,marginBottom:16}}>{shot?'JUMP EXCERPT · 1×':'FIELD RECORDING · SETUP'}</Label>
  <div style={{position:'relative',width:365,height:649,borderRadius:18,overflow:'hidden',border:`1px solid ${C.line}`,background:C.bg}}>
   <Sequence durationInFrames={300} layout="none"><OffthreadVideo src={staticFile('investor-exact/field-readiness.mp4')} muted style={{width:365,height:649,objectFit:'contain'}}/></Sequence>
   <Sequence from={300} durationInFrames={270} layout="none"><OffthreadVideo src={staticFile('investor-exact/field-jump.mp4')} muted style={{width:365,height:649,objectFit:'contain'}}/></Sequence>
   {cut&&<div style={{position:'absolute',inset:0,background:C.bg,opacity:1-(frame-300)/5}}/>}
  </div>
 </div>}
 <Label style={{position:'absolute',left:result?330:96,top:929,fontSize:18}}>Original app audio · {result?'Processing wait shortened':shot?'Jump excerpt timed to the original countdown · 1×':'Setup excerpt · Complete movement follows at 1×'}</Label>
 {caption&&<div style={{position:'absolute',left:120,right:120,top:975,textAlign:'center',fontSize:29}}>{caption.text}</div>}
 {audioEnabled&&<Audio src={staticFile('product/demo-audio.wav')}/>}
 </>;
}
function SixTests({frame}:{frame:number}){
 if(frame<90)return <><Heading label="03 / MOVEMENT CAPTURE" title="On-device processing"/><div style={{position:'absolute',left:330,top:270,width:1260,padding:13,border:'2px solid #567461',borderRadius:25,background:'#010a06'}}><OffthreadVideo src={staticFile('investor-exact/processing.mp4')} muted style={{display:'block',width:'100%',borderRadius:14}}/></div><Label style={{position:'absolute',left:330,top:929,fontSize:18}}>Recorded processing excerpt · Original phone interface</Label></>;
 const testFrame=frame-90,boxes=ease(testFrame,120,144);
 return <><Heading label="03 / MOVEMENT CAPTURE" title="Six tests"/><div style={{position:'absolute',left:96,right:96,top:243,display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:22}}>{['Sprint','Vertical jump','Broad jump','Dribbling','Change of direction','Shooting'].map((name,i)=><div key={name} style={{height:315,position:'relative',overflow:'hidden',borderRadius:14,background:`rgba(10,33,26,${boxes})`}}>
 <div style={{position:'absolute',left:48,top:-7}}><ProductMovementPreview index={i} f={testFrame}/></div>
 <svg width="100%" height="100%" viewBox="0 0 561 315" style={{position:'absolute',inset:0}}><rect x="1" y="1" width="559" height="313" rx="13" fill="none" stroke={C.line} strokeWidth="2" pathLength="1" strokeDasharray="1" strokeDashoffset={1-boxes}/></svg>
 <div style={{position:'absolute',left:25,bottom:18,fontSize:28,fontWeight:600}}><span style={{fontFamily:mono,fontSize:17,color:C.lime,marginRight:20}}>0{i+1}</span>{name}</div>
 </div>)}</div></>;
}
function Identity({frame}:{frame:number}){return <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',opacity:1-ease(frame,51,60)}}><ExactBrand large/><div style={{fontFamily:mono,fontSize:25,color:C.muted,marginTop:35,letterSpacing:3}}>posetek.net</div></div>;}

export const InvestorExactFilm:React.FC<Props>=({audioEnabled=false,captions=[]})=>{
 const f=useCurrentFrame();const caption=captions.find(c=>f/30>=c.start&&f/30<c.end);const demo=f>=750&&f<1500;
 return <AbsoluteFill style={{background:C.bg,color:C.ink,fontFamily:'Inter,sans-serif',overflow:'hidden'}}><Fonts/>
  <Scene at={0} duration={420}>{frame=><Platform frame={frame} opening/>}</Scene>
  <Scene at={420} duration={330}>{frame=><><Heading label="02 / CAPTURE WORKFLOW" title="Smartphone, custom marker and athlete"/><ExactSetup frame={frame}/></>}</Scene>
  <Scene at={750} duration={750}>{frame=><PairedDemo frame={frame} audioEnabled={audioEnabled}/>}</Scene>
  <Scene at={1500} duration={270}>{frame=><SixTests frame={frame}/>}</Scene>
  <Scene at={1770} duration={360}>{frame=><><Heading label="04 / PERFORMANCE COMPARISON" title="Example player and D1 reference"/><Panel><ExactSprint frame={frame}/></Panel></>}</Scene>
  <Scene at={2130} duration={480}>{frame=><><Heading label="05 / PROFILE AND PLANNING" title={frame<378?'The skill map and its supporting results':'Selected focus → personalized training plan'}/><Panel>{frame<378?<ExactPlayerProfile frame={frame}/>:<ExactPlanBuilder frame={45}/>}</Panel></>}</Scene>
  <Scene at={2610} duration={750}>{frame=><><Heading label="06 / GUIDED TRAINING" title={frame<360?'Workout request and generated plan':'Guided workout session'}/><Panel>{frame<360?<ExactPlanBuilder frame={frame<290?90+frame:380+(frame-290)*2}/>:<ExactGuidedWorkout frame={frame-360}/>}</Panel></>}</Scene>
  <Scene at={3360} duration={840}>{frame=><><Heading label="07 / TECHNIQUE OBSERVATION" title="AI Kick Analysis"/><Panel><ExactTechnique frame={frame}/></Panel></>}</Scene>
  <Scene at={4200} duration={270}>{frame=><><Heading label="08 / RETESTING" title="Reassessment and the next training focus"/><Panel><ExactProgressReview frame={frame*1.08}/></Panel></>}</Scene>
  <Scene at={4470} duration={270}>{frame=><Platform frame={frame}/>}</Scene>
  <Scene at={4740} duration={240}>{frame=><><Heading label="RECORDED TWO-KICK REVIEW" title="Two kicks from the same example player"/><Panel><ExactKickReview frame={frame}/></Panel></>}</Scene>
  <Scene at={4980} duration={150}>{frame=><Platform frame={frame} reveal/>}</Scene>
  <Scene at={5130} duration={60}>{frame=><Identity frame={frame}/>}</Scene>
  {f<5130&&<div style={{position:'absolute',left:96,right:96,top:51,display:'flex',alignItems:'center',justifyContent:'space-between'}}><ExactBrand/><Label style={{fontSize:16,letterSpacing:1}}>INVESTOR PRESENTATION · TIMED PROOF</Label></div>}
  {caption&&!demo&&<div style={{position:'absolute',left:120,right:120,top:962,minHeight:66,display:'flex',alignItems:'center',justifyContent:'center',textAlign:'center',fontSize:29,lineHeight:1.3,padding:'7px 22px',boxSizing:'border-box',background:'#04130ef8',borderRadius:10}}>{caption.text}</div>}
  {audioEnabled&&<Audio src={staticFile('audio-investor-exact-v1/master.wav')}/>}
 </AbsoluteFill>;
};
