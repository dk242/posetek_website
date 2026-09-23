import React, {CSSProperties, useEffect, useState} from 'react';
import {cancelRender, continueRender, delayRender, Easing, Freeze, interpolate, OffthreadVideo, staticFile} from 'remotion';

/**
 * Editorial reconstructions of the checked native source, not live app captures.
 * Reference lock: PRODUCT_DEMO_PLAN.md; native d09151a WorkoutChatView,
 * WorkoutNowCard, AthleteStatsView and AI Coach. Product data is read from the
 * ignored local asset package. No athlete measurements live in this source.
 */
const C = {bg:'#04130e', panel:'#0a211a', raised:'#102d22', lime:'#b7f34a', ink:'#f0f5ed', muted:'#a9bdb1', line:'#29483b', mint:'#c1f5e5'};
const mono='"IBM Plex Mono", monospace';
const head='"Barlow Condensed", sans-serif';
const ease=(f:number,a:number,b:number)=>interpolate(f,[a,b],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.bezier(.2,.75,.2,1)});
const box:CSSProperties={position:'relative',width:1728,height:700,overflow:'hidden',boxSizing:'border-box',background:C.panel,border:`1px solid ${C.line}`,borderRadius:22,color:C.ink,fontFamily:'Inter, sans-serif'};
const display:CSSProperties={fontFamily:head,fontWeight:700,lineHeight:1.03,letterSpacing:'-.012em',margin:0};
export type ProductScreenProps={frame:number};
type Metric={label:string;value:string|number;unit?:string;date?:string;status?:string};
type Axis={id:string;label:string;score?:number|null;metrics?:Metric[];status?:string};
type History={date:string;test:string;value:string|number;unit?:string;status?:string};
type Profile={displayName?:string;verifiedAt?:string;axes?:Axis[];metrics?:Metric[];history?:History[];coaching?:{cue?:string;question?:string;answer?:string;sourceLabel?:string};note?:string};
const nativeAxes:Axis[]=[{id:'power',label:'Power'},{id:'speed',label:'Speed'},{id:'agility',label:'Agility'},{id:'ballControl',label:'Ball Control'},{id:'striking',label:'Striking'}];
function useProfile():Profile {
  const [data,setData]=useState<Profile>({});
  const [handle]=useState(()=>delayRender('Read sanitized product evidence'));
  useEffect(()=>{
    let active=true;
    fetch(staticFile('investor-exact/profile.json'))
      .then(r=>{if(!r.ok)throw new Error('Verified product profile unavailable');return r.json();})
      .then((d:Profile)=>{
        if(!Array.isArray(d.axes)||!d.axes.some(a=>a.metrics?.length)||d.axes.some(a=>a.score!=null&&!Number.isFinite(a.score))) {
          throw new Error('Prepare the sanitized, verified product profile before rendering');
        }
        if(active)setData(d);
        continueRender(handle);
      }).catch(error=>cancelRender(error));
    return()=>{active=false;};
  },[handle]);
  return data;
}
function Micro({children,style={}}:{children:React.ReactNode;style?:CSSProperties}) {return <div style={{fontFamily:mono,fontSize:18,color:C.muted,lineHeight:1.45,...style}}>{children}</div>;}
function Check({size=22}:{size?:number}) {return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="m5 12 4 4L19 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;}
function Arrow({size=25}:{size?:number}) {return <svg width={size} height={size} viewBox="0 0 24 24" fill="none"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/></svg>;}
function Tag({children,active=false}:{children:React.ReactNode;active?:boolean}) {return <div style={{display:'inline-flex',alignItems:'center',gap:8,background:active?C.lime:C.raised,color:active?C.bg:C.muted,padding:'8px 13px',borderRadius:7,fontFamily:mono,fontSize:16,whiteSpace:'nowrap'}}>{children}</div>;}
function Tap({frame,at,x,y}:{frame:number;at:number;x:number;y:number}) {const p=ease(frame,at,at+17);return frame>=at&&frame<at+20?<div style={{position:'absolute',zIndex:10,left:x-25,top:y-25,width:50,height:50,border:`3px solid ${C.ink}`,borderRadius:'50%',transform:`scale(${.45+p})`,opacity:1-p,boxSizing:'border-box'}}/>:null;}
function Header({section,title,right}:{section:string;title:string;right?:React.ReactNode}) {return <div style={{height:104,padding:'21px 34px',boxSizing:'border-box',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:`1px solid ${C.line}`}}><div style={{display:'flex',alignItems:'center',gap:23}}><div style={{height:47,width:47,borderRadius:11,background:C.lime,color:C.bg,display:'grid',placeItems:'center',fontWeight:600,fontSize:32}}>P</div><div><Micro style={{fontSize:15,color:C.lime,letterSpacing:1.5,textTransform:'uppercase'}}>{section}</Micro><div style={{fontSize:30,fontWeight:600,marginTop:3}}>{title}</div></div></div>{right}</div>;}
function Footer({children}:{children:React.ReactNode}) {return <div style={{position:'absolute',bottom:0,left:0,right:0,height:40,padding:'10px 30px',boxSizing:'border-box',background:C.bg,borderTop:`1px solid ${C.line}`,fontFamily:mono,fontSize:14,color:C.muted}}>{children}</div>;}
function Primary({children,style={}}:{children:React.ReactNode;style?:CSSProperties}) {return <div style={{minHeight:58,padding:'15px 23px',background:C.lime,color:C.bg,borderRadius:9,display:'flex',alignItems:'center',justifyContent:'space-between',gap:20,fontWeight:600,fontSize:23,boxSizing:'border-box',...style}}>{children}</div>;}

function Radar({axes,selected}:{axes:Axis[];selected:number}) {
  const cx=332,cy=264,r=185;
  const point=(i:number,k:number)=>{const a=-Math.PI/2+i*2*Math.PI/5;return [cx+Math.cos(a)*r*k,cy+Math.sin(a)*r*k];};
  const polygon=(k:number)=>axes.map((_,i)=>point(i,k).join(',')).join(' ');
  const measured=axes.filter(a=>typeof a.score==='number');
  const values=axes.map((a,i)=>point(i,Math.max(0,Math.min(130,a.score??0))/130));
  return <svg width="665" height="528" viewBox="0 0 665 528">
    {[.25,.5,.75,1].map(k=><polygon key={k} points={polygon(k)} fill="none" stroke={C.line} strokeWidth="1.25"/>)}
    {axes.map((a,i)=>{const [x,y]=point(i,1);return <line key={a.id} x1={cx} y1={cy} x2={x} y2={y} stroke={i===selected?C.lime:C.line} opacity={i===selected?.55:1}/>;})}
    {measured.length===5&&<polygon points={values.map(v=>v.join(',')).join(' ')} fill={C.lime} fillOpacity=".13" stroke={C.lime} strokeWidth="2.5"/>}
    {axes.map((a,i)=>{const [x,y]=point(i,1.19);const [vx,vy]=values[i];const has=typeof a.score==='number';return <g key={a.id}>
      {has&&<><line x1={cx} y1={cy} x2={vx} y2={vy} stroke={C.lime} strokeWidth="2" opacity={measured.length<5?.65:0}/><circle cx={vx} cy={vy} r={selected===i?7:4.5} fill={C.lime}/></>}
      <text x={x} y={y-5} textAnchor="middle" fill={selected===i?C.lime:C.ink} fontSize="21" fontWeight={selected===i?600:400}>{a.label}</text>
      <text x={x} y={y+22} textAnchor="middle" fill={C.muted} fontFamily={mono} fontSize="17">{has?Math.round(a.score!):'—'}</text>
    </g>;})}
    {measured.length===0&&<><text x={cx} y={cy-8} textAnchor="middle" fill={C.ink} fontSize="23">Evidence first</text><text x={cx} y={cy+22} textAnchor="middle" fill={C.muted} fontSize="17">Select a recorded skill</text></>}
  </svg>;
}

export function ExactPlayerProfile({frame}:ProductScreenProps) {
  const profile=useProfile();
  const axes=nativeAxes.map(axis=>({...axis,...profile.axes?.find(a=>a.id===axis.id)}));
  const available=axes.map((a,i)=>({a,i})).filter(({a})=>a.metrics?.length);
  const selected=available.length?available[Math.min(available.length-1,Math.floor(frame/66))].i:Math.min(4,Math.floor(frame/66));
  const chosen=frame>=330?3:selected; const axis=axes[chosen];const metrics=axis.metrics??profile.metrics??[];
  return <div style={box}>
    <Header section="Player profile" title={profile.displayName??'Player evidence'} right={<><Tag>Recorded results</Tag><Micro>{profile.verifiedAt?'Checked '+profile.verifiedAt:'Source-derived profile'}</Micro></>}/>
    <div style={{position:'absolute',left:28,top:117,width:694,height:523,borderRight:`1px solid ${C.line}`}}><Micro style={{position:'absolute',left:26,top:3,color:C.lime}}>SKILL MAP</Micro><Radar axes={axes} selected={chosen}/><Micro style={{position:'absolute',left:27,bottom:0,fontSize:17}}>Default projected reference · 100 = reference</Micro></div>
    <div style={{position:'absolute',left:772,top:137,right:48}}>
      <div style={{display:'flex',gap:9,marginBottom:24}}>{axes.map((a,i)=><Tag key={a.id} active={i===chosen}>{a.label}</Tag>)}</div>
      <Micro style={{color:C.lime}}>THE EVIDENCE BEHIND THE SKILL</Micro>
      <h3 style={{...display,fontSize:61,marginTop:9}}>{axis.label}</h3>
      <div style={{marginTop:21}}>{metrics.length?metrics.slice(0,3).map((m,i)=><div key={i} style={{padding:'16px 0',borderTop:`1px solid ${C.line}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}><div><div style={{fontSize:24}}>{m.label}</div><Micro style={{fontSize:16,marginTop:5}}>{[m.date,m.status].filter(Boolean).join(' · ')||'Recorded assessment'}</Micro></div><div style={{fontSize:42,fontWeight:600,color:C.lime,whiteSpace:'nowrap'}}>{m.value}<span style={{fontFamily:mono,fontSize:19,color:C.muted,marginLeft:10}}>{m.unit}</span></div></div>):<div style={{borderTop:`1px solid ${C.line}`,paddingTop:23,fontSize:26,color:C.muted,lineHeight:1.5}}>Add a measured assessment<br/>to complete this part of the profile.</div>}</div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:24,paddingTop:18,borderTop:`1px solid ${C.line}`,fontSize:24}}><span>Use evidence to choose a focus</span><span style={{color:C.lime}}><Arrow size={31}/></span></div>
    </div>
    <Footer>Reconstructed app view · Recorded results · Projected reference score, not a percentile.</Footer>
  </div>;
}

const workoutFocus='I have 15 minutes. Help me work on close control and passing.';
export function ExactPlanBuilder({frame}:ProductScreenProps) {
  const plan=frame<87;const proposed=frame>=285;const planning=frame>=238&&frame<285;const saved=frame>=425;
  const typed=workoutFocus.slice(0,Math.max(0,Math.floor((frame-165)*.94)));
  return <div style={box}>
    <Header section={plan?'Training program':'Build a workout'} title={plan?'Your plan, week by week':'What do you want to work on today?'} right={<Tag>{plan?'Multiweek plan':'Today’s session'}</Tag>}/>
    <div style={{position:'absolute',left:34,top:133,width:358,bottom:65,borderRight:`1px solid ${C.line}`,paddingRight:30,boxSizing:'border-box'}}>
      <Micro style={{color:C.lime}}>TRAINING</Micro><h3 style={{...display,fontSize:52,marginTop:15}}>{plan?<>Personalized<br/>training plan.</>:<>Session<br/>preferences.</>}</h3>
      <div style={{marginTop:33}}>{['Your training plan','Today’s workout','Guided session'].map((t,i)=><div key={t} style={{display:'flex',alignItems:'center',gap:15,padding:'19px 0',borderBottom:`1px solid ${C.line}`,color:(plan?i===0:i===1)?C.lime:C.muted,fontSize:21}}><span style={{fontFamily:mono,fontSize:16}}>0{i+1}</span>{t}</div>)}</div>
      <Micro style={{marginTop:27,fontSize:17}}>{plan?'Your longer-term program provides the structure.':'Review the proposal before saving or starting.'}</Micro>
    </div>
    {plan?<div style={{position:'absolute',left:435,top:136,right:43}}>
      <div style={{display:'flex',alignItems:'baseline',justifyContent:'space-between'}}><div style={{fontSize:31,fontWeight:600}}>Close control & passing</div><Micro>EXAMPLE PROGRAM</Micro></div>
      <div style={{display:'flex',gap:13,marginTop:25}}>{[1,2,3,4].map(w=><div key={w} style={{flex:1,padding:'18px 24px',border:`1px solid ${w===1?C.lime:C.line}`,borderRadius:10,background:w===1?C.raised:'transparent',fontSize:24,color:w===1?C.lime:C.muted}}>Week {w}</div>)}</div>
      <div style={{marginTop:34,borderTop:`1px solid ${C.line}`}}>{[{title:'Ball mastery',detail:'Control · Change of direction',n:'01'},{title:'Passing rhythm',detail:'First touch · Passing',n:'02'}].map((w,i)=><div key={w.n} style={{padding:'29px 8px',display:'flex',alignItems:'center',gap:27,borderBottom:`1px solid ${C.line}`}}><div style={{fontFamily:head,fontSize:57,color:C.lime}}>{w.n}</div><div style={{flex:1}}><div style={{fontSize:31,fontWeight:600}}>{w.title}</div><Micro style={{marginTop:7,fontSize:20}}>{w.detail}</Micro></div><Arrow size={32}/></div>)}</div>
      <div style={{marginTop:23,fontSize:21,color:C.muted}}>Plan structure → a practical session for today</div>
    </div>:<>
      <div style={{position:'absolute',left:435,top:133,width:493}}>
        <Micro style={{color:C.lime}}>01 / TIME</Micro><div style={{display:'flex',gap:9,marginTop:13}}>{[15,30,45,60].map(t=><div key={t} style={{flex:1,textAlign:'center',padding:'13px 0',borderRadius:8,border:`1px solid ${frame>=109&&t===15?C.lime:C.line}`,background:frame>=109&&t===15?C.lime:'transparent',color:frame>=109&&t===15?C.bg:C.muted,fontSize:22}}>{t} min</div>)}</div>
        <Micro style={{color:C.lime,marginTop:25}}>02 / ENERGY</Micro><div style={{display:'flex',gap:9,marginTop:13}}>{['Running on empty','Normal','Fresh'].map((t,i)=><div key={t} style={{padding:'14px 15px',borderRadius:8,border:`1px solid ${frame>=138&&i===1?C.lime:C.line}`,color:frame>=138&&i===1?C.lime:C.muted,fontSize:i===0?18:21,display:'flex',alignItems:'center'}}>{t}</div>)}</div>
        <Micro style={{color:C.lime,marginTop:25}}>03 / FOCUS</Micro><div style={{marginTop:13,border:`1px solid ${frame>=165?C.lime:C.line}`,borderRadius:12,padding:23,height:146,boxSizing:'border-box',fontSize:27,lineHeight:1.42}}>{frame<165?<span style={{color:C.muted}}>Tell your coach…</span>:typed}{frame>=165&&frame<237&&<span style={{color:C.lime,opacity:Math.floor(frame/12)%2?0:1}}>│</span>}</div>
        <div style={{marginTop:19,display:'flex',justifyContent:'space-between',alignItems:'center'}}><Micro style={{fontSize:16}}>A session built around your request</Micro><div style={{width:51,height:51,borderRadius:'50%',background:C.lime,color:C.bg,display:'grid',placeItems:'center'}}><Arrow/></div></div>
      </div>
      <div style={{position:'absolute',left:976,top:133,right:40,height:502,border:`1px solid ${proposed?C.lime:C.line}`,borderRadius:14,padding:27,boxSizing:'border-box',background:C.bg}}>
        {!proposed?<><Micro style={{color:C.lime}}>{planning?'REQUEST SENT':'WORKOUT PREVIEW'}</Micro><h3 style={{...display,fontSize:53,marginTop:27}}>{planning?<>Planning your<br/>workout…</>:<>Workout<br/>preview.</>}</h3><div style={{fontSize:25,lineHeight:1.5,color:C.muted,marginTop:29,maxWidth:540}}>{planning?'Matching the request to your available time and approved exercises.':'Tell your coach what you want to work on, then review the proposed workout.'}</div>{planning&&<Tag>Generation wait shortened for the film</Tag>}</>:<>
          <Micro style={{color:C.lime}}>{saved?'WORKOUT SAVED':'PROPOSED WORKOUT'}</Micro><h3 style={{...display,fontSize:44,marginTop:10}}>Control & passing</h3><Micro style={{marginTop:9}}>15 min · Example prescription</Micro>
          {[{name:'Figure-8 dribble',dose:'3 × 60 sec · 30 sec rest'},{name:'Wall pass rhythm',dose:'3 × 60 sec · 30 sec rest'}].map((d,i)=><div key={d.name} style={{display:'flex',alignItems:'center',gap:15,padding:'20px 0',borderBottom:`1px solid ${C.line}`}}><span style={{fontFamily:mono,fontSize:18,color:C.lime}}>0{i+1}</span><div><div style={{fontSize:25,fontWeight:600}}>{d.name}</div><Micro style={{fontSize:17,marginTop:5}}>{d.dose}</Micro></div></div>)}
          <Primary style={{marginTop:24}}><span>{saved?'Saved · Opening workout':'Save and start workout'}</span>{saved?<Check/>:<Arrow/>}</Primary><Micro style={{marginTop:12,textAlign:'center',fontSize:16}}>Save workout for later</Micro>
        </>}
      </div>
      <Tap frame={frame} at={109} x={490} y={194}/><Tap frame={frame} at={138} x={705} y={291}/><Tap frame={frame} at={237} x={902} y={565}/><Tap frame={frame} at={423} x={1354} y={545}/>
    </>}
    <Footer>Reconstructed native flow · Illustrative plan and prescription · Multiweek program and single-session builder are separate steps.</Footer>
  </div>;
}

export function ExactGuidedWorkout({frame}:ProductScreenProps) {
  const complete=frame>=190;const next=frame>=266;const videoFrame=next?frame-266:frame;
  const seconds=258+Math.floor(frame/30);const drill=next?'Wall pass rhythm':'Figure-8 dribble';
  return <div style={box}>
    <Header section="Guided workout" title="Control & passing" right={<div style={{display:'flex',alignItems:'center',gap:18}}><Tag>Workout preview</Tag><Micro>{next?'DRILL 2 OF 2':'DRILL 1 OF 2'}</Micro></div>}/>
    <div style={{position:'absolute',left:27,top:127,width:439,height:508,borderRadius:13,overflow:'hidden',background:C.bg}}>
      <Freeze frame={videoFrame}><OffthreadVideo src={staticFile(next?'wall-pass.mp4':'figure-8.mp4')} muted style={{width:'100%',height:'100%',objectFit:'contain'}}/></Freeze>
      <div style={{position:'absolute',top:14,left:14}}><Tag>DEMONSTRATION</Tag></div>
    </div>
    <div style={{position:'absolute',left:508,top:132,width:698}}>
      <Micro style={{color:C.lime}}>CURRENT EXERCISE</Micro><h3 style={{...display,fontSize:61,marginTop:11}}>{drill}</h3>
      <div style={{fontSize:27,lineHeight:1.45,color:C.muted,marginTop:18,maxWidth:652}}>{next?'Meet the return with a controlled first touch. Settle, pass, and repeat.':'Keep the ball close as you move around both markers. Use small, controlled touches.'}</div>
      <div style={{marginTop:27,padding:'22px 0',borderTop:`1px solid ${C.line}`,borderBottom:`1px solid ${C.line}`,display:'flex',justifyContent:'space-between'}}>
        <div><Micro style={{color:C.ink,fontSize:20}}>{next?'SET 1 OF 3':complete?'ALL 3 SETS DONE':'SET 3 OF 3'} · 60 SEC</Micro><div style={{display:'flex',gap:15,marginTop:18}}>{[0,1,2].map(i=>{const done=!next&&(i<2||complete);return <div key={i} style={{height:48,width:48,background:done?C.lime:C.raised,border:`1px solid ${done?C.lime:C.line}`,borderRadius:24,color:done?C.bg:C.muted,display:'grid',placeItems:'center',fontSize:22}}>{done?<Check/>:i+1}</div>;})}</div></div>
        <div style={{textAlign:'right'}}><Micro style={{color:C.lime}}>WORKING</Micro><div style={{fontSize:56,fontWeight:600,fontVariantNumeric:'tabular-nums',lineHeight:1.2}}>{Math.floor(seconds/60)}:{String(seconds%60).padStart(2,'0')}</div><Micro style={{fontSize:17}}>this session</Micro></div>
      </div>
      <Micro style={{marginTop:16,fontSize:19}}>30 sec rest between sets</Micro>
      <Primary style={{marginTop:24}}><span>{next?'Complete set 1 of 3':complete?'Next drill':'Complete set 3 of 3'}</span>{complete&&!next?<Arrow/>:<Check/>}</Primary>
    </div>
    <div style={{position:'absolute',left:1263,right:29,top:140,bottom:65,borderLeft:`1px solid ${C.line}`,paddingLeft:32}}>
      <Micro style={{color:C.lime}}>SESSION</Micro><div style={{marginTop:24,color:C.lime,fontSize:25,fontWeight:600}}>01</div><div style={{fontSize:28,marginTop:8}}>Figure-8<br/>dribble</div><Micro style={{marginTop:11}}>{complete?'3 sets complete':'Finish your last set'}</Micro>
      <div style={{height:47,marginLeft:14,borderLeft:`1px solid ${C.line}`,marginTop:18,marginBottom:18}}/>
      <Micro style={{color:next?C.lime:C.muted}}>{next?'NOW':'UP NEXT'}</Micro><div style={{fontSize:28,marginTop:8}}>Wall pass<br/>rhythm</div><Micro style={{marginTop:11}}>3 × 60 sec</Micro>
      <div style={{position:'absolute',bottom:6,left:32,right:0,display:'flex',alignItems:'center',gap:15,color:C.muted,fontSize:22}}><span style={{fontFamily:mono}}>Ⅱ</span> Pause workout</div>
    </div>
    <Tap frame={frame} at={188} x={873} y={568}/><Tap frame={frame} at={264} x={873} y={568}/>
    <Footer>Reconstructed native workout preview · Approved exercise footage · Example session clock and prescription; set completion is a player action.</Footer>
  </div>;
}

export function ExactProgressReview({frame}:ProductScreenProps) {
  const profile=useProfile();const history=(profile.history??[]).slice(0,3);const phase=Math.min(2,Math.floor(frame/95));
  return <div style={box}>
    <Header section="Progress review" title={profile.displayName?profile.displayName+' · Evidence over time':'Evidence over time'} right={<Tag>Assess → Train → Retest</Tag>}/>
    <div style={{position:'absolute',left:35,top:139,width:695,bottom:65,paddingRight:40,borderRight:`1px solid ${C.line}`,boxSizing:'border-box'}}>
      <Micro style={{color:C.lime}}>RECORDED BASELINE</Micro><h3 style={{...display,fontSize:54,marginTop:13}}>Recorded<br/>results.</h3>
      <div style={{marginTop:27}}>{history.length?history.map((h,i)=><div key={i} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:17,padding:'16px 0',borderTop:`1px solid ${C.line}`}}><div><div style={{fontSize:24}}>{h.test}</div><Micro style={{fontSize:17,marginTop:6}}>{h.date} · {h.status??'Recorded result'}</Micro></div><div style={{fontSize:37,fontWeight:600,color:C.lime,whiteSpace:'nowrap'}}>{h.value}<span style={{fontFamily:mono,fontSize:18,marginLeft:8,color:C.muted}}>{h.unit}</span></div></div>):<div style={{padding:'26px 0',borderTop:`1px solid ${C.line}`,fontSize:26,color:C.muted,lineHeight:1.5}}>Use a recorded assessment<br/>as the starting point.</div>}</div>
    </div>
    <div style={{position:'absolute',left:797,top:142,right:46}}>
      <Micro style={{color:C.lime}}>NEXT ASSESSMENT / ILLUSTRATIVE FLOW</Micro>
      {[{title:'Return to the same test',detail:'Match the setup and capture conditions.'},{title:'Review the new evidence',detail:'Compare the results and the movement.'},{title:'Choose the next focus',detail:'Player and coach decide what comes next.'}].map((step,i)=><div key={i} style={{position:'relative',display:'flex',gap:23,padding:'29px 0',opacity:i<=phase?1:.5}}><div style={{width:48,height:48,flexShrink:0,border:`1px solid ${i<=phase?C.lime:C.line}`,borderRadius:24,display:'grid',placeItems:'center',background:i===phase?C.lime:'transparent',color:i===phase?C.bg:C.lime,fontFamily:mono,fontSize:20}}>{i+1}</div><div><div style={{fontSize:32,fontWeight:600}}>{step.title}</div><div style={{marginTop:9,fontSize:24,color:C.muted,lineHeight:1.4}}>{step.detail}</div></div>{i<2&&<div style={{position:'absolute',left:24,top:79,height:39,borderLeft:`1px solid ${C.line}`}}/>}</div>)}
    </div>
    <Footer>Recorded baseline + illustrative next-assessment flow · No future results or improvement invented · Retesting is arranged by the player and coach.</Footer>
  </div>;
}
