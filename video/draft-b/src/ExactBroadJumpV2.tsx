import React,{useEffect,useState} from 'react';
import {cancelRender,continueRender,delayRender,staticFile} from 'remotion';

/** Native broad-jump analysis, reconstructed from the checked recorded artifacts.
 * x/y and visibility remain source values. FPS is capture-declared because the
 * original movie was not retained; this component never supplies new motion.
 */
type Point=[number,number,number]|null;
type XY={x:number;y:number};
export type ExactBroadJumpProps={frame:number;sourceFrame?:number;paused?:boolean};
type BroadJumpSource={
 version:number;
 timing:{fps:number;provenance:string;originalVideoAvailable:boolean;startFrame:number;endFrame:number};
 geometry:{width:number;height:number;provenance:string;bounds:{minX:number;maxX:number;minY:number;maxY:number}};
 metrics:{distanceMeters:number;peakHeightMeters:number;flightSeconds:number;trackedFoot:string};
 events:{takeoff:number;landing:number;peak:number};
 guides:{takeoffX:number;landingX:number;groundY:number;markerCorners:XY[]};
 frames:(Point[]|null)[];com:([number,number]|null)[];feet:([number,number]|null)[];heights:(number|null)[];
};
const W=1728,H=700,mono='"IBM Plex Mono",monospace',head='"Barlow Condensed",sans-serif';
const C={bg:'#04130e',panel:'#0a211a',line:'#29483b',lime:'#b7f34a',ink:'#f0f5ed',muted:'#a9bdb1',cyan:'#79dce8',orange:'#f3a452',red:'#e88378',gold:'#ffcc4d'};
const EDGES=[[11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],[12,14],[14,16],[16,18],[16,20],[16,22],[18,20],[11,23],[12,24],[23,24],[23,25],[25,27],[27,29],[29,31],[27,31],[24,26],[26,28],[28,30],[30,32],[28,32],[0,7],[0,8],[7,11],[8,12]];
const valid=(p:Point):p is Exclude<Point,null>=>Boolean(p&&p.length===3&&p.every(Number.isFinite)&&p[2]>=.1&&p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1);
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
let sourcePromise:Promise<BroadJumpSource>|null=null;
function useSource(){
 const [source,setSource]=useState<BroadJumpSource|null>(null);
 const [handle]=useState(()=>delayRender('Verified broad-jump source'));
 useEffect(()=>{let active=true;
  sourcePromise??=fetch(staticFile('investor-exact-v2/broadjump.json')).then(async response=>{
   if(!response.ok)throw new Error('Prepare the verified broad-jump render asset');
   const data=await response.json() as BroadJumpSource;
   if(data.version!==1||data.frames.length!==503||data.timing.fps!==120||data.geometry.width!==1280||data.geometry.height!==720||data.events.takeoff!==249||data.events.landing!==299)throw new Error('Unexpected broad-jump source contract');
   if(!data.frames[14]||!data.frames[360]||data.heights.length!==data.frames.length)throw new Error('Incomplete recorded broad-jump data');
   return data;
  });
  sourcePromise.then(data=>{if(active)setSource(data);continueRender(handle);}).catch(cancelRender);
  return()=>{active=false;};
 },[handle]);
 return source;
}

/** 0–17: ready. 18–78: recorded 1× playback (four source slots per film
 * frame), beginning after capture warmup. 79–131: end hold. At132: visible Landing-chip seek to source299.
 * sourceFrame overrides are zero-based, consistently applied to every layer.
 */
export function exactBroadJumpState(frame:number,sourceFrame?:number,paused?:boolean){
 if(sourceFrame!==undefined)return {sourceFrame:Math.max(0,Math.min(502,Math.round(sourceFrame))),paused:paused??true,landingSeek:false};
 if(frame<18)return {sourceFrame:120,paused:true,landingSeek:false};
 if(frame<79)return {sourceFrame:Math.min(360,120+Math.floor((frame-18)*4)),paused:false,landingSeek:false};
 if(frame<132)return {sourceFrame:360,paused:true,landingSeek:false};
 return {sourceFrame:299,paused:true,landingSeek:true};
}
function Metric({x,y,label,value,unit,active=false,width=239}:{x:number;y:number;label:string;value:string;unit?:string;active?:boolean;width?:number}){
 return <g transform={'translate('+x+' '+y+')'}>
  <rect width={width} height="123" rx="12" fill={active?'#133222':'#0b241b'} stroke={active?'#577831':C.line}/>
  <text x="22" y="32" fill={active?C.lime:C.muted} fontSize="19">{label}</text>
  <text x="22" y="94" fill={C.ink} fontFamily={head} fontWeight="700" fontSize={value==='Right'?48:59}>{value}<tspan fill={C.muted} fontFamily={mono} fontWeight="400" fontSize="22" dx="9">{unit}</tspan></text>
 </g>;
}
export const ExactBroadJumpV2:React.FC<ExactBroadJumpProps>=({frame,sourceFrame,paused})=>{
 const source=useSource();if(!source)return null;
 const state=exactBroadJumpState(frame,sourceFrame,paused),index=state.sourceFrame,points=source.frames[index];
 const b=source.geometry.bounds,aspect=source.geometry.width/source.geometry.height;
 const plot={x:38,y:108,w:1080,h:428};
 const scale=Math.min(plot.w/((b.maxX-b.minX)*aspect),plot.h/(b.maxY-b.minY));
 const offsetX=plot.x+(plot.w-(b.maxX-b.minX)*aspect*scale)/2;
 const offsetY=plot.y+(plot.h-(b.maxY-b.minY)*scale)/2;
 const mirror=source.guides.landingX<source.guides.takeoffX;
 const xy=(p:[number,number]|number[]):[number,number]=>[offsetX+((mirror?b.maxX-p[0]:p[0]-b.minX)*aspect*scale),offsetY+(p[1]-b.minY)*scale];
 const g=source.guides,ground=xy([g.takeoffX,g.groundY])[1],takeoffX=xy([g.takeoffX,g.groundY])[0],landingX=xy([g.landingX,g.groundY])[0];
 const com=source.com[index],foot=source.feet[index],thisHeight=source.heights[index];
 const trace=source.com.slice(Math.max(0,index-40),index+1).map(p=>p&&p.every(finite)?xy(p):null);
 // Separate trace subpaths at missing samples; never bridge a missing COM.
 let trail='';let previous=false;
 for(const p of trace){if(!p){previous=false;continue;}trail+=(previous?' L':' M')+p[0]+' '+p[1];previous=true;}
 const feetValue=(source.metrics.distanceMeters*3.28084).toFixed(1);
 const phase=index===source.events.takeoff?'TAKEOFF':index===source.events.landing?'LANDING':index<source.events.takeoff?'PREPARATION':index<source.events.landing?'FLIGHT':'RECOVERY';
 const progress=index/(source.frames.length-1),timelineX=128,timelineW=756;
 const seekPulse=sourceFrame===undefined&&frame>=126&&frame<149;
 return <svg width={W} height={H} viewBox={'0 0 '+W+' '+H} style={{display:'block',fontFamily:'Inter,sans-serif'}}>
  <defs><clipPath id="exact-broad-jump-stage"><rect x="29" y="99" width="1111" height="457" rx="10"/></clipPath></defs>
  <rect x="1" y="1" width={W-2} height={H-2} rx="22" fill={C.panel} stroke={C.line}/>
  <path d="m43 33-8 8 8 8" fill="none" stroke={C.muted} strokeWidth="2.5"/>
  <text x="61" y="50" fill={C.ink} fontSize="27" fontWeight="600">Broad jump</text>
  <text x={W-35} y="47" textAnchor="end" fill={C.muted} fontFamily={mono} fontSize="16">RECORDED DATA · RECONSTRUCTED VIEW</text>
  <line x1="0" x2={W} y1="78" y2="78" stroke={C.line}/>
  <line x1="1164" x2="1164" y1="103" y2="638" stroke={C.line}/>
  <text x="42" y="118" fill={C.muted} fontFamily={mono} fontSize="15">{state.paused?'PAUSED · '+phase:'RECORDED MOTION · 1×'}</text>
  <text x="1115" y="118" textAnchor="end" fill={C.muted} fontFamily={mono} fontSize="15">FRAME {index+1}</text>
  <g clipPath="url(#exact-broad-jump-stage)">
   <line x1="48" x2="1122" y1={ground} y2={ground} stroke={C.ink} opacity=".48" strokeWidth="1.25"/>
   <polygon points={g.markerCorners.map(p=>xy([p.x,p.y]).join(',')).join(' ')} fill={C.gold} fillOpacity=".08" stroke={C.gold} strokeOpacity=".75" strokeWidth="1.6"/>
   {g.markerCorners.map((p,i)=>{const [x,y]=xy([p.x,p.y]);return <circle key={i} cx={x} cy={y} r="2.4" fill={C.gold}/>;})}
   <line x1={takeoffX} x2={takeoffX} y1="135" y2={ground} stroke={C.lime} strokeOpacity=".5" strokeDasharray="6 4" strokeWidth="1.5"/>
   <line x1={landingX} x2={landingX} y1="135" y2={ground} stroke={C.red} strokeOpacity=".7" strokeDasharray="6 4" strokeWidth="1.5"/>
   <path d={trail} fill="none" stroke={C.cyan} strokeOpacity=".85" strokeWidth="2"/>
   {points&&<g>{EDGES.map(([a,b])=>{const p=points[a],q=points[b];if(!valid(p)||!valid(q))return null;const[x,y]=xy(p),[u,v]=xy(q);return <line key={a+'-'+b} x1={x} y1={y} x2={u} y2={v} stroke={C.ink} strokeWidth={a<11?1.8:3.2} strokeLinecap="round"/>;})}
    {points.map((p,i)=>{if(!valid(p))return null;const[x,y]=xy(p);return <circle key={i} cx={x} cy={y} r={i<11?1.7:i>16&&i<23?1.9:3.0} fill={C.lime}/>;})}
   </g>}
   {com&&com.every(finite)&&<circle cx={xy(com)[0]} cy={xy(com)[1]} r="4.8" fill={C.cyan} stroke={C.ink}/>}
   {foot&&foot.every(finite)&&<circle cx={xy(foot)[0]} cy={xy(foot)[1]} r="4.2" fill={C.orange} stroke={C.ink}/>}
   <path d={'M'+takeoffX+' '+(ground+17)+'H'+landingX+' M'+takeoffX+' '+(ground+11)+'v12 M'+landingX+' '+(ground+11)+'v12'} stroke={C.lime} strokeWidth="1.6" opacity=".9"/>
   <text x={(takeoffX+landingX)/2} y={ground+43} fill={C.lime} fontFamily={mono} fontSize="20" textAnchor="middle">{feetValue} ft</text>
  </g>
  {!points&&<text x="582" y="326" fill={C.muted} textAnchor="middle" fontSize="22">No recorded pose in this frame</text>}
  {[{x:43,label:'Takeoff',color:C.lime,active:index===source.events.takeoff},{x:209,label:'Landing',color:C.red,active:index===source.events.landing}].map(c=><g key={c.label} transform={'translate('+c.x+' 565)'}>
   <rect width="143" height="41" rx="20.5" fill={c.active?'#173727':'#0c261c'} stroke={c.active?c.color:C.line}/>
   <circle cx="20" cy="20" r="4" fill={c.color}/>
   <text x="34" y="27" fill={C.ink} fontSize="18">{c.label}</text>
  </g>)}
  <circle cx="411" cy="585" r="4" fill={C.cyan}/><text x="424" y="591" fill={C.muted} fontFamily={mono} fontSize="14">COM</text>
  <circle cx="498" cy="585" r="4" fill={C.orange}/><text x="512" y="591" fill={C.muted} fontFamily={mono} fontSize="14">TRACKED FOOT</text>
  <rect x="995" y="565" width="121" height="41" rx="20.5" fill="#173322" stroke={C.line}/><text x="1055.5" y="592" textAnchor="middle" fill={C.ink} fontSize="18">Analyze</text>
  {seekPulse&&<circle cx="279" cy="585" r={12+(frame-126)*1.35} fill="none" stroke={C.ink} strokeWidth="2" opacity={Math.max(0,1-(frame-126)/23)}/>}
  <circle cx="67" cy="639" r="23" fill={C.lime}/>
  {state.paused?<path d="m61 629 15 10-15 10z" fill={C.bg}/>:<g fill={C.bg}><rect x="59" y="630" width="6" height="18"/><rect x="69" y="630" width="6" height="18"/></g>}
  <line x1={timelineX} x2={timelineX+timelineW} y1="639" y2="639" stroke={C.line} strokeWidth="4" strokeLinecap="round"/>
  <line x1={timelineX} x2={timelineX+timelineW*Math.max(0,Math.min(1,progress))} y1="639" y2="639" stroke={C.lime} strokeWidth="4" strokeLinecap="round"/>
  {[source.events.takeoff,source.events.landing].map(n=><line key={n} x1={timelineX+n/(source.frames.length-1)*timelineW} x2={timelineX+n/(source.frames.length-1)*timelineW} y1="632" y2="646" stroke={C.muted} strokeWidth="2"/>)}
  <circle cx={timelineX+timelineW*Math.max(0,Math.min(1,progress))} cy="639" r="6" fill={C.lime}/>
  <rect x="918" y="620" width="69" height="36" rx="18" fill="#173322"/><text x="952.5" y="644" textAnchor="middle" fontFamily={mono} fill={C.ink} fontSize="17">1×</text>
  <text x="1115" y="645" textAnchor="end" fill={C.muted} fontFamily={mono} fontSize="17">{index+1} / {source.frames.length}</text>
  <text x="1200" y="120" fill={C.lime} fontFamily={mono} fontSize="17" letterSpacing="1.2">REP ANALYSIS</text>
  <Metric x={1200} y={140} label="Distance" value={feetValue} unit="ft" active/>
  <Metric x={1455} y={140} label="Peak height" value={(source.metrics.peakHeightMeters*39.3701).toFixed(1)} unit="in"/>
  <Metric x={1200} y={279} label="Flight time" value={source.metrics.flightSeconds.toFixed(2)} unit="s"/>
  <Metric x={1455} y={279} label="This frame" value={finite(thisHeight)?(thisHeight*39.3701).toFixed(1):'—'} unit={finite(thisHeight)?'in':undefined} active={!state.paused}/>
  <Metric x={1200} y={418} label="Tracked foot" value="Right" width={494}/>
  <text x="1200" y="583" fill={C.muted} fontSize="17">Session 1 · Rep 1</text>
  <text x="1200" y="613" fill={C.muted} fontFamily={mono} fontSize="14">September 22, 2026</text>
  <line x1="0" x2={W} y1="675" y2="675" stroke={C.line}/>
  <text x="35" y="693" fill={C.muted} fontFamily={mono} fontSize="12">Recorded pose and analysis</text>
 </svg>;
};
