// Explicit operator-only, create-only import. Default is read-only preflight.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {cloud,DOCUMENTS,decode,encode}=require('./training-cloud.cjs');
const {bumpVersion}=require('../functions/training-authoring.js');
const {validateTrainingDrill}=require('../functions/training-validation.js');
const {verifyImported}=require('./training-import-verification.cjs');
const DIR='.netlify/training-expansion';
const PATH='content/training-expansion/manifest.json';
const fields=x=>encode(x).mapValue.fields;
const unpack=d=>decode({mapValue:{fields:d.fields||{}}});
const normalized=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
const prefixes={strength:'STR',plyometrics:'PLY',speed:'SPD',agility:'AGL',ballMastery:'BMA',dribbling:'DRB',passing:'PAS',receiving:'RCV',shooting:'SHT',games:'SSG'};
async function main(){
  const apply=process.argv.includes('--apply');
  const bytes=fs.readFileSync(PATH),manifest=JSON.parse(bytes);
  const sha256=crypto.createHash('sha256').update(bytes).digest('hex');
  assert.equal(manifest.productionBatchId,'whole-body-2026-09');assert.equal(manifest.drills.length,80);
  assert.equal(new Set(manifest.drills.map(r=>r.manifestId)).size,80);
  for(let week=1;week<=4;week++)assert.equal(manifest.drills.filter(r=>r.filmingWeek===week).length,20);
  for(const row of manifest.drills){
    validateTrainingDrill(row.drill,(code,message)=>{throw Error(`${row.manifestId}: ${code}: ${message}`);});
    assert.equal(row.drill.status,'draft');assert.equal(row.drill.trainingPolicy.reviewStatus,'pending');
    assert.equal(row.authoring.reviewStatus,'pending');assert.equal(Object.keys(row.drill.media).length,0);
    assert.ok(row.authoring.sources.length&&row.authoring.distinctness.rationale);
    assert.ok(['primaryDemo','teachingDetail','errorCorrection'].every(s=>row.authoring.filmingInstructions[s]));
  }
  const c=await cloud(),receiptPath=`trainingImports/${manifest.productionBatchId}`;
  let previous;
  try{previous=unpack(await c.api(`${DOCUMENTS}/${receiptPath}`));}catch(e){if(!e.message.includes(': 404 '))throw e;}
  if(previous){
    assert.equal(previous.manifestSha256,sha256,'Imported manifest differs. Never re-import or overwrite.');
    const saved=`${DIR}/import-preflight.json`,ledger=fs.existsSync(saved)?JSON.parse(fs.readFileSync(saved,'utf8')):null;
    const verified=await verifyImported(c,previous,manifest,ledger);
    fs.mkdirSync(DIR,{recursive:true});fs.writeFileSync(`${DIR}/import-verified.json`,JSON.stringify(verified,null,2));
    textSummary(previous,'already-imported-verified');return;
  }
  const {transaction}=await c.api(`${DOCUMENTS}:beginTransaction`,'POST',{options:{readWrite:{}}});
  const rows=(await c.api(`${DOCUMENTS}:runQuery`,'POST',{transaction,structuredQuery:{from:[{collectionId:'drillCatalog'}]}})).filter(r=>r.document).map(r=>r.document);
  const metaDoc=await c.api(`${DOCUMENTS}/drillCatalogMeta/current?transaction=${encodeURIComponent(transaction)}`);
  let counterDoc;
  try{counterDoc=await c.api(`${DOCUMENTS}/drillCatalogMeta/idCounters?transaction=${encodeURIComponent(transaction)}`);}catch(e){if(!e.message.includes(': 404 '))throw e;}
  const meta=unpack(metaDoc),counters=counterDoc?unpack(counterDoc):{},version=bumpVersion(meta.catalogVersion);
  const existing=new Set(rows.map(d=>d.name.split('/').pop())),names=new Set(rows.map(d=>normalized(unpack(d).name)));
  const mapping=[],writes=[];
  for(const row of manifest.drills){
    assert.ok(!names.has(normalized(row.drill.name)),`Existing name: ${row.drill.name}`);names.add(normalized(row.drill.name));
    const code=prefixes[row.drill.domain];assert.ok(code,`Unrecognized domain ${row.drill.domain}`);
    let n=Math.max(500,Number(counters[code])||500),drillId;
    do{drillId=`${code}-${String(++n).padStart(3,'0')}`;}while(existing.has(drillId));
    counters[code]=n;existing.add(drillId);
    mapping.push({manifestId:row.manifestId,drillId,name:row.drill.name,filmingWeek:row.filmingWeek,category:row.category});
    const drill={...row.drill,drillId,productionBatchId:manifest.productionBatchId,catalogVersion:version,updatedBy:'operator:whole-body-import'};
    const authoring={...row.authoring,drillId,manifestSha256:sha256};
    for(const [collection,data] of [['drillCatalog',drill],['drillCatalogAuthoring',authoring]])writes.push({update:{name:`projects/kickai-69dd0/databases/(default)/documents/${collection}/${drillId}`,fields:fields(data)},currentDocument:{exists:false},updateTransforms:['createdAt','updatedAt'].map(fieldPath=>({fieldPath,setToServerValue:'REQUEST_TIME'}))});
  }
  const receipt={schemaVersion:1,productionBatchId:manifest.productionBatchId,manifestSha256:sha256,status:'imported-as-drafts',count:80,catalogVersionBefore:meta.catalogVersion,catalogVersionAfter:version,existingCount:rows.length,mapping,at:new Date().toISOString()};
  fs.mkdirSync(DIR,{recursive:true});
  fs.writeFileSync(`${DIR}/import-preflight.json`,JSON.stringify({receipt,existing:rows,meta:metaDoc,counters:counterDoc,writes},null,2));
  if(!apply){await c.api(`${DOCUMENTS}:rollback`,'POST',{transaction});textSummary(receipt,'preflight');return;}
  // Import can only follow deployment of the private-sidecar access rules.
  const release=await c.api('https://firebaserules.googleapis.com/v1/projects/kickai-69dd0/releases/cloud.firestore');
  const ruleset=await c.api(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
  assert.equal(ruleset.source.files[0].content.replace(/\r\n/g,'\n'),fs.readFileSync(process.env.RULES_PATH||path.resolve(__dirname,'../../PoseTek-mobile-app/firebase/firestore.rules'),'utf8').replace(/\r\n/g,'\n'),'Tested rules must be live before private authoring import.');
  const root='projects/kickai-69dd0/databases/(default)/documents/';
  writes.push({update:{name:root+'drillCatalogMeta/idCounters',fields:fields(counters)},currentDocument:counterDoc?{updateTime:counterDoc.updateTime}:{exists:false}});
  writes.push({update:{name:metaDoc.name,fields:fields({...meta,catalogVersion:version,updatedBy:'operator:whole-body-import',lastChange:{kind:'draft-batch-import',productionBatchId:manifest.productionBatchId,count:80}})},currentDocument:{updateTime:metaDoc.updateTime},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]});
  writes.push({update:{name:root+receiptPath,fields:fields(receipt)},currentDocument:{exists:false}});
  const committed=await c.api(`${DOCUMENTS}:commit`,'POST',{transaction,writes});
  fs.writeFileSync(`${DIR}/import-committed.json`,JSON.stringify({receipt,committed},null,2));
  const verified=await verifyImported(c,receipt,manifest,{receipt,existing:rows});
  fs.writeFileSync(`${DIR}/import-verified.json`,JSON.stringify(verified,null,2));
  textSummary(receipt,'verified');
}
function textSummary(r,status){console.log(JSON.stringify({status,count:r.count,catalogVersion:r.catalogVersionAfter,byWeek:[1,2,3,4].map(w=>r.mapping.filter(x=>x.filmingWeek===w).length)}));}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
