/* Offline preparation of the approved two-record change-of-direction turn.
 * Reads only the private qualified-results/calibration audit. No Firebase calls.
 * Full evidence stays private; the renderer receives anonymous cropped poses.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const video=path.resolve(__dirname,'..'),original=process.env.POSETEK_SOURCE_ROOT||path.resolve(video,'../../../..');
const audit=path.join(original,'.netlify/video-product-demo-plan/cod-comparison-audit');
const output=path.join(video,'public/investor-exact-v3/cod.json'),receiptFile=path.join(video,'output/investor-exact-v3/cod-source-validation.json');
const read=(file)=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const valid=p=>p&&p.length===3&&p.every(Number.isFinite)&&p[2]>=.1&&p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1;
function world(r,p){
 const c=r.calibration,g=c.ground;
 const groundY=g.left.y+(p[0]-g.left.x)*(g.right.y-g.left.y)/(g.right.x-g.left.x);
 return [(p[0]-c.turnHipX)*c.metersPerNormalizedX*c.direction,(groundY-p[1])*c.metersPerNormalizedX/c.aspect];
}
const records=[],evidence=[],privateIds=[];
for(const [index,key] of ['player','reference'].entries()){
 const local=path.join(audit,key),r=n=>read(path.join(local,n)),current=read(path.join(audit,key+'-results.json'));
 const candidates=current.reps.filter(rep=>rep.resultStatus.qualified&&!rep.resultStatus.duplicate);
 assert.equal(candidates.length,1,'Expected one audited qualified COD rep per example');
 const rep=candidates[0],metadata=r('metadata.json'),context=r('reprocess_context.json'),pose=r('pose.json'),markers=r('aruco_corners.json'),gate=r('change_of_direction_marker.json');
 const artifacts=[...r('artifact-index.json'),...r('calibration-index.json')],verified=[];
 for(const artifact of artifacts){
  const file=path.join(local,artifact.name);
  if(!fs.existsSync(file)){assert(!artifact.name.endsWith('.json'),'Missing analysis evidence');continue;}
  const bytes=fs.readFileSync(file);
  assert.equal(bytes.length,artifact.bytes,artifact.name+': size changed');
  assert.equal(crypto.createHash('md5').update(bytes).digest('base64'),artifact.md5Hash,artifact.name+': sourceMD5 mismatch');
  if(artifact.sha256)assert.equal(sha(bytes),artifact.sha256,artifact.name+': sourceSHA mismatch');
  verified.push({name:artifact.name,sha256:sha(bytes)});
 }
 assert.equal(context.rep.repId,rep.id);assert.equal(context.rep.playerDocId,current.uid);
 assert.equal(metadata.processingStatus,'complete');assert.equal(metadata.calibrationGeometryTrusted,true);assert.deepEqual(metadata.failedSteps,[]);
 assert.equal(context.capture.recordingMatchesCalibrationGeometry,true);
 assert.equal(metadata.framesPerSecond,context.capture.clipFramesPerSecondUsed);
 assert.equal(metadata.videoDisplayWidth,1280);assert.equal(metadata.videoDisplayHeight,720);assert.equal(metadata.frameNormalization,'up_passthrough');
 assert.equal(pose.length,metadata.totalFrames);
 assert(Math.abs(metadata.markerDistance-context.calibration.markerSeparationMetersUsed)<1e-9);
 assert(Math.abs(metadata.totalTime-rep.totalTime)<1e-9);
 const turn=metadata.apexFrame;assert.equal(turn,index===0?371:344);
 assert(gate.startGateIsLeft===true,'Review opposite-side registration before changing sources');
 const first=turn-Math.round(1.2*metadata.framesPerSecond),last=turn+Math.round(1.4*metadata.framesPerSecond);
 assert(first>=metadata.startFrame&&last<=metadata.endFrame,'Turn crop escapes the qualified analysis window');
 const contacts=markers.markers.map(marker=>{
  const bottom=marker.cornersNormalized.slice().sort((a,b)=>b.y-a.y).slice(0,2);
  return{x:(bottom[0].x+bottom[1].x)/2,y:(bottom[0].y+bottom[1].y)/2};
 }).sort((a,b)=>a.x-b.x);
 assert.equal(contacts.length,2);assert(contacts[1].x-contacts[0].x>.1);
 const frames=pose.slice(first,last+1).map(frame=>frame?.map(p=>p?[p[0],p[1],p[3]]:null)??null);
 const sampleFrames=Array.from({length:79},(_,i)=>turn+Math.round((i/30-1.2)*metadata.framesPerSecond));
 for(const f of sampleFrames){
  const points=frames[f-first];assert(points&&points.length===33,'Missing complete source pose slot');
  for(const j of [0,11,12,23,24,25,26,27,28])assert(valid(points[j]),'Missing core tracked body joint');
 }
 const record={key,fps:metadata.framesPerSecond,firstSourceFrame:first,turnSourceFrame:turn,lastSourceFrame:last,frames,
  calibration:{metersPerNormalizedX:metadata.markerDistance/(gate.rightMarkerX-gate.leftMarkerX),aspect:1280/720,direction:1,turnHipX:(pose[turn][23][0]+pose[turn][24][0])/2,ground:{left:contacts[0],right:contacts[1]}}};
 records.push(record);
 privateIds.push(current.uid,rep.id,rep.sessionId,context.rep.videoStoragePath);
 evidence.push({key,qualified:true,duplicate:false,auditCapturedAt:current.capturedAt,sourceFrames:pose.length,sourceFPS:metadata.framesPerSecond,sourceDimensions:[1280,720],normalization:metadata.frameNormalization,originalMovieAvailable:verified.some(a=>a.name.endsWith('.mov')),sourceWindow:[first,last],savedTurnFrame:turn,recordedPhase2Seconds:metadata.phase2Time,phase2Definition:'Outward/inward crossing of 90% of this recording marker distance; not an equal-distance turn benchmark',courseMeters:metadata.markerDistance,displaySampleSourceFrames:sampleFrames,verifiedArtifacts:verified});
}
const all=records.flatMap(r=>r.frames.flatMap(f=>(f??[]).filter(valid).map(p=>world(r,p))));
const xs=all.map(p=>p[0]),ys=all.map(p=>p[1]);
const bounds={minX:Math.min(...xs)-.16,maxX:Math.max(...xs)+.16,minY:Math.min(0,...ys)-.12,maxY:Math.max(...ys)+.14};
const payload={version:3,window:{before:1.2,after:1.4},bounds,records,
 provenance:{representation:'Recorded 2D poses; anonymous reconstructed comparison',alignment:'Saved turnaround apex, fixed hip-origin translation, original calibrated meter scale, recorded ground line',timing:'Fractional source FPS retained; no interpolation or time warp',limits:'Individual recordings on different courses; no race, equal-course ranking or population benchmark'}};
const serialized=JSON.stringify(payload)+'\n';
for(const id of privateIds)if(id)assert(!serialized.includes(id),'Private identity in render payload');
assert(!/\b(Guy|Maurizio|Dylan|Niall)\b/i.test(serialized));
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,serialized);
const receipt={createdAt:new Date().toISOString(),passed:true,remoteMutations:0,renderPayloadSha256:sha(serialized),evidence,
 alignment:{event:'Stored modeled turn apex, not manually measured foot-plant contact',sharedWindowSeconds:[-1.2,1.4],worldCoordinates:'Calibrated x displacement from the fixed saved-turn hip midpoint; aspect-correct height above the recorded ground line. Same pixels per meter for both figures; no athlete-size or gate-length normalization.',bounds},
 timeline:{ready:[0,18],approach:[18,54],turnPause:[54,126],exit:[126,168],exitPause:[168,228],parentTransition:[228,246]},
 displayPolicy:'Example player solid lime; D1 reference translucent mint. Confidence <0.1 and missing joints remain omitted. No total-time or turn-duration advantage claimed.'};
fs.mkdirSync(path.dirname(receiptFile),{recursive:true});fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({passed:true,records:2,sourceWindows:evidence.map(r=>r.sourceWindow),turnFrames:evidence.map(r=>r.savedTurnFrame),fps:records.map(r=>r.fps),bounds,payloadSha256:sha(serialized),remoteMutations:0},null,2));
