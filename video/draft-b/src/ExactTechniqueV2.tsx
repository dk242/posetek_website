import React, {useEffect, useMemo, useState} from 'react';
import {cancelRender, continueRender, delayRender, staticFile} from 'remotion';

/** V2: 624-frame walkthrough and 135-frame static comparison excerpt.
 * Reference lock: current native KickWalkthroughPanel / controller semantics,
 * with the website's exact recorded sample and four forward-only stops.
 * Movie time may hold a cue; recorded coordinates never tween or morph.
 */
type Point = (number | null)[];
type Metric = {id:string;label:string;value:number;unit:string;reference:number|null;joints:number[]};
type Phase = {key:string;title:string;sourceFrame:number;index:number;metrics:Metric[];referencePose:Point[]|null};
type Focus = {title:string;cue:string;frameKey:string;joints:number[];metricIds:string[]};
type Technique = {fps:number;startFrame:number;step:number;frames:Point[][];ball:({x:number;y:number;radius:number}|null)[];phases:Phase[];focusAreas:Focus[]};
type Kick = {foot:'left'|'right';fps:number;width:number;height:number;startFrame:number;keyFrames:{backswing:number;contact:number;followThrough:number};frames:Point[][]};
type Source = {technique:Technique;comparison:{records:Kick[];observation:{title:string;cue:string;lookFor:string;left:number;right:number}}};
type Step = {phase:Phase;title:string;cue:string;joints:number[];metric:Metric;isSavedCue:boolean};
type Props = {frame:number};
const W=1728,H=700,PLOT=1048;
const C={bg:'#04130e',panel:'#0a211a',line:'#254036',ink:'#f0f5ed',muted:'#a9bdb1',lime:'#b7f34a',pro:'#8fdccc'};
const mono='"IBM Plex Mono",monospace';
const EDGES:number[][]=[[0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],[12,14],[14,16],[16,18],[16,20],[16,22],[18,20],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32]];
const valid=(p?:Point):p is number[]=>Boolean(p&&typeof p[0]==='number'&&typeof p[1]==='number'&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&(p[3]===undefined||p[3]===null||p[3]>=.1));
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const ease=(t:number)=>{const v=clamp(t,0,1);return v*v*(3-2*v);};
const format=(value:number,unit:string)=>`${new Intl.NumberFormat('en-US',{maximumFractionDigits:1}).format(value)}${unit==='°'?'°':' cm'}`;
let pending:Promise<Source>|null=null;
function useSource(){
  const [source,setSource]=useState<Source|null>(null);
  const [handle]=useState(()=>delayRender('Exact recorded technique sample'));
  useEffect(()=>{let alive=true;
    pending??=fetch(staticFile('investor-exact/technique.json')).then(response=>{if(!response.ok)throw new Error('Run prepare-exact-technique.mjs before rendering');return response.json();});
    pending.then(data=>{if(alive)setSource(data);continueRender(handle);}).catch(error=>cancelRender(error));
    return()=>{alive=false;};
  },[handle]);return source;
}

function referenceAligned(points:Point[],playerContact:Point[],referenceContact:Point[]):Point[]{
  // Exact website similarity transform: fixed contact plant anchor / torso scale.
  const midpoint=(p:Point[],a:number,b:number)=>[(Number(p[a][0])+Number(p[b][0]))/2*16/9,(Number(p[a][1])+Number(p[b][1]))/2];
  const torso=(p:Point[])=>{const h=midpoint(p,23,24),s=midpoint(p,11,12);return Math.hypot(h[0]-s[0],h[1]-s[1]);};
  const plant=(p:Point[])=>Number(p[27][1])>Number(p[28][1])?27:28;
  const pp=plant(playerContact),rp=plant(referenceContact),target=playerContact[pp],anchor=referenceContact[rp];
  const scale=torso(playerContact)/Math.max(.001,torso(referenceContact));
  const direction=(p:Point[],i:number)=>Number(p[i===27?28:27][0])-Number(p[i][0]);
  const mirror=direction(playerContact,pp)*direction(referenceContact,rp)<0?-1:1;
  return points.map(p=>[Number(target[0])+(Number(p[0])-Number(anchor[0]))*scale*mirror,Number(target[1])+(Number(p[1])-Number(anchor[1]))*scale]);
}
function projection(frames:Point[][],width:number,height:number,aspect=16/9){
  const points=frames.flat().filter(valid),xs=points.map(p=>p[0]*aspect),ys=points.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const scale=Math.min((width-116)/Math.max(.01,maxX-minX),(height-60)/Math.max(.01,maxY-minY));
  return {scale,point:(p:number[]):[number,number]=>[width/2+(p[0]*aspect-(minX+maxX)/2)*scale,height/2+(p[1]-(minY+maxY)/2)*scale]};
}
function Skeleton({points,project,highlight=[],color=C.lime,ghost=false}:{points:Point[];project:(p:number[])=>[number,number];highlight?:number[];color?:string;ghost?:boolean}){
  return <g opacity={ghost?.63:1}>
    {EDGES.map(([a,b])=>{if(!valid(points[a])||!valid(points[b]))return null;const p=project(points[a] as number[]),q=project(points[b] as number[]),lit=highlight.includes(a)&&highlight.includes(b),detail=a<11||(a>=15&&a<=22&&b>=15&&b<=22);return <line key={`${a}-${b}`} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={lit?C.ink:color} strokeWidth={lit?6:detail?1.7:3.4} strokeLinecap="round" strokeDasharray={ghost&&!detail?'8 5':undefined}/>;})}
    {points.map((p,i)=>{if(!valid(p))return null;const [x,y]=project(p),lit=highlight.includes(i);return <g key={i}>{lit&&<circle cx={x} cy={y} r="13" fill="none" stroke={C.lime} strokeWidth="2" opacity=".7"/>}<circle cx={x} cy={y} r={lit?5.4:i<11?1.7:3.1} fill={lit?C.ink:color}/></g>;})}
  </g>;
}
function buildSteps(data:Technique):Step[]{
  return data.phases.flatMap<Step>(phase=>{
    const focuses=data.focusAreas.filter(f=>f.frameKey===phase.key);
    return focuses.length?focuses.map(f=>({phase,title:f.title,cue:f.cue,joints:f.joints,
      metric:f.metricIds.map(id=>phase.metrics.find(metric=>metric.id===id)).find((metric):metric is Metric=>Boolean(metric))??phase.metrics[0],isSavedCue:true})):
      [{phase,title:phase.title,cue:phase.key==='backswing'?'Compare the kicking knee at the same phase before reviewing the saved improvement cues at contact.':'Review how the kicking leg finishes. No professional reference was captured for this phase.',joints:phase.metrics[0].joints,metric:phase.metrics[0],isSavedCue:false}];
  });
}

/** All values are local 30fps film frames. At 240fps source, sampled every two
 * frames, quarter speed advances exactly one sample per film frame. */
export const EXACT_TECHNIQUE_V2_FRAMES=624;
export const EXACT_KICK_REVIEW_V2_FRAMES=135;
export function exactTechniqueStateV2(frame:number){
  if(frame<18)return {index:0,step:0,mode:'ready' as const};
  if(frame<37)return {index:frame-18,step:0,mode:'approaching' as const};
  if(frame<166)return {index:19,step:0,mode:'paused' as const};
  if(frame<173)return {index:19+frame-166,step:1,mode:'approaching' as const};
  if(frame<308)return {index:26,step:1,mode:'paused' as const};
  // Same exact contact frame: update only the cue and highlighted joints.
  if(frame<440)return {index:26,step:2,mode:'paused' as const};
  if(frame<465)return {index:26+frame-440,step:3,mode:'approaching' as const};
  if(frame<594)return {index:51,step:3,mode:'paused' as const};
  return {index:51,step:3,mode:'finished' as const};
}
function Pointer({frame,at,x,y,lead=14,tail=13}:{frame:number;at:number;x:number;y:number;lead?:number;tail?:number}){
  const age=frame-at;if(age < -lead||age>tail)return null;
  const move=ease((age+lead)/Math.max(1,lead-2)),dx=(1-move)*58,dy=-(1-move)*24;
  return <svg width={W} height={H} style={{position:'absolute',inset:0,pointerEvents:'none'}}>
    {age>=0&&<circle cx={x} cy={y} r={10+age*2.2} fill="none" stroke={C.ink} opacity={1-age/14} strokeWidth="2"/>}
    <path d="M0 0L0 29L8 21L14 34L20 31L14 19L26 19Z" transform={`translate(${x+dx} ${y+dy})`} fill={C.ink} stroke={C.bg} strokeWidth="2"/>
  </svg>;
}
const outer:React.CSSProperties={width:W,height:H,position:'relative',fontFamily:'Inter,sans-serif',color:C.ink,background:C.panel,border:`1px solid ${C.line}`,borderRadius:20,overflow:'hidden',boxSizing:'border-box'};
function PhaseChip({children}:{children:React.ReactNode}){return <div style={{fontFamily:mono,fontSize:17,textTransform:'uppercase',letterSpacing:1.5,color:C.muted}}>{children}</div>;}

export const ExactTechniqueV2:React.FC<Props>=({frame})=>{
  const source=useSource();
  const prepared=useMemo(()=>{if(!source)return null;const d=source.technique,contact=d.phases.find(p=>p.key==='contact')!;
    const refs=Object.fromEntries(d.phases.filter(p=>p.referencePose).map(p=>[p.key,referenceAligned(p.referencePose!,d.frames[contact.index],contact.referencePose!)]));
    return {steps:buildSteps(d),refs,project:projection([...d.frames,...Object.values(refs)],PLOT,465)};
  },[source]);
  if(!source||!prepared)return null;
  const data=source.technique,state=exactTechniqueStateV2(frame),step=prepared.steps[state.step];
  const paused=state.mode==='paused',playing=state.mode==='approaching',finished=state.mode==='finished';
  const ref=paused?prepared.refs[step.phase.key]:null,ball=data.ball[state.index],sourceFrame=data.startFrame+state.index*data.step;
  const speedMenu=frame>=4&&frame<13,quarter=frame>=12;
  const controlX=PLOT+32,controlW=W-PLOT-64;
  const p=prepared.project.point,ballPoint=ball?p([ball.x,ball.y]):null;
  return <div style={outer}>
    <div style={{height:72,display:'flex',alignItems:'center',padding:'0 30px',borderBottom:`1px solid ${C.line}`,gap:15}}><span style={{color:C.muted,fontSize:27}}>‹</span><span style={{fontSize:24,fontWeight:650}}>Kick analysis</span><div style={{marginLeft:'auto',fontFamily:mono,fontSize:16,color:C.muted}}>RECORDED DATA · RECONSTRUCTED NATIVE CONTROLS</div></div>
    <div style={{position:'absolute',top:72,left:0,width:PLOT,height:562,borderRight:`1px solid ${C.line}`}}>
      <div style={{display:'flex',justifyContent:'space-between',padding:'20px 30px 0',fontFamily:mono,fontSize:16,color:C.muted}}><span>{paused?'PAUSED ON EVIDENCE':finished?'REVIEW COMPLETE':playing?'PLAYING':'PLAYBACK SETTINGS'}</span><span>FRAME {sourceFrame}</span></div>
      <svg width={PLOT} height="465" viewBox={`0 0 ${PLOT} 465`} style={{position:'absolute',top:52,left:0}}>
        <defs><pattern id="exact-technique-grid" width="56" height="56" patternUnits="userSpaceOnUse"><path d="M56 0H0V56" fill="none" stroke={C.line} strokeWidth=".65"/></pattern></defs>
        <rect x="24" y="0" width={PLOT-48} height="465" fill="url(#exact-technique-grid)" opacity=".42"/>
        {ref&&<Skeleton points={ref} project={p} color={C.pro} ghost/>}
        <Skeleton points={data.frames[state.index]} project={p} highlight={paused?step.joints:[]}/>
        {ballPoint&&ball&&<g><circle cx={ballPoint[0]} cy={ballPoint[1]} r={ball.radius*prepared.project.scale} fill={C.bg} stroke={C.ink} strokeWidth="2"/><path d={`M${ballPoint[0]-5} ${ballPoint[1]-4}h10l3 8-8 5-8-5z`} fill="none" stroke={C.muted}/></g>}
      </svg>
      <div style={{position:'absolute',left:32,bottom:5,display:'flex',gap:24,fontSize:17}}><span style={{color:C.lime}}>● Player</span>{ref&&<span style={{color:C.pro}}>● Pro reference · saved phase</span>}{paused&&!ref&&<span style={{color:C.muted}}>No reference captured for this phase</span>}</div>
    </div>
    <div style={{position:'absolute',left:PLOT,top:72,right:0,height:548}}>
      <div style={{padding:'24px 32px',display:'flex',alignItems:'center',gap:16,borderBottom:`1px solid ${C.line}`}}><div style={{width:39,height:39,background:C.lime,color:C.bg,borderRadius:'50%',display:'grid',placeItems:'center',fontSize:24}}>✦</div><div><div style={{fontSize:23,fontWeight:700}}>AI Kick Analysis</div><div style={{fontSize:17,color:C.muted,marginTop:5}}>Guided walkthrough</div></div><div style={{marginLeft:'auto',fontFamily:mono,fontSize:19,color:C.muted}}>{state.step+1} of 4</div></div>
      <div style={{padding:'28px 32px'}}>
        {finished?<div style={{paddingTop:70,textAlign:'center'}}><div style={{fontSize:46,color:C.lime}}>✓</div><div style={{fontSize:31,fontWeight:700,marginTop:20}}>Walkthrough complete</div><div style={{fontSize:23,lineHeight:1.45,color:C.muted,margin:'20px auto',maxWidth:470}}>Replay it, or return to the workspace.</div></div>:paused?<>
          <PhaseChip>{step.phase.title} · {step.isSavedCue?'saved cue':'phase review'}</PhaseChip>
          <div style={{fontSize:24,fontWeight:650,marginTop:18}}>{step.title}</div>
          <div style={{fontSize:31,lineHeight:1.26,fontWeight:700,color:C.lime,marginTop:17}}>{step.cue}</div>
          <div style={{marginTop:25,padding:'19px 21px',background:'#071a13',borderRadius:10,border:`1px solid ${C.line}`}}>
            <div style={{fontSize:17,color:C.muted,marginBottom:12}}>{step.metric.label}</div>
            <div style={{display:'flex',gap:35,fontFamily:mono,fontSize:23}}><span>Player <b>{format(step.metric.value,step.metric.unit)}</b></span>{step.metric.reference!==null&&<span style={{color:C.pro}}>Pro <b>{format(step.metric.reference,step.metric.unit)}</b></span>}</div>
          </div>
        </>:<div style={{paddingTop:80,textAlign:'center'}}><div style={{fontSize:40,color:C.muted}}>◉</div><div style={{fontSize:28,fontWeight:650,marginTop:20}}>{playing?'Watch…':'Playback speed'}</div><div style={{color:C.muted,fontSize:21,marginTop:15}}>{!playing&&quarter?'¼× selected before playback':''}</div></div>}
      </div>
    </div>
    <div style={{position:'absolute',left:30,top:627,width:PLOT-60,height:43,display:'flex',alignItems:'center',gap:25}}>
      <div style={{fontSize:26,width:26,color:C.ink}}>{playing?'Ⅱ':'▶'}</div>
      <div style={{position:'relative',width:79,padding:'8px 0',background:'#153128',borderRadius:7,textAlign:'center',fontFamily:'Inter,sans-serif',fontSize:20,fontWeight:600}}>{quarter?'¼×':'1×'} ▾
        {speedMenu&&<div style={{position:'absolute',bottom:51,left:-6,width:126,padding:6,background:'#173a2b',border:`1px solid #42614e`,borderRadius:10,boxShadow:'0 10px 35px #0008'}}>{['¼×','½×','1×'].map((rate,i)=><div key={rate} style={{padding:'9px 13px',textAlign:'left',background:frame>=9&&i===0?C.lime:'transparent',color:frame>=9&&i===0?C.bg:C.ink,borderRadius:6}}>{rate}{i===2&&frame<12?' ✓':''}</div>)}</div>}
      </div>
      <div style={{height:4,flex:1,background:C.line,position:'relative',borderRadius:3}}><div style={{height:4,width:`${state.index/(data.frames.length-1)*100}%`,background:C.lime,borderRadius:3}}/>{data.phases.map(phase=><span key={phase.key} style={{position:'absolute',left:`${phase.index/(data.frames.length-1)*100}%`,top:-4,width:2,height:12,background:C.muted}}/>)}</div><div style={{fontFamily:mono,fontSize:18,color:C.muted}}>{sourceFrame}</div>
    </div>
    {finished?<div style={{position:'absolute',left:controlX,top:610,width:controlW,display:'flex',gap:16}}>{['Replay','Done'].map((label,i)=><div key={label} style={{width:'50%',padding:'15px',fontSize:23,fontWeight:700,borderRadius:30,textAlign:'center',boxSizing:'border-box',background:i?C.lime:'transparent',border:`1px solid ${C.lime}`,color:i?C.bg:C.lime}}>{label}</div>)}</div>:<div style={{position:'absolute',left:controlX,top:610,width:controlW,padding:'15px',boxSizing:'border-box',borderRadius:30,textAlign:'center',fontSize:23,fontWeight:700,background:C.lime,color:C.bg,opacity:paused?1:.45}}>{state.step===3?'Finish':'Continue'}</div>}
    <Pointer frame={frame} at={11} x={109} y={507} lead={5} tail={1}/><Pointer frame={frame} at={17} x={40} y={648} lead={3} tail={4}/>
    {[165,307,439,593].map(at=><Pointer key={at} frame={frame} at={at} x={1397} y={638}/>)}
  </div>;
};

/** Visual coda: one recorded kick per physical foot, shown in original camera
 * directions. Separate stages avoid implying a new pro reference or a cohort.
 * Native neutral observation wording, with exact saved comparison values.
 */
export const ExactKickReviewV2:React.FC<Props>=({frame})=>{
  const source=useSource();
  const prepared=useMemo(()=>source?.comparison.records.map(record=>({record,project:projection(record.frames.slice(0,record.keyFrames.backswing-record.startFrame+1),780,405,record.width/record.height)})),[source]);
  if(!source||!prepared)return null;
  const paused=true,observation=source.comparison.observation;
  return <div style={outer}>
    <div style={{display:'flex',alignItems:'center',height:78,padding:'0 34px',borderBottom:`1px solid ${C.line}`}}><div style={{fontSize:25,fontWeight:700}}>Left/right comparison</div><div style={{fontSize:18,color:C.muted,marginLeft:25}}>Same athlete · one recorded kick per foot</div><div style={{marginLeft:'auto',fontFamily:mono,fontSize:17,color:C.muted}}>{paused?'PAUSED · BACKSWING':'¼× · APPROACHING BACKSWING'}</div></div>
    {prepared.map(({record,project},i)=>{
      const local=record.keyFrames.backswing-record.startFrame;
      const joints=paused?(record.foot==='left'?[24,26,28]:[23,25,27]):[];
      return <div key={record.foot} style={{position:'absolute',left:36+i*842,top:97,width:814,height:460,borderLeft:i?`1px solid ${C.line}`:undefined}}>
        <div style={{display:'flex',justifyContent:'space-between',margin:'0 25px',fontSize:21,color:i?C.pro:C.lime}}><b>{record.foot==='left'?'Left-foot kick':'Right-foot kick'}</b><span style={{fontFamily:mono,fontSize:16,color:C.muted}}>FRAME {record.startFrame+local}</span></div>
        <svg width="780" height="405" style={{display:'block',margin:'12px auto 0'}}><Skeleton points={record.frames[local]} project={project.point} highlight={joints} color={i?C.pro:C.lime}/></svg>
        {paused&&<div style={{position:'absolute',right:32,bottom:20,fontFamily:mono,fontSize:29,color:i?C.pro:C.lime}}>{(i?observation.right:observation.left).toFixed(1)}°<div style={{fontSize:15,color:C.muted,marginTop:7}}>STANDING KNEE</div></div>}
      </div>;
    })}
    <div style={{position:'absolute',left:36,right:36,top:560,borderTop:`1px solid ${C.line}`,padding:'23px 0 0',display:'flex',gap:45,alignItems:'center'}}>
      <div style={{width:254,flexShrink:0}}><PhaseChip>{paused?observation.title:'Guided comparison'}</PhaseChip><div style={{fontFamily:mono,fontSize:15,color:C.muted,marginTop:13}}>SAVED COMPARISON EXCERPT</div></div>
      <div style={{fontSize:29,lineHeight:1.3,fontWeight:600,maxWidth:1140,color:paused?C.lime:C.ink}}>{paused?observation.cue:'Watch…'}</div>
    </div>
  </div>;
};
