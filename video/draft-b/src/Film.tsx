import React, {CSSProperties,useEffect,useState} from 'react';
import {AbsoluteFill,Audio,Easing,OffthreadVideo,Sequence,continueRender,delayRender,interpolate,staticFile,useCurrentFrame} from 'remotion';
import {PoseVisual} from './PoseVisual';
import recorded from '../../../app/src/pages/home/movement/recorded-movement.json';
import {POSE_EDGES} from '../../../app/src/pages/home/latest-hero/pose-model';
import {sampleTeams} from '../../../app/src/pages/coaches/coach-samples';

const C={bg:'#04130e',panel:'#0a211a',lime:'#b7f34a',ink:'#f0f5ed',muted:'#a9bdb1',line:'#254036',mint:'#c1f5e5'};
const mono='"IBM Plex Mono", monospace';
const condensed='"Barlow Condensed", sans-serif';
const ease=Easing.bezier(.18,.78,.22,1);
const p=(f:number,a:number,b:number)=>interpolate(f,[a,b],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:ease});
const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
const heading:CSSProperties={fontFamily:condensed,textTransform:'uppercase',fontWeight:700,lineHeight:.94,letterSpacing:'-0.02em',margin:0};
const alex=sampleTeams[0].players[0];
type Caption={start:number;end:number;text:string};
type Props={audioEnabled?:boolean;captions?:Caption[]};

function Fonts(){
 const [handle]=useState(()=>delayRender('Local brand fonts'));
 useEffect(()=>{Promise.all([
  ['Barlow Condensed','barlow-700.woff2','700'],['Inter','inter-400.woff2','400'],['Inter','inter-600.woff2','600'],['IBM Plex Mono','plex-400.woff2','400']
 ].map(async([name,file,weight])=>{const font=new FontFace(name,`url(${staticFile('fonts/'+file)})`,{weight});await font.load();(document.fonts as unknown as {add:(font:FontFace)=>void}).add(font);})).then(()=>continueRender(handle));},[handle]);
 return null;
}
function Mark({size=58}: {size?:number}){return <div style={{width:size,height:size,background:C.lime,color:'#082015',display:'grid',placeItems:'center',fontSize:size*.70,fontWeight:900,borderRadius:4,position:'relative',fontFamily:'Inter'}} >P<div style={{position:'absolute',right:-2,bottom:-2,width:size*.22,height:size*.22,background:C.bg}}/></div>;}
function Brand({large=false}:{large?:boolean}){return <div style={{display:'flex',gap:large?28:16,alignItems:'center',fontSize:large?62:32,fontWeight:600,letterSpacing:large?8:4}}><Mark size={large?102:54}/><span>POSETEK</span></div>;}
function Eyebrow({children,color=C.lime,style={}}:{children:React.ReactNode;color?:string;style?:CSSProperties}){return <div style={{fontFamily:mono,fontSize:25,letterSpacing:3,textTransform:'uppercase',lineHeight:1.5,color,...style}}>{children}</div>;}
function Reveal({children,frame,at=0,style={}}:{children:React.ReactNode;frame:number;at?:number;style?:CSSProperties}){const a=p(frame,at,at+22);return <div style={{opacity:a,transform:`translateY(${(1-a)*42}px)`,...style}}>{children}</div>;}
function Rule({style={}}:{style?:CSSProperties}){return <div style={{height:1,background:C.line,...style}}/>;}
function Sample({style={}}:{style?:CSSProperties}){return <div style={{fontFamily:mono,fontSize:22,letterSpacing:.4,color:C.muted,...style}}>Illustrative example</div>;}
function Arrow({size=48,color=C.lime}:{size?:number;color?:string}){return <svg width={size} height={size} viewBox="0 0 40 40" fill="none"><path d="M6 20H32M20 8L32 20L20 32" stroke={color} strokeWidth="2.5"/></svg>;}
function Window({start,end,children}:{start:number;end:number;children:(f:number)=>React.ReactNode}){
 const frame=useCurrentFrame(),f=frame-start;
 const enter=p(f,0,14),exit=end===1350?1:1-p(frame,end-14,end);
 if(frame<start||frame>=end)return null;
 return <AbsoluteFill style={{opacity:enter*exit,transform:`translateY(${(1-enter)*30-(1-exit)*16}px)`}}>{children(f)}</AbsoluteFill>;
}

function Hero({f}:{f:number}){
 return <>
  <Reveal frame={f} at={0} style={{position:'absolute',left:76,top:220}}><Eyebrow>Player development, connected.</Eyebrow></Reveal>
  <Reveal frame={f} at={4} style={{position:'absolute',left:72,top:305}}><h1 style={{...heading,fontSize:145}}>What should<br/>your team<br/><span style={{color:C.lime}}>train next?</span></h1></Reveal>
  <div style={{position:'absolute',left:0,top:590,opacity:p(f,8,35),transform:`scale(${lerp(.95,1,p(f,0,100))})`}}><PoseVisual frame={f} width={1080} height={1040}/></div>
  <Reveal frame={f} at={28} style={{position:'absolute',left:80,bottom:305,right:80,display:'flex',alignItems:'center',justifyContent:'space-between',borderTop:`1px solid ${C.line}`,paddingTop:24}}><Eyebrow color={C.muted} style={{fontSize:23}}>Movement → insight → action</Eyebrow><Arrow/></Reveal>
 </>;
}

const jumpSeq=recorded.sequences.find(s=>s.key==='jump')!;
const jumpFrames=jumpSeq.frames;
const bounds=(()=>{const pts=jumpFrames.flat();const xs=pts.map(pt=>pt[0]*(16/9));const ys=pts.map(pt=>pt[1]);return {x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys)};})();
function RecordedJump({f}:{f:number}){
 // Original timestamps are sampled at the sequence's 30 fps. Do not synthesize poses.
 const idx=Math.min(jumpFrames.length-1,Math.max(0,Math.floor(f)));
 const pts=jumpFrames[idx];
 const scale=Math.min(730/(bounds.x1-bounds.x0),830/(bounds.y1-bounds.y0));
 const tx=(x:number)=>540+(x*16/9-(bounds.x0+bounds.x1)/2)*scale;
 const ty=(y:number)=>980+(y-(bounds.y0+bounds.y1)/2)*scale;
 const edges=[...POSE_EDGES.filter(([a,b])=>a>=11&&b>=11),[0,7],[0,8],[7,11],[8,12]];
 return <svg width="1080" height="1650" style={{position:'absolute',top:0,left:0}}>
  <defs><radialGradient id="repLight"><stop stopColor="#234931" stopOpacity=".6"/><stop offset="1" stopColor={C.bg} stopOpacity="0"/></radialGradient></defs>
  <ellipse cx="540" cy="1060" rx="475" ry="560" fill="url(#repLight)"/>
  {[0,1,2,3,4].map(i=><line key={i} x1="90" x2="990" y1={680+i*170} y2={680+i*170} stroke={C.line} opacity=".55"/>)}
  <line x1="540" x2="540" y1="550" y2="1440" stroke={C.line} strokeDasharray="4 12"/>
  {edges.map(([a,b],i)=><line key={i} x1={tx(pts[a][0])} y1={ty(pts[a][1])} x2={tx(pts[b][0])} y2={ty(pts[b][1])} stroke={i%2?C.mint:C.lime} strokeWidth={a>16&&a<23?2:3} strokeLinecap="round"/>)}
  {pts.map(([x,y],i)=><circle key={i} cx={tx(x)} cy={ty(y)} r={i<11?2.5:4.5} fill={C.lime}/>)}
  <text x="88" y="1490" fill={C.muted} fontSize="23" fontFamily={mono}>VERTICAL JUMP · RECORDED LANDMARKS</text>
 </svg>;
}
const tests=['Sprint','Vertical jump','Broad jump','Dribbling','Change of direction','Shooting'];
function TestGlyph({i}:{i:number}){
 const shapes=[<path d="M10 42H42M30 30L42 42L30 54M7 25H27M13 9H36"/>,<path d="M32 54V8M17 23L32 8L47 23M10 57H54"/>,<path d="M8 52Q18 2 52 28M40 17L52 28L37 36M8 56H54"/>,<><path d="M16 16C54-10 54 74 16 48C-16 25 80 5 47 49"/><circle cx="17" cy="15" r="4"/><circle cx="47" cy="49" r="4"/></>,<path d="M10 50V14H49M36 3L49 14L36 26"/>,<><circle cx="33" cy="30" r="20"/><path d="M33 9V50M13 30H53M19 17L47 44M19 44L47 17"/></>];
 return <svg width="66" height="66" viewBox="0 0 66 66" fill="none" stroke={C.lime} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">{shapes[i]}</svg>;
}
function Evidence({f}:{f:number}){
 const grid=p(f,75,94);
 return <>
  <div style={{position:'absolute',top:225,left:76,right:76}}><Eyebrow>01 / Assessment</Eyebrow><h2 style={{...heading,fontSize:135,marginTop:34}}>Start with<br/><span style={{color:C.lime}}>evidence.</span></h2></div>
  <div style={{opacity:1-grid,transform:`scale(${1+grid*.08})`}}><RecordedJump f={f}/></div>
  <div style={{position:'absolute',left:76,right:76,top:675,opacity:grid,transform:`translateY(${(1-grid)*60}px)`}}>
   <Eyebrow color={C.muted} style={{marginBottom:26}}>Six performance tests</Eyebrow>
   <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:18}}>{tests.map((test,i)=><div key={test} style={{height:224,border:`1px solid ${C.line}`,background:C.panel,borderRadius:14,padding:'26px 28px',display:'flex',flexDirection:'column',justifyContent:'space-between'}}><TestGlyph i={i}/><div style={{fontSize:test.length>16?32:37,fontWeight:600,lineHeight:1.13}}>{test}</div></div>)}</div>
  </div>
 </>;
}

function Radar({size=660,emphasis=1}:{size?:number;emphasis?:number}){
 const center=size/2,r=size*.34;
 const point=(i:number,m:number)=>[center+Math.sin(i*Math.PI*2/5)*r*m,center-Math.cos(i*Math.PI*2/5)*r*m];
 const poly=(m:number)=>[0,1,2,3,4].map(i=>point(i,m).join(',')).join(' ');
 const values=alex.scores.map((s,i)=>point(i,s/100).join(',')).join(' ');
 return <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
  {[.25,.5,.75,1].map(m=><polygon key={m} points={poly(m)} fill="none" stroke={C.line} strokeWidth="1.7"/>)}
  {[0,1,2,3,4].map(i=>{const [x,y]=point(i,1);return <line key={i} x1={center} y1={center} x2={x} y2={y} stroke={C.line}/>;})}
  <polygon points={values} fill={C.lime} fillOpacity=".12" stroke={C.lime} strokeWidth="3"/>
  {['Speed','Shooting','Power','Control','Agility'].map((label,i)=>{const [x,y]=point(i,1.22);const [px,py]=point(i,alex.scores[i]/100);return <g key={label}><circle cx={px} cy={py} r={i===3?8:5} fill={i===3?C.lime:C.mint}/>{i===3&&<circle cx={px} cy={py} r={18+emphasis*6} stroke={C.lime} strokeWidth="2" fill="none" opacity={.5}/>}<text x={x} y={y} fill={i===3?C.lime:C.muted} fontSize={size*.045} fontFamily="Inter" textAnchor="middle" dominantBaseline="middle">{label}</text></g>;})}
 </svg>;
}
function Profile({f}:{f:number}){
 const focus=p(f,90,120), select=p(f,45,70);
 return <>
  <div style={{position:'absolute',left:76,right:76,top:220}}><Eyebrow>02 / Individual insight</Eyebrow><h2 style={{...heading,fontSize:120,marginTop:30}}>See the team.<br/><span style={{color:C.lime}}>Understand<br/>each player.</span></h2></div>
  <div style={{position:'absolute',top:665,left:76,right:76,display:'flex',gap:18,alignItems:'center',fontFamily:mono,fontSize:25,color:C.muted}}><span>Northfield FC</span><Arrow size={32}/><span style={{color:C.ink}}>U13</span><Arrow size={32}/><span style={{color:C.lime}}>Alex</span></div>
  <div style={{position:'absolute',left:76,right:76,top:755,height:795,border:`1px solid ${C.line}`,background:C.panel,borderRadius:20,overflow:'hidden'}}>
   <div style={{padding:'32px 38px',display:'flex',alignItems:'center',gap:24,borderBottom:`1px solid ${C.line}`}}><div style={{height:84,width:84,background:'#183426',border:`1px solid ${C.line}`,display:'grid',placeItems:'center',fontFamily:condensed,fontSize:54,color:C.lime}}>08</div><div><div style={{fontSize:43,fontWeight:600}}>Alex Rivera</div><div style={{fontSize:25,color:C.muted,marginTop:5}}>U13 · Midfielder</div></div><div style={{marginLeft:'auto',color:C.lime}}><Arrow/></div></div>
   <div style={{position:'absolute',left:60,top:153,opacity:1-focus,transform:`scale(${1+select*.03}) translateY(${-focus*55}px)`}}><Radar size={740}/></div>
   <div style={{position:'absolute',left:40,right:40,top:207,opacity:focus,transform:`translateY(${(1-focus)*60}px)`}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline'}}><Eyebrow>Player focus / Control</Eyebrow><div style={{fontFamily:condensed,fontSize:75,color:C.lime}}>58<span style={{fontFamily:mono,fontSize:25,color:C.muted}}> / 100</span></div></div>
    <Rule style={{margin:'20px 0 34px'}}/>
    <h3 style={{...heading,fontSize:82,lineHeight:1.05}}>Keep the ball<br/>close through<br/><span style={{color:C.lime}}>each turn.</span></h3>
    <div style={{display:'flex',gap:18,alignItems:'center',marginTop:34,fontSize:28,color:C.muted}}><span style={{width:10,height:10,background:C.lime,borderRadius:9}}/>A focus that belongs to the player.</div>
   </div>
  </div>
  <Sample style={{position:'absolute',left:82,top:1590}}/>
 </>;
}

function Training({f}:{f:number}){
 const phone=p(f,24,65);
 return <>
  <div style={{position:'absolute',top:218,left:76,right:76}}><Eyebrow>03 / Focused training</Eyebrow><h2 style={{...heading,fontSize:116,marginTop:30}}>An individual<br/><span style={{color:C.lime}}>next step.</span></h2></div>
  <div style={{position:'absolute',top:575,left:76,right:76,display:'flex',alignItems:'center',justifyContent:'space-between'}}><div><div style={{fontFamily:mono,fontSize:22,color:C.muted,marginBottom:9}}>ALEX RIVERA / U13</div><div style={{fontSize:41,fontWeight:600}}>Figure-8 dribble</div></div><div style={{background:C.lime,color:C.bg,width:62,height:62,borderRadius:40,display:'grid',placeItems:'center'}}><Arrow size={35} color={C.bg}/></div></div>
  <div style={{position:'absolute',left:230,top:710,width:620,height:850,borderRadius:48,background:'#071710',border:'3px solid #3c5145',boxShadow:'0 20px 60px #0008',overflow:'hidden',transform:`translateY(${(1-phone)*34}px) scale(${lerp(.97,1,phone)})`}}>
   <div style={{height:87,padding:'20px 28px',display:'flex',justifyContent:'space-between',alignItems:'center',background:C.panel,fontSize:23}}><span>PoseTek</span><div style={{width:110,height:26,borderRadius:20,background:C.bg}}/><span style={{color:C.lime}}>Workout</span></div>
   <div style={{position:'relative',height:657,overflow:'hidden',background:'#0e2917'}}><Sequence from={0} layout="none"><OffthreadVideo src={staticFile('figure-8.mp4')} muted style={{height:'100%',width:'100%',objectFit:'cover'}}/></Sequence><div style={{position:'absolute',bottom:0,left:0,right:0,height:210,background:'linear-gradient(transparent,#04130ed9)'}}/><div style={{position:'absolute',left:30,right:30,bottom:24,fontSize:32,lineHeight:1.18,fontWeight:600}}>Small touches.<br/>Close control.</div></div>
   <div style={{display:'flex',height:101,padding:'24px 28px',justifyContent:'space-between',alignItems:'center',fontSize:25}}><span>Watch. Set up. Train.</span><span style={{color:C.lime}}>→</span></div>
  </div>
  <div style={{position:'absolute',left:78,top:1450,fontFamily:mono,fontSize:21,color:C.muted,writingMode:'vertical-rl',transform:'rotate(180deg)'}}>PRODUCT PREVIEW</div>
  <Sample style={{position:'absolute',left:230,top:1595}}/>
 </>;
}

function Retest({f}:{f:number}){
 const progress=p(f,12,55),diff=alex.priorDribbleSeconds-alex.latestDribbleSeconds;
 return <>
  <div style={{position:'absolute',left:76,right:76,top:220}}><Eyebrow>04 / Review the change</Eyebrow><h2 style={{...heading,fontSize:128,marginTop:28}}>Retest.<br/>Review.<br/><span style={{color:C.lime}}>Refine.</span></h2></div>
  <div style={{position:'absolute',top:675,left:76,right:76,padding:'37px 38px 34px',background:C.panel,border:`1px solid ${C.line}`,borderRadius:18}}>
   <Eyebrow style={{fontSize:22}}>Same player. Same test.</Eyebrow><h3 style={{fontSize:42,margin:'20px 0 7px',fontWeight:600}}>Dribbling shuttle</h3><div style={{color:C.muted,fontSize:26}}>Alex Rivera · U13</div><Rule style={{margin:'28px 0 34px'}}/>
   {[{label:'Earlier assessment',value:alex.priorDribbleSeconds},{label:'Latest assessment',value:alex.latestDribbleSeconds}].map((v,i)=><div key={v.label} style={{marginBottom:34}}><div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:18}}><span style={{fontSize:27,color:C.muted}}>{v.label}</span><span style={{fontFamily:condensed,fontSize:90,color:i?C.lime:C.ink,lineHeight:1}}>{v.value.toFixed(2)}<span style={{fontFamily:mono,fontSize:24}}> sec</span></span></div><div style={{height:18,width:'100%',background:'#183728',borderRadius:3,overflow:'hidden'}}><div style={{height:'100%',width:`${v.value/10*100*progress}%`,background:i?C.lime:'#718c7c'}}/></div></div>)}
   <div style={{display:'flex',justifyContent:'space-between',fontFamily:mono,fontSize:22,color:C.muted}}><span>0</span><span>Time · seconds</span><span>10</span></div>
  </div>
  <Reveal frame={f} at={55} style={{position:'absolute',top:1310,left:76,right:76}}><div style={{display:'flex',alignItems:'baseline',gap:18}}><span style={{fontFamily:condensed,fontSize:126,color:C.lime}}>{diff.toFixed(2)}</span><span style={{fontSize:35}}>sec faster</span></div><div style={{fontSize:25,color:C.muted,marginTop:8,lineHeight:1.5}}>Illustrative change · Not a promised outcome</div><Rule style={{marginTop:30}}/><div style={{fontSize:32,marginTop:27}}>Compare the evidence. Choose what comes next.</div></Reveal>
 </>;
}

function Connected({f}:{f:number}){
 return <>
  <div style={{position:'absolute',top:220,left:76,right:76}}><Eyebrow>A shared view of development</Eyebrow><h2 style={{...heading,fontSize:133,marginTop:38}}>Players train.<br/><span style={{color:C.lime}}>Coaches<br/>review.</span></h2></div>
  <div style={{position:'absolute',top:735,left:76,right:76}}>
   <div style={{fontFamily:mono,fontSize:27,color:C.muted,marginBottom:23,display:'flex',alignItems:'center',gap:22}}><span>Northfield FC</span><Arrow size={32}/><span style={{color:C.ink}}>U13</span></div>
   {sampleTeams[0].players.map((player,i)=><Reveal key={player.id} frame={f} at={8+i*8} style={{padding:'25px 32px',marginBottom:15,border:`1px solid ${i===0?C.lime:C.line}`,background:i===0?'#173322':C.panel,borderRadius:12,display:'flex',gap:26,alignItems:'center'}}><div style={{fontFamily:condensed,fontSize:48,color:i===0?C.lime:C.muted,width:58}}>{String(player.number).padStart(2,'0')}</div><div style={{flex:1}}><div style={{fontSize:36,fontWeight:600}}>{player.name}</div><div style={{color:C.muted,fontSize:25,marginTop:8}}>{i===0?'Close control through each turn':i===1?'Controlled first touch':'Control through a change of direction'}</div></div>{i===0&&<Arrow size={36}/>}</Reveal>)}
   <div style={{marginTop:55,paddingTop:30,borderTop:`1px solid ${C.line}`,display:'flex',justifyContent:'space-between',alignItems:'center'}}>{['Plan','Train','Retest'].map((label,i)=><React.Fragment key={label}><div style={{fontFamily:condensed,fontSize:56,color:i===Math.floor(f/32)%3?C.lime:C.ink}}>{label}</div>{i<2&&<Arrow size={38}/>}</React.Fragment>)}</div>
   <Sample style={{marginTop:28}}/>
  </div>
 </>;
}

function Closing({f}:{f:number}){
 return <>
  <div style={{position:'absolute',inset:0,background:'radial-gradient(ellipse at 50% 55%,#15372499,transparent 66%)'}}/>
  <Reveal frame={f} at={0} style={{position:'absolute',top:392,left:76}}><Brand large/></Reveal>
  <Reveal frame={f} at={4} style={{position:'absolute',left:76,right:76,top:635}}><h2 style={{...heading,fontSize:148}}>Talk about<br/><span style={{color:C.lime}}>your team.</span></h2></Reveal>
  <Reveal frame={f} at={10} style={{position:'absolute',top:1030,left:76,right:76}}><Rule/><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',paddingTop:36}}><span style={{fontSize:43,fontWeight:600}}>posetek.net/coaches</span><div style={{background:C.lime,width:76,height:76,borderRadius:40,display:'grid',placeItems:'center'}}><Arrow color={C.bg}/></div></div><div style={{fontSize:29,color:C.muted,marginTop:38}}>Start with evidence. Train what’s next.</div></Reveal>
 </>;
}

export const Film:React.FC<Props>=({audioEnabled=false,captions=[]})=>{
 const frame=useCurrentFrame();
 const cap=captions.find(c=>frame/30>=c.start&&frame/30<c.end);
 const chapter=frame<120?'THE QUESTION':frame<300?'ASSESS':frame<540?'UNDERSTAND':frame<840?'TRAIN':frame<1050?'RETEST':frame<1200?'DEVELOP':'POSETEK';
 return <AbsoluteFill style={{background:C.bg,color:C.ink,fontFamily:'Inter, sans-serif',overflow:'hidden'}}>
  <Fonts/>
  <div style={{position:'absolute',inset:0,background:'radial-gradient(ellipse at 85% 30%,#102b2066,transparent 60%)'}}/>
  <div style={{position:'absolute',zIndex:40,top:71,left:76,right:76,display:'flex',justifyContent:'space-between',alignItems:'center',opacity:1-p(frame,1192,1210)}}><Brand/><Eyebrow color={C.muted} style={{fontSize:19,letterSpacing:2}}>FOR CLUBS & COACHES</Eyebrow></div>
  <Window start={0} end={126}>{f=><Hero f={f}/>}</Window>
  <Window start={114} end={306}>{f=><Evidence f={f}/>}</Window>
  <Window start={294} end={546}>{f=><Profile f={f}/>}</Window>
  <Sequence from={534} durationInFrames={312} layout="none"><TrainingLocal/></Sequence>
  <Window start={834} end={1056}>{f=><Retest f={f}/>}</Window>
  <Window start={1044} end={1206}>{f=><Connected f={f}/>}</Window>
  <Window start={1194} end={1350}>{f=><Closing f={f}/>}</Window>
  {cap&&<div style={{position:'absolute',left:82,right:82,top:1693,minHeight:90,display:'flex',justifyContent:'center',alignItems:'center',fontSize:32,lineHeight:1.35,textAlign:'center',fontWeight:400,textShadow:'0 2px 6px #000',background:'#04130ee8',padding:'10px 20px',borderRadius:10}}>{cap.text}</div>}
  <div style={{position:'absolute',left:76,right:76,bottom:70,height:2,background:C.line}}><div style={{width:`${frame/1349*100}%`,height:2,background:C.lime}}/></div>
  <div style={{position:'absolute',left:76,right:76,bottom:97,display:'flex',justifyContent:'space-between',fontFamily:mono,fontSize:19,letterSpacing:2,color:C.muted}}><span>{chapter}</span><span>POSETEK / DEVELOPMENT IN MOTION</span></div>
  {audioEnabled&&<Audio src={staticFile('audio/master.wav')}/>}
 </AbsoluteFill>;
};
function TrainingLocal(){const f=useCurrentFrame();const alpha=p(f,0,14)*(1-p(f,298,312));return <AbsoluteFill style={{opacity:alpha,transform:`translateY(${(1-p(f,0,14))*30}px)`}}><Training f={f}/></AbsoluteFill>;}
