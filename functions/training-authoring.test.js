"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {FakeFirestore,FieldValue,HttpsError}=require("./test-support/fake-firestore");
const {createTrainingAuthoring,contentHash,BATCH,SLOTS}=require("./training-authoring");
const {validateTrainingDrill,EDITABLE}=require("./training-validation");
const manifest=require('../content/training-expansion/manifest.json');
const admin={uid:"reviewer",email:"reviewer@posetek.net",emailVerified:true};
const clock=()=>Date.parse("2026-09-22T12:00:00Z");
const source={id:"consensus",title:"Youth training consensus",url:"https://pubmed.ncbi.nlm.nih.gov/24055781/",evidenceType:"consensus",population:"youth",applicability:"Supervised progressive resistance training",limitations:"Not exercise-specific efficacy"};
function setup(extra={}) {
  const drill={...structuredClone(manifest.drills[0].drill),drillId:"STR-501",name:"Test squat",catalogVersion:"1.0.90",productionBatchId:BATCH};
  drill.trainingPolicy.evidenceLinks=[];
  const author={revision:1,productionBatchId:BATCH,filmingWeek:1,sources:[source],filmingInstructions:Object.fromEntries(SLOTS.map(s=>[s,"Original demonstration"])),reviewStatus:"pending",publicationHold:"Review pending"};
  const db=new FakeFirestore({"drillCatalog/STR-501":drill,"drillCatalogAuthoring/STR-501":author,"drillCatalogMeta/current":{catalogVersion:"1.0.90"},"trainingReviewers/reviewer":{enabled:true,qualification:"Qualified strength coach",scopeType:"posetek"},"players/p":{authenticationUID:"athlete",userUID:"athlete",coachUID:"coach"},"coaches/coach":{userUID:"coach",members:["p"]},...extra});
  const metadata=new Map();
  const bucket={file:path=>({getMetadata:async()=>{const m=metadata.get(path);if(!m)throw Error("not found");return [m];}})};
  const api=createTrainingAuthoring({db,bucket,FieldValue,HttpsError,now:clock,authDirectory:{getUser:async uid=>({uid,email:uid==="reviewer"?"reviewer@posetek.net":"coach@example.test",emailVerified:true})}});
  return {db,api,drill,author,metadata};
}
const rejection=code=>({code});
async function approveContent(s) {return s.api.reviewDrill({drillId:"STR-501",baseRevision:s.db.snapshot("drillCatalogAuthoring/STR-501").revision,decision:"approved",reviewNotes:"Instructions and program-level evidence reviewed."},admin);}
async function media(s) {
  for(const slot of SLOTS) {
    const storagePath=`drillCatalogMedia/app/STR-501/${slot}.mp4`;
    s.metadata.set(storagePath,{generation:"1",contentType:"video/mp4",size:"100"});
    await s.db.doc("drillCatalog/STR-501").update({[`media.${slot}`]:{storagePath,generation:"1",contentType:"video/mp4",status:"pending"}});
    await s.api.approveMedia({drillId:"STR-501",slot,generation:"1",baseRevision:s.db.snapshot("drillCatalogAuthoring/STR-501").revision},admin);
  }
}
test("authoring data and reviewer designation are unavailable to ordinary users",async()=>{
  const s=setup();
  await assert.rejects(s.api.getAuthoring({}, {uid:"athlete"}),rejection("permission-denied"));
  await assert.rejects(s.api.setReviewer({uid:"athlete",enabled:true,qualification:"self claim",displayName:"A"},{uid:"athlete"}),rejection("permission-denied"));
  assert.equal((await s.api.getAuthoring({},admin)).canReview,true);
});
test("administrator status alone is not qualified-review authority",async()=>{
  const s=setup({"trainingReviewers/reviewer":{enabled:false}});
  await assert.rejects(approveContent(s),rejection("permission-denied"));
  assert.equal(s.db.snapshot("drillCatalog/STR-501").trainingPolicy.reviewStatus,"pending");
});
test("review is bound to complete current instructions, equipment and dose",async()=>{
  const s=setup();await approveContent(s);
  const hash=s.db.snapshot("drillCatalogAuthoring/STR-501").reviewedContentHash;
  assert.equal(hash,contentHash(s.db.snapshot("drillCatalog/STR-501")));
  for(const patch of [{equipment:["barbell"]},{dose:{setsMin:8}},{minAge:5},{howTo:{steps:["Changed"]}},{trainingPolicy:{limits:{setsPerWeek:100}}}]) assert.notEqual(hash,contentHash({...s.drill,...patch}));
  await s.db.doc("drillCatalog/STR-501").update({name:"Changed instructions"});
  await assert.rejects(s.api.publishDrill({drillId:"STR-501",baseRevision:2},admin),rejection("failed-precondition"));
});
test("publishing requires all three current media generations and verified mobile",async()=>{
  const s=setup();await approveContent(s);
  await assert.rejects(s.api.publishDrill({drillId:"STR-501",baseRevision:2},admin),rejection("failed-precondition"));
  await media(s);
  let rev=s.db.snapshot("drillCatalogAuthoring/STR-501").revision;
  await assert.rejects(s.api.publishDrill({drillId:"STR-501",baseRevision:rev},admin),/mobile/);
  await s.db.doc("config/llm").set({wholeBodyTraining:{mobileVerified:true}});
  s.metadata.get("drillCatalogMedia/app/STR-501/primaryDemo.mp4").generation="2";
  await assert.rejects(s.api.publishDrill({drillId:"STR-501",baseRevision:rev},admin),/changed/);
  s.metadata.get("drillCatalogMedia/app/STR-501/primaryDemo.mp4").generation="1";
  const result=await s.api.publishDrill({drillId:"STR-501",baseRevision:rev},admin);
  assert.equal(result.catalogVersion,"1.0.91");assert.equal(s.db.snapshot("drillCatalog/STR-501").status,"published");
});
test("revoked content or media reviewer blocks publication",async()=>{
  const s=setup();await approveContent(s);await media(s);
  await s.db.doc("trainingReviewers/reviewer").update({enabled:false});
  await assert.rejects(s.api.publishDrill({drillId:"STR-501",baseRevision:5},admin),rejection("permission-denied"));
});
test("production notes do not alter athlete text and stale saves cannot overwrite",async()=>{
  const s=setup();const before=s.db.snapshot("drillCatalog/STR-501");
  await s.api.saveAuthoring({drillId:"STR-501",baseRevision:1,patch:{filmingWeek:2,productionNotes:"Film in gym"}},admin);
  assert.deepEqual(s.db.snapshot("drillCatalog/STR-501"),before);
  await assert.rejects(s.api.saveAuthoring({drillId:"STR-501",baseRevision:1,patch:{filmingWeek:3}},admin),rejection("aborted"));
  await assert.rejects(s.api.saveAuthoring({drillId:"STR-501",baseRevision:2,patch:{reviewStatus:"approved"}},admin),rejection("invalid-argument"));
});
test("changed evidence removes content approval without approving invented claims",async()=>{
  const s=setup();await approveContent(s);
  await s.api.saveAuthoring({drillId:"STR-501",baseRevision:2,patch:{sources:[{...source,limitations:"Different population"}]}},admin);
  assert.equal(s.db.snapshot("drillCatalogAuthoring/STR-501").reviewStatus,"pending");
  assert.equal(s.db.snapshot("drillCatalog/STR-501").trainingPolicy.reviewStatus,"pending");
});
function readiness() {return {schemaVersion:1,status:"cleared",loadFamilies:["knee"],supervision:"qualifiedCoach",expiresAt:"2026-10-20T12:00:00Z",limits:{setsPerSession:6,setsPerWeek:12,contactsPerSession:20,contactsPerWeek:40,holdSecondsPerSession:60,holdSecondsPerWeek:120,minRecoveryHours:48},exerciseLoads:{"STR-501":{instruction:"Coach-selected introductory load; no automatic increase.",independentAllowed:false}}};}
test("only currently assigned designated reviewers can clear a player",async()=>{
  const s=setup({"trainingReviewers/coach":{enabled:true,qualification:"S&C",scopeType:"assignedPlayers"},"trainingReviewers/other":{enabled:true,qualification:"S&C",scopeType:"assignedPlayers"}});
  const args={playerId:"p",baseRevision:0,readiness:readiness()};
  await assert.rejects(s.api.saveReadiness(args,{uid:"athlete"}),rejection("permission-denied"));
  await assert.rejects(s.api.saveReadiness(args,{uid:"other"}),rejection("permission-denied"));
  const saved=await s.api.saveReadiness(args,{uid:"coach"});
  assert.equal(saved.readiness.reviewedBy,"coach");assert.equal(saved.readiness.revision,1);
  await assert.rejects(s.api.saveReadiness(args,{uid:"coach"}),rejection("aborted"));
});
test("moved club players cannot be cleared through stale legacy coach pointers",async()=>{
  const s=setup({"players/p":{organizationId:"club",teamId:"new",coachUID:"coach"},"trainingReviewers/coach":{enabled:true,qualification:"S&C"},"organizations/club/members/coach":{userUID:"coach",role:"coach",status:"active",teamIds:["old"]}});
  await assert.rejects(s.api.saveReadiness({playerId:"p",baseRevision:0,readiness:readiness()},{uid:"coach"}),rejection("permission-denied"));
});
test("clearance rejects expired dates, unknown movement families and absent load conditions",async()=>{
  const s=setup();
  for(const r of [{...readiness(),expiresAt:"2020-01-01"},{...readiness(),loadFamilies:["madeUp"]},{...readiness(),exerciseLoads:{"STR-501":{instruction:"",independentAllowed:true}}},{...readiness(),limits:{setsPerSession:4}}]) await assert.rejects(s.api.saveReadiness({playerId:"p",baseRevision:0,readiness:r},admin),rejection("invalid-argument"));
  assert.equal(s.db.snapshot("players/p/privateProfile/trainingReadiness"),undefined);
});
test("reviewer scope comes from verified account identity, never caller-supplied role",async()=>{
  const s=setup();await s.api.setReviewer({uid:"coach",enabled:true,qualification:"Qualified coach",displayName:"Coach",scopeType:"posetek"},admin);
  assert.equal(s.db.snapshot("trainingReviewers/coach").scopeType,"assignedPlayers");
});

test("revoking expired readiness needs no replacement clearance and removes permissions",async()=>{
  const s=setup({"players/p/privateProfile/trainingReadiness":{...readiness(),expiresAt:"2020-01-01",revision:3}});
  const result=await s.api.saveReadiness({playerId:"p",baseRevision:3,readiness:{schemaVersion:1,status:"pending"}},admin);
  assert.equal(result.readiness.status,"pending");
  assert.deepEqual(result.readiness.exerciseLoads,{});
  assert.deepEqual(result.readiness.loadFamilies,[]);
  assert.equal(result.readiness.limits.setsPerWeek,0);
});

test("saving content atomically invalidates review and preserves protected policy",async()=>{
  const s=setup();await approveContent(s);
  const keys=['name','domain','minAge','maxAge','difficultyLevel','equipment','requiresPartner','positionSpecific','howTo','dose','maxFrequencyPerWeek','coachComments','adaptiveLevers','status'];
  const write=Object.fromEntries(keys.map(k=>[k,s.drill[k]??null]));write.name='Reviewed squat revision';
  const result=await s.api.saveDrill({drillId:'STR-501',expectedCatalogVersion:'1.0.90',write},admin);
  assert.equal(result.authoring.reviewStatus,'pending');assert.equal(result.authoring.reviewedContentHash,null);
  assert.equal(s.db.snapshot('drillCatalog/STR-501').trainingPolicy.reviewStatus,'pending');
  assert.equal(s.db.snapshot('drillCatalog/STR-501').trainingPolicy.requiresVerifiedMobile,true);
  assert.equal(result.catalogVersion,'1.0.91');
  await assert.rejects(s.api.saveDrill({drillId:'STR-501',write:{...write,status:'published'}},admin),rejection('failed-precondition'));
  await assert.rejects(s.api.saveDrill({drillId:'STR-501',write:{...write,trainingPolicy:{reviewStatus:'approved'}}},admin),rejection('invalid-argument'));
});

test('every authored draft passes the same server boundary as edited and published content',()=>{
  for(const row of manifest.drills) validateTrainingDrill(row.drill,(code,message)=>{throw Error(`${row.manifestId}: ${code}: ${message}`);});
});
const editable=d=>Object.fromEntries(EDITABLE.map(k=>[k,d[k]??null]));
test('draft saves reject invalid schema vocabulary, text, ranges, and continuous rest before writing',async()=>{
  const s=setup(),valid=editable(s.drill);
  const variants=[{domain:'conditioning'},{equipment:['rack']},{equipment:['dumbbells','dumbbells']},{name:'x'.repeat(81)},
    {howTo:{...valid.howTo,setup:'x'.repeat(401)}},{howTo:{...valid.howTo,steps:['x'.repeat(241)]}},
    {coachComments:Array(9).fill('cue')},{adaptiveLevers:['x'.repeat(201)]},{minAge:9},
    {dose:{}},{dose:{...valid.dose,repUnit:'kg'}},{dose:{...valid.dose,setsMax:3}},
    {dose:{...valid.dose,repsMin:9,repsMax:8}},{dose:{...valid.dose,restSecondsMin:-1}},
    {dose:{...valid.dose,repUnit:'seconds',restScope:'reps'}},{dose:{...valid.dose,perSide:'true'}},
    {dose:{...valid.dose,unreviewedLoad:20}}];
  for(const change of variants) await assert.rejects(s.api.saveDrill({drillId:'STR-501',expectedCatalogVersion:'1.0.90',write:{...valid,...change}},admin),rejection('invalid-argument'));
  assert.equal(s.db.snapshot('drillCatalog/STR-501').catalogVersion,'1.0.90');
  assert.equal(s.db.snapshot('drillCatalogAuthoring/STR-501').revision,1);
});
test('content review and publication reject invalid doses independently of prior approval',async()=>{
  const s=setup();
  await s.db.doc('drillCatalog/STR-501').update({dose:{...s.drill.dose,repUnit:'kilograms'}});
  await assert.rejects(approveContent(s),rejection('invalid-argument'));
  await assert.rejects(s.api.publishDrill({drillId:'STR-501',baseRevision:1},admin),rejection('invalid-argument'));
});
test('plyometric and isometric review boundaries count unilateral exposure',()=>{
  for(const modality of ['plyometric','isometric']) {
    const d=structuredClone(manifest.drills.find(r=>r.drill.trainingPolicy.modality===modality&&r.drill.dose.perSide).drill);
    const key=modality==='plyometric'?'contactsPerSession':'holdSecondsPerSession';
    d.trainingPolicy.limits[key]=d.dose.setsMax*d.dose.repsMax;
    assert.throws(()=>validateTrainingDrill(d,(_,message)=>{throw Error(message);}),/both sides/);
  }
});
test('stale catalog versions cannot overwrite a newer draft and missing versions are refused',async()=>{
  const s=setup(),write=editable(s.drill);
  await assert.rejects(s.api.saveDrill({drillId:'STR-501',write},admin),rejection('invalid-argument'));
  await s.api.saveDrill({drillId:'STR-501',expectedCatalogVersion:'1.0.90',write:{...write,name:'Newer reviewed draft'}},admin);
  await assert.rejects(s.api.saveDrill({drillId:'STR-501',expectedCatalogVersion:'1.0.90',write},admin),rejection('aborted'));
  assert.equal(s.db.snapshot('drillCatalog/STR-501').name,'Newer reviewed draft');
});
test('published content can be archived without simultaneously changing instructions',async()=>{
  const s=setup();await s.db.doc('drillCatalog/STR-501').update({status:'published'});
  const write={...editable(s.drill),status:'archived'};
  await assert.rejects(s.api.saveDrill({drillId:'STR-501',expectedCatalogVersion:'1.0.90',write:{...write,name:'Changed published instructions'}},admin),rejection('failed-precondition'));
  await s.api.saveDrill({drillId:'STR-501',expectedCatalogVersion:'1.0.90',write},admin);
  assert.equal(s.db.snapshot('drillCatalog/STR-501').status,'archived');
});
test('individual load instructions match the gateway 500-character bound',async()=>{
  const s=setup(),r=readiness();r.exerciseLoads['STR-501'].instruction='x'.repeat(501);
  await assert.rejects(s.api.saveReadiness({playerId:'p',baseRevision:0,readiness:r},admin),rejection('invalid-argument'));
  r.exerciseLoads['STR-501'].instruction='x'.repeat(500);
  assert.equal((await s.api.saveReadiness({playerId:'p',baseRevision:0,readiness:r},admin)).readiness.exerciseLoads['STR-501'].instruction.length,500);
});
