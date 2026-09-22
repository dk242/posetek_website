// Reviewable operator release stages; private receipts stay outside Git.
const fs=require('node:fs');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const {cloud,DOCUMENTS,decode,encode}=require('./training-cloud.cjs');
const DIR='.netlify/training-expansion/release';
const RUN='https://run.googleapis.com/v2/projects/kickai-69dd0/locations/us-west1/services/agent-gateway';
const RULES='https://firebaserules.googleapis.com/v1/projects/kickai-69dd0';
const BUILD='https://cloudbuild.googleapis.com/v1/projects/kickai-69dd0/locations/us-west1/builds';
const EXPECTED='agent-gateway-web-62c05fa8fbde';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=name=>JSON.parse(fs.readFileSync(`${DIR}/${name}.json`,'utf8'));
function save(name,data){fs.mkdirSync(DIR,{recursive:true});fs.writeFileSync(`${DIR}/${name}.json`,JSON.stringify(data,null,2));}
const unpack=d=>decode({mapValue:{fields:d.fields||{}}});
const fields=x=>encode(x).mapValue.fields;
async function main(){
 const c=await cloud(),action=process.argv[2];
 async function drain(){
  for(const capability of ['assess_personalized_plan','generate_personalized_plan','activate_personalized_plan','discard_personalized_plan','generate_training_plan','apply_workout_draft','save_workout_edit','validate_workout_start']){
   const q=await c.api(`${DOCUMENTS}:runQuery`,'POST',{structuredQuery:{from:[{collectionId:'llmJobs'}],where:{compositeFilter:{op:'AND',filters:[{fieldFilter:{field:{fieldPath:'capability'},op:'EQUAL',value:{stringValue:capability}}},{fieldFilter:{field:{fieldPath:'status'},op:'IN',value:{arrayValue:{values:[{stringValue:'pending'},{stringValue:'running'}]}}}}]}}}});
   assert.equal(q.filter(r=>r.document).length,0,`Drain ${capability} first.`);
  }
 }
 if(action==='snapshot'){
  assert.ok(!fs.existsSync(`${DIR}/before.json`),'Before-image already exists; inspect it instead.');
  const service=await c.api(RUN),rulesRelease=await c.api(`${RULES}/releases/cloud.firestore`),config=await c.api(`${DOCUMENTS}/config/llm`);
  const ruleset=await c.api(`https://firebaserules.googleapis.com/v1/${rulesRelease.rulesetName}`);
  const routed=service.trafficStatuses.filter(t=>t.percent>0);assert.equal(routed.length,1);assert.equal(routed[0].percent,100);assert.equal(routed[0].revision,EXPECTED);assert.equal(service.template.revision,EXPECTED);
  const previousBuild=await c.api(`${BUILD}/b00664db-d4ce-4067-ae9f-6aa47eabdcd9`);
  const liveRules=ruleset.source.files[0].content.replace(/\r\n/g,'\n');
  const committedRules=cp.execFileSync('git',['show','HEAD:firestore.rules'],{encoding:'utf8'}).replace(/\r\n/g,'\n');
  save('before',{at:new Date().toISOString(),service,rulesRelease,ruleset,config,previousBuild,rulesMatchHead:liveRules===committedRules});
  fs.writeFileSync(`${DIR}/live-firestore.rules`,liveRules);
  await drain();
  console.log(JSON.stringify({revision:EXPECTED,rulesMatchHead:liveRules===committedRules,buildServiceAccount:previousBuild.serviceAccount,sourceBucket:previousBuild.source.storageSource.bucket,capabilities:Object.keys(unpack(config).capabilities||{})}));
 } else if(action==='build'){
  assert.ok(!fs.existsSync(`${DIR}/build-submitted.json`),'Build already submitted.');
  assert.equal(cp.execFileSync('git',['status','--porcelain','--','services/agent-gateway'],{encoding:'utf8'}).trim(),'','Commit reviewed gateway source first.');
  const before=read('before'),archive=`${DIR}/source.tar.gz`;
  cp.execFileSync('git',['archive','--format=tar.gz',`--output=${archive}`,'HEAD:services/agent-gateway']);
  const bytes=fs.readFileSync(archive),sha256=hash(bytes),version=`web-${sha256.slice(0,12)}`,image=`us-west1-docker.pkg.dev/kickai-69dd0/cloud-run-source-deploy/agent-gateway:${version}`;
  const bucket=before.previousBuild.source.storageSource.bucket,object=`whole-body-release/${sha256}.tar.gz`;
  const up=await c.request(`https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(object)}&ifGenerationMatch=0`,{method:'POST',headers:{'Content-Type':'application/gzip'},body:bytes});
  const uploaded=await up.json();assert.ok(up.ok,uploaded.error?.message);
  const downloaded=await c.request(`https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}?alt=media&generation=${uploaded.generation}`);assert.equal(hash(Buffer.from(await downloaded.arrayBuffer())),sha256);
  const build={source:{storageSource:{bucket,object,generation:uploaded.generation}},serviceAccount:before.previousBuild.serviceAccount,steps:[{name:'gcr.io/cloud-builders/docker',args:['build','-f','Dockerfile.release','-t',image,'.']},{name:'gcr.io/cloud-builders/docker',args:['run','--rm','-v','/workspace:/validation','-w','/validation','-e','PYTHONUTF8=1','--entrypoint','sh',image,'-c','pip install --quiet pytest==9.1.1 && python -m pytest -q -p no:cacheprovider --basetemp /tmp/planner-tests']}],images:[image],options:{logging:'CLOUD_LOGGING_ONLY'},timeout:'1200s'};
  save('build-request',build);save('source',{commit:cp.execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sha256,version,revision:`agent-gateway-${version}`,image,source:build.source});
  const submitted=await c.api(BUILD,'POST',build);save('build-submitted',submitted);console.log(JSON.stringify({buildId:submitted.metadata?.build?.id,operation:submitted.name,version}));
 } else if(action==='build-status'){
  const submitted=read('build-submitted'),id=submitted.metadata.build.id,b=await c.api(`${BUILD}/${id}`);save('build-result',b);console.log(JSON.stringify({id,status:b.status,steps:b.steps?.map(s=>s.status),images:b.results?.images,logUrl:b.logUrl}));
 } else if(action==='stage'){
  const before=read('before'),source=read('source'),build=read('build-result');assert.equal(build.status,'SUCCESS');assert.equal(build.steps[1].status,'SUCCESS');assert.equal(build.results.images.length,1);
  assert.deepEqual(build.source,read('build-request').source);
  const current=await c.api(RUN);assert.equal(current.etag,before.service.etag,'Service drift');await drain();
  const template=structuredClone(current.template),image=source.image.replace(/:[^/:]+$/,'')+'@'+build.results.images[0].digest;
  template.revision=source.revision;template.containers[0].image=image;
  const versions=template.containers[0].env.filter(e=>e.name==='GATEWAY_VERSION');assert.equal(versions.length,1);versions[0].value=source.version;
  const request={name:current.name,etag:current.etag,template,traffic:[...current.traffic,{type:'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION',revision:source.revision,tag:source.version}]};
  save('stage-request',request);const op=await c.api(`${RUN}?updateMask=template,traffic`,'PATCH',request);save('stage-operation',op);console.log(JSON.stringify({operation:op.name,image}));
 } else if(action==='stage-status'||action==='promote-status'){
  const op=read(action.startsWith('stage')?'stage-operation':'promote-operation');const result=await c.api(`https://run.googleapis.com/v2/${op.name}`);save(action,result);console.log(JSON.stringify({done:result.done,error:result.error}));
 } else if(action==='promote'){
  const source=read('source'),staged=await c.api(RUN),req=read('stage-request');
  assert.deepEqual(staged.template,req.template);assert.deepEqual(staged.traffic,req.traffic);const tag=staged.trafficStatuses.find(t=>t.revision===source.revision&&t.tag===source.version);assert.ok(tag?.uri);
  const health=await fetch(tag.uri+'/health').then(r=>r.json());assert.equal(health.ok,true);assert.equal(health.version,source.version);
  const missing=await fetch(tag.uri+'/v1/jobs/handle',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(missing.status,200);const missingBody=await missing.json();assert.ok(JSON.stringify(missingBody).includes('jobId'));
  const anon=await fetch(tag.uri+'/v1/chat/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(anon.status,401);
  const routed=staged.trafficStatuses.filter(t=>t.percent>0);assert.equal(routed.length,1);assert.equal(routed[0].revision,EXPECTED);assert.equal(routed[0].percent,100);await drain();
  save('candidate-checks',{health,missingJob:missingBody,unauthenticatedStatus:anon.status});
  const request={name:staged.name,etag:staged.etag,traffic:staged.traffic.map(t=>({...t,percent:t.revision===source.revision?100:0}))};save('promote-request',request);
  const op=await c.api(`${RUN}?updateMask=traffic`,'PATCH',request);save('promote-operation',op);console.log(JSON.stringify({operation:op.name,revision:source.revision}));
 } else if(action==='rules'){
  const before=read('before');assert.equal((await c.api(`${RULES}/releases/cloud.firestore`)).rulesetName,before.rulesRelease.rulesetName,'Rules drift');
  const content=fs.readFileSync('deployment/whole-body-firestore.rules','utf8'),candidate=await c.api(`${RULES}/rulesets`,'POST',{source:{files:[{name:'firestore.rules',content}]}});save('candidate-ruleset',{ruleset:candidate,sha256:hash(content)});
  assert.equal((await c.api(`${RULES}/releases/cloud.firestore`)).rulesetName,before.rulesRelease.rulesetName,'Rules drift');
  const publication=await c.api(`${RULES}/releases/cloud.firestore`,'PATCH',{release:{name:before.rulesRelease.name,rulesetName:candidate.name},updateMask:'rulesetName'});save('rules-publication',publication);
  assert.equal((await c.api(`${RULES}/releases/cloud.firestore`)).rulesetName,candidate.name);console.log(JSON.stringify({ruleset:candidate.name,sha256:hash(content)}));
 } else if(action==='storage'){
  const before=read('storage-before'),url=`https://firebaserules.googleapis.com/v1/${before.release.name}`;
  assert.equal((await c.api(url)).rulesetName,before.release.rulesetName,'Storage rules drift');
  const content=fs.readFileSync('storage.rules','utf8'),candidate=await c.api(`${RULES}/rulesets`,'POST',{source:{files:[{name:'storage.rules',content}]}});save('candidate-storage-ruleset',{ruleset:candidate,sha256:hash(content)});
  assert.equal((await c.api(url)).rulesetName,before.release.rulesetName,'Storage rules drift');
  const publication=await c.api(url,'PATCH',{release:{name:before.release.name,rulesetName:candidate.name},updateMask:'rulesetName'});save('storage-publication',publication);assert.equal((await c.api(url)).rulesetName,candidate.name);console.log(JSON.stringify({ruleset:candidate.name}));
 } else if(action==='config'){
  const before=read('before'),current=await c.api(`${DOCUMENTS}/config/llm`);assert.equal(current.updateTime,before.config.updateTime,'Config drift');
  const old=unpack(current),capabilities={...old.capabilities,save_workout_edit:{enabled:true,dailyLimitPerUser:100},validate_workout_start:{enabled:true,dailyLimitPerUser:100}};
  const patch={capabilities,wholeBodyTraining:{previewEnabled:true,mobileVerified:false}};
  const body={writes:[{update:{name:current.name,fields:fields(patch)},updateMask:{fieldPaths:['capabilities.save_workout_edit','capabilities.validate_workout_start','wholeBodyTraining']},currentDocument:{updateTime:current.updateTime}}]};save('config-request',body);
  save('config-result',await c.api(`${DOCUMENTS}:commit`,'POST',body));const after=await c.api(`${DOCUMENTS}/config/llm`);save('config-after',after);
  const next=unpack(after);for(const [key,value] of Object.entries(old.capabilities))assert.deepEqual(next.capabilities[key],value);assert.equal(next.wholeBodyTraining.mobileVerified,false);console.log(JSON.stringify({previewEnabled:true,mobileVerified:false,capabilitiesAdded:['save_workout_edit','validate_workout_start']}));
 } else if(action==='verify'){
  const service=await c.api(RUN),source=read('source');const routed=service.trafficStatuses.filter(t=>t.percent>0);assert.equal(routed.length,1);assert.equal(routed[0].revision,source.revision);assert.equal(routed[0].percent,100);
  const health=await fetch(service.uri+'/health').then(r=>r.json());assert.equal(health.version,source.version);assert.equal(health.ok,true);save('gateway-verified',{service,health,at:new Date().toISOString()});console.log(JSON.stringify({revision:source.revision,health,trafficPercent:100}));
 } else throw Error('Choose an explicit release stage.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
