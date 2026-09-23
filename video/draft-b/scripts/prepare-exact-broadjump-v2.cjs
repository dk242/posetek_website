/* Offline preparation of the approved account's recorded broad jump.
 * Reads the private read-only audit cache; never calls Firebase or modifies it.
 * No identity, object path, raw metadata or source credentials enter render JSON.
 * Native references: BroadJumpSessionView, BroadJumpProcessingMath and
 * SessionViewer/PoseSkeleton at the audited native source.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const videoRoot=path.resolve(__dirname,'..');
const sourceRoot=process.env.POSETEK_SOURCE_ROOT||path.resolve(videoRoot,'../../../..');
const audit=path.join(sourceRoot,'.netlify/video-product-demo-plan/broadjump-account-audit');
const output=path.join(videoRoot,'public/investor-exact-v2/broadjump.json');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const read=name=>JSON.parse(fs.readFileSync(path.join(audit,name),'utf8').replace(/^\uFEFF/,''));
const index=read('artifact-index.json');
for(const artifact of index){
 const bytes=fs.readFileSync(path.join(audit,artifact.name));
 assert.equal(bytes.length,artifact.size,artifact.name+': byte count changed');
 assert.equal(sha(bytes),artifact.sha256,artifact.name+': SHA-256 changed');
 assert.equal(crypto.createHash('md5').update(bytes).digest('base64'),artifact.md5Hash,artifact.name+': remote MD5 disagreement');
}
const current=read('effective-results.json'),rep=current.reps[0],metadata=read('metadata.json'),context=read('reprocess_context.json');
const fit=read('foot_piecewise_fit.json'),keys=read('key_frames.json'),pose=read('pose.json'),com=read('com_midpoints.json'),heights=read('com_height.json'),feet=read('foot_centers.json');
assert.equal(current.reps.length,1,'Selection is no longer unique');
assert(rep.resultStatus.qualified&&!rep.resultStatus.duplicate,'Source must remain a qualified, nonduplicate recorded result');
assert.equal(rep.id,context.rep.repId,'Audit selection/context mismatch');
assert.equal(rep.sessionNumber,1);assert.equal(rep.repNumber,1);
assert.equal(context.rep.videoArchived,false,'Re-audit timing if original video has been recovered');
assert.equal(metadata.resultsValid,true);assert.equal(context.result.resultsValid,true);
assert.equal(context.capture.clipFramesPerSecondUsed,120);
assert.equal(metadata.footSide,'right');
assert.equal(pose.length,503);for(const series of [com,heights,feet])assert.equal(series.length,pose.length);
assert.deepEqual(keys,[249,299]);
assert.equal(fit.takeoffFrameIndex,keys[0]);assert.equal(fit.landingFrameIndex,keys[1]);
assert(Math.abs(rep.broadJumpDistance-metadata.broadJumpDistance)<1e-10);
assert(Math.abs(rep.jumpHeight-metadata.jumpHeight)<1e-10);
assert(Math.abs((fit.endFootXNorm-fit.startFootXNorm)*metadata.m_to_normalized_units-metadata.broadJumpDistance)<1e-10);
assert.equal((metadata.broadJumpDistance*3.28084).toFixed(1),'4.8');
assert.equal((metadata.jumpHeight*39.3701).toFixed(1),'22.1');
const marker=metadata.arucoMarkers[0];
for(const [pixels,normalized] of [[marker.centerPixel,marker.centerNormalized],...marker.cornersPixels.map((v,i)=>[v,marker.cornersNormalized[i]])]){
 assert(Math.abs(pixels.x/normalized.x-1280)<1e-5,'Unexpected inferred image width');
 assert(Math.abs(pixels.y/normalized.y-720)<1e-5,'Unexpected inferred image height');
}
for(let i=14;i<=360;i++){
 assert(Array.isArray(pose[i])&&pose[i].length===33,'Missing pose in planned playback interval');
 for(const j of [0,11,12,14,16,23,24,26,27,28,29,30,31,32])assert(pose[i][j]&&pose[i][j][3]>=.1,'Missing tracked near-side joint');
}
const frames=pose.map(frame=>frame?.map(p=>p?[p[0],p[1],p[3]]:null)??null);
const points=frames.slice(14,361).flatMap(frame=>(frame??[]).filter(p=>p&&p[2]>=.1&&p[0]>=0&&p[0]<=1&&p[1]>=0&&p[1]<=1));
points.push(...marker.cornersNormalized.map(p=>[p.x,p.y,1]),[fit.startFootXNorm,metadata.ground_loc_y,1],[fit.endFootXNorm,metadata.ground_loc_y,1]);
const minX=Math.min(...points.map(p=>p[0]))-.04,maxX=Math.max(...points.map(p=>p[0]))+.04;
const center=(fit.startFootXNorm+fit.endFootXNorm)/2,half=Math.max(center-minX,maxX-center);
const bounds={minX:center-half,maxX:center+half,minY:Math.min(...points.map(p=>p[1]))-.05,maxY:Math.max(...points.map(p=>p[1]))+.05};
const payload={
 version:1,
 timing:{fps:120,provenance:'capture-declared',originalVideoAvailable:false,startFrame:120,endFrame:360},
 geometry:{width:1280,height:720,provenance:'inferred from recorded marker pixel/normalized coordinates',bounds},
 metrics:{distanceMeters:metadata.broadJumpDistance,peakHeightMeters:metadata.jumpHeight,flightSeconds:(keys[1]-keys[0])/120,trackedFoot:metadata.footSide},
 events:{takeoff:keys[0],landing:keys[1],peak:heights.indexOf(metadata.jumpHeight)},
 guides:{takeoffX:fit.startFootXNorm,landingX:fit.endFootXNorm,groundY:metadata.ground_loc_y,markerCorners:marker.cornersNormalized},
 frames,com,feet,heights,
 provenance:{representation:'Recorded 2D pose and source analysis; reconstructed native view',coordinatePolicy:'Original normalized x/y preserved; visibility carried unchanged; no interpolation, smoothing or invented joints',sourcePoseSha256:index.find(a=>a.name==='pose.json').sha256}
};
assert.equal(payload.events.peak,272);
const json=JSON.stringify(payload)+'\n';
for(const value of [context.rep.playerDocId,context.rep.repId,context.rep.sessionDocId,context.rep.videoStoragePath])assert(!json.includes(value),'Private source identity in render data');
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,json);
console.log(JSON.stringify({output:path.relative(videoRoot,output),sourceFrames:frames.length,displayInterval:[120,360],fps:120,fpsProvenance:'capture-declared',dimensions:[1280,720],dimensionProvenance:'marker geometry inferred',events:payload.events,metrics:payload.metrics,sha256:sha(json),verifiedSourceArtifacts:index.length,remoteMutations:0},null,2));
