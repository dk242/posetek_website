import React, {CSSProperties,useEffect,useState} from 'react';
import {AbsoluteFill,Audio,Easing,OffthreadVideo,Sequence,continueRender,delayRender,interpolate,staticFile,useCurrentFrame} from 'remotion';
import {PoseVisual} from './PoseVisual';
import {EvidenceV2,ClubV2,TrainingV2,ConnectedV2} from './RevisionScenes';
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
 const enter=p(f,0,14),exit=end===1650?1:1-p(frame,end-14,end);
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
 const chapter=frame<120?'THE QUESTION':frame<360?'ASSESS':frame<720?'UNDERSTAND':frame<1140?'TRAIN':frame<1380?'RETEST':frame<1500?'DEVELOP':'POSETEK';
 return <AbsoluteFill style={{background:C.bg,color:C.ink,fontFamily:'Inter, sans-serif',overflow:'hidden'}}>
  <Fonts/>
  <div style={{position:'absolute',inset:0,background:'radial-gradient(ellipse at 85% 30%,#102b2066,transparent 60%)'}}/>
  <div style={{position:'absolute',zIndex:40,top:71,left:76,right:76,display:'flex',justifyContent:'space-between',alignItems:'center',opacity:1-p(frame,1492,1510)}}><Brand/><Eyebrow color={C.muted} style={{fontSize:19,letterSpacing:2}}>FOR CLUBS & COACHES</Eyebrow></div>
  <Window start={0} end={126}>{f=><Hero f={f}/>}</Window>
  <Window start={114} end={366}>{f=><EvidenceV2 f={f}/>}</Window>
  <Window start={354} end={726}>{f=><ClubV2 f={f}/>}</Window>
  <Sequence from={714} durationInFrames={432} layout="none"><TrainingLocal/></Sequence>
  <Window start={1134} end={1386}>{f=><Retest f={f}/>}</Window>
  <Window start={1374} end={1506}>{()=> <ConnectedV2/>}</Window>
  <Window start={1494} end={1650}>{f=><Closing f={f}/>}</Window>
  {cap&&<div style={{position:'absolute',left:82,right:82,top:1693,minHeight:90,display:'flex',justifyContent:'center',alignItems:'center',fontSize:32,lineHeight:1.35,textAlign:'center',fontWeight:400,textShadow:'0 2px 6px #000',background:'#04130ee8',padding:'10px 20px',borderRadius:10}}>{cap.text}</div>}
  <div style={{position:'absolute',left:76,right:76,bottom:70,height:2,background:C.line}}><div style={{width:`${frame/1649*100}%`,height:2,background:C.lime}}/></div>
  <div style={{position:'absolute',left:76,right:76,bottom:97,display:'flex',justifyContent:'space-between',fontFamily:mono,fontSize:19,letterSpacing:2,color:C.muted}}><span>{chapter}</span><span>POSETEK / DEVELOPMENT IN MOTION</span></div>
  {audioEnabled&&<Audio src={staticFile('audio-v2/master.wav')}/>}
 </AbsoluteFill>;
};
function TrainingLocal(){const f=useCurrentFrame();const alpha=p(f,0,14)*(1-p(f,418,432));return <AbsoluteFill style={{opacity:alpha,transform:`translateY(${(1-p(f,0,14))*30}px)`}}><TrainingV2 f={f}/></AbsoluteFill>;}
