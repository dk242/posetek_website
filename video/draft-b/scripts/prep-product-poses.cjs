/* Read-only preparation of user-selected comparison records. No remote writes.
 * Generated athlete data stays under ignored public/product. OAuth is memory-only.
 * Set POSETEK_SOURCE_ROOT when dependency modules live in another checkout.
 * The private selection JSON contains the four user-selected uid/id/key entries.
 */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const project='kickai-69dd0',bucketName='kickai-69dd0.firebasestorage.app';
const original=process.env.POSETEK_SOURCE_ROOT||path.resolve(__dirname,'../../..');
const out=path.resolve(__dirname,'../public/product');
const rawOut=path.join(out,'pose-source');
const specs=JSON.parse(fs.readFileSync(process.env.POSETEK_POSE_SELECTION||path.join(rawOut,'selection.json'),'utf8'));
if(specs.map(s=>s.key).join(',')!=='guy-jump,maurizio-jump,guy-left,guy-right')throw new Error('Expected private four-record film selection');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function decode(v){if(v.mapValue)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));if(v.arrayValue)return(v.arrayValue.values||[]).map(decode);if(v.integerValue!==undefined)return Number(v.integerValue);return v.stringValue??v.doubleValue??v.booleanValue??v.timestampValue??v.referenceValue??null;}
function write(file,v){fs.writeFileSync(file,JSON.stringify(v)+'\n');}
function filmSource(records,comparison){
 // Public render contract matches ProductPoseSource; complete private objects
 // remain exclusively under pose-source and the private source manifest.
 const pick=(object,keys)=>Object.fromEntries(keys.map(key=>[key,object[key]]));
 return {
  records:records.map(record=>pick(record,['key','name','kind','fps','frames','eventFrame','peakFrame','transitionFrame','metric','ground','metersPerNormalizedUnit','width','height','strikeFoot','direction','keyFrames'])),
  comparison:{
   focusAreas:comparison.focusAreas.map(row=>pick(row,['cue','title','rank'])),
   differences:comparison.differences.map(row=>pick(row,['id','left','right','leftFrame','rightFrame','comparable'])),
   leftKeyFrames:pick(comparison.leftKeyFrames,['backswing','contact','followThrough']),
   rightKeyFrames:pick(comparison.rightKeyFrames,['backswing','contact','followThrough']),
  },
 };
}
function verifySavedComparison(){
 // Match the gateway's Python JSON canonicalization exactly (including floats).
 const code=`import json,hashlib,pathlib,sys
base=pathlib.Path(sys.argv[1]); c=json.loads((base/'saved-comparison.json').read_text())['comparison']; results=[]
for key,rep in [('guy-left',c['leftRepId']),('guy-right',c['rightRepId'])]:
 for name,hashkey in [('pose.json','poseHash'),('metadata.json','metadataHash'),('ball_trajectory.json','trajectoryHash'),('ball_information.json','ballInformationHash')]:
  value=json.loads((base/key/name).read_text()); sha=hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False,default=str).encode()).hexdigest()
  expected=c['provenance']['sources'][rep].get(hashkey)
  if sha!=expected: raise RuntimeError(key+' saved analysis source changed: '+name)
  results.append({'key':key,'file':name,'canonicalSha256':sha,'matchesSavedAnalysis':True})
print(json.dumps(results))`;
 return JSON.parse(execFileSync(process.env.POSETEK_PYTHON||'python',['-c',code,rawOut],{encoding:'utf8'}));
}
async function main(){
 fs.mkdirSync(rawOut,{recursive:true});
 const cliRoot=path.join(process.env.APPDATA,'npm/node_modules/firebase-tools');
 const auth=require(path.join(cliRoot,'lib/auth.js')),account=auth.getGlobalDefaultAccount();
 if(!account?.tokens?.refresh_token)throw new Error('Existing Firebase CLI login unavailable');
 const cred=await auth.getAccessToken(account.tokens.refresh_token,['https://www.googleapis.com/auth/cloud-platform']);
 const headers={Authorization:`Bearer ${cred.access_token}`};
 const request=async(url,missing=false)=>{const r=await fetch(url,{headers,signal:AbortSignal.timeout(90000)});if(missing&&r.status===404)return null;if(!r.ok)throw new Error(`Read-only source request failed HTTP ${r.status}`);return r;};
 const docs=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
 const readDoc=async(p)=>{const r=await request(`${docs}/${p}`,true);if(!r)return null;const d=await r.json();return {id:d.name.split('/').at(-1),...decode({mapValue:{fields:d.fields}}),_updateTime:d.updateTime};};
 const collections=async(p)=>{const r=await request(`${docs}/${p}?pageSize=1000`);const d=await r.json();if(d.nextPageToken)throw new Error('Read bound exceeded');return(d.documents||[]).map(d=>({id:d.name.split('/').at(-1),...decode({mapValue:{fields:d.fields}}),_updateTime:d.updateTime}));};
 const moduleAt=n=>require(path.join(original,'functions/node_modules',n));
 const {Firestore}=moduleAt('@google-cloud/firestore'),{Storage}=moduleAt('@google-cloud/storage'),{GoogleAuth,OAuth2Client}=moduleAt('google-auth-library');
 const client=new OAuth2Client();client.setCredentials({access_token:cred.access_token,expiry_date:Date.now()+45*60*1000});
 const googleAuth=new GoogleAuth({projectId:project,authClient:client});
 const db=new Firestore({projectId:project,auth:googleAuth}),bucket=new Storage({projectId:project,authClient:googleAuth}).bucket(bucketName);
 class HttpsError extends Error{constructor(code,message){super(message);this.code=code;}}
 const service=require(path.join(original,'functions/effective-results.js')).createEffectiveResults({db,bucket,HttpsError});
 const guy=await service.listForPlayer(specs[0].uid,undefined,true);
 const maurizio=await service.listForPlayer(specs[1].uid,'jump',true);
 write(path.join(rawOut,'current-qualified-results.json'),{capturedAt:new Date().toISOString(),guy,maurizio});
 const manifest={version:1,preparedAt:new Date().toISOString(),remoteMutations:0,records:[],comparison:null};
 const loaded=[];
 for(const spec of specs){
  const effective=(spec.uid===specs[0].uid?guy:maurizio).reps.find(r=>r.id===spec.id);
  if(!effective?.resultStatus.qualified||effective.resultStatus.duplicate||!effective.storageFolder)throw new Error(`${spec.key}: current result not qualified with exact source`);
  const folder=effective.storageFolder,local=path.join(rawOut,spec.key);fs.mkdirSync(local,{recursive:true});
  const json={},sources=[];
  const names=['pose.json','metadata.json','reprocess_context.json',...(spec.kind==='jump'?['key_frames.json','chest_offsets.json','torso_midpoints.json']:['ball_trajectory.json','ball_information.json','ball_boxes.json','admin_annotations.json'])];
  for(const name of names){
   const object=`${folder}/${name}`,metaResponse=await request(`https://storage.googleapis.com/storage/v1/b/${bucketName}/o/${encodeURIComponent(object)}`,true);
   if(!metaResponse){if(['pose.json','metadata.json','reprocess_context.json','key_frames.json'].includes(name))throw new Error(`${spec.key}: missing ${name}`);continue;}
   const meta=await metaResponse.json();
   const bytes=Buffer.from(await(await request(`https://storage.googleapis.com/download/storage/v1/b/${bucketName}/o/${encodeURIComponent(object)}?alt=media&generation=${meta.generation}`)).arrayBuffer());
   const md5=crypto.createHash('md5').update(bytes).digest('base64');if(md5!==meta.md5Hash)throw new Error('Source checksum mismatch');
   fs.writeFileSync(path.join(local,name),bytes);json[name]=JSON.parse(bytes.toString());sources.push({name,object,generation:meta.generation,bytes:bytes.length,md5Hash:md5,sha256:hash(bytes)});
  }
  const m=json['metadata.json'],context=json['reprocess_context.json'];
  if(context.rep?.playerDocId!==spec.uid||context.rep?.repId!==spec.id)throw new Error(`${spec.key}: source identity mismatch`);
  const fps=Number(m.framesPerSecond??m.fps??context.capture?.clipFramesPerSecondUsed);
  if(!(fps>0&&fps<=1000))throw new Error(`${spec.key}: authoritative timing missing`);
  const raw=json['pose.json'],rawFrames=Array.isArray(raw)?raw:raw.frames;
  if(!rawFrames?.length)throw new Error(`${spec.key}: full pose unavailable`);
  const frames=rawFrames.map(frame=>(Array.isArray(frame)?frame:frame?.landmarks??frame?.pose??Array.from({length:33},()=>null)).map(point=>Array.isArray(point)?point:point?[point.x,point.y,point.z??0,point.visibility??point.confidence??1]:[null,null,null,0]));
  if(frames.some(f=>f.length!==33))throw new Error(`${spec.key}: expected MediaPipe33 pose layout`);
  const event=spec.kind==='jump'?json['key_frames.json'][2]:effective.contact_frame;
  if(!Number.isInteger(event)||event<0||event>=frames.length)throw new Error(`${spec.key}: event outside source`);
  const movieName=context.rep.videoFileName??(spec.kind==='jump'?'static_jump.mov':'side_kick_240.mov');
  const movieMeta=await(await request(`https://storage.googleapis.com/storage/v1/b/${bucketName}/o/${encodeURIComponent(folder+'/'+movieName)}`)).json();
  const moviePath=path.join(local,movieName);
  if(!movieMeta.md5Hash)throw new Error('Original media source checksum unavailable');
  const cacheMatches=fs.existsSync(moviePath)&&fs.statSync(moviePath).size===Number(movieMeta.size)&&crypto.createHash('md5').update(fs.readFileSync(moviePath)).digest('base64')===movieMeta.md5Hash;
  if(!cacheMatches){
   const bytes=Buffer.from(await(await request(`https://storage.googleapis.com/download/storage/v1/b/${bucketName}/o/${encodeURIComponent(folder+'/'+movieName)}?alt=media&generation=${movieMeta.generation}`)).arrayBuffer());
   if(crypto.createHash('md5').update(bytes).digest('base64')!==movieMeta.md5Hash)throw new Error('Original media checksum mismatch');
   fs.writeFileSync(moviePath,bytes);
  }
  const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',moviePath],{encoding:'utf8'}));
  const video=probe.streams.find(s=>s.codec_type==='video');if(!video?.width||!video?.height)throw new Error('Source video dimensions unavailable');
  const rotation=video.side_data_list?.find(s=>s.rotation!==undefined)?.rotation??0;
  const sideways=Math.abs(rotation)%180===90;
  sources.push({name:movieName,object:folder+'/'+movieName,generation:movieMeta.generation,bytes:Number(movieMeta.size),md5Hash:movieMeta.md5Hash,sha256:hash(fs.readFileSync(moviePath)),probe:{width:video.width,height:video.height,rotation,fps:video.avg_frame_rate,duration:probe.format.duration},note:'Original media verified; film uses exact pose coordinates.'});
  const record={key:spec.key,name:spec.name,kind:spec.kind,fps,frames,eventFrame:event,peakFrame:spec.kind==='jump'?json['key_frames.json'][3]:null,
   transitionFrame:spec.kind==='shooting'?effective.transition_frame:null,metric:spec.kind==='jump'?effective.jumpHeight:effective.velocity,
   ground:m.ground_loc_y??null,metersPerNormalizedUnit:m.m_to_normalized_units??null,
   width:m.videoDisplayWidth??m.frameWidth??(sideways?video.height:video.width),height:m.videoDisplayHeight??m.frameHeight??(sideways?video.width:video.height),
   direction:effective.direction??null,strikeFoot:effective.strike_foot??null,keyFrames:json['key_frames.json']??null};
  loaded.push(record);manifest.records.push({key:spec.key,uid:spec.uid,repId:spec.id,canonical:effective,source:sources,eventFrame:event,fps,frameCount:frames.length});
  console.log(`${spec.key}: qualified; ${frames.length} frames at ${fps} fps; event ${event}`);
 }
 const comparisons=await collections(`players/${specs[0].uid}/aiKickComparisons`);
 const comparison=comparisons.filter(c=>c.leftRepId===specs[2].id&&c.rightRepId===specs[3].id).sort((a,b)=>String(b.generatedAt??b._updateTime).localeCompare(String(a.generatedAt??a._updateTime)))[0];
 if(!comparison)throw new Error('Exact saved Guy left/right comparison missing');
 const reviewHead=await readDoc(`players/${specs[0].uid}/aiAnalysisReviewHeads/comparison_${comparison.id}`);
 const review=reviewHead?.reviewId?await readDoc(`players/${specs[0].uid}/aiAnalysisReviews/${reviewHead.reviewId}`):null;
 write(path.join(rawOut,'saved-comparison.json'),{comparison,reviewHead,review});
 manifest.comparison={id:comparison.id,updatedAt:comparison._updateTime,reviewId:review?.id??null,sourceVerification:verifySavedComparison()};
 write(path.join(out,'poses.json'),filmSource(loaded,comparison));
 write(path.join(out,'pose-source-manifest.json'),manifest);
 const profileSource={displayName:'Guy',verifiedAt:manifest.preparedAt,reps:guy.reps,comparison,review,sourceNote:'Fresh canonical effective-results projection. Reference scores are projected product references, not percentiles.'};
 write(path.join(rawOut,'profile-source.json'),profileSource);
 // ProductScreens owns the sanitized display file. Preserve it on repeat prep.
 if(!fs.existsSync(path.join(out,'profile.json')))write(path.join(out,'profile.json'),profileSource);
 await db.terminate();
 console.log(`Saved exact comparison ${comparison.id}; ${loaded.length} complete recorded poses; no remote mutations.`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
