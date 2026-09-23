import React,{useEffect,useState} from 'react';
import {cancelRender,continueRender,delayRender,staticFile} from 'remotion';
import {MovementPreview} from './RevisionScenes';

type Point=(number|null)[];
type PoseRecord={key:string;name:string;kind:string;fps:number;frames:Point[][];eventFrame:number;peakFrame:number|null;transitionFrame:number|null;metric:number;ground:number|null;metersPerNormalizedUnit:number|null;width:number;height:number;strikeFoot:string|null;direction:string|null;keyFrames:number[]|null};
type Difference={id:string;left:number;right:number;leftFrame:number;rightFrame:number;comparable:boolean};
export type ProductPoseSource={records:PoseRecord[];comparison:{focusAreas:{cue:string;title:string;rank:number}[];differences:Difference[];leftKeyFrames:Record<string,number>;rightKeyFrames:Record<string,number>}};
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
 const [handle]=useState(()=>delayRender('Verified recorded comparison data'));
 useEffect(()=>{let alive=true;
  pending??=fetch(staticFile('product/poses.json')).then(r=>{if(!r.ok)throw new Error('Recorded pose source unavailable');return r.json();});
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
 const r=data.records.find(record=>record.key==='guy-jump')!;
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
 * Existing editions and the other five recorded previews retain their sources.
 */
export function ProductMovementPreview({index,f}:{index:number;f:number}){
 return index===1?<RecordedVerticalJumpPreview f={f}/>:<MovementPreview index={index} f={f}/>;
}

/** The video frame selects original 120-fps samples; no interpolation, time warp
 * or per-frame centering is applied. The fixed per-source ground calibration
 * shares a pixels-per-metre display scale, retaining the true modest height gap.
 */
export const RecordedJumpComparison:React.FC<Props>=({frame,width=1728,height=700})=>{
 const data=useSource();if(!data)return null;
 const a=data.records.find(r=>r.key==='guy-jump')!,b=data.records.find(r=>r.key==='maurizio-jump')!;
 const segments=[[15,75],[166,226],[326,386]];
 const pass=segments.find(([s,e])=>frame>=s&&frame<e);
 const playing=Boolean(pass),before=frame<15;
 const time=playing?-.60+(frame-pass![0])/30:-.60;
 const merge=ease((frame-127)/32);
 const centers=[mix(width*.27,width*.5,merge),mix(width*.73,width*.5,merge)];
 const groundY=height*.747,ppm=height*.292;
 const metricOpacity=ease((frame-73)/18);
 const diff=(b.metric-a.metric)*100;
 return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{display:'block',fontFamily:'Inter,sans-serif'}}>
  <defs><linearGradient id="jump-stage" x1="0" y1="0" x2="0" y2="1"><stop stopColor="#0a211a" stopOpacity=".8"/><stop offset="1" stopColor="#0a211a" stopOpacity=".2"/></linearGradient></defs>
  <rect width={width} height={height} rx="22" fill="url(#jump-stage)" stroke={C.line}/>
  <Status width={width} playing={playing} text={playing?'1× · ALIGNED AT TAKEOFF':before?'PAUSED · READY TO COMPARE':'PAUSED · EACH RECORDED PEAK'}/>
  <g opacity={1-merge*.7}><text x={width*.27} y="82" textAnchor="middle" fill={C.lime} fontSize="30" fontWeight="600">Guy</text><text x={width*.73} y="82" textAnchor="middle" fill={C.mint} fontSize="30" fontWeight="600">Maurizio</text></g>
  {[.5,1,1.5,2].map(m=><g key={m} opacity=".20"><line x1="52" x2={width-52} y1={groundY-m*ppm} y2={groundY-m*ppm} stroke={C.line} strokeDasharray="2 9"/></g>)}
  <line x1="70" x2={width-70} y1={groundY} y2={groundY} stroke="#60846d" strokeWidth="1.2"/>
  <text x="76" y={groundY+27} fill={C.muted} fontFamily={mono} fontSize="17">COMMON GROUND · FIXED SCALE</text>
  {[b,a].map(r=>{
   const i=r===a?0:1,base=r.frames[r.eventFrame],left=base[27],right=base[28];
   const anchorX=valid(left)&&valid(right)?(left[0]+right[0])/2:.5;
   const scale=r.metersPerNormalizedUnit!;
   const points=playing||before?sample(r,time):r.frames[r.peakFrame!];
   const project=(p:number[]):[number,number]=>[centers[i]+(p[0]-anchorX)*(r.width/r.height)*scale*ppm,groundY-(r.ground!-p[1])*scale*ppm];
   return <g key={r.key}><ellipse cx={centers[i]} cy={groundY+3} rx="92" ry="10" fill="#010b06" opacity=".55"/><Skeleton points={points} project={project} color={i?C.mint:C.lime} opacity={i?mix(1,.67,merge):1} ghost={i===1&&merge>.5}/></g>;
  })}
  <g opacity={metricOpacity}>
   <rect x="66" y={height-123} width={width-132} height="101" rx="13" fill="#061910" stroke={C.line}/>
   {[a,b].map((r,i)=>{const x=i?width-475:99;return <g key={r.key}><text x={x} y={height-89} fill={i?C.mint:C.lime} fontFamily={mono} fontSize="18">{r.name.toUpperCase()} / MEASURED JUMP HEIGHT</text><text x={x} y={height-40} fill={C.ink} fontFamily={head} fontWeight="700" fontSize="56">{(r.metric*100).toFixed(1)}<tspan fontSize="26" fontFamily="Inter"> cm</tspan></text></g>;})}
   <text x={width/2} y={height-75} textAnchor="middle" fill={C.ink} fontFamily={head} fontWeight="700" fontSize="43">{diff.toFixed(1)} cm difference</text>
   <text x={width/2} y={height-42} textAnchor="middle" fill={C.muted} fontFamily={mono} fontSize="17">RECORDED PLAYERS · SAME TEST</text>
  </g>
 </svg>;
};

const median=(xs:number[])=>{const a=xs.slice().sort((x,y)=>x-y),mid=Math.floor(a.length/2);return a.length%2?a[mid]:(a[mid-1]+a[mid])/2;};
const SCALE_BONES=[[11,13],[13,15],[12,14],[14,16],[23,25],[25,27],[24,26],[26,28],[11,23],[12,24]];
function boneLengths(r:PoseRecord){const first=Math.max(0,Math.floor(r.eventFrame-r.fps*.2)),last=Math.min(r.frames.length-1,Math.ceil(r.eventFrame+r.fps*.05));return SCALE_BONES.map(([a,b])=>{const values=[];for(let i=first;i<=last;i++){const p=r.frames[i][a],q=r.frames[i][b];if(valid(p)&&valid(q))values.push(Math.hypot((p[0]-q[0])*r.width/r.height,p[1]-q[1]));}return values.length>=5?median(values):null;});}
function kickAlignment(a:PoseRecord,b:PoseRecord){
 const aa=boneLengths(a),bb=boneLengths(b),ratios=aa.flatMap((v,i)=>v&&bb[i]?[Math.log(v/bb[i]!)]:[]);
 if(ratios.length<3)throw new Error('Insufficient tracked bones for fixed comparison alignment');
 const ratio=Math.exp(median(ratios));
 const anchor=(r:PoseRecord)=>{const p=r.frames[r.eventFrame][r.strikeFoot==='left'?28:27];if(!valid(p))throw new Error('Contact standing foot unavailable');return p;};
 return {ratio,anchors:[anchor(a),anchor(b)],mirror:a.direction!==b.direction};
}
/** Opposite-foot display uses one contact standing-foot registration and a fixed
 * robust body-scale ratio. Right geometry is mirrored only for visual alignment;
 * labels and stored measurements continue to refer to the physical feet.
 */
export const RecordedKickComparison:React.FC<Props>=({frame,width=1728,height=700})=>{
 const data=useSource();if(!data)return null;
 const a=data.records.find(r=>r.key==='guy-left')!,b=data.records.find(r=>r.key==='guy-right')!;
 const alignment=kickAlignment(a,b),plotWidth=width*.665,groundY=height*.775;
 const segments=[[15,54],[180,219]],pass=segments.find(([s,e])=>frame>=s&&frame<e);
 const playing=Boolean(pass),before=frame<15,time=playing?-.5+(frame-pass![0])/30:-.5;
 const merge=ease((frame-58)/22),centers=[mix(plotWidth*.225,plotWidth*.51,merge),mix(plotWidth*.70,plotWidth*.51,merge)];
 const normal=(r:PoseRecord,p:number[],i:number):[number,number]=>[(p[0]-alignment.anchors[i][0])*(r.width/r.height)*(i?alignment.ratio:1)*(i&&alignment.mirror?-1:1),(p[1]-alignment.anchors[i][1])*(i?alignment.ratio:1)];
 const pointsFor=(r:PoseRecord)=>playing||before?sample(r,time):r.frames[r.transitionFrame!];
 // Framing spans both complete kick excerpts; the one shared camera push-in
 // after registration scales both poses together and never follows a joint.
 let minY=0,maxY=0,minX=0,maxX=0;
 [a,b].forEach((r,i)=>{for(let t=-.5;t<=.8;t+=1/30){for(const pt of sample(r,t)){if(!valid(pt))continue;const[x,y]=normal(r,pt,i);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minX=Math.min(minX,x);maxX=Math.max(maxX,x);}}});
 const px=Math.min((height*.58)/Math.max(.1,maxY-minY),(plotWidth*.42)/Math.max(.1,maxX-minX))*mix(1.12,1.4,merge);
 const row=data.comparison.differences.find(d=>d.id==='backswing.thigh_angle.kicking'&&d.comparable);
 const cue=data.comparison.focusAreas.slice().sort((x,y)=>x.rank-y.rank)[0]?.cue;
 return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{display:'block',fontFamily:'Inter,sans-serif'}}>
  <rect width={width} height={height} rx="22" fill={C.panel} stroke={C.line}/>
  <Status width={plotWidth} playing={playing} text={playing?'1× · ALIGNED AT CONTACT':before?'PAUSED · BEFORE THE KICK':'PAUSED · EACH BACKSWING'}/>
  <g><circle cx="56" cy="77" r="5" fill={C.lime}/><text x="73" y="85" fill={C.lime} fontSize="25" fontWeight="600">Guy · left foot</text><circle cx={plotWidth-310} cy="77" r="5" fill={C.mint}/><text x={plotWidth-293} y="85" fill={C.mint} fontSize="25" fontWeight="600">Guy · right foot</text></g>
  <line x1="50" x2={plotWidth-30} y1={groundY} y2={groundY} stroke="#4d705c"/>
  <clipPath id="kick-comparison-clip"><rect x="20" y="112" width={plotWidth-40} height={height-190}/></clipPath>
  <g clipPath="url(#kick-comparison-clip)">{[b,a].map(r=>{const i=r===a?0:1;const project=(p:number[]):[number,number]=>{const[x,y]=normal(r,p,i);return[centers[i]+x*px,groundY+y*px];};return <Skeleton key={r.key} points={pointsFor(r)} project={project} color={i?C.mint:C.lime} opacity={i?mix(1,.68,merge):1} ghost={i===1&&merge>.5} focus={!playing&&!before}/>;})}</g>
  <text x="54" y={height-67} fill={C.muted} fontFamily={mono} fontSize="18">RIGHT POSE MIRRORED FOR REVIEW · FIXED ALIGNMENT</text>
  <text x="54" y={height-36} fill={C.muted} fontFamily={mono} fontSize="18">SAVED COMPARISON · ONE KICK PER FOOT</text>
  <line x1={plotWidth+5} x2={plotWidth+5} y1="37" y2={height-37} stroke={C.line}/>
  <foreignObject x={plotWidth+40} y="48" width={width-plotWidth-74} height={height-90}>
   <div style={{color:C.ink,fontFamily:'Inter,sans-serif'}}>
    <div style={{fontFamily:mono,color:C.lime,fontSize:21,letterSpacing:1.3}}>SAVED COACHING FOCUS</div>
    <div style={{fontFamily:head,fontSize:53,lineHeight:.98,textTransform:'uppercase',fontWeight:700,marginTop:21}}>A clearer<br/>backswing.</div>
    {row&&<div style={{display:'flex',gap:35,marginTop:25,borderTop:`1px solid ${C.line}`,borderBottom:`1px solid ${C.line}`,padding:'19px 0'}}>{[['LEFT',row.left,C.lime],['RIGHT',row.right,C.mint]].map(([label,value,color])=><div key={String(label)}><div style={{fontFamily:mono,fontSize:18,color:String(color)}}>{label}</div><div style={{fontFamily:head,fontSize:55,lineHeight:1.2}}>{Number(value).toFixed(1)}°</div></div>)}</div>}
    <div style={{color:C.muted,fontSize:18,marginTop:12}}>Kicking thigh angle at backswing</div>
    <div style={{fontSize:28,lineHeight:1.25,marginTop:24}}>{cue}</div>
    <div style={{fontFamily:mono,color:C.muted,fontSize:16,lineHeight:1.4,marginTop:23}}>Recorded 2D observation.<br/>Explore the cue with your coach.</div>
   </div>
  </foreignObject>
 </svg>;
};
