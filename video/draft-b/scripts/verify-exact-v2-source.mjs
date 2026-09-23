/**
 * Offline V2 source acceptance. Run from video/draft-b.
 * Independently checks original private analysis bytes, the sanitized/staged
 * render payload, original website technique data, evaluated renderer clocks,
 * exact V1 narration and PCM samples. Does not render or modify source/media.
 * Output is a local receipt; final encoded-picture/audio QA remains separate.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const original=process.env.POSETEK_SOURCE_ROOT||path.resolve(root,'../../../..');
const audit=path.join(original,'.netlify/video-product-demo-plan/broadjump-account-audit');
const out=path.join(root,'output/investor-exact-v2'),stage=path.join(out,'render-assets');
const read=async p=>fs.readFile(path.isAbsolute(p)?p:path.join(root,p));
const json=async p=>JSON.parse((await read(p)).toString('utf8').replace(/^\uFEFF/,''));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b),near=(a,b,e=1e-9)=>Math.abs(a-b)<=e;
const checks=[],limits=[
 'Source acceptance does not replace viewing or decoding the encoded proof.',
 'Broad-jump120fps is capture-declared;1280x720 is inferred from original marker coordinates; source movie was not archived.',
 'Countdown/field synchronization uses the prior independently inspected first-airborne frame, with one-frame uncertainty.',
];
const check=(name,passed,observed)=>checks.push({name,passed:Boolean(passed),...(observed===undefined?{}:{observed})});
const exists=async p=>{try{await fs.access(p);return true;}catch{return false;}};
const parseTS=async p=>ts.createSourceFile(p,(await read(p)).toString(),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function evaluate(expression){return vm.runInNewContext(expression,{Math,Number,Object,JSON},{timeout:1000});}
async function sourceFunction(p,name){
 const ast=await parseTS(p),node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 if(!node)throw Error('Missing source function '+name);
 const text=node.getText(ast).replace(/^export\s+/,'');
 return evaluate(ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText+'\n'+name);
}
async function sourceVariable(p,name){
 const ast=await parseTS(p);let initializer;
 for(const stmt of ast.statements)if(ts.isVariableStatement(stmt))for(const decl of stmt.declarationList.declarations)if(decl.name.getText(ast)===name)initializer=decl.initializer?.getText(ast);
 if(!initializer)throw Error('Missing source variable '+name);
 return evaluate('('+initializer+')');
}
function wav(bytes){
 if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('Unsupported WAV container');
 let fmt,data;
 for(let at=12;at+8<=bytes.length;){
  const tag=bytes.toString('ascii',at,at+4),size=bytes.readUInt32LE(at+4),start=at+8;
  if(tag==='fmt ')fmt={code:bytes.readUInt16LE(start),channels:bytes.readUInt16LE(start+2),rate:bytes.readUInt32LE(start+4),align:bytes.readUInt16LE(start+12),bits:bytes.readUInt16LE(start+14)};
  if(tag==='data')data=bytes.subarray(start,start+size);
  at=start+size+(size%2);
 }
 if(!fmt||!data||![1,3,65534].includes(fmt.code)||![16,24,32].includes(fmt.bits))throw Error('Unsupported PCM format');
 return {...fmt,data,frames:data.length/fmt.align};
}
async function tree(directory){
 const found=[];for(const e of await fs.readdir(directory,{withFileTypes:true})){const p=path.join(directory,e.name);if(e.isDirectory())found.push(...await tree(p));else found.push(p);}return found;
}

try{
 const timing=await json('src/investor-exact-v2-timing.json');
 const v1=await json('audio-source/investor-exact-v1.json'),v2=await json('audio-source/investor-exact-v2.json');
 const captions=await json('public/audio-investor-exact-v2/captions.json'),segments=await json('public/audio-investor-exact-v2/segments.json');
 const authored=v1.passages.map(p=>p.text).join(' ');
 check('Exact V1 narration: nine passages,203words',v1.passages.length===9&&v2.passages.length===9&&authored.split(/\s+/).length===203&&equal(v1.passages.map(p=>[p.id,p.text]),v2.passages.map(p=>[p.id,p.text])));
 check('Authored passage SHA256 locks',v2.passages.every(p=>hash(p.text)===p.text_sha256));
 check('All captions preserve exact V1 characters',captions.map(c=>c.text).join(' ')===authored);
 check('Shared119second/3570frame clock',timing.duration===119&&timing.duration_frames===3570&&timing.fps===30&&timing.duration*timing.fps===timing.duration_frames);
 check('Audio config/timeline use same manifest',equal(v2.timeline,timing)&&equal(await json('public/audio-investor-exact-v2/timeline.json'),timing));
 check('Scene intervals tile119seconds exactly',timing.scenes[0].start===0&&timing.scenes.at(-1).end===3570&&timing.scenes.every((s,i)=>Number.isInteger(s.start)&&Number.isInteger(s.end)&&s.end>s.start&&(!i||s.start===timing.scenes[i-1].end)),timing.scenes.length);
 check('Transitions share scene boundaries',equal(timing.transitions,timing.scenes.slice(1).map(s=>s.start/timing.fps))&&timing.transition_frames===15);
 const demo=timing.original_demo,scene=timing.scenes.find(s=>s.id==='original-demo');
 check('Original demo has full25second slot',demo.start===21.5&&demo.end===46.5&&scene.start===645&&scene.end===1395);
 const measured=await json('public/audio-investor-exact-v2/measurements.json');
 check('Measured narration fits each reserved interval',segments.length===9&&segments.every((s,i)=>{
  const m=measured.passages.find(p=>p.id===s.id);
  return s.text===v2.passages[i].text&&m&&near(s.start,timing.passage_starts[s.id])&&near(s.end-s.start,m.speech_seconds,2e-6)&&s.end<=timing.scene_ends[s.id]&&s.start<s.end&&(!i||s.start>=segments[i-1].end)&&(s.end<=demo.start||s.start>=demo.end);
 }),segments.map(s=>({id:s.id,slackSeconds:Number((timing.scene_ends[s.id]-s.end).toFixed(4))})));
 const native=await sourceVariable('src/InvestorExactFilm.tsx','nativeCues');
 const allCaptions=[...captions,...native.map(c=>({...c,start:c.start+demo.start,end:c.end+demo.start}))].sort((a,b)=>a.start-b.start);
 check('Narration/native captions are ordered and nonoverlapping',allCaptions.every((c,i)=>c.start>=0&&c.end>c.start&&c.end<=119&&(!i||c.start>=allCaptions[i-1].end)),allCaptions.length);
 const manifest=await json('public/audio-investor-exact-v2/audio-manifest.json');
 for(const name of ['narration.wav','bed.wav','master.wav']){
  const bytes=await read('public/audio-investor-exact-v2/'+name),pcm=wav(bytes),slice=pcm.data.subarray(Math.round(demo.start*pcm.rate)*pcm.align,Math.round(demo.end*pcm.rate)*pcm.align);
  check(name+' measured sample duration and hash',pcm.rate===48000&&pcm.frames===119*48000&&hash(bytes)===manifest.audio[name].sha256,{frames:pcm.frames,rate:pcm.rate,channels:pcm.channels});
  check(name+' demo interval contains only zero PCM samples',slice.length===25*pcm.rate*pcm.align&&slice.every(b=>b===0));
 }
 const nativeBytes=await read('public/product/demo-audio.wav'),nativePCM=wav(nativeBytes);
 check('Original app audio is unchanged and25seconds',hash(nativeBytes)==='0a78f939168ee542146844bace043e26609db8ea8d3e652b631fd76027f435a6'&&nativePCM.frames/nativePCM.rate===25);
 const footage=await json('public/investor-exact/footage-timing.json');
 const visual=await json('output/exact-audio-qa/jump-and-mix-review.json');
 const firstAirborneRelative=(300+visual.derivative_first_clearly_airborne_frame_zero_based)/30;
 const oneRelative=footage.oneOnsetSeconds-footage.screenStart;
 const gap=firstAirborneRelative-oneRelative;
 check('Complete countdown and validated field takeoff timing',visual.derivative_first_clearly_airborne_frame_zero_based===151&&visual.derivative_frame_rate===30&&near(firstAirborneRelative,451/30)&&near(gap,1.007333333333333,1e-6)&&Math.abs(gap-1)<=1/30,{firstAirborneRelative,absoluteTakeoff:demo.start+firstAirborneRelative,absoluteOne:demo.start+oneRelative,intervalSeconds:gap});
 const filmText=(await read('src/InvestorExactFilmV2.tsx')).toString();
 const reveal=filmText.match(/rep=ease\(frame,\s*(\d+),\s*(\d+)\)/);
 const resultCue=native.find(c=>c.text.includes('4.8'));
 check('Recorded result finishes revealing before spoken distance',Boolean(reveal)&&Number(reveal[1])<Number(reveal[2])&&Number(reveal[2])/30<=resultCue.start,{revealStart:reveal?demo.start+Number(reveal[1])/30:null,revealComplete:reveal?demo.start+Number(reveal[2])/30:null,distanceSpeechStarts:demo.start+resultCue.start});

 const artifactIndex=await json(path.join(audit,'artifact-index.json'));
 check('Private source artifact bytes match observed storageMD5/SHA256',(await Promise.all(artifactIndex.map(async a=>{const bytes=await read(path.join(audit,a.name));return bytes.length===a.size&&hash(bytes)===a.sha256&&crypto.createHash('md5').update(bytes).digest('base64')===a.md5Hash;}))).every(Boolean),artifactIndex.length);
 check('Broad-jump source matches independently audited pose',hash(await read(path.join(audit,'pose.json')))==='dd9a69ad34461ad3ac368ac6f09b8ad40e7fd6e5b893cce9527c670e2b5b94fd');
 const originalPose=await json(path.join(audit,'pose.json')),metadata=await json(path.join(audit,'metadata.json')),context=await json(path.join(audit,'reprocess_context.json'));
 const fit=await json(path.join(audit,'foot_piecewise_fit.json')),keys=await json(path.join(audit,'key_frames.json')),effective=await json(path.join(audit,'effective-results.json'));
 const broad=await json('public/investor-exact-v2/broadjump.json');
 check('Unique qualified nonduplicate broad jump',effective.reps.length===1&&effective.reps[0].resultStatus.qualified&&!effective.reps[0].resultStatus.duplicate&&effective.reps[0].id===context.rep.repId&&metadata.resultsValid===true);
 check('All503original landmarkx/y/confidence/null masks preserved',equal(broad.frames,originalPose.map(f=>f?.map(p=>p?[p[0],p[1],p[3]]:null)??null))&&broad.frames.length===503);
 for(const [key,file] of [['com','com_midpoints.json'],['feet','foot_centers.json'],['heights','com_height.json']])check('Original '+key+' series preserved',equal(broad[key],await json(path.join(audit,file))));
 check('Timing and dimensions retain actual evidence limits',broad.timing.fps===120&&broad.timing.fps===context.capture.clipFramesPerSecondUsed&&broad.timing.provenance==='capture-declared'&&broad.timing.originalVideoAvailable===false&&context.rep.videoArchived===false&&broad.geometry.width===1280&&broad.geometry.height===720&&broad.geometry.provenance.includes('inferred'));
 check('Inferred dimensions agree with all recorded marker points',metadata.arucoMarkers.every(m=>[[m.centerPixel,m.centerNormalized],...m.cornersPixels.map((p,i)=>[p,m.cornersNormalized[i]])].every(([p,n])=>near(p.x/n.x,broad.geometry.width,1e-5)&&near(p.y/n.y,broad.geometry.height,1e-5))));
 const calculatedDistance=Math.abs(fit.endFootXNorm-fit.startFootXNorm)*metadata.m_to_normalized_units;
 check('Calibrated fitted-foot distance matches displayed record',near(calculatedDistance,broad.metrics.distanceMeters)&&near(metadata.broadJumpDistance,broad.metrics.distanceMeters)&&near(effective.reps[0].broadJumpDistance,broad.metrics.distanceMeters));
 check('Five native metric values and units',equal(keys,[249,299])&&broad.events.takeoff===249&&broad.events.landing===299&&broad.events.peak===272&&
  (broad.metrics.distanceMeters*3.28084).toFixed(1)==='4.8'&&(broad.metrics.peakHeightMeters*39.3701).toFixed(1)==='22.1'&&near(broad.metrics.peakHeightMeters,metadata.jumpHeight)&&
  near(broad.metrics.flightSeconds,(299-249)/120)&&broad.metrics.flightSeconds.toFixed(2)==='0.42'&&broad.metrics.trackedFoot==='right'&&
  (broad.heights[249]*39.3701).toFixed(1)==='14.5'&&(broad.heights[272]*39.3701).toFixed(1)==='22.1'&&(broad.heights[299]*39.3701).toFixed(1)==='9.0',
  {distance:'4.8ft',peak:'22.1in',flight:'0.42s',thisFrameAtLanding:'9.0in',trackedFoot:'Right'});
 const broadClock=await sourceFunction('src/ExactBroadJumpV2.tsx','exactBroadJumpState');
 const play=Array.from({length:61},(_,i)=>broadClock(i+18));
 check('Actual broad-jump clock preserves declared1x and explicit landing seek',play.every((s,i)=>s.sourceFrame===120+i*4&&!s.paused)&&broadClock(0).sourceFrame===120&&broadClock(131).sourceFrame===360&&broadClock(132).sourceFrame===299&&broadClock(132).paused&&broadClock(132).landingSeek);
 const bounds=broad.geometry.bounds;
 check('Fixed bounds enclose all confidence-filtered original poses',broad.frames.every(f=>!f||f.every(p=>!p||p[2]<.1||p[0]<0||p[0]>1||p[1]<0||p[1]>1||(p[0]>=bounds.minX&&p[0]<=bounds.maxX&&p[1]>=bounds.minY&&p[1]<=bounds.maxY))));

 const technique=await json('public/investor-exact/technique.json'),websitePath=path.join(original,'app/src/pages/home/technique/technique-data.json'),websiteBytes=await read(websitePath),website=JSON.parse(websiteBytes);
 check('Technique still uses exact original website sample',hash(websiteBytes)===technique.provenance.websiteSha256&&equal(technique.technique,Object.fromEntries(['fps','startFrame','step','frames','ball','phases','focusAreas'].map(k=>[k,website[k]]))));
 const clock=await sourceFunction('src/ExactTechniqueV2.tsx','exactTechniqueStateV2'),td=technique.technique;
 const stops=Array.from({length:624},(_,i)=>({frame:i,...clock(i)})).filter(s=>s.mode==='paused');
 const steps=[0,1,2,3].map(step=>stops.filter(s=>s.step===step));
 check('Actual technique holds original458/472/472/522frames',steps.every((group,i)=>group.length>0&&group.every(s=>td.startFrame+s.index*td.step===[458,472,472,522][i])),steps.map(g=>({frames:g.length,sourceFrame:td.startFrame+g[0]?.index*td.step})));
 const metric=id=>td.phases.flatMap(p=>p.metrics).find(m=>m.id===id);
 check('Saved technique values remain unchanged',near(metric('backswing.knee_angle.kicking').value,103.10328)&&near(metric('backswing.knee_angle.kicking').reference,75.73349)&&near(metric('contact.plant_foot_ball_offset_x.support').value,-7.95056)&&near(metric('contact.plant_foot_ball_offset_x.support').reference,3.6469)&&near(metric('contact.arm_abduction.lead').value,8.75691)&&near(metric('contact.arm_abduction.lead').reference,93.03339)&&near(metric('followThrough.knee_angle.kicking').value,128.1936)&&metric('followThrough.knee_angle.kicking').reference===null);
 const profile=await json('public/investor-exact/profile.json');
 check('Displayed profile is anonymous',profile.displayName==='Example player'&&!/\b(Guy|Maurizio|Dylan|Niall)\b/i.test(JSON.stringify(profile)));
 const preview=await json('public/investor-exact-v2/preview-poses.json'),priorPreview=await json('public/product/poses.json'),originalJump=priorPreview.records.find(r=>r.key==='guy-jump');
 check('Anonymous preview contains only original vertical-jump motion',preview.records.length===1&&preview.records[0].key==='example-jump'&&['kind','fps','frames','ground','width','height'].every(k=>equal(preview.records[0][k],originalJump[k]))&&equal(Object.keys(preview.records[0]),['key','kind','fps','frames','ground','width','height']));
 const renderFiles=await sourceVariable('scripts/render-exact-v2.mjs','files');
 const tokens=new Set([context.rep.playerDocId,context.rep.repId,context.rep.sessionDocId,context.rep.videoStoragePath]);
 const sprintManifest=await json('public/investor-exact/sprint/source/manifest.json');
 for(const r of sprintManifest.records)for(const k of ['uid','repId'])if(r[k])tokens.add(r[k]);
 const forbiddenKey=/^(uid|playerDocId|repId|sessionDocId|sessionId|storageFolder|videoStoragePath|downloadTokens|firebaseStorageDownloadTokens|email|access_token|refresh_token)$/i;
 const privacyIssues=[],legacyNames=[];
 function inspect(value,location){
  if(typeof value==='string'){
   if([...tokens].some(t=>t&&value.includes(t))||/firebaseStorageDownloadTokens|[?&]token=|Bearer\s/i.test(value))privacyIssues.push(location);
   if(/\b(Guy|Maurizio|Dylan|Niall)\b/i.test(value))legacyNames.push(location);
  }else if(Array.isArray(value))value.forEach((v,i)=>inspect(v,location+'['+i+']'));
  else if(value&&typeof value==='object')for(const [k,v]of Object.entries(value)){if(forbiddenKey.test(k))privacyIssues.push(location+'.'+k);inspect(v,location+'.'+k);}
 }
 for(const name of renderFiles.filter(f=>f.endsWith('.json')))inspect(await json('public/'+name),name);
 check('RenderJSON excludes privateIDs/paths/credentials',privacyIssues.length===0,{issueLocations:[...new Set(privacyIssues)]});
 check('RenderJSON excludes legacy real-name strings',legacyNames.length===0,{issueLocations:[...new Set(legacyNames)]});
 const stageExists=await exists(stage);
 if(stageExists){
  const actual=(await tree(stage)).map(f=>path.relative(stage,f).replaceAll('\\','/'));
  check('Staged render contains only explicit allowlist and fonts',actual.every(f=>renderFiles.includes(f)||/^fonts\/[^/]+\.woff2$/.test(f)),actual.length);
  check('All staged render payloads equal accepted source bytes',(await Promise.all(renderFiles.map(async f=>await exists(path.join(stage,f))&&hash(await read(path.join(stage,f)))===hash(await read('public/'+f))))).every(Boolean));
 }else{
  limits.push('Render-assets directory absent; rerun with --require-render-assets after staging.');
  if(process.argv.includes('--require-render-assets'))check('Render-assets staging exists',false);
 }
 await fs.mkdir(out,{recursive:true});
 const report={createdAt:new Date().toISOString(),scope:'Offline source acceptance only; encoded proof not tested here',passed:checks.every(c=>c.passed),renderStageChecked:stageExists,checks,limits};
 await fs.writeFile(path.join(out,'source-validation.json'),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({passed:report.passed,checks:checks.length,renderStageChecked:stageExists,failed:checks.filter(c=>!c.passed),receipt:'output/investor-exact-v2/source-validation.json'},null,2));
 if(!report.passed)process.exitCode=1;
}catch(error){console.error('V2 source verification: '+error.message);process.exitCode=1;}
