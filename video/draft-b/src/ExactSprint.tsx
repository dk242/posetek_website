import React,{useEffect,useState} from 'react';
import {cancelRender,continueRender,delayRender,staticFile} from 'remotion';

type Point=[number,number,number]|null;
type XY={x:number;y:number};
type SprintRecord={key:'player'|'reference';fps:number;frames:(Point[]|null)[];distances:(number|null)[];calibration:{leftX:number;metersPerNormalizedX:number;aspect:number;ground:{point1:XY;point2:XY};originX:number;direction:number}};
type SprintSource={version:number;duration:number;records:SprintRecord[]};
export const EXACT_SPRINT_DURATION=360;
const W=1728,H=700;
const C={panel:'#0a211a',line:'#254036',lime:'#b7f34a',mint:'#c1f5e5',ink:'#f0f5ed',muted:'#a9bdb1'};
const mono='"IBM Plex Mono",monospace';
const EDGES=[[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],[12,14],[14,16],[16,18],[16,20],[16,22],[18,20],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32],[0,7],[0,8],[7,11],[8,12]];
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const ease=(v:number)=>{const t=clamp(v);return t*t*(3-2*t);};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const valid=(p:Point):p is Exclude<Point,null>=>Boolean(p&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&p[2]>=.1&&p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1);
let sourcePromise:Promise<SprintSource>|null=null;
function useSprint(){
 const [source,setSource]=useState<SprintSource|null>(null);
 const [handle]=useState(()=>delayRender('Verified sprint comparison'));
 useEffect(()=>{let alive=true;
  sourcePromise??=fetch(staticFile('investor-exact/sprint/poses.json')).then(response=>{if(!response.ok)throw new Error('Verified sprint render asset unavailable');return response.json();});
  sourcePromise.then(data=>{if(alive)setSource(data);continueRender(handle);}).catch(cancelRender);
  return()=>{alive=false;};
 },[handle]);
 return source;
}
function world(r:SprintRecord,p:Exclude<Point,null>):[number,number]{
 const c=r.calibration,g=c.ground;
 const groundY=g.point1.y+(p[0]-g.point1.x)*(g.point2.y-g.point1.y)/(g.point2.x-g.point1.x);
 return [((p[0]-c.leftX)*c.metersPerNormalizedX-c.originX)*c.direction,(groundY-p[1])*c.metersPerNormalizedX/c.aspect];
}

/** Two real recordings share their verified movement-onset event and elapsed
 * clock. Source rates remain fractional and unchanged. The only moving camera
 * follows their shared midpoint, preserving the entire measured separation.
 */
export const ExactSprint:React.FC<{frame:number}>=({frame})=>{
 const source=useSprint();if(!source)return null;
 const first=24,replay=190,playFrames=Math.round(source.duration*30)+1;
 const playingFirst=frame>=first&&frame<first+playFrames;
 const playingReplay=frame>=replay&&frame<replay+playFrames;
 const playing=playingFirst||playingReplay;
 const time=playing?Math.min(source.duration,(frame-(playingReplay?replay:first))/30):frame<first?0:source.duration;
 const selected=source.records.map(r=>{const index=Math.min(r.frames.length-1,Math.floor(time*r.fps));return{r,index,points:r.frames[index],distance:r.distances[index]??0};});
 const close=ease((frame-113)/27),pixelsPerMeter=mix(140,260,close);
 const center=mix(4.65,(selected[0].distance+selected[1].distance)/2,close),groundY=535;
 const project=(r:SprintRecord,p:Exclude<Point,null>):[number,number]=>{const [x,y]=world(r,p);return[W/2+(x-center)*pixelsPerMeter,groundY-y*pixelsPerMeter];};
 const worldX=(x:number)=>W/2+(x-center)*pixelsPerMeter;
 const status=playingReplay?'REPLAY · 1×':playingFirst?'RECORDED MOTION · 1×':frame<first?'PAUSED · MOVEMENT START':'PAUSED · SAME ELAPSED TIME';
 return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{display:'block',fontFamily:'Inter,sans-serif'}}>
  <defs>
   <linearGradient id="exact-sprint-stage" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#0e2a1e"/><stop offset="1" stopColor="#061910"/></linearGradient>
   <clipPath id="exact-sprint-world"><rect x="28" y="105" width={W-56} height="465"/></clipPath>
  </defs>
  <rect x="1" y="1" width={W-2} height={H-2} rx="22" fill="url(#exact-sprint-stage)" stroke={C.line}/>
  <g transform="translate(54 49)">
   <circle cx="5" cy="-8" r="6" fill={C.lime}/><text x="23" fill={C.lime} fontSize="27" fontWeight="600">Example player</text>
   <circle cx="321" cy="-8" r="6" fill={C.mint} opacity=".55"/><text x="340" fill={C.mint} fontSize="27" fontWeight="600">D1 reference</text>
  </g>
  <text x={W-55} y="46" textAnchor="end" fill={playing?C.ink:C.muted} fontFamily={mono} fontSize="20" letterSpacing="1">{status}</text>
  <text x={W-55} y="80" textAnchor="end" fill={C.muted} fontFamily={mono} fontSize="19">{time.toFixed(2)} s elapsed</text>
  <g clipPath="url(#exact-sprint-world)">
   <path d={`M28 ${groundY} H${W-28} V570 H28Z`} fill="#122c1c" opacity=".50"/>
   {Array.from({length:20},(_,i)=>i-5).map(m=><g key={m}><line x1={worldX(m)} x2={worldX(m)} y1={groundY} y2={groundY+9} stroke="#5a765e"/><text x={worldX(m)} y={groundY+29} textAnchor="middle" fill={C.muted} fontFamily={mono} fontSize="15">{m} m</text></g>)}
   <line x1="28" x2={W-28} y1={groundY} y2={groundY} stroke="#62816a" strokeWidth="1.2"/>
   {selected.slice().reverse().map(({r,points,distance})=>{
    if(!points)throw new Error('Displayed sprint frame lacks original tracked pose');
    const ghost=r.key==='reference',color=ghost?C.mint:C.lime;
    // The legacy reference retains its five facial points in slots 0–4 while
    // the MediaPipe ear slots are empty. Connect those existing points only.
    const edges=valid(points[7])||valid(points[8])?EDGES:[...EDGES.filter(([a,b])=>a>=11&&b>=11),[0,1],[0,2],[1,3],[2,4],[3,11],[4,12]];
    return <g key={r.key}>
     <ellipse cx={worldX(distance)} cy={groundY+4} rx={pixelsPerMeter*.40} ry="9" fill="#020b07" opacity=".55"/>
     <g opacity={ghost?.46:1}>
      {edges.map(([a,b],i)=>{const p=points[a],q=points[b];if(!valid(p)||!valid(q))return null;const[x,y]=project(r,p),[u,v]=project(r,q),detail=(a>=15&&a<=22&&b>=15&&b<=22)||a<11;return <line key={i} x1={x} y1={y} x2={u} y2={v} stroke={color} strokeWidth={detail?1.7:3.8} strokeLinecap="round"/>;})}
      {points.map((p,i)=>{if(!valid(p))return null;const[x,y]=project(r,p);return<circle key={i} cx={x} cy={y} r={i<11?1.65:i>16&&i<23?1.95:3.2} fill={color}/>;})}
     </g>
    </g>;
   })}
  </g>
  <line x1="54" x2={W-54} y1="604" y2="604" stroke={C.line}/>
  <text x="54" y="646" fill={C.ink} fontSize="25" fontWeight="600">Aligned at movement start</text>
  <text x={W-54} y="646" textAnchor="end" fill={C.muted} fontFamily={mono} fontSize="20">SHARED GROUND · ORIGINAL TIMING</text>
 </svg>;
};
