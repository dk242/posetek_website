import React from 'react';

const C={lime:'#b7f34a',ink:'#f0f5ed',muted:'#a9bdb1',line:'#254036'};
type P=[number,number];
const mix=(a:number,b:number,u:number)=>a+(b-a)*u;
const smooth=(v:number)=>{const u=Math.max(0,Math.min(1,v));return u*u*(3-2*u);};
// One rig throughout: fixed 92px femur/tibia and 65px upper/lower arm.
// Grounded phases solve the knee from fixed foot and pelvis positions.
const knee=(hip:P,ankle:P):P=>{
 const dx=ankle[0]-hip[0],dy=ankle[1]-hip[1],d=Math.min(183.999,Math.hypot(dx,dy));
 const h=Math.sqrt(92*92-d*d/4),norm=Math.hypot(dx,dy)||1;
 return [(hip[0]+ankle[0])/2+dy/norm*h,(hip[1]+ankle[1])/2-dx/norm*h];
};
const polar=(p:P,len:number,degrees:number):P=>[p[0]+Math.cos(degrees*Math.PI/180)*len,p[1]+Math.sin(degrees*Math.PI/180)*len];
const keys=[
 {at:0,x:0,y:-179,lean:0,feet:0,air:0,arm:76,fore:85,back:102,backFore:90},
 {at:36,x:0,y:-179,lean:0,feet:0,air:0,arm:76,fore:85,back:102,backFore:90},
 {at:64,x:0,y:-179,lean:0,feet:0,air:0,arm:-76,fore:-85,back:-102,backFore:-95},
 {at:111,x:0,y:-179,lean:0,feet:0,air:0,arm:-76,fore:-85,back:-102,backFore:-95},
 {at:136,x:0,y:-179,lean:0,feet:0,air:0,arm:76,fore:85,back:102,backFore:90},
 {at:160,x:-29,y:-124,lean:32,feet:0,air:0,arm:145,fore:193,back:156,backFore:204},
 {at:176,x:-29,y:-124,lean:32,feet:0,air:0,arm:145,fore:193,back:156,backFore:204},
 {at:188,x:22,y:-174,lean:12,feet:0,air:0,arm:-43,fore:-64,back:-37,backFore:-70},
 {at:194,x:48,y:-214,lean:9,feet:55,air:-40,arm:-46,fore:-69,back:-39,backFore:-75},
 {at:204,x:96,y:-244,lean:10,feet:120,air:-78,arm:-30,fore:-53,back:-35,backFore:-60},
 {at:217,x:165,y:-208,lean:23,feet:203,air:-46,arm:-10,fore:-29,back:-12,backFore:-32},
 {at:228,x:200,y:-146,lean:30,feet:241,air:0,arm:0,fore:-24,back:3,backFore:-27},
 {at:239,x:209,y:-124,lean:28,feet:241,air:0,arm:16,fore:-11,back:22,backFore:-9},
 {at:267,x:241,y:-179,lean:0,feet:241,air:0,arm:76,fore:85,back:102,backFore:90},
 {at:330,x:241,y:-179,lean:0,feet:241,air:0,arm:76,fore:85,back:102,backFore:90},
];
export function setupRig(frame:number){
 const t=Math.max(0,Math.min(330,frame));const i=Math.max(0,keys.findIndex((k,j)=>j<keys.length-1&&t>=k.at&&t<keys[j+1].at));
 const a=t>=330?keys.at(-1)!:keys[i],b=t>=330?a:keys[i+1];
 const u=smooth((t-a.at)/(b.at-a.at||1));
 const k=Object.fromEntries(Object.keys(a).map(v=>[v,mix(a[v as keyof typeof a],b[v as keyof typeof b],u)])) as typeof a;
 // One uninterrupted flight arc: smoothstep on separate airborne keys would
 // brake the athlete at each intermediate key. Feet travel monotonically;
 // pelvis-to-ankle reach stays inside the fixed two-bone IK range throughout.
 if(t>=188&&t<=228){
  const flight=(t-188)/40;
  k.feet=mix(0,241,flight);
  k.air=-4*78*flight*(1-flight);
  k.x=mix(22,200,flight);
  k.y=k.air-mix(174,146,flight);
 }
 const hip:P=[k.x,k.y],farHip:P=[k.x-16,k.y],ankle:P=[k.feet+14,k.air],farAnkle:P=[k.feet-14,k.air];
 const shoulder=polar(hip,102,-90+k.lean),farShoulder:P=[shoulder[0]-17,shoulder[1]+3];
 const elbow=polar(shoulder,65,k.arm),wrist=polar(elbow,65,k.fore),farElbow=polar(farShoulder,65,k.back),farWrist=polar(farElbow,65,k.backFore);
 const head=polar(shoulder,37,-90+k.lean);
 return {hip,farHip,ankle,farAnkle,knee:knee(hip,ankle),farKnee:knee(farHip,farAnkle),shoulder,farShoulder,elbow,wrist,farElbow,farWrist,head};
}
function Athlete({frame}:{frame:number}){
 const r=setupRig(frame);const line=(a:P,b:P,color:string,w:number)=><line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={color} strokeWidth={w} strokeLinecap="round"/>;
 return <g transform="translate(1025 756)">
  <ellipse cx={r.hip[0]} cy="14" rx="59" ry="11" fill="#020d09" opacity=".7"/>
  {line(r.farHip,r.farKnee,'#75a134',32)}{line(r.farKnee,r.farAnkle,'#be9470',23)}
  {line(r.farShoulder,r.farElbow,'#b7c3b3',24)}{line(r.farElbow,r.farWrist,'#be9470',20)}
  {line(r.shoulder,r.hip,'#e9efdf',61)}{line(r.hip,r.knee,C.lime,35)}{line(r.knee,r.ankle,'#e2b48d',24)}
  {line(r.shoulder,r.elbow,'#e9efdf',26)}{line(r.elbow,r.wrist,'#e2b48d',20)}
  <circle cx={r.head[0]} cy={r.head[1]} r="29" fill="#e2b48d"/>
  <path d={`M${r.head[0]-24} ${r.head[1]-8} Q${r.head[0]-22} ${r.head[1]-35} ${r.head[0]+5} ${r.head[1]-29} Q${r.head[0]+19} ${r.head[1]-30} ${r.head[0]+23} ${r.head[1]-14}`} fill="none" stroke="#344137" strokeWidth="13" strokeLinecap="round"/>
  <circle cx={r.head[0]+15} cy={r.head[1]-1} r="2.8" fill="#28322b"/>
  <path d={`M${r.head[0]+13} ${r.head[1]+13} q8 3 11-3`} fill="none" stroke="#8d6149" strokeWidth="2.5" strokeLinecap="round"/>
  {[r.farAnkle,r.ankle].map((pt,i)=><g key={i}>{line([pt[0]-8,pt[1]],[pt[0]+23,pt[1]],i===0?'#b3c2b2':'#f0f5ed',16)}{line([pt[0]-11,pt[1]+7],[pt[0]+25,pt[1]+7],'#536859',3)}</g>)}
 </g>;
}
export function ExactSetup({frame}:{frame:number}){
 const phase=frame<51?0:frame<126?1:frame<154?2:frame<190?3:frame<228?4:5;
 const labels=['Position','Readiness signal','Hands down','Countermovement','Two-foot takeoff','Balanced landing'];
 return <>
 <svg width="1920" height="930" viewBox="0 0 1920 930">
  <path d="M240 739L1590 739L1730 858L340 858Z" fill="#102e20" stroke={C.line} strokeWidth="2"/>
  <path d="M544 651L1330 422L1515 775Z" fill="#b7f34a05" stroke="#476a42" strokeDasharray="7 9"/>
  <path d="M559 645L472 825M559 645L661 825M559 645L556 851" stroke="#627b6b" strokeWidth="11" strokeLinecap="round"/>
  <path d="M559 584L559 720" stroke="#aabeb0" strokeWidth="9"/>
  <rect x="468" y="530" width="179" height="90" rx="13" fill="#030d08" stroke="#829a8a" strokeWidth="5"/>
  <rect x="480" y="540" width="155" height="69" rx="7" fill="#173c28"/>
  <circle cx="492" cy="550" r="5" fill={C.lime}/>
  <path d="M532 591l15-25 34 25" fill="none" stroke={C.lime} strokeWidth="2.5"/>
  <g transform="translate(873 776) scale(.72)"><path d="M-53 29L-34-40L35-40L60 29Z" fill="#d9e2d4" stroke="#829481" strokeWidth="3"/><rect x="-27" y="-38" width="53" height="53" fill="#fff"/><rect x="-22" y="-33" width="43" height="43" fill="#12241a"/><path d="M-16-27h12v12h-12z M4-27h10v8H4z M-16-5h8v9h-8z M-2-13h10v10H-2z M11 1h5v5h-5z" fill="#fff"/></g>
  <Athlete frame={frame}/>
  <g fill={C.muted} fontFamily="Inter" fontSize="23"><text x="436" y="479">Smartphone + tripod</text><text x="789" y="868">One custom marker</text></g>
 </svg>
 <div style={{position:'absolute',left:99,right:99,top:270,display:'flex',alignItems:'center',justifyContent:'space-between',gap:20}}>{labels.map((v,i)=><div key={v} style={{fontSize:23,color:phase===i?C.ink:C.muted,opacity:i<=phase?1:.44,borderTop:`2px solid ${phase===i?C.lime:C.line}`,paddingTop:16,flex:1}}><span style={{color:C.lime,fontSize:16,marginRight:9}}>0{i+1}</span>{v}</div>)}</div>
 <div style={{position:'absolute',left:99,bottom:155,color:C.muted,fontSize:18}}>Illustrated workflow · Based on the supplied broad-jump recording</div>
 </>;
}
