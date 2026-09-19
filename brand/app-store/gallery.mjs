/**
 * PoseTek gallery composer. All review interfaces are visibly labeled illustrations.
 * npm ci && npm run render
 * npm run render -- --input gallery-input.local.json
 * No app/account/network mutations. Current-build captures are never generated here.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import * as fontkit from 'fontkit';
import sharp from 'sharp';
import { recordedPoses, POSE_EDGES, poseSVG, textSha256LF } from './pose.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const OUT = path.join(ROOT, 'output');
const SOURCE = path.join(ROOT, 'source');
const C = { bg:'#04130e', lime:'#b7f34a', ink:'#f0f5ed', muted:'#a9bdb1', line:'#254036', panel:'#122e23', deep:'#041610', nativeLime:'#7cff18', nativeTab:'#081816', nativeAccent:'#38aa6a' };
const content = JSON.parse(fs.readFileSync(path.join(ROOT, 'gallery-content.json'), 'utf8'));
const officialIconPath=path.resolve(ROOT,'../../images/brand/posetek-app-icon.svg');
const officialIconInner=fs.readFileSync(officialIconPath,'utf8').replace(/^[\s\S]*?<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'');
const inputIndex=process.argv.indexOf('--input'),reviewIndex=process.argv.indexOf('--review-input');
if(inputIndex>=0&&reviewIndex>=0)throw new Error('--input and --review-input are mutually exclusive.');
const reviewMode=reviewIndex>=0,inputFlagIndex=reviewMode?reviewIndex:inputIndex;
const inputArgument=inputFlagIndex>=0?process.argv[inputFlagIndex+1]:null;
if(inputFlagIndex>=0&&(!inputArgument||inputArgument.startsWith('--')))throw new Error('The input flag requires a JSON file path.');
const inputPath=inputArgument?path.resolve(inputArgument):null;
const supplied=inputPath?JSON.parse(fs.readFileSync(inputPath,'utf8')):null;
if(supplied)validateInputManifest(supplied);
const captures={iphone:await readCaptures('iphone'),ipad:await readCaptures('ipad')};
if(process.argv.includes('--validate-input-only')) {
  console.log(JSON.stringify({mode:reviewMode?'review':supplied?'release':'preview',captures:Object.values(captures).reduce((sum,items)=>sum+Object.keys(items||{}).length,0),currentBuildConfirmed:Boolean(supplied&&!reviewMode),warnings:Object.values(captures).flatMap(items=>Object.values(items||{}).flatMap(capture=>capture.warnings))}));
  process.exit(0);
}
const fonts = {};
const copiedLicenses = new Set();
const emojiManifest=JSON.parse(fs.readFileSync(path.join(ROOT,'emoji/manifest.json'),'utf8'));
const emojiAssets=Object.fromEntries(emojiManifest.assets.map(asset=>{
  const buffer=fs.readFileSync(path.join(ROOT,'emoji',asset.file));
  if(textSha256LF(buffer)!==asset.sha256)throw new Error(`Emoji checksum mismatch: ${asset.file}`);
  return [asset.id,buffer.toString('base64')];
}));

for (const [name, family, weight] of [['body','inter',400],['medium','inter',600],['bold','inter',700],['black','inter',900],['display','barlow-condensed',700],['mono','ibm-plex-mono',500]]) {
  const packageRoot = path.dirname(require.resolve(`@fontsource/${family}/package.json`));
  // IBM Plex Mono's subset WOFF space metrics fail in fontkit; WOFF2 decodes correctly.
  const file = `${family}-latin-${weight}-normal.${family==='ibm-plex-mono'?'woff2':'woff'}`;
  fonts[name] = fontkit.openSync(path.join(packageRoot,'files',file));
  fs.mkdirSync(path.join(ROOT,'fonts'),{recursive:true});
  fs.copyFileSync(path.join(packageRoot,'files',file),path.join(ROOT,'fonts',file));
  if (!copiedLicenses.has(family)) {
    fs.copyFileSync(path.join(packageRoot,'LICENSE'),path.join(ROOT,'fonts',`${family}-OFL.txt`));
    copiedLicenses.add(family);
  }
}
fs.mkdirSync(OUT,{recursive:true});
fs.mkdirSync(SOURCE,{recursive:true});

const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const n = value => Math.round(value * 1000) / 1000;
const rect=(x,y,w,h,fill,rx=0,stroke=null,sw=1)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"${stroke?` stroke="${stroke}" stroke-width="${sw}"`:''}/>`;
const line=(x1,y1,x2,y2,color=C.line,width=1,dash='')=>`<path d="M${x1} ${y1}L${x2} ${y2}" fill="none" stroke="${color}" stroke-width="${width}"${dash?` stroke-dasharray="${dash}"`:''}/>`;
const circle=(cx,cy,r,fill,stroke=null,sw=1)=>`<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${stroke?` stroke="${stroke}" stroke-width="${sw}"`:''}/>`;
const group=(x,y,scale,body)=>`<g transform="translate(${x} ${y}) scale(${scale})">${body}</g>`;
const textWidth=(value,size=16,font='body',tracking=0)=>{
  const run=fonts[font].layout(String(value));
  return run.positions.reduce((sum,pos)=>sum+pos.xAdvance,0)*size/fonts[font].unitsPerEm+Math.max(0,run.glyphs.length-1)*tracking;
};
function text(value,x,y,size=16,color=C.ink,font='body',anchor='start',tracking=0) {
  const face=fonts[font],run=face.layout(String(value)),scale=size/face.unitsPerEm;
  if(run.glyphs.some(glyph=>glyph.id===0))throw new Error(`Unsupported glyph in ${font}: ${value}`);
  const width=textWidth(value,size,font,tracking);
  let cursor=anchor==='middle'?-width/2:anchor==='end'?-width:0;
  let result=`<g aria-label="${esc(value)}" fill="${color}">`;
  run.glyphs.forEach((glyph,i)=>{
    const pos=run.positions[i];
    result+=`<path d="${glyph.path.toSVG()}" transform="translate(${n(x+cursor+pos.xOffset*scale)} ${n(y-pos.yOffset*scale)}) scale(${n(scale)} ${n(-scale)})"/>`;
    cursor+=pos.xAdvance*scale+tracking;
  });
  return result+'</g>';
}
function wrap(value,x,y,width,size=16,color=C.muted,font='body',leading=size*1.4) {
  const lines=[];let row='';
  for(const word of value.split(' ')) {const next=row?`${row} ${word}`:word;if(row&&textWidth(next,size,font)>width){lines.push(row);row=word;}else row=next;}
  if(row)lines.push(row);
  return {svg:lines.map((v,i)=>text(v,x,y+i*leading,size,color,font)).join(''),lines:lines.length,bottom:y+(lines.length-1)*leading};
}
function logo(x,y,size=50) {
  // Reuse the canonical converted-glyph icon exactly; crop its surrounding canvas.
  return `<svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="7 7 34 34">${officialIconInner}</svg>`;
}
function tag(label,x,y,width,color=C.nativeLime) { return rect(x,y,width,24,color+'18',12)+text(label,x+width/2,y+16,9,color,'bold','middle',.4); }
function row(label,value,y) {return text(label,36,y,12,C.muted)+text(value,354,y,13,C.ink,'bold','end')+line(36,y+16,354,y+16);}
function action(label,y,width=318,x=36){return rect(x,y,width,46,C.nativeLime,13)+text(label,x+width/2,y+29,14,C.deep,'bold','middle');}
function icon(kind,x,y,size=26,color=C.nativeLime) {
  const paths={
    run:'M13 4a2 2 0 1 0 .01 0M9 9l5-2 3 5 4 1M14 8l-3 7-6 2M11 15l5 3 1 5M9 9l-3 5-4-1',
    arrow:'M4 20V9h10M10 4l5 5-5 5M14 20h8',
    jump:'M12 4a2 2 0 1 0 .01 0M12 8v8M12 10L5 5M12 10l7-5M12 16l-5 6M12 16l6 6',
    ball:'M21 13a9 9 0 1 1-18 0 9 9 0 0 1 18 0M12 8l4 3-2 5H9l-2-5 5-3M12 8V4M7 11l-4-1M9 16l-2 4M14 16l3 4M16 11l5-1',
    cone:'M5 22L12 3l7 19ZM8 14h8M6 20h12',
    chart:'M3 3v19h20M7 17l5-6 4 2 5-8',
    check:'M5 13l5 5L22 5',
    sparkle:'M13 2l3 8 8 3-8 3-3 8-3-8-8-3 8-3ZM22 2v5M19.5 4.5h5',
    previous:'M4 5v17M21 5L7 13l14 9Z',
    play:'M6 3l17 10L6 23Z',
    next:'M22 5v17M5 5l14 8-14 9Z',
    replay:'M7 7a9 9 0 1 1-2 11M3 3v8h8',
    video:'M3 6h13v15H3ZM16 11l7-4v15l-7-4',
    settings:'M12 7a6 6 0 1 0 .01 0M12 2v3M12 22v3M2 13h3M22 13h3M4 5l2 2M20 21l2 2M4 21l2-2M20 5l2-2',
    person:'M13 4a4 4 0 1 0 .01 0M4 25v-3a9 9 0 0 1 18 0v3',
    brain:'M13 4C2 0-2 22 10 22M13 4c11-4 15 18 3 18M13 4v20M5 9l5 3-2 5M21 9l-5 3 2 5',
    list:'M8 6h16M8 13h16M8 20h16M2 6h1M2 13h1M2 20h1',
    calendar:'M3 5h21v19H3ZM8 2v6M19 2v6M3 11h21M8 16h4M8 21h4',
    trophy:'M7 3h12v11a6 6 0 0 1-12 0ZM7 6H2v5l5 3M19 6h5v5l-5 3M13 20v4M8 24h10',
  };
  return group(x,y,size/26,`<path d="${paths[kind]||paths.chart}" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`);
}
function radar(cx,cy,r=102,values=[.7,.81,.58,.49,.72]) {
  const point=(i,ratio)=>[cx+Math.sin(i*2*Math.PI/5)*r*ratio,cy-Math.cos(i*2*Math.PI/5)*r*ratio];
  let s='';
  for(const level of [.25,.5,.75,1])s+=`<polygon points="${Array.from({length:5},(_,i)=>point(i,level).join(',')).join(' ')}" fill="none" stroke="${C.line}" stroke-width="1"/>`;
  for(let i=0;i<5;i++){const [x,y]=point(i,1);s+=line(cx,cy,x,y);}
  s+=`<polygon points="${values.map((v,i)=>point(i,v).join(',')).join(' ')}" fill="${C.nativeLime}20" stroke="${C.nativeLime}" stroke-width="2"/>`;
  values.forEach((v,i)=>{const [x,y]=point(i,v);s+=circle(x,y,3,C.nativeLime);});
  [['SPEED',0,-r-16],['POWER',r+8,-25],['AGILITY',r*.64,r+16],['CONTROL',-r*.64,r+16],['STRIKING',-r-8,-25]].forEach(([v,dx,dy])=>s+=text(v,cx+dx,cy+dy,8,C.muted,'bold','middle',.5));
  return s;
}
function pitch(x,y,w,h,figure8=false) {
  let s=rect(x,y,w,h,'#0b281a',18);
  for(let i=1;i<7;i++)s+=line(x+i*w/7,y+10,x+i*w/7,y+h-10,'#193e2b',.6);
  for(let i=1;i<5;i++)s+=line(x+10,y+i*h/5,x+w-10,y+i*h/5,'#193e2b',.6);
  s+=rect(x+24,y+24,w-48,h-48,'none',2,'#34553e',1);
  if(figure8){
    s+=`<path d="M${x+w*.5} ${y+h*.5}C${x+w*.1} ${y+h*.02} ${x+w*.1} ${y+h*.98} ${x+w*.5} ${y+h*.5}C${x+w*.9} ${y+h*.02} ${x+w*.9} ${y+h*.98} ${x+w*.5} ${y+h*.5}" fill="none" stroke="${C.nativeLime}" stroke-width="3" stroke-dasharray="6 5"/>`;
    s+=icon('cone',x+w*.25-12,y+h*.5-14,25,'#efc575')+icon('cone',x+w*.75-12,y+h*.5-14,25,'#efc575')+circle(x+w*.52,y+h*.42,8,C.ink);
  } else {
    s+=poseSVG('sprint',{x:x+25,y:y+40,width:w-50,height:h-65,padding:9});
  }
  return s;
}

function screenBody(kind) {
  let s='';
  if(kind==='profile') {
    s+=text('OVERALL VS D1',27,190,10,C.muted,'bold','start',1)+text('72',27,228,34,C.ink,'black');
    s+=tag('DEVELOPING',92,206,113)+text('18 reps · 6 sessions',362,218,10,C.muted,'body','end');
    s+=rect(24,252,342,304,C.panel,24,'#ffffff1a')+text('SKILL MAP',40,277,10,C.muted,'mono');
    s+=tag('SAMPLE DATA',242,263,108)+radar(195,404,91);
    s+=rect(24,574,342,171,C.panel,24,'#ffffff1a')+text('Speed',42,607,23,C.ink,'bold')+tag('SELECTED',265,587,84);
    s+=text('Sprint',42,646,12,C.muted)+text('4.82 s',347,646,17,C.ink,'bold','end');
    s+=line(42,663,348,663)+text('Illustrative values · scrolled profile',42,694,10,C.muted);
    s+=text('Review the result behind this skill.',42,720,12,C.ink);
  } else if(kind==='tests') {
    s+=rect(20,178,350,140,'#ffffff21',24,'#ffffff1f');
    s+=wrap('what would you like to work on?',38,213,260,23,C.ink,'bold',27).svg;
    s+=wrap('Choose a drill path to start a recording or review progress.',38,278,286,12,C.muted).svg;
    const tests=[['Shooting','ball'],['Sprint','run'],['Jump','jump'],['Broad Jump','jump'],['Dribbling','cone'],['Change of Direction','arrow'],['Free record','video'],['Drill Settings','settings']];
    tests.forEach(([label,key],i)=>{
      const x=20+(i%2)*182,y=336+Math.floor(i/2)*99;
      s+=rect(x,y,168,85,'#ffffff14',22,'#ffffff1f');
      s+=circle(x+28,y+29,17,C.nativeAccent+'24')+icon(key,x+17,y+18,22,C.nativeAccent);
      s+=wrap(label,x+52,y+29,100,12,C.ink,'medium',16).svg;
      s+=rect(x+13,y+65,22,4,C.nativeAccent,2)+rect(x+41,y+65,112,4,'#ffffff1f',2);
    });
  } else if(kind==='focus') {
    s+=radar(195,291,87,[.75,.7,.63,.48,.67]);
    s+=rect(24,433,342,278,C.panel,22,'#2b4736')+tag('SELECTED SKILL',42,451,130);
    s+=text('Ball control',42,509,29,C.ink,'bold');
    s+=wrap('Review the results behind this part of your skill map.',42,536,299,12).svg;
    s+=line(42,585,348,585)+text('Dribbling shuttle',42,616,12,C.muted)+text('8.42 s',348,616,17,C.ink,'bold','end');
    s+=text('Change of direction',42,652,12,C.muted)+text('6.12 s',348,652,17,C.ink,'bold','end');
    s+=text('Illustrative values · not athlete results',42,690,9,C.muted,'mono');
    s+=text('Five areas. A clearer next step.',195,745,13,C.ink,'medium','middle');
  } else if(kind==='workout') {
    s+=text('Ball control',28,187,10,C.nativeLime,'mono')+text('Figure-8 dribbling',28,218,25,C.ink,'bold');
    s+=pitch(25,241,340,244,true)+text('INSTRUCTION DIAGRAM',195,268,9,C.muted,'mono','middle',.5);
    s+=rect(25,505,340,117,C.panel,21,'#2b4736')+text('SET 2 OF 3',42,530,10,C.muted,'mono');
    for(let i=0;i<3;i++){s+=circle(57+i*42,563,15,i===0?C.nativeLime:'none',i===0?C.nativeLime:'#45634b');s+=i===0?icon('check',45,552,22,C.deep):text(String(i+1),57+i*42,568,12,C.ink,'bold','middle');}
    s+=text('WORKING',347,532,9,C.nativeLime,'mono','end')+text('0:40',347,565,30,C.ink,'bold','end');
    s+=text('30 seconds rest between sets',43,603,10,C.muted);
    s+=wrap('Keep the ball close as you turn around each cone.',28,650,331,14,C.ink).svg;
    s+=action('Complete set',704);
  } else if(kind==='progress') {
    s+=text('Sprint results',27,193,24,C.ink,'bold')+tag('SAMPLE HISTORY',26,212,136);
    s+=rect(24,258,342,244,C.panel,22,'#2b4736');
    s+=text('RECORDED TIME',42,286,9,C.muted,'mono');
    for(let i=0;i<4;i++)s+=line(47,326+i*41,344,326+i*41,'#34523c',.7);
    const pts=[[49,354],[103,379],[158,369],[214,404],[270,398],[341,427]];
    s+=`<polyline points="${pts.map(p=>p.join(',')).join(' ')}" fill="none" stroke="${C.nativeLime}" stroke-width="2.5"/>`;
    pts.forEach(p=>s+=circle(...p,4,C.nativeLime));
    s+=text('SESSION 1',44,480,8,C.muted,'mono')+text('SESSION 6',347,480,8,C.muted,'mono','end');
    s+=text('Your history is the reference.',27,543,17,C.ink,'bold');
    s+=wrap('Look at the sessions together. Ask a question about your next training step.',27,568,326,13).svg;
    s+=rect(25,629,340,87,C.panel,18)+text('AI Coach',43,655,13,C.nativeLime,'bold')+wrap('What should I focus on next?',43,682,290,14,C.ink).svg;
    s+=text('Sample data is illustrative, not a promise.',195,747,9,C.muted,'body','middle');
  }
  return s;
}
function nativeDefinitions() {
  return `<defs><linearGradient id="native-bg" x2="1" y2="1"><stop stop-color="#041610"/><stop offset=".5" stop-color="#062016"/><stop offset="1" stop-color="#082417"/></linearGradient><linearGradient id="drills-bg" x2="1" y2="1"><stop stop-color="#091c18"/><stop offset=".5" stop-color="#125638"/><stop offset="1" stop-color="#061012"/></linearGradient><linearGradient id="native-badge"><stop stop-color="#7cff18" stop-opacity=".9"/><stop offset="1" stop-color="#7cff18" stop-opacity=".5"/></linearGradient></defs>`;
}
function nativeHeader(width) {
  return rect(0,50,width,58,C.nativeTab)+rect(14,61,32,32,'url(#native-badge)',8)+text('P',30,83,18,C.deep,'black','middle')+text('POSETEK',57,83,17,C.ink,'black','start',2)+rect(width-139,64,72,26,'#ffffff0d',9,'#ffffff14')+text('Sign Out',width-103,81,10,C.ink,'bold','middle')+rect(width-59,64,45,26,'#ffffff0d',9,'#ffffff14')+text('Home',width-36,81,10,C.ink,'bold','middle')+line(0,107,width,107,'#ffffff1f');
}
function nativeTabs(panel,width,y) {
  const labels=['Profile','AI Coach','Drills','Training','Leaderboards'],keys=['person','brain','list','calendar','trophy'];
  const selected=panel.screen==='tests'?2:panel.screen==='workout'?3:0;
  const available=width-28,slot=available/5;
  let s=rect(0,y,width,87,C.nativeTab)+line(0,y,width,y,'#ffffff1f');
  labels.forEach((label,i)=>{const x=14+(i+.5)*slot,color=i===selected?C.nativeAccent:'#a0a8a7';
    if(i===selected)s+=rect(x-slot/2+4,y+10,slot-8,56,C.nativeAccent+'29',16);
    s+=icon(keys[i],x-10,y+17,20,color)+text(label,x,y+54,Math.min(11,(slot-8)/textWidth(label,1,'medium')),color,'medium','middle');
  });return s;
}
function phoneInterface(panel) {
  const workout=panel.screen==='workout';
  let s=nativeDefinitions()+rect(0,0,390,844,panel.screen==='tests'?'url(#drills-bg)':'url(#native-bg)',40);
  s+=text('9:41',28,33,13,C.ink,'bold')+rect(148,13,94,24,'#020a06',14);
  s+=line(327,26,327,32,C.ink,2)+line(332,23,332,32,C.ink,2)+line(337,20,337,32,C.ink,2)+rect(347,21,20,10,'none',2,C.ink)+rect(349,23,15,6,C.ink,1);
  if(workout)s+=text('‹',20,87,27,C.nativeLime,'bold')+text('Workout',195,84,18,C.ink,'bold','middle')+text('Pause',293,84,12,C.nativeLime,'bold')+text('End',346,84,12,C.ink,'bold');
  else s+=nativeHeader(390);
  s+=text('SOURCE-DERIVED SAMPLE INTERFACE',25,126,8,C.muted,'mono','start',.3)+text(panel.screenTitle,25,157,21,C.ink,'bold');
  s+=screenBody(panel.screen);
  // The fullscreen workout has its own controls rather than the Profile tab bar.
  if(workout)s+=line(20,777,370,777)+text('Previous',27,807,12,C.ink,'bold')+text('Next drill',363,807,12,C.nativeLime,'bold','end');
  else s+=nativeTabs(panel,390,766);
  s+=rect(137,831,116,4,C.ink,2);
  return `<defs><clipPath id="phone-screen"><rect width="390" height="844" rx="40"/></clipPath></defs><g clip-path="url(#phone-screen)">${s}</g>`;
}
function tabletInterface(panel) {
  const width=768,height=1024,workout=panel.screen==='workout';
  let s=nativeDefinitions()+rect(0,0,width,height,panel.screen==='tests'?'url(#drills-bg)':'url(#native-bg)',24)+text('9:41',24,30,13,C.ink,'bold');
  if(workout)s+=text('‹',24,85,28,C.nativeLime,'bold')+text('Workout',width/2,83,18,C.ink,'bold','middle')+text('Pause',644,83,12,C.nativeLime,'bold')+text('End',725,83,12,C.ink,'bold');
  else s+=nativeHeader(width);
  s+=text('SOURCE-DERIVED SAMPLE INTERFACE',48,145,11,C.muted,'mono','start',.3)+text(panel.screenTitle,48,188,28,C.ink,'bold');
  // Preserve the native vertical hierarchy with a centered readable content column.
  // Responsive iPad sizing remains illustrative until an authentic capture is supplied.
  s+=group(150,20,1.20,screenBody(panel.screen));
  if(workout)s+=rect(0,937,width,87,C.nativeTab)+text('Previous',34,975,14,C.ink,'bold')+text('Next drill',734,975,14,C.nativeLime,'bold','end');
  else s+=nativeTabs(panel,width,937);
  s+=rect(320,1009,128,4,C.ink,2);
  return `<defs><clipPath id="tablet-screen"><rect width="768" height="1024" rx="24"/></clipPath></defs><g clip-path="url(#tablet-screen)">${s}</g>`;
}
function landscapeAnalysis() {
  let s=nativeDefinitions()+rect(0,0,844,390,'url(#native-bg)',28);
  s+=rect(32,12,504,318,'#010b08',22,'#ffffff1f');
  s+=poseSVG('sprint',{x:56,y:35,width:456,height:267,padding:8},{strokeWidth:1.35,dotRadius:1.6});
  s+=circle(55,35,12,'#ffffff14')+text('×',55,40,18,C.ink,'medium','middle');
  s+=rect(548,12,284,366,'#00000033',22,'#ffffff1f')+circle(575,43,14,C.nativeLime)+icon('sparkle',566,34,18,C.deep);
  s+=text('PoseTek Coach',598,39,14,C.ink,'bold')+text('Technique assistant',598,55,10,C.muted);
  s+=tag('PREVIEW · AI FEEDBACK COMING SOON',560,70,257);
  s+=wrap('Source-derived interface preview',565,129,245,13,C.ink,'medium',19).svg;
  s+=wrap('The recorded sprint pose is shown with all 33 source landmarks. Add a current-build capture for release.',565,181,240,11,C.muted,'body',17).svg;
  s+=rect(560,325,260,38,'#ffffff0d',14,'#ffffff1f')+text('Ask about this rep…',572,349,12,C.muted);
  s+=icon('previous',39,345,18,C.ink)+circle(82,354,15,C.nativeLime)+icon('play',73,345,18,C.deep)+icon('next',107,345,18,C.ink)+icon('replay',140,343,22,C.ink);
  s+=line(175,352,399,352,'#ffffff33',3)+line(175,352,286,352,C.nativeLime,3)+circle(286,352,5,C.nativeLime)+text('Frame 313',288,376,8,C.muted,'mono','middle')+text('0.5×',480,358,12,C.muted,'bold','middle');
  return s;
}
function emojiAccent(id,x,y,size) {
  if(!emojiAssets[id])throw new Error(`Missing pinned emoji ${id}`);
  return `<image data-emoji="${id}" x="${x}" y="${y}" width="${size}" height="${size}" href="data:image/svg+xml;base64,${emojiAssets[id]}"/>`;
}
function brandHeader(width,idx,tablet=false) {
  const margin=tablet?112:94,y=tablet?99:88,size=tablet?69:62;
  return logo(margin,y,size)+text('POSETEK',margin+size+24,y+size*.76,tablet?52:42,C.ink,'black','start',tablet?4:3)+text(`${String(idx+1).padStart(2,'0')} / 06`,width-margin,y+size*.7,tablet?30:24,C.muted,'mono','end');
}
function captureDevice(data,x,y,w,h,radius) {
  // Embed the exact original PNG/JPEG bytes. Only the complete screenshot is
  // proportionally scaled; no cropping, retouching, or synthesized UI overlays.
  const scale=Math.min(w/data.width,h/data.height),sw=data.width*scale,sh=data.height*scale;
  const sx=x+(w-sw)/2,sy=y+(h-sh)/2;
  return rect(sx-10,sy-10,sw+20,sh+20,'#010805',radius+10,'#4a6655',3)+`<svg data-capture="true" data-source-sha256="${data.sha256}" x="${sx}" y="${sy}" width="${sw}" height="${sh}" viewBox="0 0 ${data.width} ${data.height}" preserveAspectRatio="xMidYMid meet"><image href="data:${data.mimeType};base64,${data.buffer.toString('base64')}" width="${data.width}" height="${data.height}"/></svg>`;
}
function compose(panel,idx,platform,capture=null) {
  const tablet=platform==='ipad',width=tablet?2064:1320,height=tablet?2752:2868;
  const margin=tablet?112:94;
  let s=rect(0,0,width,height,C.bg)+brandHeader(width,idx,tablet);
  s+=text(panel.eyebrow,margin,tablet?271:251,tablet?26:22,C.lime,'mono','start',1.6);
  const headlineSize=tablet?178:143,firstY=tablet?469:423,leading=tablet?172:145;
  panel.headline.forEach((v,i)=>{const fitted=Math.min(headlineSize,(width-margin*2)/textWidth(v,1,'display'));s+=text(v,margin,firstY+i*leading,fitted,C.ink,'display');});
  const accentSize=tablet?56:48,captionY=tablet?746:643;
  s+=emojiAccent(panel.emoji,margin,captionY-accentSize*.77,accentSize);
  const body=wrap(panel.description,margin+accentSize+22,captionY,width-margin*2-accentSize-22,tablet?39:34,C.muted,'body',tablet?56:48);
  s+=body.svg;
  if(body.bottom>(tablet?873:764))throw new Error(`${panel.id}: body copy overlaps device`);
  if(panel.screen==='replay'&&capture) {
    // A supplied comparison is the sole product visual; do not pair it with
    // the unrelated recorded sprint used by the earlier illustrative layout.
    s+=captureDevice(capture,48,tablet?910:810,width-96,tablet?1650:1790,tablet?40:32);
  } else if(panel.screen==='replay') {
    // Analysis really is landscape-only in SessionAnalysisView; preserve that orientation.
    // The enlarged recorded pose is marketing art outside the device, with explicit provenance.
    const stageY=tablet?956:824,stageH=tablet?820:970;
    s+=rect(margin,stageY,width-margin*2,stageH,'#0a241a',32,C.line,2);
    s+=text('RECORDED SPRINT / 33 LANDMARKS',margin+36,stageY+57,tablet?27:23,C.lime,'mono');
    s+=poseSVG('sprint',{x:margin+60,y:stageY+87,width:width-margin*2-120,height:stageH-170,padding:12},{strokeWidth:tablet?3.1:2.7,dotRadius:tablet?3.8:3.4});
    s+=text('Original positions · complete face, hand and foot detail',width/2,stageY+stageH-31,tablet?24:19,C.muted,'body','middle');
    const y=tablet?1900:1920,maxH=tablet?650:660,ratio=capture?capture.width/capture.height:844/390;
    const w=Math.min(width-margin*2,maxH*ratio),h=w/ratio,x=(width-w)/2;
    if(capture)s+=captureDevice(capture,x,y,w,h,tablet?40:32);
    else s+=rect(x-8,y-8,w+16,h+16,'#010805',40,'#4a6655',3)+group(x,y,w/844,landscapeAnalysis());
    s+=text('LANDSCAPE ANALYSIS WORKSPACE',margin,tablet?1856:1878,tablet?26:21,C.muted,'mono');
  } else if(tablet) {
    const y=900,h=1635,w=h*768/1024,x=(width-w)/2;
    if(capture) {
      const captureWidth=h*capture.width/capture.height;
      s+=captureDevice(capture,(width-captureWidth)/2,y,captureWidth,h,45);
    } else s+=rect(x-9,y-9,w+18,h+18,'#010805',48,'#4a6655',3)+group(x,y,w/768,tabletInterface(panel));
  } else {
    const x=245,y=816,w=830,h=1796;
    if(capture)s+=captureDevice(capture,x,y,w,h,83);
    else s+=rect(x-10,y-10,w+20,h+20,'#010805',87,'#4a6655',3)+group(x,y,w/390,phoneInterface(panel));
  }
  const footerY=tablet?2638:2730;
  s+=line(margin,footerY-26,width-margin,footerY-26,C.line,2);
  s+=text(capture?.review?'User-supplied screenshot • review':capture?'Current-build screenshot composition':'Layout preview • sample interface',margin,footerY+19,tablet?30:27,capture?C.ink:C.lime,'medium');
  s+=text(capture?.review?'Build and privacy review pending · original image preserved':capture?'For final release review':'Source-grounded illustration · not a native screenshot',margin,footerY+65,tablet?24:22,C.muted,'body');
  const title=`PoseTek — ${panel.headline.join(' ')} — ${capture?'screenshot composition':'layout preview'}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><desc>${esc(panel.description)} ${capture?.review?'Uses an unmodified user-supplied screenshot for review. Build identity and privacy review are not verified.':capture?'Uses supplied current-build capture.':'Illustrative review concept. No authentic app screenshot is claimed. All values are fictional sample data.'}</desc>${s}</svg>`;
}
function validateInputManifest(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Input must be a JSON object.');
  const allowed=new Set(['buildNumber','currentBuildConfirmed','privacyReviewed','captureProvenance','iphone','ipad']);
  for(const key of Object.keys(input))if(!allowed.has(key))throw new Error(`Unknown input field: ${key}`);
  if(!reviewMode&&(!input.iphone||!input.ipad))throw new Error('Provide complete iPhone and iPad capture sets together; all 12 captures are required.');
  const ids=new Set(content.panels.map(panel=>panel.id));
  let count=0;
  for(const platform of ['iphone','ipad']) {
    const entries=input[platform];
    if(entries===undefined)continue;
    if(!entries||typeof entries!=='object'||Array.isArray(entries))throw new Error(`${platform} must map panel IDs to screenshots.`);
    for(const [id,entry] of Object.entries(entries)) {
      if(!ids.has(id))throw new Error(`Unknown panel ID: ${platform}/${id}`);
      normalizeCaptureEntry(entry,`${platform}/${id}`);
      count++;
    }
  }
  if(reviewMode&&count===0)throw new Error('Review input must include at least one screenshot.');
}
function normalizeCaptureEntry(entry,label) {
  if(typeof entry==='string')entry={file:entry};
  if(!entry||typeof entry!=='object'||Array.isArray(entry))throw new Error(`${label}: screenshot entry must be a filename or object.`);
  const allowed=new Set(['file','headline','description','eyebrow','screenTitle']);
  for(const key of Object.keys(entry))if(!allowed.has(key))throw new Error(`${label}: unsupported screenshot field ${key}.`);
  if(typeof entry.file!=='string'||!entry.file.trim())throw new Error(`${label}: a screenshot filename is required.`);
  if(entry.headline!==undefined&&(!Array.isArray(entry.headline)||entry.headline.length!==2||entry.headline.some(line=>typeof line!=='string'||!line.trim())))throw new Error(`${label}: headline must contain exactly two nonempty text lines.`);
  for(const key of ['description','eyebrow','screenTitle'])if(entry[key]!==undefined&&(typeof entry[key]!=='string'||!entry[key].trim()))throw new Error(`${label}: ${key} must be nonempty text.`);
  const {file,...overrides}=entry;
  return {file,overrides};
}
async function readCaptures(platform) {
  if(!supplied?.[platform])return null;
  if(!reviewMode&&(supplied.currentBuildConfirmed!==true||supplied.privacyReviewed!==true||typeof supplied.buildNumber!=='string'||!supplied.buildNumber||supplied.buildNumber.startsWith('REPLACE')||!supplied.captureProvenance))throw new Error('Current-build identity, explicit confirmation, privacy review, and capture provenance are required.');
  const result={};
  for(const panel of content.panels) {
    const input=supplied[platform][panel.id];
    if(input===undefined) {
      if(reviewMode)continue;
      throw new Error(`${platform}: provide all six captures; missing ${panel.id}`);
    }
    const entry=normalizeCaptureEntry(input,`${platform}/${panel.id}`);
    const full=path.resolve(path.dirname(inputPath),entry.file);
    const buffer=fs.readFileSync(full),meta=await sharp(buffer).metadata();
    if(!['png','jpeg'].includes(meta.format))throw new Error(`${full}: PNG or JPEG required`);
    if(meta.orientation&&meta.orientation!==1)throw new Error(`${full}: provide an upright screenshot without EXIF rotation.`);
    const landscape=panel.captureOrientation==='landscape';
    const shortSide=Math.min(meta.width,meta.height),longSide=Math.max(meta.width,meta.height),ratio=shortSide/longSide;
    if(landscape?meta.width<=meta.height:meta.width>=meta.height)throw new Error(`${full}: ${panel.id} requires a complete ${panel.captureOrientation} ${platform} capture.`);
    if(ratio<(platform==='iphone'?.4:.6)||ratio>(platform==='iphone'?.55:.9))throw new Error(`${full}: expected a complete ${platform} screen capture, without a device frame.`);
    const warnings=[];
    if(shortSide<(platform==='iphone'?1170:1640)) {
      if(!reviewMode)throw new Error(`${full}: insufficient capture resolution`);
      warnings.push(`Original ${meta.width} x ${meta.height} screenshot is below the release capture resolution; export does not add detail.`);
    }
    if(reviewMode)warnings.push('Build identity and privacy review are unverified; use for design review only.');
    result[panel.id]={buffer,width:meta.width,height:meta.height,format:meta.format,mimeType:meta.format==='jpeg'?'image/jpeg':'image/png',filename:path.basename(full),sha256:createHash('sha256').update(buffer).digest('hex'),overrides:entry.overrides,review:reviewMode,warnings,source:reviewMode?'user-provided':'current-build-capture',currentBuildConfirmed:!reviewMode,privacyReviewed:!reviewMode};
  }
  return result;
}

const records=[];
for(const platform of ['iphone','ipad']) {
  for(const [idx,defaultPanel] of content.panels.entries()) {
    const capture=captures[platform]?.[defaultPanel.id]||null;
    const panel={...defaultPanel,...capture?.overrides};
    const svg=compose(panel,idx,platform,capture);
    const stem=`${platform}-${panel.id}`,file=`${stem}.png`;
    // The editable SVG faithfully reproduces this composition, including raw captures.
    // Both generated directories are ignored; supplied screenshots must stay private.
    fs.writeFileSync(path.join(SOURCE,`${stem}.svg`),svg);
    await sharp(Buffer.from(svg)).flatten({background:C.bg}).removeAlpha().png({compressionLevel:9}).toFile(path.join(OUT,file));
    const meta=await sharp(path.join(OUT,file)).metadata();
    if(meta.hasAlpha)throw new Error(`${file}: unexpected alpha channel`);
    records.push({platform,id:panel.id,file,width:meta.width,height:meta.height,channels:meta.channels,headline:panel.headline,description:panel.description,eyebrow:panel.eyebrow,screenTitle:panel.screenTitle,kind:capture?.review?'user-supplied-screenshot-review':capture?'current-build-screenshot-composition':'sample-interface-layout-preview',nativeScreenshotSupplied:Boolean(capture),currentBuildConfirmed:Boolean(capture&&!capture.review),privacyReviewed:Boolean(capture&&!capture.review),capture:capture?{filename:capture.filename,sha256:capture.sha256,width:capture.width,height:capture.height,format:capture.format,source:capture.source,warnings:capture.warnings}:null,sourceSvgSha256:createHash('sha256').update(svg).digest('hex'),sourceReferences:panel.sourceReferences,captureInstruction:panel.captureInstruction,captureOrientation:panel.captureOrientation,emoji:panel.emoji,pose:panel.pose&&!capture?{id:panel.pose,frameIndex:recordedPoses.poses[panel.pose].frameIndex,landmarkCount:33,connectionCount:POSE_EDGES.length,sourceSha256:recordedPoses.poses[panel.pose].sourceSha256,projectionSha256:recordedPoses.projectionSha256,projectionSha256LF:recordedPoses.projectionSha256LF}:null});
  }
}
const thumbs=[];
const sheetWidth=1800,thumbWidth=540,thumbHeight=Math.round(thumbWidth*2868/1320),gap=36,padding=54,titleHeight=148;
for(let i=0;i<6;i++){
  const filename=path.join(OUT,`iphone-${content.panels[i].id}.png`);
  thumbs.push({input:await sharp(filename).resize(thumbWidth,thumbHeight).png().toBuffer(),left:padding+(i%3)*(thumbWidth+gap),top:titleHeight+Math.floor(i/3)*(thumbHeight+gap)});
}
const sheetHeight=titleHeight+2*thumbHeight+gap+padding;
const reviewCaptureCount=records.filter(record=>record.kind==='user-supplied-screenshot-review').length;
const providedCaptureCount=Object.values(captures).reduce((sum,entries)=>sum+Object.keys(entries||{}).length,0);
if(records.filter(record=>record.nativeScreenshotSupplied).length!==providedCaptureCount)throw new Error('Not every provided screenshot was composed.');
const phoneCaptureCount=records.filter(record=>record.platform==='iphone'&&record.nativeScreenshotSupplied).length;
const tabletCaptureCount=records.filter(record=>record.platform==='ipad'&&record.nativeScreenshotSupplied).length;
const sheetSummary=`This sheet: ${phoneCaptureCount} iPhone screenshots + ${6-phoneCaptureCount} preview${phoneCaptureCount===5?'':'s'} | Separate iPad set: ${tabletCaptureCount} screenshots + ${6-tabletCaptureCount} previews`;
const sheetTitle=`<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidth}" height="${sheetHeight}">${rect(0,0,sheetWidth,sheetHeight,C.bg)}${text('POSETEK / APP STORE GALLERY',54,61,31,C.ink,'bold')}${text(sheetSummary,54,106,23,C.lime)}</svg>`;
await sharp(Buffer.from(sheetTitle)).composite(thumbs).flatten({background:C.bg}).removeAlpha().png().toFile(path.join(OUT,'contact-sheet.png'));

// A supplementary source sheet lets the release owner inspect all three
// sanitized recorded poses without presenting them as captured app screens.
let referenceArt=rect(0,0,1800,1080,C.bg)+text('POSETEK / RECORDED POSE REFERENCES',58,78,40,C.ink,'bold')+text('33 source landmarks · 35 canonical connections · uniform scale, no substituted joints',58,130,25,C.muted);
['shooting','sprint','jump'].forEach((id,index)=>{
  const x=58+index*570,pose=recordedPoses.poses[id];
  referenceArt+=rect(x,174,544,774,'#0a241a',24,C.line,2)+text(id==='jump'?'VERTICAL JUMP':id.toUpperCase(),x+28,222,28,C.lime,'bold');
  referenceArt+=poseSVG(id,{x:x+34,y:252,width:476,height:588,padding:14},{strokeWidth:2.3,dotRadius:2.8});
  referenceArt+=text(`SOURCE FRAME ${pose.frameIndex} (ZERO-BASED)`,x+28,889,18,C.muted,'mono');
  referenceArt+=text(pose.phase,x+28,921,20,C.ink,'medium');
});
referenceArt+=text('Derived homepage coordinates. Estimated reconstruction; not a calibrated body scan.',58,1000,24,C.muted);
const referenceSvg=`<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1080" viewBox="0 0 1800 1080">${referenceArt}</svg>`;
fs.writeFileSync(path.join(SOURCE,'pose-reference-sheet.svg'),referenceSvg);
await sharp(Buffer.from(referenceSvg)).flatten({background:C.bg}).removeAlpha().png().toFile(path.join(OUT,'pose-reference-sheet.png'));

const manifest={schemaVersion:3,product:'PoseTek',mode:reviewMode?'user-supplied-review':supplied?'release-capture-composition':'illustrative-preview',submissionReady:false,reviewStatus:reviewMode?'User-provided screenshots are review material. Build identity and privacy review are unverified; low-resolution sources need release recapture.':'Requires current-build native captures, copy review, and App Store Connect final verification.',galleryCompositionComplete:true,requiredPlatforms:['iphone','ipad'],targetedDeviceFamily:[1,2],currentBuild:!reviewMode?supplied?.buildNumber||null:null,currentBuildConfirmed:Boolean(supplied&&!reviewMode),privacyReviewed:Boolean(supplied&&!reviewMode),captureProvenance:reviewMode?'User-provided screenshots; no release-build provenance is inferred.':supplied?.captureProvenance||null,providedCaptureCount,reviewCaptureCount,platformSupplied:{iphone:Object.keys(captures.iphone||{}).length,ipad:Object.keys(captures.ipad||{}).length},platformCandidate:{iphone:!reviewMode&&Object.keys(captures.iphone||{}).length===6,ipad:!reviewMode&&Object.keys(captures.ipad||{}).length===6},allNativeScreenshotsSupplied:providedCaptureCount===12,important:'Review images are not submission approval. Unmatched cards remain sample interfaces. iPad captures are required because TARGETED_DEVICE_FAMILY is 1,2.',referenceLock:content.referenceLock,emojiSource:{repository:emojiManifest.repository,commit:emojiManifest.commit,style:emojiManifest.style,license:emojiManifest.license},poseSource:{schema:recordedPoses.schema,landmarkCount:33,connectionCount:POSE_EDGES.length,projectionSha256:recordedPoses.projectionSha256,projectionSha256LF:recordedPoses.projectionSha256LF},images:records};
fs.writeFileSync(path.join(OUT,'gallery-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const cards=records.map(record=>{
  const status=record.kind==='user-supplied-screenshot-review'?`<b>User-supplied screenshot:</b> ${record.capture.width} x ${record.capture.height} ${esc(record.capture.format.toUpperCase())}. ${record.capture.warnings.map(esc).join(' ')}`:record.nativeScreenshotSupplied?'<b>Current-build capture supplied:</b> Final release review remains required.':`<b>Capture needed:</b> ${esc(record.captureInstruction)}`;
  return `<article data-platform="${record.platform}"><a href="${record.file}" target="_blank" rel="noopener"><img src="${record.file}" alt="${esc(record.headline.join(' '))}: ${record.kind}" loading="lazy" width="${record.width}" height="${record.height}"></a><h2>${esc(record.headline.join(' '))}</h2><p>${esc(record.description)}</p><p class="capture">${status}</p><a href="${record.file}" download>Download ${record.width} × ${record.height} PNG</a></article>`;
}).join('');
const reviewIntro=reviewMode?`${reviewCaptureCount} user-supplied screenshots appear unchanged inside PoseTek artwork. ${12-reviewCaptureCount} cards still use labeled sample interfaces. These materials support design review; build identity, privacy review, and App Store release suitability are unverified.`:'Six PoseTek story moments, composed for iPhone and iPad. Sample interfaces are source-grounded illustrations. Complete current-build native screenshot sets are required before final release review.';
fs.writeFileSync(path.join(OUT,'gallery-review.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PoseTek · App Store gallery review</title><style>@font-face{font-family:Inter;src:url('../fonts/inter-latin-400-normal.woff')}@font-face{font-family:Inter;font-weight:700;src:url('../fonts/inter-latin-700-normal.woff')}*{box-sizing:border-box}body{margin:0;background:${C.bg};color:${C.ink};font:16px/1.6 Inter,sans-serif}header,main{max-width:1560px;margin:auto;padding:40px 32px}header{padding-bottom:16px}h1{font-size:clamp(30px,5vw,52px);line-height:1.1;margin:10px 0 22px}header p{max-width:890px;color:${C.muted}}.status{color:${C.lime};font-weight:700}nav{display:flex;gap:12px;flex-wrap:wrap;margin:26px 0}button,a{font:inherit}button{border:1px solid ${C.line};border-radius:8px;padding:12px 22px;background:transparent;color:${C.ink};cursor:pointer}button[aria-pressed=true]{background:${C.lime};color:${C.bg}}a{color:${C.lime};text-underline-offset:4px}a:focus-visible,button:focus-visible{outline:3px solid ${C.lime};outline-offset:6px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:38px 28px}article img{display:block;width:100%;height:auto;border:1px solid ${C.line}}article h2{font-size:22px;line-height:1.2}article p{color:${C.muted};font-size:14px}.capture{border-top:1px solid ${C.line};padding-top:15px;font-size:13px}[hidden]{display:none!important}@media(max-width:1000px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.grid{grid-template-columns:1fr}header,main{padding:28px 20px}}</style></head><body><header><div class="status">REVIEW PACKAGE · NOT READY FOR SUBMISSION</div><h1>Start with evidence.<br>Build a gallery around the product.</h1><p>${esc(reviewIntro)}</p><p><a href="contact-sheet.png">View iPhone contact sheet</a> · <a href="gallery-manifest.json">View provenance manifest</a></p><nav aria-label="Device family"><button aria-pressed="true" data-filter="iphone">iPhone · 1320 × 2868</button><button aria-pressed="false" data-filter="ipad">iPad · 2064 × 2752</button></nav></header><main><div class="grid">${cards}</div></main><script>const buttons=[...document.querySelectorAll('[data-filter]')],cards=[...document.querySelectorAll('[data-platform]')];function select(platform){buttons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===platform)));cards.forEach(c=>c.hidden=c.dataset.platform!==platform)}buttons.forEach(b=>b.addEventListener('click',()=>select(b.dataset.filter)));select('iphone');</script></body></html>`.replace('color:undefined','color:'+C.muted));
console.log(JSON.stringify({output:OUT,images:records.length,contactSheet:path.join(OUT,'contact-sheet.png'),reviewPage:path.join(OUT,'gallery-review.html'),submissionReady:false,platformCandidate:manifest.platformCandidate},null,2));
