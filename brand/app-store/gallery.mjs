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

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const OUT = path.join(ROOT, 'output');
const SOURCE = path.join(ROOT, 'source');
const C = { bg:'#04130e', lime:'#b7f34a', ink:'#f0f5ed', muted:'#a9bdb1', line:'#254036', panel:'#102b20', deep:'#082015', nativeLime:'#7cff18' };
const content = JSON.parse(fs.readFileSync(path.join(ROOT, 'gallery-content.json'), 'utf8'));
const officialIconPath=path.resolve(ROOT,'../../images/brand/posetek-app-icon.svg');
const officialIconInner=fs.readFileSync(officialIconPath,'utf8').replace(/^[\s\S]*?<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'');
const inputIndex = process.argv.indexOf('--input');
const inputPath = inputIndex >= 0 ? path.resolve(process.argv[inputIndex + 1] || '') : null;
const supplied = inputPath ? JSON.parse(fs.readFileSync(inputPath, 'utf8')) : null;
const fonts = {};
const copiedLicenses = new Set();

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
    const points=[[.46,.20],[.45,.31],[.41,.34],[.57,.35],[.33,.44],[.65,.44],[.26,.41],[.73,.39],[.46,.54],[.57,.53],[.40,.69],[.65,.66],[.33,.85],[.75,.77]];
    const edges=[[0,1],[1,2],[1,3],[2,4],[4,6],[3,5],[5,7],[2,8],[3,9],[8,9],[8,10],[10,12],[9,11],[11,13]];
    const p=points.map(([a,b])=>[x+w*a,y+h*b]);
    edges.forEach(([a,b])=>s+=line(...p[a],...p[b],C.ink,3));
    p.forEach(([a,b],i)=>s+=circle(a,b,i===0?9:3.8,i===0?'none':C.nativeLime,C.nativeLime,i===0?3:0));
    s+=line(x+w*.45,y+24,x+w*.45,y+h-24,C.nativeLime+'65',1,'4 5');
  }
  return s;
}

function screenBody(kind) {
  let s='';
  if(kind==='profile') {
    s+=rect(24,177,342,112,C.panel,22)+circle(67,231,25,C.nativeLime+'18')+text('P',67,241,28,C.nativeLime,'black','middle');
    s+=text('SAMPLE ATHLETE',109,210,10,C.muted,'mono', 'start',.5)+text('Your next step',109,239,21,C.ink,'bold')+text('starts with your results.',109,260,12,C.muted);
    s+=text('SKILL MAP',27,322,10,C.muted,'mono','start',.8)+tag('SAMPLE DATA',259,305,106);
    s+=radar(195,457,98)+line(27,594,363,594);
    s+=text('Bring your results together',27,627,17,C.ink,'bold');
    s+=wrap('Explore five skill areas and choose where to focus next.',27,650,330,12).svg;
    s+=action('Explore your profile',706);
  } else if(kind==='tests') {
    s+=wrap('Choose a test to record a session or review your results.',27,190,324,14,C.muted).svg;
    const tests=[['Shooting','ball'],['Sprint','run'],['Vertical jump','jump'],['Broad jump','jump'],['Dribbling','cone'],['Change of','arrow']];
    tests.forEach(([label,key],i)=>{const x=25+(i%2)*174,y=241+Math.floor(i/2)*149;s+=rect(x,y,165,137,C.panel,19,'#2b4736');s+=icon(key,x+16,y+17,28);s+=text(label,x+16,y+77,14,C.ink,'bold');if(i===5)s+=text('direction',x+16,y+96,14,C.ink,'bold');s+=text('Record / review',x+16,y+119,10,C.muted);});
    s+=text('SIX PERFORMANCE TESTS',195,727,10,C.nativeLime,'mono','middle',.6);
  } else if(kind==='replay') {
    s+=text('Sprint · sample session',27,192,14,C.ink,'bold')+tag('REP 02',286,175,77);
    s+=pitch(25,220,340,340)+text('SCHEMATIC SAMPLE FRAME',195,249,9,C.muted,'mono','middle',.4);
    s+=line(43,591,347,591,'#45634b',3)+line(43,591,175,591,C.nativeLime,3)+circle(175,591,6,C.nativeLime);
    s+=text('00:01.6',28,620,12,C.ink,'mono')+text('Frame by frame',361,620,11,C.muted,'body','end');
    s+=row('Replay speed','0.5×',662)+row('View','Pose',702);
    s+=text('Example movement illustration',195,744,10,C.muted,'body','middle');
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
function phoneInterface(panel) {
  let s=rect(0,0,390,844,'#061b12',40);
  s+=text('9:41',28,33,13,C.ink,'bold')+rect(148,13,94,24,'#020a06',14);
  s+=line(327,26,327,32,C.ink,2)+line(332,23,332,32,C.ink,2)+line(337,20,337,32,C.ink,2)+rect(347,21,20,10,'none',2,C.ink)+rect(349,23,15,6,C.ink,1);
  s+=logo(24,64,28)+text('PoseTek',63,85,21,C.ink,'bold')+line(24,104,366,104);
  s+=text('SOURCE-DERIVED SAMPLE INTERFACE',25,126,8,C.muted,'mono','start',.3)+text(panel.screenTitle,25,157,21,C.ink,'bold');
  s+=screenBody(panel.screen);
  const items=['Profile','AI Coach','Drills','Training','Ranks'];
  s+=line(20,777,370,777);
  items.forEach((label,i)=>{const active=(panel.screen==='tests'&&i===2)||(panel.screen==='workout'&&i===3)||(['profile','focus','progress','replay'].includes(panel.screen)&&i===0);const x=40+i*77;s+=circle(x,797,3,active?C.nativeLime:C.muted)+text(label,x,814,8,active?C.nativeLime:C.muted,'medium','middle');});
  s+=rect(137,831,116,4,C.ink,2);
  return s;
}
function tabletInterface(panel) {
  let s=rect(0,0,1200,1044,'#061b12',28)+text('9:41',32,35,13,C.ink,'bold');
  s+=logo(29,76,36)+text('PoseTek',82,103,27,C.ink,'bold')+line(26,129,1174,129);
  s+=rect(0,147,240,897,'#071910')+text('WORKSPACE',30,181,10,C.muted,'mono','start',1);
  ['Profile','AI Coach','Drills','Training','Leaderboards'].forEach((label,i)=>{const y=233+i*68,active=(panel.screen==='tests'&&i===2)||(panel.screen==='workout'&&i===3)||(['profile','focus','progress','replay'].includes(panel.screen)&&i===0);if(active)s+=rect(16,y-29,184,49,C.nativeLime+'15',12);s+=text(label,32,y,15,active?C.nativeLime:C.muted,active?'bold':'medium');});
  s+=wrap('Source-derived tablet layout. Native iPad capture still required.',30,896,175,12,C.muted).svg;
  s+=text(panel.screenTitle,286,191,29,C.ink,'bold')+text('SAMPLE INTERFACE · ILLUSTRATIVE DATA',286,219,11,C.muted,'mono');
  // A wide native-style workspace with an explicit navigation rail, never a stretched phone.
  s+=group(266,62,1.12,screenBody(panel.screen));
  s+=line(754,262,754,913,C.line);
  s+=text('THE NEXT STEP',792,295,12,C.nativeLime,'mono','start',.7);
  s+=wrap(panel.headline.join(' '),792,347,328,35,C.ink,'display',38).svg;
  s+=wrap(panel.description,792,486,305,18,C.muted,'body',28).svg;
  s+=rect(793,717,301,136,C.panel,20)+text('Preview context',813,753,17,C.ink,'bold')+wrap('Illustrative data only. Capture the current native iPad app before submission.',813,785,257,13,C.muted).svg;
  s+=rect(536,1028,128,4,C.ink,2);
  return s;
}
function brandHeader(width,idx,tablet=false) {
  const margin=tablet?112:94,y=tablet?99:88,size=tablet?69:62;
  return logo(margin,y,size)+text('POSETEK',margin+size+24,y+size*.76,tablet?52:42,C.ink,'black','start',tablet?4:3)+text(`${String(idx+1).padStart(2,'0')} / 06`,width-margin,y+size*.7,tablet?30:24,C.muted,'mono','end');
}
function captureDevice(data,x,y,w,h,radius) {
  // Full screenshot is embedded unchanged; contain semantics prevent any crop.
  return rect(x-10,y-10,w+20,h+20,'#010805',radius+10,'#4a6655',3)+`<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${data.width} ${data.height}" preserveAspectRatio="xMidYMid meet"><image href="data:image/png;base64,${data.buffer.toString('base64')}" width="${data.width}" height="${data.height}"/></svg>`;
}
function compose(panel,idx,platform,capture=null) {
  const tablet=platform==='ipad',width=tablet?2064:1320,height=tablet?2752:2868;
  const margin=tablet?112:94;
  let s=rect(0,0,width,height,C.bg)+brandHeader(width,idx,tablet);
  s+=text(panel.eyebrow,margin,tablet?271:251,tablet?26:22,C.lime,'mono','start',1.6);
  const headlineSize=tablet?178:143,firstY=tablet?469:423,leading=tablet?172:145;
  panel.headline.forEach((v,i)=>{const fitted=Math.min(headlineSize,(width-margin*2)/textWidth(v,1,'display'));s+=text(v,margin,firstY+i*leading,fitted,C.ink,'display');});
  const body=wrap(panel.description,margin,tablet?746:643,width-margin*2,tablet?39:34,C.muted,'body',tablet?56:48);
  s+=body.svg;
  if(body.bottom>(tablet?873:764))throw new Error(`${panel.id}: body copy overlaps device`);
  if(tablet) {
    const x=111,y=915,w=1842,h=1603;
    if(capture) {
      const portraitWidth=h*capture.width/capture.height;
      s+=captureDevice(capture,(width-portraitWidth)/2,y,portraitWidth,h,45);
    }
    else {
      // Portrait gallery art holds an intentionally wide tablet composition.
      s+=rect(x-9,y-9,w+18,h+18,'#010805',48,'#4a6655',3);
      s+=`<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 1200 1044" preserveAspectRatio="xMidYMid meet"><defs><clipPath id="tablet-clip"><rect width="1200" height="1044" rx="28"/></clipPath></defs><g clip-path="url(#tablet-clip)">${tabletInterface(panel)}</g></svg>`;
    }
  } else {
    const x=245,y=816,w=830,h=1796;
    if(capture)s+=captureDevice(capture,x,y,w,h,83);
    else s+=rect(x-10,y-10,w+20,h+20,'#010805',87,'#4a6655',3)+group(x,y,w/390,phoneInterface(panel));
  }
  const footerY=tablet?2638:2730;
  s+=line(margin,footerY-26,width-margin,footerY-26,C.line,2);
  s+=text(capture?'Current-build screenshot composition':'Layout preview • sample interface',margin,footerY+19,tablet?30:27,capture?C.ink:C.lime,'medium');
  s+=text(capture?'For final release review':'Source-grounded illustration · not a native screenshot',margin,footerY+65,tablet?24:22,C.muted,'body');
  const title=`PoseTek — ${panel.headline.join(' ')} — ${capture?'screenshot composition':'layout preview'}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><desc>${esc(panel.description)} ${capture?'Uses supplied current-build capture.':'Illustrative review concept. No authentic app screenshot is claimed. All values are fictional sample data.'}</desc>${s}</svg>`;
}
async function readCaptures(platform) {
  if(!supplied?.[platform])return null;
  if(!supplied.currentBuildConfirmed||!supplied.privacyReviewed||!supplied.buildNumber||supplied.buildNumber.startsWith('REPLACE')||!supplied.captureProvenance)throw new Error('Current-build identity, explicit confirmation, privacy review, and capture provenance are required.');
  const result={};
  for(const panel of content.panels) {
    const input=supplied[platform][panel.id];
    if(!input)throw new Error(`${platform}: provide all six captures; missing ${panel.id}`);
    const full=path.resolve(path.dirname(inputPath),input);
    const meta=await sharp(full).metadata();
    if(!['png','jpeg'].includes(meta.format))throw new Error(`${full}: PNG or JPEG required`);
    if(meta.width<meta.height*(platform==='iphone'?.4:.6)||meta.width>meta.height*(platform==='iphone'?.55:.9))throw new Error(`${full}: expected a complete portrait ${platform} screen capture, without a device frame.`);
    if(meta.width<(platform==='iphone'?1170:1640))throw new Error(`${full}: insufficient capture resolution`);
    const buffer=await sharp(full).flatten({background:C.bg}).removeAlpha().png().toBuffer();
    result[panel.id]={buffer,width:meta.width,height:meta.height,filename:path.basename(full),sha256:createHash('sha256').update(fs.readFileSync(full)).digest('hex')};
  }
  return result;
}

const captures={iphone:await readCaptures('iphone'),ipad:await readCaptures('ipad')};
const records=[];
for(const platform of ['iphone','ipad']) {
  for(const [idx,panel] of content.panels.entries()) {
    const capture=captures[platform]?.[panel.id]||null;
    const svg=compose(panel,idx,platform,capture);
    const stem=`${platform}-${panel.id}`,file=`${stem}.png`;
    // Source SVGs intentionally remain review concepts even during a capture run.
    fs.writeFileSync(path.join(SOURCE,`${stem}.svg`),compose(panel,idx,platform));
    await sharp(Buffer.from(svg)).flatten({background:C.bg}).removeAlpha().png({compressionLevel:9}).toFile(path.join(OUT,file));
    const meta=await sharp(path.join(OUT,file)).metadata();
    if(meta.hasAlpha)throw new Error(`${file}: unexpected alpha channel`);
    records.push({platform,id:panel.id,file,width:meta.width,height:meta.height,channels:meta.channels,kind:capture?'current-build-screenshot-composition':'sample-interface-layout-preview',nativeScreenshotSupplied:Boolean(capture),capture:capture?{filename:capture.filename,sha256:capture.sha256}:null,sourceReferences:panel.sourceReferences,captureInstruction:panel.captureInstruction});
  }
}
const thumbs=[];
const sheetWidth=1800,thumbWidth=540,thumbHeight=Math.round(thumbWidth*2868/1320),gap=36,padding=54,titleHeight=148;
for(let i=0;i<6;i++){
  const filename=path.join(OUT,`iphone-${content.panels[i].id}.png`);
  thumbs.push({input:await sharp(filename).resize(thumbWidth,thumbHeight).png().toBuffer(),left:padding+(i%3)*(thumbWidth+gap),top:titleHeight+Math.floor(i/3)*(thumbHeight+gap)});
}
const sheetHeight=titleHeight+2*thumbHeight+gap+padding;
const sheetTitle=`<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWidth}" height="${sheetHeight}">${rect(0,0,sheetWidth,sheetHeight,C.bg)}${text('POSETEK / APP STORE GALLERY',54,61,31,C.ink,'bold')}${text('Six review layouts · sample interfaces · native screenshots still required',54,106,23,C.lime)}</svg>`;
await sharp(Buffer.from(sheetTitle)).composite(thumbs).flatten({background:C.bg}).removeAlpha().png().toFile(path.join(OUT,'contact-sheet.png'));

const manifest={schemaVersion:1,product:'PoseTek',submissionReady:false,reviewStatus:'Requires current-build native captures, copy review, and App Store Connect final verification.',galleryCompositionComplete:true,requiredPlatforms:['iphone','ipad'],targetedDeviceFamily:[1,2],currentBuild:supplied?.buildNumber||null,captureProvenance:supplied?.captureProvenance||null,platformCandidate:{iphone:Boolean(captures.iphone),ipad:Boolean(captures.ipad)},allNativeScreenshotsSupplied:Boolean(captures.iphone&&captures.ipad),important:'Preview concepts are not valid native screenshots. iPad captures are required because TARGETED_DEVICE_FAMILY is 1,2. Candidate composition does not grant submission approval.',referenceLock:content.referenceLock,images:records};
fs.writeFileSync(path.join(OUT,'gallery-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const cards=records.map(record=>{const p=content.panels.find(p=>p.id===record.id);return `<article data-platform="${record.platform}"><a href="${record.file}" target="_blank" rel="noopener"><img src="${record.file}" alt="${esc(p.headline.join(' '))}: ${record.kind}" loading="lazy" width="${record.width}" height="${record.height}"></a><h2>${esc(p.headline.join(' '))}</h2><p>${esc(p.description)}</p><p class="capture"><b>Capture needed:</b> ${esc(p.captureInstruction)}</p><a href="${record.file}" download>Download ${record.width} × ${record.height} PNG</a></article>`;}).join('');
fs.writeFileSync(path.join(OUT,'gallery-review.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PoseTek · App Store gallery review</title><style>@font-face{font-family:Inter;src:url('../fonts/inter-latin-400-normal.woff')}@font-face{font-family:Inter;font-weight:700;src:url('../fonts/inter-latin-700-normal.woff')}*{box-sizing:border-box}body{margin:0;background:${C.bg};color:${C.ink};font:16px/1.6 Inter,sans-serif}header,main{max-width:1560px;margin:auto;padding:40px 32px}header{padding-bottom:16px}h1{font-size:clamp(30px,5vw,52px);line-height:1.1;margin:10px 0 22px}header p{max-width:890px;color:${C.muted}}.status{color:${C.lime};font-weight:700}nav{display:flex;gap:12px;flex-wrap:wrap;margin:26px 0}button,a{font:inherit}button{border:1px solid ${C.line};border-radius:8px;padding:12px 22px;background:transparent;color:${C.ink};cursor:pointer}button[aria-pressed=true]{background:${C.lime};color:${C.bg}}a{color:${C.lime};text-underline-offset:4px}a:focus-visible,button:focus-visible{outline:3px solid ${C.lime};outline-offset:6px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:38px 28px}article img{display:block;width:100%;height:auto;border:1px solid ${C.line}}article h2{font-size:22px;line-height:1.2}article p{color:${C.muted};font-size:14px}.capture{border-top:1px solid ${C.line};padding-top:15px;font-size:13px}[hidden]{display:none!important}@media(max-width:1000px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.grid{grid-template-columns:1fr}header,main{padding:28px 20px}}</style></head><body><header><div class="status">REVIEW PACKAGE · NOT READY FOR SUBMISSION</div><h1>Start with evidence.<br>Build a gallery around the product.</h1><p>Six PoseTek story moments, composed for iPhone and iPad. The sample interfaces are source-grounded illustrations. Replace them with complete current-build native screenshot sets before final release review.</p><p><a href="contact-sheet.png">View iPhone contact sheet</a> · <a href="gallery-manifest.json">View provenance manifest</a></p><nav aria-label="Device family"><button aria-pressed="true" data-filter="iphone">iPhone · 1320 × 2868</button><button aria-pressed="false" data-filter="ipad">iPad · 2064 × 2752</button></nav></header><main><div class="grid">${cards}</div></main><script>const buttons=[...document.querySelectorAll('[data-filter]')],cards=[...document.querySelectorAll('[data-platform]')];function select(platform){buttons.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===platform)));cards.forEach(c=>c.hidden=c.dataset.platform!==platform)}buttons.forEach(b=>b.addEventListener('click',()=>select(b.dataset.filter)));select('iphone');</script></body></html>`.replace('color:undefined','color:'+C.muted));
console.log(JSON.stringify({output:OUT,images:records.length,contactSheet:path.join(OUT,'contact-sheet.png'),reviewPage:path.join(OUT,'gallery-review.html'),submissionReady:false,platformCandidate:manifest.platformCandidate},null,2));
