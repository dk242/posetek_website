import { useEffect, useId, useRef, useState } from "react";
import type { DemoFocus } from "./product-demo";

type Drill = { name:string; cues:readonly string[]; run:string; ball:string; cones:readonly number[][]; start:readonly number[]; end:readonly number[]; wall?:boolean; goal?:boolean };
export const diagrams: Record<string,Drill> = {
 "DRB-006": {name:"Figure-8 dribble",cues:["Place two cones 2–5 m apart. Start with the ball close.","Use short touches to trace a figure eight around both cones.","Return to the start. Repeat with your other foot."],run:"M90 145C35 145 35 75 90 75S270 185 270 115S205 60 175 110S125 145 90 145",ball:"M99 149C44 149 44 79 99 79S279 189 279 119S214 64 184 114S134 149 99 149",cones:[[75,110],[260,120]],start:[90,145],end:[90,145]},
 "DRB-009": {name:"Weak-foot gate circuit",cues:["Set three cone gates. Begin at the first gate with your weaker foot.","Carry the ball through each gate, changing direction between them.","Control the last touch. Turn and repeat the route."],run:"M55 165L105 110Q135 75 170 110L235 150L285 85",ball:"M64 169L114 114Q144 79 179 114L244 154L294 89",cones:[[93,94],[121,120],[225,134],[249,164],[272,70],[302,99]],start:[55,165],end:[285,85]},
 "PAS-001": {name:"Wall pass rhythm",cues:["Stand 3–8 m from a wall. Choose a target.","Pass into the target. Stay ready as the ball returns.","Cushion the return into your next pass."],run:"M90 150L102 145",ball:"M110 145L286 100L110 145",cones:[],start:[90,150],end:[102,145],wall:true},
 "SHT-003": {name:"One-step laces strike",cues:["Place the ball ahead of you. Choose the goal target.","Take one step, plant beside the ball, then strike with your laces.","Follow through toward the target and regain your balance."],run:"M90 150L133 134",ball:"M144 130L296 92",cones:[],start:[90,150],end:[133,134],goal:true},
 "SHT-004": {name:"Four-corner accuracy grid",cues:["Mark four goal targets. Pick one before starting.","Approach the ball and direct your shot toward the chosen corner.","Reset the ball and choose a different corner."],run:"M90 150L129 134",ball:"M142 130L307 71",cones:[],start:[90,150],end:[129,134],goal:true}
};

/** Coaching illustration only. It does not represent measured athlete motion. */
export function DemoPitch({focus,drillId,className=""}:{focus:DemoFocus;drillId?:string;className?:string}) {
 const key=drillId && diagrams[drillId] ? drillId : focus==='passing'?'PAS-001':focus==='shooting'?'SHT-003':'DRB-006';
 return <DrillSteps key={key} drill={diagrams[key]} compact={className.includes('preview')} className={className}/>;
}
function DrillSteps({drill,compact,className}:{drill:Drill;compact:boolean;className:string}) {
 const id=useId(),root=useRef<HTMLDivElement>(null),run=useRef<SVGPathElement>(null),ball=useRef<SVGPathElement>(null);
 const [step,setStep]=useState(0),[playing,setPlaying]=useState(false),[progress,setProgress]=useState(0);
 const [reduced,setReduced]=useState(false);
 useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)');const change=()=>{setReduced(media.matches);if(media.matches)setPlaying(false);};change();media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
 useEffect(()=>{if(!playing||reduced)return;let frame=0,start=performance.now();const stop=()=>setPlaying(false);const observer=new IntersectionObserver(([e])=>{if(!e.isIntersecting)stop();});if(root.current)observer.observe(root.current);const hidden=()=>{if(document.hidden)stop();};document.addEventListener('visibilitychange',hidden);const tick=(time:number)=>{const t=Math.min(1,(time-start)/3600);setProgress(t);setStep(t>=1?2:1);if(t<1)frame=requestAnimationFrame(tick);else stop();};frame=requestAnimationFrame(tick);return()=>{cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('visibilitychange',hidden);};},[playing,reduced]);
 const t=playing?progress:step===0?0:step===1?.5:1;
 const point=(path:SVGPathElement|null,initial:readonly number[],fraction:number)=>{if(!path)return initial;const p=path.getPointAtLength(path.getTotalLength()*fraction);return[p.x,p.y];};
 const ballStart=drill.ball.match(/^M([\d.]+) ([\d.]+)/)!;
 const player=point(run.current,drill.start,drill.goal?Math.min(1,t/.35):t);
 const orb=point(ball.current,[Number(ballStart[1]),Number(ballStart[2])],drill.goal?Math.max(0,(t-.35)/.65):t);
 const choose=(n:number)=>{setPlaying(false);setStep(n);};
 return <div ref={root} className={'drill-explainer '+className}>
 {!compact&&<div className="drill-explainer-title"><strong>{drill.name}</strong><span>Drill demonstration</span></div>}
 <svg className="pd-pitch drill-diagram" viewBox="0 0 360 230" role="img" aria-label={drill.name+': '+drill.cues[step]+' Solid circle: player; white dot: ball; dashed line: movement.'}>
 <defs><marker id={id+'run'} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L9 5L1 9" fill="none" stroke="#b7f34a" strokeWidth="1.5"/></marker><marker id={id+'ball'} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L9 5L1 9" fill="none" stroke="#e8f0e6" strokeWidth="1.5"/></marker></defs>
 <rect x="10" y="12" width="340" height="200" rx="8" fill="#0b281e" stroke="#426451"/>
 <path d="M24 43V26H41M319 26H336V43M24 182V198H41M319 198H336V182" fill="none" stroke="#71947d"/>
 {drill.cones.map(([x,y])=><path key={x+'-'+y} d={'M'+x+' '+(y-7)+'l6 12h-12z'} fill="#ffbd59"/>)}
 {drill.wall&&<><path d="M291 62V166M298 62V166" stroke="#91b6ad" strokeWidth="4"/><rect x="280" y="86" width="12" height="30" fill="#6cd8e433" stroke="#6cd8e4"/></>}
 {drill.goal&&<><path d="M281 55H329V163H281M291 55V163M281 91H329M281 127H329" fill="none" stroke="#678775"/>{[[307,71],[307,146],[287,71],[287,146]].map(([x,y])=><circle key={x+'-'+y} cx={x} cy={y} r="6" fill="#b7f34a33" stroke="#b7f34a"/>)}</>}
 <path ref={run} d={drill.run} fill="none" stroke="#b7f34a" strokeWidth="2" strokeDasharray="5 5" opacity={step?1:.22} markerEnd={'url(#'+id+'run)'}/>
 <path ref={ball} d={drill.ball} fill="none" stroke="#e8f0e6" strokeWidth="1.4" opacity={step?.75:.15} markerEnd={'url(#'+id+'ball)'}/>
 <circle cx={player[0]} cy={player[1]} r="9" fill="#6cd8e4" stroke="#dafbfa" strokeWidth="1.5"/><circle cx={orb[0]} cy={orb[1]} r="4" fill="#fff" stroke="#0b281e" strokeWidth="1.5"/>
 </svg>
 {!compact&&<><div className="drill-legend"><span>● Player</span><span>● Ball</span><span>┄ Run / dribble</span><span>→ Ball path</span></div><div className="drill-step-tabs" role="group" aria-label={drill.name+' demonstration steps'}>{['Setup','Movement','Finish'].map((label,n)=><button type="button" key={label} aria-pressed={step===n} onClick={()=>choose(n)}>{n+1}. {label}</button>)}</div><p className="drill-step-cue" aria-live="polite">{drill.cues[step]}</p>{!reduced&&<button type="button" className="drill-play" onClick={()=>{setProgress(0);setPlaying(!playing);}}>{playing?'Pause demonstration':'Play demonstration'}</button>}</>}
 </div>;
}
