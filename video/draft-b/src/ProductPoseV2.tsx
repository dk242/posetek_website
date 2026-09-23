import React,{useEffect,useState} from 'react';
import {cancelRender,continueRender,delayRender,staticFile} from 'remotion';
import {MovementPreview} from './RevisionScenes';

type Point=(number|null)[];
type PoseRecord={key:string;name:string;kind:string;fps:number;frames:Point[][];eventFrame:number;peakFrame:number|null;transitionFrame:number|null;metric:number;ground:number|null;metersPerNormalizedUnit:number|null;width:number;height:number;strikeFoot:string|null;direction:string|null;keyFrames:number[]|null};
type ProductPoseSource={records:PoseRecord[]};
type Source=ProductPoseSource;
type Props={frame:number;width?:number;height?:number};
const C={bg:'#04130e',panel:'#0a211a',lime:'#b7f34a',mint:'#c1f5e5',ink:'#f0f5ed',muted:'#a9bdb1',line:'#254036'};
const mono='"IBM Plex Mono",monospace',head='"Barlow Condensed",sans-serif';
const EDGES=[[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],[12,14],[14,16],[16,18],[16,20],[16,22],[18,20],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32],[0,7],[0,8],[7,11],[8,12]];
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const ease=(v:number)=>{const x=clamp(v);return x*x*(3-2*x);};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const valid=(p?:Point):p is number[]=>Boolean(p&&typeof p[0]==='number'&&typeof p[1]==='number'&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1&&(p[3]===undefined||p[3]===null||p[3]>=.1));
const sample=(r:PoseRecord,time:number)=>r.frames[Math.max(0,Math.min(r.frames.length-1,Math.floor(r.eventFrame+time*r.fps)))];
let pending:Promise<Source>|null=null;
function useSource(){
 const [data,setData]=useState<Source|null>(null);
 const [handle]=useState(()=>delayRender('Anonymous recorded preview data'));
 useEffect(()=>{let alive=true;
  pending??=fetch(staticFile('investor-exact-v2/preview-poses.json')).then(r=>{if(!r.ok)throw new Error('Recorded pose source unavailable');return r.json();});
  pending.then(value=>{if(alive)setData(value);continueRender(handle);}).catch(error=>cancelRender(error));
  return()=>{alive=false;};
 },[handle]);return data;
}
function Skeleton({points,project,color,opacity=1,ghost=false,focus=false}:{points:Point[];project:(p:number[])=>[number,number];color:string;opacity?:number;ghost?:boolean;focus?:boolean}){
 return <g opacity={opacity}>
  {EDGES.map(([a,b],i)=>{if(!valid(points[a])||!valid(points[b]))return null;const p=project(points[a] as number[]),q=project(points[b] as number[]);const detail=(a>=15&&a<=22&&b>=15&&b<=22)||a<11;const leg=a>=23&&b>=23;return <line key={i} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} stroke={color} strokeWidth={detail?1.7:focus&&leg?4.4:3.2} strokeLinecap="round" strokeDasharray={ghost&&!detail?'7 4':undefined} opacity={focus&&!leg?.60:1}/>;})}
  {points.map((p,i)=>{if(!valid(p))return null;const [x,y]=project(p);return <circle key={i} cx={x} cy={y} r={i<11?1.9:i>16&&i<23?2.1:3.6} fill={color}/>;})}
 </g>;
}
function Status({text,playing,width}:{text:string;playing:boolean;width:number}){return <g transform={`translate(${width/2} 31)`}><circle cx={-text.length*7.2-22} cy="-7" r="4" fill={playing?C.lime:C.muted}/><text textAnchor="middle" fill={playing?C.ink:C.muted} fontFamily={mono} fontSize="20" letterSpacing="1">{text}</text></g>;}

function RecordedVerticalJumpPreview({f}:{f:number}){
 const data=useSource();if(!data)return null;
 const r=data.records.find(record=>record.key==='example-jump')!;
 const tracked=r.frames.flat().filter(valid),aspect=r.width/r.height;
 const xs=tracked.map(p=>p[0] as number),ys=tracked.map(p=>p[1] as number);
 const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
 const scale=Math.min(370/Math.max(.01,(maxX-minX)*aspect),212/Math.max(.01,maxY-minY));
 const project=(p:number[]):[number,number]=>[224+(p[0]-(minX+maxX)/2)*aspect*scale,18+(p[1]-minY)*scale];
 const sourceFrame=Math.max(0,Math.min(r.frames.length-1,Math.floor(f*r.fps/30)));
 const groundY=18+((r.ground??maxY)-minY)*scale;
 return <svg width="448" height="260" viewBox="0 0 448 260" style={{display:'block',overflow:'hidden'}}>
  <ellipse cx="224" cy={groundY+4} rx="105" ry="9" fill="#153623" opacity=".7"/>
  <line x1="30" x2="418" y1={groundY} y2={groundY} stroke={C.line}/>
  <Skeleton points={r.frames[sourceFrame]} project={project} color={C.lime}/>
 </svg>;
}

/** Product-only correction: original portrait capture, fixed aspect and framing.
 * V2 uses an anonymous single-record payload. Other five previews retain their sources.
 */
export function ProductMovementPreview({index,f}:{index:number;f:number}){
 return index===1?<RecordedVerticalJumpPreview f={f}/>:<MovementPreview index={index} f={f}/>;
}
