/* Read-only preparation of the authorized two-record sprint comparison.
 * Private selection and full provenance stay in ignored public/investor-exact/
 * sprint/source. Only poses.json belongs in the film render allowlist.
 * Requires existing Firebase CLI login, ffprobe and POSETEK_SOURCE_ROOT when
 * the website's installed functions dependencies live in another checkout.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const out=path.resolve(__dirname,'../public/investor-exact/sprint');
const source=path.join(out,'source');
const root=process.env.POSETEK_SOURCE_ROOT||path.resolve(__dirname,'../../..');
const specs=JSON.parse(fs.readFileSync(path.join(source,'selection.json'),'utf8').replace(/^\uFEFF/,''));
const project='kickai-69dd0',bucketName='kickai-69dd0.firebasestorage.app';
const digest=(bytes,algorithm='sha256',encoding='hex')=>crypto.createHash(algorithm).update(bytes).digest(encoding);
const write=(file,data)=>fs.writeFileSync(file,JSON.stringify(data)+'\n');
function buildPayload(manifest){
 const rows=manifest.records.map(record=>{
  const local=path.join(source,record.key),read=name=>JSON.parse(fs.readFileSync(path.join(local,name),'utf8'));
  for(const artifact of record.artifacts){const bytes=fs.readFileSync(path.join(local,artifact.name));if(digest(bytes)!==artifact.sha256)throw new Error('Private source changed after verification');}
  const pose=read('pose.json'),metadata=read('metadata.json'),context=read('reprocess_context.json'),calibration=read('aruco_points.json'),com=read('COM_meters.json');
  const fps=metadata.fps,start=calibration.motion_onset_frame,end=calibration.end_frame;
  if(!metadata.resultsValid||!metadata.calibrationGeometryTrusted||!context.capture.recordingMatchesCalibrationGeometry)throw new Error('Untrusted sprint geometry');
  if(!(fps>0)||Math.abs(fps-context.capture.clipFramesPerSecondUsed)>1e-5)throw new Error('Source timing disagreement');
  if(!Number.isInteger(start)||!Number.isInteger(end)||end<=start||end>=pose.length)throw new Error('Missing verified sprint event frames');
  if(pose.length!==Number(record.probe.nb_frames)||com.length!==pose.length)throw new Error('Pose/COM/movie frame counts do not agree');
  if(record.probe.width!==metadata.frameWidth||record.probe.height!==metadata.frameHeight)throw new Error('Unresolved source orientation');
  if(!['left','right'].includes(calibration.starting_side))throw new Error('Source direction missing');
  const left=calibration.point1.x<calibration.point2.x?calibration.point1:calibration.point2;
  const right=calibration.point1.x<calibration.point2.x?calibration.point2:calibration.point1;
  const meterScale=calibration.distance/(right.x-left.x);
  if(!(meterScale>0)||!calibration.ground_line||!Number.isFinite(com[start]?.[0]))throw new Error('Calibrated common ground unavailable');
  return {record,pose,metadata,calibration,com,fps,start,end,left,right,meterScale};
 });
 const duration=Math.floor(Math.min(...rows.map(r=>(r.end-r.start)/r.fps))*30)/30;
 const proof=[];
 const records=rows.map(r=>{
  const last=r.start+Math.floor(duration*r.fps),sign=r.calibration.starting_side==='left'?1:-1,origin=r.com[r.start][0];
  const frames=r.pose.slice(r.start,last+1).map(frame=>Array.isArray(frame)?frame.map(p=>p?[p[0],p[1],p.length===3?p[2]:p[3]]:null):null);
  const distances=r.com.slice(r.start,last+1).map(p=>Number.isFinite(p?.[0])?sign*(p[0]-origin):null);
  const samples=Array.from({length:Math.round(duration*30)+1},(_,i)=>Math.floor((i/30)*r.fps));
  for(const frame of samples){if(!frames[frame]||[11,12,23,24,25,26,27,28].some(j=>!frames[frame][j]||frames[frame][j][2]<.1))throw new Error('A displayed sprint frame lacks tracked body geometry');}
  proof.push({key:r.record.key,sourceFPS:r.fps,sourceFrameCount:r.pose.length,analysisStartFrame:r.calibration.start_frame,alignedMovementOnsetFrame:r.start,endFrame:r.end,lastDisplayedSourceFrame:last,sourcePoints:r.pose.find(Boolean)[0].length===3?'x,y,confidence; legacy 17 populated joints in 33 slots, five facial points at 0-4':'x,y,z,visibility; MediaPipe33',sampledSourceFrames:samples.map(i=>i+r.start),nullFramesInCrop:frames.map((p,i)=>p?null:i+r.start).filter(v=>v!==null),originCOMMeters:origin,finalTravelMeters:distances.at(-1),coordinateConversion:'Source aspect-correct image geometry with recorded horizontal marker scale and ground-line correction; fixed movement-onset COM origin. No per-athlete camera following, resampling, smoothing or time warping.'});
  return {key:r.record.key,fps:r.fps,frames,distances,calibration:{leftX:r.left.x,metersPerNormalizedX:r.meterScale,aspect:r.metadata.frameWidth/r.metadata.frameHeight,ground:r.calibration.ground_line,originX:origin,direction:sign}};
 });
 const payload={version:1,duration,records};
 const bytes=JSON.stringify(payload)+'\n';
 for(const spec of specs)if(bytes.includes(spec.uid)||bytes.includes(spec.id))throw new Error('Private identity in render payload');
 fs.writeFileSync(path.join(out,'poses.json'),bytes);
 write(path.join(source,'comparison-audit.json'),{preparedAt:new Date().toISOString(),sourceVerifiedAt:manifest.preparedAt,remoteMutations:0,sharedElapsedSeconds:duration,renderFrames:360,playbackFPS:30,records:proof,finalReferenceMinusPlayerMeters:proof[1].finalTravelMeters-proof[0].finalTravelMeters,sanitizedPayloadSha256:digest(bytes),limitations:['Different original course distances; film compares equal elapsed time and does not claim an equal-distance finish time.','Each recorded peak-speed result comes from the existing sprint model; the film adds no new athlete result.','D1 reference is the user-designated individual example, not a measured normative cohort.','Both poses are recorded 2D image landmarks; depth and new motion are not generated.']});
 console.log(`Sanitized comparison: ${duration.toFixed(2)} s shared interval, ${(proof[1].finalTravelMeters-proof[0].finalTravelMeters).toFixed(3)} m final COM difference; 360 film frames.`);
}
async function main(){
 if(specs.map(r=>r.key).join(',')!=='player,reference')throw new Error('Expected authorized private two-record selection');
 const auth=require(path.join(process.env.APPDATA,'npm/node_modules/firebase-tools/lib/auth.js'));
 const account=auth.getGlobalDefaultAccount();if(!account?.tokens?.refresh_token)throw new Error('Existing Firebase CLI login unavailable');
 const credential=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);
 const request=async(url,optional=false)=>{const r=await fetch(url,{headers:{Authorization:`Bearer ${credential.access_token}`},signal:AbortSignal.timeout(90000)});if(optional&&r.status===404)return null;if(!r.ok)throw new Error(`Read-only request HTTP ${r.status}`);return r;};
 const moduleAt=name=>require(path.join(root,'functions/node_modules',name));
 const {Firestore}=moduleAt('@google-cloud/firestore'),{Storage}=moduleAt('@google-cloud/storage'),{GoogleAuth,OAuth2Client}=moduleAt('google-auth-library');
 const client=new OAuth2Client();client.setCredentials({access_token:credential.access_token,expiry_date:Date.now()+45*60*1000});
 const googleAuth=new GoogleAuth({projectId:project,authClient:client});
 const db=new Firestore({projectId:project,auth:googleAuth}),bucket=new Storage({projectId:project,authClient:googleAuth}).bucket(bucketName);
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const effective=require(path.join(root,'functions/effective-results.js')).createEffectiveResults({db,bucket,HttpsError});
 const manifest={version:1,preparedAt:new Date().toISOString(),remoteMutations:0,records:[]};
 for(const spec of specs){
  const current=await effective.listForPlayer(spec.uid,'sprint',true),rep=current.reps.find(r=>r.id===spec.id);
  if(!rep?.resultStatus?.qualified||rep.resultStatus.duplicate||!rep.storageFolder)throw new Error(spec.key+': exact qualified source unavailable');
  const folder=rep.storageFolder,local=path.join(source,spec.key);fs.mkdirSync(local,{recursive:true});
  write(path.join(local,'qualified-results.json'),current);
  const artifacts=[],json={};
  const names=['pose.json','metadata.json','reprocess_context.json','COM.json','COM_meters.json','aruco_points.json','sprint_model_fit.json','model_velocity.json','velocity.json','sprint.mov'];
  for(const name of names){
   const object=folder+'/'+name;
   const metadataResponse=await request(`https://storage.googleapis.com/storage/v1/b/${bucketName}/o/${encodeURIComponent(object)}`);
   const metadata=await metadataResponse.json();if(!metadata.md5Hash)throw new Error('Source checksum missing');
   const filename=path.join(local,name);
   let bytes=fs.existsSync(filename)?fs.readFileSync(filename):null;
   if(!bytes||bytes.length!==Number(metadata.size)||digest(bytes,'md5','base64')!==metadata.md5Hash){
    bytes=Buffer.from(await(await request(`https://storage.googleapis.com/download/storage/v1/b/${bucketName}/o/${encodeURIComponent(object)}?alt=media&generation=${metadata.generation}`)).arrayBuffer());
    if(bytes.length!==Number(metadata.size)||digest(bytes,'md5','base64')!==metadata.md5Hash)throw new Error('Source checksum mismatch');
    fs.writeFileSync(filename,bytes);
   }
   artifacts.push({name,object,generation:metadata.generation,bytes:bytes.length,md5Hash:metadata.md5Hash,sha256:digest(bytes)});
   if(name.endsWith('.json'))json[name]=JSON.parse(bytes.toString('utf8'));
  }
  const context=json['reprocess_context.json'];
  if(context.rep?.playerDocId!==spec.uid||context.rep.repId!==spec.id)throw new Error('Capture identity mismatch');
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',path.join(local,'sprint.mov')],{encoding:'utf8'}));
  write(path.join(local,'probe.json'),probe);
  manifest.records.push({key:spec.key,uid:spec.uid,repId:spec.id,qualified:rep,artifacts,probe:probe.streams.find(s=>s.codec_type==='video')});
  console.log(spec.key+': exact qualified source and all artifact checksums verified');
 }
 await db.terminate();
 write(path.join(source,'manifest.json'),manifest);
 buildPayload(manifest);
 console.log('Private source preparation complete; no remote mutations.');
}
if(process.argv.includes('--local'))buildPayload(JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8')));
else main().catch(error=>{console.error(error.message);process.exitCode=1;});
