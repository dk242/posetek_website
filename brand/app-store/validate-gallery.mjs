import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { recordedPoses, POSE_EDGES, validatePose, fitPose, poseSVG, textSha256LF } from './pose.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const repo=path.resolve(root,'../..');
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
const exports=[];
for(const record of manifest.images) {
  const metadata=await sharp(path.join(root,'output',record.file)).metadata();
  const [w,h]=record.platform==='iphone'?[1320,2868]:[2064,2752];
  assert.equal(metadata.width,w); assert.equal(metadata.height,h); assert.equal(metadata.hasAlpha,false);
  const source=fs.readFileSync(path.join(root,'source',record.file.replace('.png','.svg')),'utf8');
  assert(source.includes('SOURCE-DERIVED SAMPLE INTERFACE')||source.includes('Source-derived interface preview'));
  assert.equal([...source.matchAll(/data-emoji="/g)].length,1);
  assert(!source.includes('aria-label="Ranks"')&&!source.includes('aria-label="WORKSPACE"'));
  if(record.id==='03-replay') {
    assert.equal(record.captureOrientation,'landscape');
    assert.equal([...source.matchAll(/data-pose="sprint"/g)].length,2);
    assert.equal([...source.matchAll(/data-landmark="/g)].length,66);
  }
  if(['01-evidence','02-tests','04-focus','06-retest'].includes(record.id))assert(source.includes('aria-label="Leaderboards"'));
  exports.push({file:record.file,width:w,height:h,opaque:true});
}
const report={schemaVersion:1,passed:true,poseValidation:reports,negativePoseCases:7,canonicalWebsiteMapCompared:fs.existsSync(sourceProjection),emojiAssetsVerified:6,textLineEndingPortabilityCases:portabilityCases,exports};
fs.writeFileSync(path.join(root,'output/gallery-validation.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
