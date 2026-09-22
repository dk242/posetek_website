import React from 'react';
import {Freeze, OffthreadVideo, interpolate, Easing, staticFile} from 'remotion';
import recorded from '../../../app/src/pages/home/movement/recorded-movement.json';
import {POSE_EDGES} from '../../../app/src/pages/home/latest-hero/pose-model';
import {sampleTeams} from '../../../app/src/pages/coaches/coach-samples';

const C={bg:'#04130e',panel:'#0a211a',lime:'#b7f34a',ink:'#f0f5ed',muted:'#a9bdb1',line:'#254036',mint:'#c1f5e5'};
const mono='"IBM Plex Mono", monospace',head='"Barlow Condensed", sans-serif';
const p=(f:number,a:number,b:number)=>interpolate(f,[a,b],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.bezier(.18,.78,.22,1)});
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const title:React.CSSProperties={fontFamily:head,fontWeight:700,textTransform:'uppercase',lineHeight:.98,letterSpacing:'-.02em',margin:0};
const Eyebrow=({children}: {children:React.ReactNode})=><div style={{fontFamily:mono,fontSize:24,letterSpacing:2.2,color:C.lime,textTransform:'uppercase'}}>{children}</div>;
const Arrow=()=> <span style={{color:C.lime,fontSize:38}}>→</span>;
type Recording={key:string;frames:number[][][];fps?:number;sourceAspectRatio?:number;ball?:({x:number;y:number;radius?:number}|null)[]};
const recordings=recorded.sequences as Recording[];
const names=['Sprint','Vertical jump','Broad jump','Dribbling','Change of direction','Shooting'];
const keys=['sprint','jump','broadJump','dribbling','changeOfDirection','shooting'];
const edges=[...POSE_EDGES.filter(([a,b])=>a>=11&&b>=11),[0,7],[0,8],[7,11],[8,12]];
// Camera framing changes, source coordinates and source frame rates do not.
const fit=recordings.map(seq=>{
 const aspect=seq.sourceAspectRatio??recorded.sourceAspectRatio;
 const ys=seq.frames.flat().map(pt=>pt[1]);
 const widths=seq.frames.map(pts=>Math.max(...pts.map(pt=>pt[0]))-Math.min(...pts.map(pt=>pt[0])));
 return {aspect,minY:Math.min(...ys),maxY:Math.max(...ys),width:Math.max(...widths)*aspect};
});
export function MovementPreview({index,f}:{index:number;f:number}){
 const seq=recordings.find(s=>s.key===keys[index])!,bounds=fit[recordings.indexOf(seq)];
 const frame=Math.min(seq.frames.length-1,Math.max(0,Math.floor(f/30*(seq.fps??recorded.fps))));
 const points=seq.frames[frame];
 const scale=Math.min(378/Math.max(bounds.width,.01),252/(bounds.maxY-bounds.minY));
 const centerX=(points[23][0]+points[24][0])/2;
 const x=(v:number)=>224+(v-centerX)*bounds.aspect*scale;
 const y=(v:number)=>145+(v-(bounds.minY+bounds.maxY)/2)*scale;
 const ball=seq.ball?.[frame];
 return <svg width="448" height="284" viewBox="0 0 448 284" style={{overflow:'hidden'}}>
  <ellipse cx="224" cy="265" rx="138" ry="14" fill="#153623" opacity=".7"/>
  <line x1="30" x2="418" y1="266" y2="266" stroke={C.line}/>
  {edges.map(([a,b],i)=><line key={i} x1={x(points[a][0])} y1={y(points[a][1])} x2={x(points[b][0])} y2={y(points[b][1])} stroke={a%2?C.lime:C.mint} strokeWidth={a>16&&a<23?1.7:2.6} strokeLinecap="round"/>)}
  {points.map(([px,py],i)=><circle key={i} cx={x(px)} cy={y(py)} r={i<11?1.5:2.8} fill={C.lime}/>)}
  {ball&&<circle cx={x(ball.x)} cy={y(ball.y)} r={Math.max(4,(ball.radius??.012)*scale)} fill={C.ink}/>}
 </svg>;
}
export function EvidenceV2({f}:{f:number}){
 const boxes=p(f,138,164),arrive=p(f,7,22);
 return <>
  <div style={{position:'absolute',left:76,right:76,top:220}}><Eyebrow>01 / Assessment</Eyebrow><h2 style={{...title,fontSize:125,marginTop:30}}>Start with<br/><span style={{color:C.lime}}>evidence.</span></h2></div>
  <div style={{position:'absolute',left:76,right:76,top:535,display:'grid',gridTemplateColumns:'1fr 1fr',gap:24,opacity:arrive}}>
   {names.map((name,i)=><div key={name} style={{height:330,position:'relative',overflow:'hidden',borderRadius:16,background:`rgba(10,33,26,${boxes})`,transform:`translateY(${(1-arrive)*(i%2?32:50)}px)`}}>
    <div style={{position:'absolute',inset:0}}><MovementPreview index={i} f={Math.max(0,f-18)}/></div>
    <svg width="100%" height="100%" viewBox="0 0 452 330" style={{position:'absolute',inset:0}}><rect x="1" y="1" width="450" height="328" rx="15" fill="none" stroke={C.line} strokeWidth="2" pathLength="1" strokeDasharray="1" strokeDashoffset={1-boxes}/></svg>
    <div style={{position:'absolute',left:22,right:22,bottom:19,display:'flex',alignItems:'center',gap:14}}><span style={{fontFamily:mono,fontSize:19,color:C.lime}}>0{i+1}</span><span style={{fontSize:name.length>16?29:33,fontWeight:600}}>{name}</span></div>
   </div>)}
  </div>
  <div style={{position:'absolute',left:80,top:1630,fontFamily:mono,fontSize:21,color:C.muted}}>Six tests · Recorded movement · One connected view</div>
 </>;
}

const coverage=[[6,4,6],[6,6,3],[6,6,2]];
const all=sampleTeams.flatMap(t=>t.players);
const totalWorkouts=all.reduce((n,player)=>n+player.completedSessions,0);
function Check({on=false}:{on?:boolean}){return <span style={{width:12,height:12,borderRadius:3,display:'inline-block',background:on?C.lime:C.line}}/>;}
export function ClubDashboard({team=false,highlight=false}:{team?:boolean;highlight?:boolean}){
 const totals=team?[3,2,sampleTeams[0].players.reduce((n,v)=>n+v.completedSessions,0)]:[all.length,coverage.flat().filter(x=>x===6).length,totalWorkouts];
 return <div style={{position:'relative',height:945,padding:34,border:`1px solid ${C.line}`,borderRadius:20,background:C.panel,boxSizing:'border-box'}}>
  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}><div><div style={{fontFamily:mono,fontSize:21,color:C.muted,marginBottom:8}}>CLUB OVERVIEW</div><div style={{fontSize:40,fontWeight:600}}>Northfield FC</div></div><div style={{fontFamily:mono,fontSize:21,color:C.lime}}>Last 8 weeks</div></div>
  <div style={{display:'flex',gap:12,marginTop:27}}>{['All teams','U13','U15','U17'].map((label,i)=><div key={label} style={{padding:'14px 26px',background:(team?i===1:i===0)?C.lime:'#123024',color:(team?i===1:i===0)?C.bg:C.muted,borderRadius:8,fontSize:25,fontWeight:600}}>{label}</div>)}</div>
  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1.15fr',gap:15,marginTop:26}}>{['Players','Fully tested','Workouts completed'].map((label,i)=><div key={label} style={{padding:'18px 20px',background:'#061b13',border:`1px solid ${C.line}`,borderRadius:10}}><div style={{fontSize:21,color:C.muted,whiteSpace:'nowrap'}}>{label}</div><div style={{fontFamily:head,fontSize:73,color:i===1?C.lime:C.ink,marginTop:5}}>{totals[i]}</div></div>)}</div>
  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',margin:'27px 0 12px',fontSize:23}}><span>Testing coverage</span><span style={{color:C.lime}}>{totals[1]} of {totals[0]} fully tested</span></div><div style={{height:9,background:C.line,borderRadius:6,overflow:'hidden'}}><div style={{height:'100%',width:`${totals[1]/totals[0]*100}%`,background:C.lime}}/></div>
  <div style={{display:'grid',gridTemplateColumns:'1fr 185px 135px',fontSize:21,color:C.muted,margin:'28px 16px 12px'}}><span>{team?'Player':'Team'}</span><span>{team?'Tests':'Fully tested'}</span><span>Workouts</span></div>
  {[0,1,2].map(i=>{
   const player=sampleTeams[0].players[i],selected=highlight&&i===0;
   return <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 185px 135px',alignItems:'center',height:112,marginBottom:12,padding:'0 16px',border:`1px solid ${selected?C.lime:C.line}`,background:selected?'#1a3926':'#0c281d',borderRadius:10}}>
    <div style={{display:'flex',alignItems:'center',gap:17}}><div style={{fontFamily:head,fontSize:35,color:C.lime,width:42}}>{team?String(player.number).padStart(2,'0'):sampleTeams[i].name}</div><div><div style={{fontSize:29,fontWeight:600}}>{team?player.name:sampleTeams[i].name+' team'}</div><div style={{fontSize:21,color:C.muted,marginTop:7}}>{team?player.position:'3 players'}</div></div></div>
    <div>{team?<><div style={{fontSize:25,marginBottom:8}}>{coverage[0][i]} / 6</div><div style={{display:'flex',gap:5}}>{[0,1,2,3,4,5].map(j=><Check key={j} on={j<coverage[0][i]}/>)}</div></>:<span style={{fontSize:29}}>{coverage[i].filter(x=>x===6).length} / 3</span>}</div>
    <span style={{fontFamily:head,fontSize:45,color:C.lime}}>{team?player.completedSessions:sampleTeams[i].players.reduce((n,v)=>n+v.completedSessions,0)}</span>
   </div>;
  })}
  <div style={{fontFamily:mono,fontSize:20,color:C.muted,marginTop:21}}>Illustrative club data · Testing and workout activity</div>
 </div>;
}
export function ClubV2({f}:{f:number}){
 const team=f>=156,expand=p(f,219,245),detail=p(f,242,262);
 const player=sampleTeams[0].players[0];
 return <>
  <div style={{position:'absolute',left:76,right:76,top:220}}><Eyebrow>02 / Team and player insights</Eyebrow><h2 style={{...title,fontSize:115,marginTop:31}}>{expand<.5?<>See your<br/><span style={{color:C.lime}}>whole club.</span></>:<>Understand<br/><span style={{color:C.lime}}>each player.</span></>}</h2><div style={{fontSize:28,color:C.muted,marginTop:20}}>{expand<.5?'Testing. Training. Every player.':'Northfield FC → U13 → Alex Rivera'}</div></div>
  <div style={{position:'absolute',left:76,right:76,top:620,opacity:1-expand,transform:`scale(${1-expand*.025})`}}><ClubDashboard team={team} highlight={f>197}/></div>
  {f>=219&&<div style={{position:'absolute',left:76,right:76,top:mix(1110,620,expand),height:mix(112,945,expand),border:`1px solid ${C.lime}`,borderRadius:mix(10,20,expand),background:C.panel,overflow:'hidden'}}>
   <div style={{display:'flex',alignItems:'center',gap:24,padding:32,borderBottom:`1px solid ${C.line}`}}><div style={{background:'#193b29',width:78,height:78,display:'grid',placeItems:'center',fontFamily:head,fontSize:54,color:C.lime}}>08</div><div><div style={{fontSize:42,fontWeight:600}}>Alex Rivera</div><div style={{fontSize:25,color:C.muted,marginTop:9}}>U13 · Midfielder</div></div><div style={{marginLeft:'auto'}}><Arrow/></div></div>
   <div style={{padding:38,opacity:detail,transform:`translateY(${(1-detail)*30}px)`}}><div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between'}}><Eyebrow>Player focus / Control</Eyebrow><div style={{fontFamily:head,fontSize:106,color:C.lime}}>58<span style={{fontFamily:mono,fontSize:25,color:C.muted}}> / 100</span></div></div><div style={{borderTop:`1px solid ${C.line}`,paddingTop:36,marginTop:18}}><h3 style={{...title,fontSize:94,lineHeight:1.06}}>Keep the ball<br/>close through<br/><span style={{color:C.lime}}>each turn.</span></h3></div><div style={{marginTop:42,padding:24,background:'#133323',borderRadius:10,display:'flex',alignItems:'center',justifyContent:'space-between'}}><div><div style={{fontFamily:mono,fontSize:21,color:C.muted}}>NEXT TRAINING FOCUS</div><div style={{fontSize:35,marginTop:12}}>Figure-8 dribble</div></div><Arrow/></div><div style={{fontSize:23,color:C.muted,marginTop:27}}>An individual priority, within the team picture.</div></div>
  </div>}
  <div style={{position:'absolute',left:80,top:1603,fontFamily:mono,fontSize:21,color:C.muted}}>Illustrative example</div>
 </>;
}

export function workoutVisualState(f:number){
 const next=f>=342,complete=f>=306;
 return {next,complete,setsDone:next?0:complete?3:2,currentSet:next?1:3,sessionSeconds:258+Math.max(0,Math.floor((f-126)/30)),drill:next?'Wall pass rhythm':'Figure-8 dribble',drillNumber:next?2:1};
}
const clock=(s:number)=>`${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
export function TrainingV2({f}:{f:number}){
 const s=workoutVisualState(f),controls=p(f,108,126),tap=p(f,299,306)*(1-p(f,308,319));
 return <>
  <div style={{position:'absolute',top:216,left:76,right:76}}><Eyebrow>03 / Guided sessions</Eyebrow><h2 style={{...title,fontSize:101,marginTop:27}}>Your next session.<br/><span style={{color:C.lime}}>Step by step.</span></h2></div>
  <div style={{position:'absolute',left:160,top:482,width:760,height:1165,borderRadius:44,background:'#071710',border:'3px solid #3c5145',boxShadow:'0 20px 70px #0007',overflow:'hidden'}}>
   <div style={{height:66,padding:'0 30px',display:'flex',alignItems:'center',justifyContent:'space-between',background:C.panel,fontSize:25}}><span style={{fontWeight:600}}>P / PoseTek</span><span style={{color:C.lime}}>Workout</span></div>
   <div style={{height:112,padding:'20px 28px',boxSizing:'border-box'}}><div style={{fontFamily:mono,fontSize:20,color:C.muted,display:'flex',justifyContent:'space-between'}}><span>ALEX RIVERA / U13</span><span>DRILL {s.drillNumber} OF 2</span></div><div style={{fontSize:39,fontWeight:600,marginTop:11}}>{s.drill}</div></div>
   <div style={{height:425,position:'relative',overflow:'hidden'}}><Freeze frame={s.next?Math.min(f-342,68):Math.min(f,358)}><OffthreadVideo src={staticFile(s.next?'wall-pass.mp4':'figure-8.mp4')} muted style={{width:'100%',height:'100%',objectFit:'cover',objectPosition:'50% 35%'}}/></Freeze><div style={{position:'absolute',inset:0,background:'linear-gradient(transparent 60%,#04130ebd)'}}/><div style={{position:'absolute',left:28,right:28,bottom:23,fontSize:28,fontWeight:600}}>{s.next?'First touch. Clean return pass.':'Small touches. Close control.'}</div></div>
   <div style={{padding:'18px 24px',opacity:controls,transform:`translateY(${(1-controls)*22}px)`}}>
    <div style={{padding:'20px 23px',height:153,boxSizing:'border-box',background:C.panel,border:`1px solid ${C.line}`,borderRadius:14,display:'flex',justifyContent:'space-between'}}>
     <div><div style={{fontFamily:mono,fontSize:22,color:C.muted}}>{s.complete&&!s.next?'ALL 3 SETS DONE':`SET ${s.currentSet} OF 3 · ${s.next?'45':'60'} SEC`}</div><div style={{display:'flex',gap:14,marginTop:20}}>{[1,2,3].map(n=><div key={n} style={{height:49,width:49,borderRadius:28,border:`1px solid ${n<=s.setsDone?C.lime:'#4a6357'}`,background:n<=s.setsDone?C.lime:'transparent',color:n<=s.setsDone?C.bg:C.muted,display:'grid',placeItems:'center',fontSize:26,fontWeight:600,transform:n===3?`scale(${1+tap*.12})`:undefined}}>{n<=s.setsDone?'✓':n}</div>)}</div></div>
     <div style={{textAlign:'right'}}><div style={{fontFamily:mono,fontSize:19,color:C.lime}}>{s.complete&&!s.next?'DRILL COMPLETE':'WORKING'}</div><div style={{fontSize:53,fontWeight:600,fontVariantNumeric:'tabular-nums',lineHeight:1.25}}>{clock(s.sessionSeconds)}</div><div style={{fontSize:20,color:C.muted}}>this session</div></div>
    </div>
    <div style={{height:91,marginTop:15,padding:'17px 22px',boxSizing:'border-box',background:'#122e21',borderRadius:12,display:'flex',alignItems:'center',gap:22}}><div style={{fontSize:31,color:C.lime}}>{s.next?'02':'→'}</div><div><div style={{fontFamily:mono,fontSize:18,color:C.muted}}>{s.next?'CURRENT DRILL':'UP NEXT · AFTER THIS DRILL'}</div><div style={{fontSize:29,marginTop:6}}>Wall pass rhythm</div></div></div>
    <div style={{marginTop:15,height:66,display:'flex',justifyContent:'center',alignItems:'center',background:C.lime,color:C.bg,borderRadius:11,fontWeight:600,fontSize:27,transform:`scale(${1-tap*.035})`}}>{s.complete&&!s.next?'Next drill →':`Complete set ${s.currentSet} of 3`}</div>
    <div style={{display:'flex',gap:9,marginTop:20}}>{[0,1].map(i=><div key={i} style={{height:5,flex:1,background:i===0&&s.complete?C.lime:i===s.drillNumber-1?C.ink:C.line,borderRadius:5}}/>)}</div>
   </div>
   {controls<1&&<div style={{position:'absolute',left:28,right:28,top:658,opacity:1-controls}}><div style={{fontFamily:mono,fontSize:22,color:C.lime}}>A CLEAR FOCUS</div><div style={{fontFamily:head,fontSize:71,lineHeight:1.07,marginTop:20,textTransform:'uppercase'}}>Keep the ball close<br/>through each turn.</div><div style={{fontSize:27,color:C.muted,marginTop:25}}>Watch. Set up. Train.</div></div>}
   <div style={{position:'absolute',bottom:21,left:27,right:27,fontFamily:mono,fontSize:18,color:C.muted,textAlign:'center'}}>PRODUCT PREVIEW · ILLUSTRATIVE SESSION</div>
  </div>
 </>;
}
export function ConnectedV2(){return <>
 <div style={{position:'absolute',left:76,right:76,top:220}}><Eyebrow>A shared view of development</Eyebrow><h2 style={{...title,fontSize:117,marginTop:31}}>Players train.<br/><span style={{color:C.lime}}>Coaches review.</span></h2></div>
 <div style={{position:'absolute',left:76,right:76,top:610}}><ClubDashboard team highlight/></div>
 <div style={{position:'absolute',left:80,top:1605,fontFamily:mono,fontSize:22,color:C.muted}}>One connected development cycle.</div>
 </>;}
