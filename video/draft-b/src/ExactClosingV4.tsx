import React,{useEffect,useMemo,useState} from 'react';
import {cancelRender,continueRender,delayRender,Freeze,OffthreadVideo,staticFile} from 'remotion';
import timing from './investor-exact-v4-timing.json';
import {Heading,Label} from './InvestorExactFilm';
import {ExactPlayerProfileV3,ExactPlanBuilderV3,ExactGuidedWorkoutV3} from './ExactScreensV3';

// Reference lock: approved V3 layout, saved PoseTek evidence and V4 storyboard.
// Cards move continuously; recorded joint positions never morph.
const C={bg:'#04130e',panel:'#0a211a',lime:'#b7f34a',ink:'#f0f5ed',muted:'#a9bdb1',line:'#254036'};
const mono='"IBM Plex Mono",monospace',head='"Barlow Condensed",sans-serif';
const clamp=(v:number,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ease=(f:number,a:number,b:number)=>{const u=clamp((f-a)/(b-a));return u*u*(3-2*u);};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
type Point=[number,number,number]|null;
type Jump={frames:(Point[]|null)[];geometry:{width:number;height:number;bounds:{minX:number;maxX:number;minY:number;maxY:number}};guides:{landingX:number;takeoffX:number;groundY:number}};
const EDGES=[[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],[12,14],[14,16],[16,18],[16,20],[16,22],[18,20],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32],[0,7],[0,8],[7,11],[8,12]];
const valid=(p:Point):p is Exclude<Point,null>=>Boolean(p&&p.every(Number.isFinite)&&p[2]>=.1&&p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1);
let promise:Promise<Jump>|null=null;
function useJump(){
 const [data,setData]=useState<Jump|null>(null),[handle]=useState(()=>delayRender('V4 recorded broad-jump replay'));
 useEffect(()=>{let alive=true;promise??=fetch(staticFile('investor-exact-v2/broadjump.json')).then(r=>{if(!r.ok)throw Error('Missing saved jump');return r.json();});
 promise.then(d=>{if(alive)setData(d);continueRender(handle);}).catch(cancelRender);return()=>{alive=false;};},[handle]);return data;
}
export function closingJumpStateV4(frame:number){
 const t=timing.closing,local=Math.max(0,Math.min(t.duration_frames-1,frame))%t.pose_replay_frames;
 const reset=t.pose_replay_frames-t.pose_reset_frames,half=t.pose_reset_frames/2;
 const resetting=local>=reset,after=local>=reset+half;
 return {sourceFrame:after?t.pose_source_start:Math.min(t.pose_source_end,t.pose_source_start+local*t.pose_source_fps/timing.fps),
  opacity:!resetting?1:after?ease(local,reset+half,t.pose_replay_frames-1):1-ease(local,reset,reset+half),resetting};
}
function JumpReplay({frame}:{frame:number}){
 const data=useJump(),s=closingJumpStateV4(frame);
 const project=useMemo(()=>{if(!data)return null;const b=data.geometry.bounds,a=data.geometry.width/data.geometry.height;
  const scale=Math.min(278/((b.maxX-b.minX)*a),207/(b.maxY-b.minY)),mir=data.guides.landingX<data.guides.takeoffX;
  const x=31+(278-(b.maxX-b.minX)*a*scale)/2,y=46+(207-(b.maxY-b.minY)*scale)/2;
  return (p:number[])=>[x+(mir?b.maxX-p[0]:p[0]-b.minX)*a*scale,y+(p[1]-b.minY)*scale];
 },[data]);
 if(!data||!project)return null;
 const points=data.frames[Math.round(s.sourceFrame)],ground=project([data.guides.takeoffX,data.guides.groundY])[1];
 return <svg width="340" height="290" style={{display:'block'}}>
  <text x="23" y="27" fill={C.muted} fontFamily={mono} fontSize="12">BROAD JUMP · RECORDED REPLAY</text>
  <line x1="25" x2="315" y1={ground} y2={ground} stroke={C.line} strokeWidth="2"/>
  <g opacity={s.opacity}>{points&&EDGES.map(([a,b])=>{const p=points[a],q=points[b];if(!valid(p)||!valid(q))return null;const[x,y]=project(p),[u,v]=project(q);return <line key={a+'-'+b} x1={x} y1={y} x2={u} y2={v} stroke={C.lime} strokeWidth={a<11?1.1:2.8} strokeLinecap="round"/>;})}
  {points?.map((p,i)=>{if(!valid(p))return null;const[x,y]=project(p);return <circle key={i} cx={x} cy={y} r={i<11?1:1.9} fill={C.ink}/>;})}</g>
  <text x="25" y="279" fill={C.lime} fontFamily={mono} fontSize="20">4.8 ft</text><text x="315" y="279" textAnchor="end" fill={C.muted} fontFamily={mono} fontSize="13">1× · SAME REP</text>
 </svg>;
}
export function ClosingPhoneV4({frame}:{frame:number}){
 const source=timing.closing.phone_source_start+clamp(frame,0,timing.closing.duration_frames-1);
 return <div style={{width:610,padding:13,border:'2px solid #6b8475',borderRadius:27,background:'#020b07',boxSizing:'border-box',boxShadow:'0 22px 80px #0006'}}>
  <Freeze frame={source}><OffthreadVideo src={staticFile('product/screen-demo.mp4')} muted style={{display:'block',width:'100%',borderRadius:13}}/></Freeze>
 </div>;
}
function LiveWorkspace({frame}:{frame:number}){
 const t=timing.closing,a=ease(frame,t.platform_plan[0],t.platform_plan[0]+t.internal_transition_frames),b=ease(frame,t.platform_guided[0],t.platform_guided[0]+t.internal_transition_frames);
 const layers=[1-a,a*(1-b),b],states=[<ExactPlayerProfileV3 frame={Math.min(100,frame*2.6)}/>,<ExactPlanBuilderV3 frame={132+clamp(frame-45,0,65)}/>,<ExactGuidedWorkoutV3 frame={Math.max(0,frame-115)}/>];
 const details=[
  ['SELECTED FOCUS','Ball Control','Dribbling shuttle','7.48 s'],
  ['EXAMPLE WORKOUT · SAVED','Close control & passing','Figure-8 dribble → Wall pass rhythm',''],
  ['GUIDED SESSION · EXAMPLE','Figure-8 dribble','4:'+String(18+Math.floor(Math.max(0,frame-115)/30)).padStart(2,'0'),'Next: Wall pass rhythm']
 ];
 return <div style={{width:604,height:490,background:C.panel,borderRadius:19,boxShadow:'inset 0 0 0 1px '+C.line,overflow:'hidden'}}>
  <div style={{height:245,position:'relative',background:C.panel}}>{states.map((child,i)=><div key={i} style={{position:'absolute',inset:0,opacity:layers[i],transform:'scale(.349537)',transformOrigin:'0 0'}}>{child}</div>)}</div>
  <div style={{height:179,position:'relative',borderTop:'1px solid '+C.line}}>{details.map((d,i)=><div key={i} style={{position:'absolute',inset:0,padding:'24px 28px',opacity:layers[i],transform:'translateY('+((1-layers[i])*8)+'px)'}}><div style={{fontSize:16,color:C.muted,fontFamily:mono}}>{d[0]}</div><div style={{fontSize:30,fontWeight:650,marginTop:12,color:C.lime}}>{d[1]}</div><div style={{fontSize:20,marginTop:14}}>{d[2]}<span style={{color:i===0?C.lime:C.muted,float:'right',fontSize:18}}>{d[3]}</span></div></div>)}</div>
  <div style={{height:66,padding:'18px 28px',boxSizing:'border-box',display:'flex',alignItems:'center',gap:18,borderTop:'1px solid '+C.line}}>{['Profile','Plan','Train'].map((n,i)=><React.Fragment key={n}><span style={{fontFamily:mono,fontSize:15,color:layers[i]>.5?C.lime:C.muted}}>{n}</span>{i<2&&<span style={{color:C.line}}>→</span>}</React.Fragment>)}</div>
 </div>;
}
export function ExactDynamicPlatformV4({frame,hidePhone=false}:{frame:number;hidePhone?:boolean}){
 const f=clamp(frame,0,179);
 return <>
  <Heading label="09 / CONNECTED PLATFORM" title="Testing, training and coaching assistance"/>
  <svg width="1920" height="1080" style={{position:'absolute',inset:0}}><path d="M716 548H787M1127 548H1220" fill="none" stroke={C.line} strokeWidth="2"/>
   {[0,1].map(i=>{const age=(f+i*20)%60;return <circle key={i} cx={mix(i?1136:724,i?1210:778,ease(age,0,59))} cy="548" r="4" fill={C.lime} opacity={Math.sin(Math.PI*age/60)**2}/>;})}</svg>
  {!hidePhone&&<div style={{position:'absolute',left:96,top:396}}><ClosingPhoneV4 frame={f}/><Label style={{marginTop:26,textAlign:'center'}}>Smartphone</Label></div>}
  <div style={{position:'absolute',left:787,top:348,width:340,height:365,borderRadius:19,border:'1px solid '+C.line,background:C.panel,overflow:'hidden'}}><JumpReplay frame={f}/><div style={{padding:'11px 25px',fontSize:23,color:C.lime}}>Captured movement</div></div>
  <div style={{position:'absolute',left:1220,top:289}}><LiveWorkspace frame={f}/><Label style={{marginTop:24,textAlign:'center'}}>Connected platform</Label></div>
  <Label style={{position:'absolute',left:96,top:879,fontSize:18}}>Recorded app and pose examples · Reconstructed product views · Illustrative workout</Label>
 </>;
}
const STAGES=['Test','Data','Plan','Retest'],TESTS=['Sprint','Vertical jump','Broad jump','Dribbling','Change of direction','Shooting'];
const CardEyebrow=({children}:{children:React.ReactNode})=><div style={{fontFamily:mono,fontSize:18,color:C.muted,letterSpacing:1}}>{children}</div>;
function CycleContent({stage}:{stage:number}){
 if(stage===0||stage===3)return <div style={{display:'flex',gap:60,padding:'40px 48px',alignItems:'center',height:'100%',boxSizing:'border-box'}}>
  <div style={{width:440,flexShrink:0}}><CardEyebrow>{stage===0?'ASSESSMENT':'NEXT ASSESSMENT · PENDING'}</CardEyebrow><div style={{fontFamily:head,fontSize:62,fontWeight:600,lineHeight:1.05,marginTop:22}}>{stage===0?'Test the player.':'Return to the test.'}</div><div style={{fontSize:24,color:C.muted,lineHeight:1.4,marginTop:20}}>{stage===0?'Six tests. A recorded starting point.':'Same setup. New evidence when recorded.'}</div></div>
  <div style={{display:'grid',gridTemplateColumns:'repeat(2,1fr)',gap:12,flex:1}}>{TESTS.map((n,i)=><div key={n} style={{border:'1px solid '+(i===3?C.lime:C.line),padding:'17px 18px',borderRadius:9,display:'flex',alignItems:'center',gap:15,fontSize:22,background:i===3?'#173222':C.bg}}><span style={{fontFamily:mono,color:C.lime,fontSize:16}}>0{i+1}</span>{n}</div>)}</div>
 </div>;
 if(stage===1)return <div style={{display:'flex',gap:70,padding:'38px 48px',alignItems:'center',height:'100%',boxSizing:'border-box'}}>
  <div style={{width:470}}><CardEyebrow>RECORDED PROFILE</CardEyebrow><div style={{fontFamily:head,fontSize:68,fontWeight:600,marginTop:12}}>Ball Control</div><div style={{fontSize:24,color:C.muted,marginTop:13}}>Selected training focus</div><div style={{marginTop:25,display:'flex',gap:10}}>{['Power','Speed','Agility','Ball Control','Striking'].map(n=><div key={n} style={{width:n==='Ball Control'?115:60,height:5,borderRadius:3,background:n==='Ball Control'?C.lime:C.line}}/>)}</div></div>
  <div style={{flex:1,borderLeft:'1px solid '+C.line,paddingLeft:60}}><CardEyebrow>DRIBBLING SHUTTLE</CardEyebrow><div style={{fontFamily:head,fontSize:108,lineHeight:1.1,color:C.lime,fontWeight:600,marginTop:12}}>7.48 <span style={{fontFamily:mono,fontSize:31,color:C.muted}}>s</span></div><div style={{fontSize:20,color:C.muted,marginTop:12}}>Recorded baseline · September 2</div></div>
 </div>;
 return <div style={{display:'flex',gap:50,padding:'35px 48px',alignItems:'center',height:'100%',boxSizing:'border-box'}}>
  <div style={{width:465,flexShrink:0}}><CardEyebrow>EXAMPLE PLAN</CardEyebrow><div style={{fontFamily:head,fontSize:58,fontWeight:600,lineHeight:1.05,marginTop:20}}>Close control<br/>& passing</div><div style={{fontSize:23,color:C.muted,marginTop:20}}>Selected focus → specific drills</div></div>
  <div style={{flex:1}}>{['Figure-8 dribble','Wall pass rhythm'].map((n,i)=><div key={n} style={{display:'flex',alignItems:'center',gap:24,padding:'25px 0',borderBottom:'1px solid '+C.line}}><span style={{fontFamily:mono,fontSize:23,color:C.lime}}>0{i+1}</span><div><div style={{fontSize:30,fontWeight:600}}>{n}</div><div style={{fontFamily:mono,fontSize:17,color:C.muted,marginTop:10}}>3 × 60 sec · 30 sec rest</div></div></div>)}</div>
 </div>;
}
export function ExactConnectedCycleV4({frame}:{frame:number}){
 const t=timing.cycle,entry=ease(frame,0,t.entry_frames),ending=ease(frame,t.duration_frames,t.duration_frames+12);
 const stages=[t.test,t.data,t.plan,t.retest],progress=stages.map(([a],i)=>i===0?1:ease(frame,a,a+t.transition_frames));
 const weights=progress.map((p,i)=>ease(p,.5,1)*(1-ease(progress[i+1]??0,0,.5))),xs=[360,760,1160,1560];
 const localStage=frame<t.data[0]?0:frame<t.plan[0]?1:frame<t.retest[0]?2:3;
 const nextX=localStage===0?360:mix(xs[localStage-1],xs[localStage],ease(frame,stages[localStage][0],stages[localStage][0]+12));
 const cardX=mix(96,260,entry),cardY=mix(396,440,entry),cardW=mix(610,1400,entry),cardH=mix(298.25,376,entry),fade=1-ending;
 return <>
  {entry<1&&<div style={{position:'absolute',inset:0,opacity:1-ease(entry,0,.6),clipPath:'inset(235px 0 0 0)'}}><ExactDynamicPlatformV4 frame={179} hidePhone/></div>}
  <div style={{position:'absolute',inset:0,opacity:(1-ease(entry,0,.45))*fade}}><Heading label="09 / CONNECTED PLATFORM" title="Testing, training and coaching assistance"/></div>
  <div style={{position:'absolute',inset:0,opacity:ease(entry,.55,1)*fade}}><Heading label="THE DEVELOPMENT CYCLE" title="Test → Data → Plan → Retest"/></div>
  <svg width="1920" height="1080" style={{position:'absolute',inset:0,opacity:ease(entry,.55,1)*fade}}>
   <path d="M360 349H1560M1560 349C1752 349 1780 851 1570 851H350C144 851 168 349 360 349" fill="none" stroke={C.line} strokeWidth="2"/>
   <path d="M360 349H1560M1560 349C1752 349 1780 851 1570 851H350C144 851 168 349 360 349" fill="none" stroke={C.lime} strokeWidth="2.5" pathLength="1" strokeDasharray="1" strokeDashoffset={1-ease(frame,0,t.duration_frames)} opacity=".55"/>
   {xs.map((x,i)=><g key={x}><circle cx={x} cy="349" r="8" fill={weights[i]>.5?C.lime:C.panel} stroke={C.lime}/><text x={x} y="313" textAnchor="middle" fontFamily={mono} fontSize="25" fill={C.ink}>{STAGES[i]}</text></g>)}
   <circle cx={nextX} cy="349" r="15" fill="none" stroke={C.lime} strokeWidth="2" opacity=".65"/>
  </svg>
  <div style={{position:'absolute',left:cardX,top:cardY,width:cardW,height:cardH,background:C.panel,border:'1px solid '+C.line,borderRadius:mix(27,20,entry),overflow:'hidden',opacity:fade,boxSizing:'border-box',transform:'translateY('+(-16*ending)+'px) scale('+(1-.03*ending)+')',transformOrigin:'center'}}>
   {entry<1&&<div style={{position:'absolute',inset:0,opacity:1-ease(entry,0,.5)}}><div style={{width:610,transform:'scale('+(cardW/610)+')',transformOrigin:'0 0'}}><ClosingPhoneV4 frame={179}/></div></div>}
   <div style={{position:'absolute',inset:0,opacity:ease(entry,.5,1),transform:'scale('+(cardW/1400)+')',transformOrigin:'0 0',width:1400,height:376}}>
    {weights.map((w,i)=>w>0&&<div key={i} style={{position:'absolute',inset:0,opacity:w,transform:'translateX('+((1-w)*14)+'px)'}}><CycleContent stage={i}/></div>)}
   </div>
  </div>
  <Label style={{position:'absolute',left:96,top:909,fontSize:18,opacity:ease(entry,.55,1)*fade}}>Recorded baseline → illustrative plan → next assessment pending</Label>
 </>;
}
