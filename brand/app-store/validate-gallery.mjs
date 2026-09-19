import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { recordedPoses, POSE_EDGES, validatePose, fitPose, poseSVG, textSha256LF } from './pose.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(root,'../..');
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
let portabilityCases=0;
function verifyPortableText(buffer, expected) {
  const lf=buffer.toString('utf8').replace(/\r\n/g,'\n');
  const crlf=lf.replace(/\n/g,'\r\n');
  assert.equal(textSha256LF(Buffer.from(lf,'utf8')),expected);
  assert.equal(textSha256LF(Buffer.from(crlf,'utf8')),expected);
  portabilityCases+=2;
}
const viewport={x:20,y:30,width:300,height:460,padding:12};
assert.equal(POSE_EDGES.length,35);
assert.equal(new Set(POSE_EDGES.flat()).size,33);
assert(POSE_EDGES.flat().every(index=>Number.isInteger(index)&&index>=0&&index<=32));
const reports=[];
for(const [id,pose] of Object.entries(recordedPoses.poses)) {
  validatePose(pose,recordedPoses.schema);
  assert.equal(pose.worldPoints.length,33);
  assert(pose.worldPoints.every(point=>point.length===3&&point.every(Number.isFinite)));
  const fitted=fitPose(pose,viewport);
  fitted.points.forEach(([x,y])=>{
    assert(x>=viewport.x+viewport.padding-1e-8&&x<=viewport.x+viewport.width-viewport.padding+1e-8);
    assert(y>=viewport.y+viewport.padding-1e-8&&y<=viewport.y+viewport.height-viewport.padding+1e-8);
  });
  // Every pairwise distance must be preserved under the same scale. This catches
  // aspect-ratio distortion, reordering, and "readability" offsets to dense joints.
  for(let a=0;a<33;a++)for(let b=a+1;b<33;b++) {
    const original=Math.hypot(pose.points[a][0]-pose.points[b][0],pose.points[a][1]-pose.points[b][1]);
    const rendered=Math.hypot(fitted.points[a][0]-fitted.points[b][0],fitted.points[a][1]-fitted.points[b][1]);
    assert(Math.abs(rendered-original*fitted.scale)<1e-8);
  }
  const svg=poseSVG(id,viewport);
  assert.equal([...svg.matchAll(/data-landmark="(\d+)"/g)].length,33);
  assert.equal([...svg.matchAll(/data-edge="/g)].length,35);
  const originalFile=path.join(repo,pose.sourceFile);
  if(fs.existsSync(originalFile))verifyPortableText(fs.readFileSync(originalFile),pose.sourceFileSha256LF);
  reports.push({id,frameIndex:pose.frameIndex,landmarks:33,edges:35,uniformFit:true,sourceFileSha256:pose.sourceFileSha256,sourceFileSha256LF:pose.sourceFileSha256LF});
}
const sourceProjection=path.join(repo,recordedPoses.projectionFile);
if(fs.existsSync(sourceProjection)) {
  const buffer=fs.readFileSync(sourceProjection);
  verifyPortableText(buffer,recordedPoses.projectionSha256LF);
  const original=JSON.parse(buffer);
  for(const [id,pose] of Object.entries(recordedPoses.poses))assert.deepEqual(pose.points,original.poses[id].points);
  const sourceModel=fs.readFileSync(path.join(repo,'app/src/pages/home/latest-hero/pose-model.ts'),'utf8');
  const expression=sourceModel.match(/export const POSE_EDGES[^=]*=\s*(\[[\s\S]*?\n\]);/)[1];
  assert.deepEqual(POSE_EDGES,JSON.parse(expression.replace(/,\s*]/g,']')));
}
const valid=recordedPoses.poses.sprint;
assert.throws(()=>validatePose({...valid,points:valid.points.slice(0,17)}),/exactly 33/);
assert.throws(()=>validatePose({...valid,points:valid.points.map((p,i)=>i===32?[0,0]:p)}),/Missing landmark 32/);
assert.throws(()=>validatePose({...valid,points:valid.points.map((p,i)=>i===4?[NaN,1]:p)}),/Invalid landmark 4/);
assert.throws(()=>validatePose({...valid,points:valid.points.map((p,i)=>i===4?[Infinity,1]:p)}),/Invalid landmark 4/);
assert.throws(()=>validatePose({...valid,points:valid.points.map((p,i)=>i===1?valid.points[0]:p)}),/Repeated landmarks/);
assert.throws(()=>validatePose(valid,'coco17'),/padded COCO17/);
assert.throws(()=>fitPose(valid,{...viewport,width:20}),/Invalid pose viewport/);

const content=JSON.parse(fs.readFileSync(path.join(root,'gallery-content.json'),'utf8'));
const emoji=JSON.parse(fs.readFileSync(path.join(root,'emoji/manifest.json'),'utf8'));
assert.equal(content.panels.length,6);
assert.equal(new Set(content.panels.map(panel=>panel.emoji)).size,6);
for(const asset of emoji.assets)verifyPortableText(fs.readFileSync(path.join(root,'emoji',asset.file)),asset.sha256);
const manifest=JSON.parse(fs.readFileSync(path.join(root,'output/gallery-manifest.json'),'utf8'));
assert.equal(manifest.images.length,12);
assert.equal(manifest.submissionReady,false);
assert.equal(manifest.images.filter(record=>record.nativeScreenshotSupplied).length,manifest.providedCaptureCount);
assert.equal(manifest.images.filter(record=>record.kind==='user-supplied-screenshot-review').length,manifest.reviewCaptureCount);
for(const platform of ['iphone','ipad'])assert.equal(manifest.images.filter(record=>record.platform===platform&&record.nativeScreenshotSupplied).length,manifest.platformSupplied[platform]);
if(manifest.mode==='user-supplied-review') {
  assert.equal(manifest.currentBuildConfirmed,false);
  assert.equal(manifest.privacyReviewed,false);
  assert.equal(manifest.currentBuild,null);
  assert.deepEqual(manifest.platformCandidate,{iphone:false,ipad:false});
}
const exports=[];
for(const record of manifest.images) {
  const metadata=await sharp(path.join(root,'output',record.file)).metadata();
  const [w,h]=record.platform==='iphone'?[1320,2868]:[2064,2752];
  assert.equal(metadata.width,w); assert.equal(metadata.height,h); assert.equal(metadata.hasAlpha,false);
  const source=fs.readFileSync(path.join(root,'source',record.file.replace('.png','.svg')),'utf8');
  assert.equal(hash(Buffer.from(source)),record.sourceSvgSha256);
  assert.equal([...source.matchAll(/data-emoji="/g)].length,1);
  assert(!source.includes('aria-label="Ranks"')&&!source.includes('aria-label="WORKSPACE"'));
  if(record.nativeScreenshotSupplied) {
    assert(['user-supplied-screenshot-review','current-build-screenshot-composition'].includes(record.kind));
    assert(!source.includes('SOURCE-DERIVED SAMPLE INTERFACE')&&!source.includes('Source-derived interface preview'));
    const captureNode=source.match(/<svg data-capture="true"[^>]+>/g);
    assert.equal(captureNode?.length,1);
    const attr=name=>Number(captureNode[0].match(new RegExp(`(?:^| )${name}="([^"]+)"`))[1]);
    const x=attr('x'),y=attr('y'),width=attr('width'),height=attr('height');
    assert(Math.abs(width/height-record.capture.width/record.capture.height)<1e-10,'Screenshot aspect ratio changed');
    assert(x>=0&&y>=0&&x+width<=w&&y+height<(record.platform==='iphone'?2704:2612),'Capture overlaps footer or canvas');
    assert(captureNode[0].includes('preserveAspectRatio="xMidYMid meet"'));
    const embedded=source.match(/<image href="data:(image\/(?:jpeg|png));base64,([^"]+)"/);
    assert(embedded,'Raw screenshot bytes must be embedded in the editable source');
    const original=Buffer.from(embedded[2],'base64');
    assert.equal(hash(original),record.capture.sha256);
    const originalMetadata=await sharp(original).metadata();
    assert.equal(originalMetadata.width,record.capture.width);
    assert.equal(originalMetadata.height,record.capture.height);
    assert.equal(originalMetadata.format,record.capture.format);
    assert.equal([...source.matchAll(/data-landmark="/g)].length,0,'No invented pose may be paired with supplied app pixels');
    assert.equal(record.pose,null);
    if(record.kind==='user-supplied-screenshot-review') {
      assert(source.includes('User-supplied screenshot'));
      assert(!source.includes('Current-build screenshot composition'));
      assert.equal(record.currentBuildConfirmed,false);
      assert.equal(record.privacyReviewed,false);
      assert.equal(record.capture.source,'user-provided');
      assert(record.capture.warnings.length>0);
    }
  } else {
    assert.equal(record.kind,'sample-interface-layout-preview');
    assert(source.includes('SOURCE-DERIVED SAMPLE INTERFACE')||source.includes('Source-derived interface preview'));
    assert.equal([...source.matchAll(/data-capture="true"/g)].length,0);
    if(record.id==='03-replay') {
      assert.equal(record.captureOrientation,'landscape');
      assert.equal([...source.matchAll(/data-pose="sprint"/g)].length,2);
      assert.equal([...source.matchAll(/data-landmark="/g)].length,66);
    }
    if(['01-evidence','02-tests','04-focus','06-retest'].includes(record.id))assert(source.includes('aria-label="Leaderboards"'));
  }
  exports.push({file:record.file,width:w,height:h,opaque:true,kind:record.kind,originalCapturePreserved:record.nativeScreenshotSupplied});
}

// Exercise real CLI parsing and image metadata without rendering or touching the
// gallery outputs. Fixtures live in one temporary directory and are removed.
let inputCases=0;
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'posetek-gallery-input-'));
try {
  for(const [name,width,height] of [['small',588,1280],['landscape',1280,588],['phone',1200,2600],['phone-landscape',2600,1200],['tablet',1640,2300],['tablet-landscape',2300,1640]]) {
    await sharp({create:{width,height,channels:3,background:'#0a251b'}}).png().toFile(path.join(temporary,name+'.png'));
  }
  const inputFile=path.join(temporary,'input.json');
  function checkInput(input,{release=false,error=null,extra=[]}={}) {
    fs.writeFileSync(inputFile,JSON.stringify(input));
    const child=spawnSync(process.execPath,[path.join(root,'gallery.mjs'),release?'--input':'--review-input',inputFile,'--validate-input-only',...extra],{encoding:'utf8'});
    if(error) {assert.notEqual(child.status,0);assert.match(child.stderr,error);}
    else {assert.equal(child.status,0,child.stderr);}
    inputCases++;
    return error?null:JSON.parse(child.stdout);
  }
  const sparse={iphone:{'01-evidence':'small.png'}};
  const reviewResult=checkInput(sparse);
  assert.equal(reviewResult.captures,1);assert.equal(reviewResult.currentBuildConfirmed,false);assert(reviewResult.warnings.some(value=>value.includes('588 x 1280')));
  const objectResult=checkInput({currentBuildConfirmed:true,privacyReviewed:true,buildNumber:'unproven',iphone:{'03-replay':{file:'landscape.png',headline:['COMPARE','BOTH SIDES.'],description:'Compare both recordings.',eyebrow:'SHOOTING',screenTitle:'Comparison'}}});
  assert.equal(objectResult.currentBuildConfirmed,false);
  checkInput({}, {error:/at least one screenshot/});
  checkInput({iphone:{unknown:'small.png'}},{error:/Unknown panel ID/});
  checkInput({iphone:{'01-evidence':{file:'small.png',crop:true}}},{error:/unsupported screenshot field crop/});
  checkInput({iphone:{'01-evidence':{file:'small.png',headline:['ONE LINE']}}},{error:/exactly two/});
  checkInput({iphone:{'03-replay':'small.png'}},{error:/requires a complete landscape/});
  checkInput(sparse,{extra:['--input',inputFile],error:/mutually exclusive/});
  checkInput(sparse,{release:true,error:/all 12 captures/});
  const strict={currentBuildConfirmed:true,privacyReviewed:true,buildNumber:'42',captureProvenance:'Synthetic validation fixture only.',iphone:{},ipad:{}};
  for(const panel of content.panels)for(const platform of ['iphone','ipad'])strict[platform][panel.id]=`${platform==='iphone'?'phone':'tablet'}${panel.id==='03-replay'?'-landscape':''}.png`;
  strict.iphone['04-focus']={file:'phone.png',headline:['ASK YOUR','AI COACH.']};
  assert.equal(checkInput(strict,{release:true}).captures,12);
  checkInput({...strict,privacyReviewed:false},{release:true,error:/explicit confirmation/});
  checkInput({...strict,iphone:{...strict.iphone,'01-evidence':'small.png'}},{release:true,error:/insufficient capture resolution/});
} finally {
  for(const file of fs.readdirSync(temporary))fs.unlinkSync(path.join(temporary,file));
  fs.rmdirSync(temporary);
}
const report={schemaVersion:2,passed:true,poseValidation:reports,negativePoseCases:7,canonicalWebsiteMapCompared:fs.existsSync(sourceProjection),emojiAssetsVerified:6,textLineEndingPortabilityCases:portabilityCases,inputValidationCases:inputCases,reviewCaptureCount:manifest.reviewCaptureCount,exports};
fs.writeFileSync(path.join(root,'output/gallery-validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
