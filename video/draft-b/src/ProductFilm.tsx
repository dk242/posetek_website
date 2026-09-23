import React,{CSSProperties,useEffect,useState} from 'react';
import {AbsoluteFill,Audio,Easing,OffthreadVideo,Sequence,continueRender,delayRender,interpolate,staticFile,useCurrentFrame} from 'remotion';
import {MovementPreview} from './RevisionScenes';
import {RecordedJumpComparison,RecordedKickComparison,ProductMovementPreview} from './ProductPose';
import {PlayerProfile,PlanBuilder,GuidedProductWorkout,CoachingConversation,ProgressReview} from './ProductScreens';

const C={bg:'#04130e',panel:'#0a211a',lime:'#b7f34a',ink:'#f0f5ed',muted:'#a9bdb1',line:'#254036',mint:'#c1f5e5'};
const mono='"IBM Plex Mono",monospace',head='"Barlow Condensed",sans-serif';
const p=(f:number,a:number,b:number)=>interpolate(f,[a,b],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.bezier(.18,.78,.22,1)});
const title:CSSProperties={fontFamily:head,fontWeight:700,lineHeight:1.02,letterSpacing:'-.015em',textTransform:'uppercase',margin:0};
export const PRODUCT_DURATION=4500;
type Props={audioEnabled?:boolean;captions?:{start:number;end:number;text:string}[]};
function Fonts(){const [handle]=useState(()=>delayRender('Load product film fonts'));useEffect(()=>{Promise.all([['Barlow Condensed','barlow-700.woff2','700'],['Inter','inter-400.woff2','400'],['Inter','inter-600.woff2','600'],['IBM Plex Mono','plex-400.woff2','400']].map(async([name,file,weight])=>{const font=new FontFace(name,`url(${staticFile('fonts/'+file)})`,{weight});await font.load();(document.fonts as unknown as {add:(f:FontFace)=>void}).add(font);})).then(()=>continueRender(handle));},[handle]);return null;}
function Brand({large=false}:{large?:boolean}){return <div style={{display:'flex',alignItems:'center',gap:large?23:13,fontWeight:600,fontSize:large?53:27,letterSpacing:large?7:3}}><div style={{width:large?80:42,height:large?80:42,background:C.lime,color:C.bg,display:'grid',placeItems:'center',fontSize:large?59:31,borderRadius:3,position:'relative'}}>P<span style={{position:'absolute',right:-1,bottom:-1,width:large?17:10,height:large?17:10,background:C.bg}}/></div>POSETEK</div>;}
function Label({children,style={}}:{children:React.ReactNode;style?:CSSProperties}){return <div style={{fontFamily:mono,fontSize:21,color:C.muted,...style}}>{children}</div>;}
function Reveal({f,at=0,children,style={}}:{f:number;at?:number;children:React.ReactNode;style?:CSSProperties}){const v=p(f,at,at+18);return <div style={{opacity:v,transform:`translateY(${(1-v)*22}px)`,...style}}>{children}</div>;}
function Scene({from,duration,children}:{from:number;duration:number;children:(f:number)=>React.ReactNode}){return <Sequence from={from} durationInFrames={duration}><SceneInner duration={duration}>{children}</SceneInner></Sequence>;}
function SceneInner({duration,children}:{duration:number;children:(f:number)=>React.ReactNode}){const f=useCurrentFrame();return <AbsoluteFill style={{background:C.bg,opacity:1-p(f,duration-7,duration)}}>{children(f)}</AbsoluteFill>;}
function Heading({eyebrow,children}:{eyebrow:string;children:React.ReactNode}){return <div style={{position:'absolute',left:96,top:122,right:96}}><Label style={{fontSize:17,color:C.lime,letterSpacing:2,marginBottom:12}}>{eyebrow}</Label><h2 style={{...title,fontSize:66}}>{children}</h2></div>;}

function Phone({f,small=false}:{f:number;small?:boolean}){return <div style={{width:small?240:350,height:small?472:700,borderRadius:small?34:45,border:'3px solid #577063',background:'#071a12',boxShadow:'0 30px 70px #0008',overflow:'hidden',position:'relative'}}><div style={{height:38,display:'flex',justifyContent:'center',alignItems:'center'}}><div style={{width:90,height:15,borderRadius:10,background:'#020b08'}}/></div><div style={{padding:small?18:28}}><Brand/><Label style={{fontSize:small?14:19,marginTop:20}}>YOUR DEVELOPMENT</Label><div style={{...title,fontSize:small?39:59,marginTop:14}}>A clear<br/>next step.</div><div style={{margin:'10px 0 0',width:448,transform:small?'scale(.45)':'scale(.65)',transformOrigin:'top left',height:small?145:188}}><MovementPreview index={2} f={f%150}/></div>{['Assess','Train','Review'].map((x,i)=><div key={x} style={{padding:'13px 0',borderTop:`1px solid ${C.line}`,fontSize:small?18:25,display:'flex',justifyContent:'space-between'}}><span>{x}</span><span style={{color:C.lime}}>{i===Math.floor(f/70)%3?'→':'·'}</span></div>)}</div></div>;}
function Opening({f}:{f:number}){return <><div style={{position:'absolute',left:96,top:208,width:1050}}><Label style={{color:C.lime,letterSpacing:3}}>PLAYER DEVELOPMENT, CONNECTED</Label><h1 style={{...title,fontSize:136,marginTop:26}}>Elite development,<br/><span style={{color:C.lime}}>within reach.</span></h1><Reveal f={f} at={38}><div style={{fontSize:32,lineHeight:1.5,color:C.muted,marginTop:34,maxWidth:810}}>Understand your movement.<br/>Know what to work on. Put it into practice.</div></Reveal><div style={{display:'flex',gap:16,marginTop:43}}>{['Movement analysis','Personalized training','Coaching guidance'].map((x,i)=><Reveal key={x} f={f} at={90+i*40}><div style={{fontSize:21,borderTop:`2px solid ${C.line}`,padding:'18px 16px 0 0'}}>{x}</div></Reveal>)}</div></div><div style={{position:'absolute',left:1295,top:175,transform:`translateY(${(1-p(f,0,30))*55}px) rotate(-4deg)`}}><Phone f={f}/></div><div style={{position:'absolute',left:1115,top:663,width:275,padding:24,background:C.lime,color:C.bg,boxShadow:'0 15px 40px #0005',transform:`translateX(${(1-p(f,90,125))*70}px)`,opacity:p(f,90,125)}}><div style={{fontFamily:head,fontSize:50,lineHeight:1}}>ONE<br/>PLATFORM</div><div style={{fontSize:17,marginTop:15}}>From testing<br/>to your next session.</div></div></>;}

// A deliberately illustrated athlete explains the setup; this is not captured product output.
function Athlete({f}:{f:number}){
 const poses=[
  {at:0,x:0,pts:[[0,-284],[0,-241],[-6,-136],[4,-68],[0,0],[26,-65],[28,0],[-20,-178],[-8,-123],[27,-183],[41,-137]]},
  {at:56,x:0,pts:[[30,-230],[18,-190],[-31,-107],[28,-66],[0,0],[51,-62],[28,0],[-55,-172],[-95,-204],[-29,-175],[-73,-211]]},
  {at:82,x:78,pts:[[21,-329],[10,-287],[-8,-189],[48,-170],[68,-113],[64,-188],[88,-134],[43,-318],[63,-369],[59,-294],[97,-329]]},
  {at:109,x:204,pts:[[42,-239],[29,-196],[-20,-107],[43,-60],[78,0],[63,-75],[101,0],[77,-186],[110,-235],[91,-173],[132,-211]]},
  {at:141,x:204,pts:[[77,-284],[73,-241],[71,-136],[82,-68],[78,0],[105,-65],[101,0],[55,-178],[67,-123],[100,-183],[114,-137]]}
 ];
 const t=Math.max(0,f-72),i=Math.min(poses.length-2,Math.max(0,poses.findIndex((v,j)=>j<poses.length-1&&t>=v.at&&t<poses[j+1].at)));
 const a=t>=141?poses[4]:poses[i],b=t>=141?a:poses[i+1],u=p(t,a.at,b.at===a.at?a.at+1:b.at);
 const pts=a.pts.map((v,j)=>v.map((n,k)=>n+(b.pts[j][k]-n)*u));const travel=a.x+(b.x-a.x)*u;
 const seg=(a:number,b:number,color:string,width:number)=><line x1={pts[a][0]} y1={pts[a][1]} x2={pts[b][0]} y2={pts[b][1]} stroke={color} strokeWidth={width} strokeLinecap="round"/>;
 return <g transform={`translate(${1080+travel} 764)`}>
  <ellipse cx="45" cy="10" rx="87" ry="15" fill="#020b08" opacity=".7"/>
  {seg(2,5,'#5a8d2b',33)}{seg(5,6,'#b39376',24)}{seg(1,9,'#819989',24)}{seg(9,10,'#b39376',18)}
  {seg(1,2,'#668171',59)}{seg(1,2,'#e8efe3',48)}
  {seg(2,3,C.lime,35)}{seg(3,4,'#d9b291',25)}
  {seg(1,7,'#e8efe3',27)}{seg(7,8,'#d9b291',19)}
  <circle cx={pts[0][0]} cy={pts[0][1]} r="27" fill="#d9b291"/>
  <path d={`M${pts[0][0]-25} ${pts[0][1]-8} Q${pts[0][0]-14} ${pts[0][1]-41} ${pts[0][0]+18} ${pts[0][1]-25}`} stroke="#27342b" strokeWidth="13" fill="none" strokeLinecap="round"/>
  {[4,6].map((n)=><line key={n} x1={pts[n][0]-10} y1={pts[n][1]} x2={pts[n][0]+20} y2={pts[n][1]} stroke="#f0f5ed" strokeWidth="17" strokeLinecap="round"/>)}
 </g>;
}
function Marker({x,y,scale=1}:{x:number;y:number;scale?:number}){return <g transform={`translate(${x} ${y}) scale(${scale})`}><path d="M-64 32 L-43 -40 L38 -40 L66 32Z" fill="#d4ddd1" stroke="#7c9484" strokeWidth="3"/><path d="M-43 -40 L38 -40 L25 -70 L-31 -70Z" fill="#e8efdf"/><rect x="-30" y="-53" width="58" height="58" fill="#fff"/><rect x="-24" y="-47" width="46" height="46" fill="#10211b"/><path d="M-17 -40h13v13h-13z M3 -40h12v8H3z M-17 -19h8v11h-8z M-3 -25h11v10H-3z M10 -13h6v6h-6z" fill="#fff"/></g>;}
function Setup({f}:{f:number}){return <><Heading eyebrow="01 / THE SETUP">A smartphone. Custom markers. Your movement.</Heading><svg width="1920" height="1000" style={{position:'absolute',top:0,left:0}} viewBox="0 0 1920 1000"><defs><linearGradient id="turf" x2="0" y2="1"><stop stopColor="#183b29"/><stop offset="1" stopColor="#092019"/></linearGradient></defs><path d="M260 470L1310 375L1780 795L435 900Z" fill="url(#turf)" stroke="#315b40" strokeWidth="2"/>{[0,1,2,3,4].map(i=><path key={i} d={`M${310+i*201} ${490-i*17}L${480+i*232} ${881-i*18}`} stroke="#3b5d46" strokeWidth="1" opacity=".35"/>)}<path d="M558 700L1270 475L1430 749Z" fill="#b7f34a08" stroke={C.lime} strokeDasharray="8 10" strokeWidth="2" opacity={p(f,35,65)*.7}/><g opacity={p(f,0,20)} transform={`translate(${(1-p(f,0,24))*-250} 0)`}><path d="M561 656L475 866M561 656L670 852M561 656L554 884" stroke="#5e7467" strokeWidth="12" strokeLinecap="round"/><path d="M561 583L561 740" stroke="#afc1b1" strokeWidth="10"/><rect x="476" y="524" width="167" height="87" rx="13" fill="#030d08" stroke="#849e8e" strokeWidth="5"/><rect x="489" y="535" width="142" height="64" rx="7" fill="#163e29"/><circle cx="499" cy="545" r="7" fill={C.lime}/><path d="M532 581l20-30 42 33" stroke={C.lime} strokeWidth="3" fill="none"/></g><g opacity={p(f,30,55)}><Marker x={982} y={791} scale={.85}/></g><g opacity={p(f,58,78)}><Athlete f={f}/></g><g fill={C.ink} fontFamily="Inter" fontSize="28"><text x="313" y="416">Smartphone + tripod</text><text x="875" y="871">Custom ArUco marker</text></g></svg><Label style={{position:'absolute',left:100,top:906,fontSize:18}}>Illustrated setup · Match the on-screen positioning guidance</Label></>;}

function PairedDemo({f,audio}:{f:number;audio:boolean}){
 const result=f>=570,zoom=p(f,570,582),phase=f<190?'READY WHEN YOU ARE':f<520?'CAPTURE THE COMPLETE REP':'ON-DEVICE ANALYSIS';
 const time=f/30;
 const cues=[{a:1.3,b:2.6,t:'Person is in view.'},{a:4.82,b:7.7,t:'You are in position. Put your hands up when ready.'},{a:9.2,b:10.35,t:'Starting drill.'},{a:11.88,b:12.55,t:'3'},{a:12.94,b:13.6,t:'2'},{a:13.94,b:14.6,t:'1'},{a:19.9,b:20.95,t:'Processing complete.'},{a:21.42,b:23.25,t:'Your broad jump was 4.8 feet.'},{a:23.64,b:24.7,t:'Ready for next rep.'}];
 const cue=cues.find(c=>time>=c.a&&time<c.b);
 return <><Heading eyebrow="02 / WATCH IT WORK">{result?'Hear the result. Keep moving.':'The app guides. The player moves.'}</Heading>
  <div style={{position:'absolute',left:96+zoom*174,top:278-zoom*37,width:1175+zoom*205}}>
   <Label style={{fontSize:19,color:C.lime,marginBottom:17}}>ON THE PHONE · ORIGINAL APP RECORDING</Label>
   <div style={{padding:13,border:'2px solid #567461',background:'#010a06',borderRadius:26,boxShadow:'0 20px 70px #0006'}}><OffthreadVideo src={staticFile('product/screen-demo.mp4')} muted style={{display:'block',width:'100%',borderRadius:16}}/></div>
   {!result&&<><div style={{display:'flex',alignItems:'center',gap:18,marginTop:38}}><div style={{height:10,width:10,background:C.lime,borderRadius:9}}/><Label style={{color:C.ink,fontSize:23}}>{phase}</Label></div><Label style={{fontSize:18,marginTop:17}}>Original app audio · Idle time trimmed · Rep shown at 1×</Label></>}
  </div>
  {!result&&<div style={{position:'absolute',left:1360,top:248,width:386}}><Label style={{fontSize:19,color:C.lime,marginBottom:17}}>ON THE FIELD</Label><OffthreadVideo src={staticFile('product/field-demo.mp4')} muted style={{width:386,height:686,objectFit:'cover',borderRadius:18,border:`1px solid ${C.line}`}}/></div>}
  {result&&<Label style={{position:'absolute',left:270,top:944,fontSize:18}}>Processing wait shortened · Original recorded result</Label>}
  {cue&&<div style={{position:'absolute',left:150,right:150,top:974,textAlign:'center',fontSize:28,color:C.ink}}>{cue.t}</div>}
  {audio&&<Audio src={staticFile('product/demo-audio.wav')}/>}</>;
}
function SixTests({f}:{f:number}){return <><Heading eyebrow="03 / ASSESS">Six tests. One connected picture.</Heading><div style={{position:'absolute',left:96,right:96,top:248,display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:24}}>{['Sprint','Vertical jump','Broad jump','Dribbling','Change of direction','Shooting'].map((name,i)=><div key={name} style={{height:306,border:`1px solid ${C.line}`,background:C.panel,borderRadius:14,position:'relative',overflow:'hidden'}}><div style={{position:'absolute',left:35,top:-5,transform:'scale(1.05)',transformOrigin:'top left'}}><ProductMovementPreview index={i} f={f}/></div><div style={{position:'absolute',left:25,bottom:21,display:'flex',gap:18,alignItems:'center'}}><Label style={{fontSize:18,color:C.lime}}>0{i+1}</Label><div style={{fontSize:28,fontWeight:600}}>{name}</div></div></div>)}</div></>;}
function ProductPanel({eyebrow,heading,children}:{eyebrow:string;heading:string;children:React.ReactNode}){return <><Heading eyebrow={eyebrow}>{heading}</Heading><div style={{position:'absolute',left:96,top:235,width:1728,height:700}}>{children}</div></>;}
function Closing({f}:{f:number}){const collapse=p(f,120,160);return <><div style={{position:'absolute',left:96,top:188,width:1040}}><Brand large/><h2 style={{...title,fontSize:112,marginTop:49}}>Start with evidence.<br/><span style={{color:C.lime}}>Train what’s next.</span></h2><div style={{fontSize:32,color:C.muted,lineHeight:1.5,marginTop:34,maxWidth:860}}>Advanced development tools.<br/>Coaching support. Within reach.</div><div style={{fontSize:32,marginTop:39,display:'inline-flex',alignItems:'center',gap:25,borderBottom:`2px solid ${C.lime}`,paddingBottom:17}}>Explore PoseTek <span style={{color:C.lime}}>→</span> posetek.net</div></div><div style={{position:'absolute',left:1325,top:196,transform:`scale(${.95+collapse*.05})`}}><Phone f={f}/></div>{['ASSESS','TRAIN','REVIEW'].map((x,i)=><div key={x} style={{position:'absolute',left:1210+(i===1?300:0)+(i===2?70:0),top:260+i*176,padding:'19px 23px',background:i===1?C.lime:C.panel,color:i===1?C.bg:C.ink,border:`1px solid ${C.line}`,fontFamily:mono,fontSize:24,letterSpacing:2,opacity:1-collapse,transform:`translateX(${collapse*(i===1?-100:100)}px)`}}>{x}</div>)}</>;}

export const ProductFilm:React.FC<Props>=({audioEnabled=false,captions=[]})=>{const frame=useCurrentFrame();const cap=captions.find(c=>frame/30>=c.start&&frame/30<c.end);const inDemo=frame>=630&&frame<1380;return <AbsoluteFill style={{background:C.bg,color:C.ink,fontFamily:'Inter,sans-serif',overflow:'hidden'}}><Fonts/>
 <Scene from={0} duration={390}>{f=><Opening f={f}/>}</Scene>
 <Scene from={390} duration={240}>{f=><Setup f={f}/>}</Scene>
 <Scene from={630} duration={750}>{f=><PairedDemo f={f} audio={audioEnabled}/>}</Scene>
 <Scene from={1380} duration={150}>{f=><SixTests f={f}/>}</Scene>
 <Scene from={1530} duration={480}>{f=><ProductPanel eyebrow="04 / COMPARE" heading="See the movement behind the result."><RecordedJumpComparison frame={f}/></ProductPanel>}</Scene>
 <Scene from={2010} duration={360}>{f=><ProductPanel eyebrow="05 / UNDERSTAND" heading="Your profile. A clearer focus."><PlayerProfile frame={f}/></ProductPanel>}</Scene>
 <Scene from={2370} duration={450}>{f=><ProductPanel eyebrow="06 / PERSONALIZE" heading="Turn your focus into a session."><PlanBuilder frame={f}/></ProductPanel>}</Scene>
 <Scene from={2820} duration={390}>{f=><ProductPanel eyebrow="07 / TRAIN" heading="Guidance through every set."><GuidedProductWorkout frame={f}/></ProductPanel>}</Scene>
 <Scene from={3210} duration={300}>{f=><ProductPanel eyebrow="08 / REFINE TECHNIQUE" heading="Two kicks. A closer look."><RecordedKickComparison frame={f}/></ProductPanel>}</Scene>
 <Scene from={3510} duration={180}>{f=><ProductPanel eyebrow="08 / COACHING SUPPORT" heading="Understand the next step."><CoachingConversation frame={f}/></ProductPanel>}</Scene>
 <Scene from={3690} duration={360}>{f=><ProductPanel eyebrow="09 / RETEST & REVIEW" heading="Keep your development in view."><ProgressReview frame={f}/></ProductPanel>}</Scene>
 <Scene from={4050} duration={450}>{f=><Closing f={f}/>}</Scene>
 <div style={{position:'absolute',left:96,right:96,top:51,display:'flex',alignItems:'center',justifyContent:'space-between',opacity:1-p(frame,4035,4050)}}><Brand/><Label style={{fontSize:18,letterSpacing:2}}>PLAYER DEVELOPMENT, CONNECTED.</Label></div>
 {cap&&!inDemo&&<div style={{position:'absolute',left:120,right:120,top:956,minHeight:66,display:'flex',alignItems:'center',justifyContent:'center',textAlign:'center',fontSize:29,lineHeight:1.3,padding:'7px 22px',boxSizing:'border-box',background:'#04130ef5',borderRadius:10}}>{cap.text}</div>}
 <div style={{position:'absolute',left:96,right:96,bottom:28,height:2,background:C.line}}><div style={{height:2,width:`${frame/4499*100}%`,background:C.lime}}/></div>
 {audioEnabled&&<Audio src={staticFile('audio-product-v1/master.wav')}/>}
 </AbsoluteFill>;};
