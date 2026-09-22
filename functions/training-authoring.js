"use strict";
// Content production is private and separate from athlete-facing catalog text.
const crypto = require("node:crypto");
const { isClubAdmin, memberCanAccessPlayer } = require("./club-access");
const { validateTrainingDrill, EDITABLE } = require("./training-validation");
const SLOTS = ["primaryDemo", "teachingDetail", "errorCorrection"];
const BATCH = "whole-body-2026-09";
const canonical = value => JSON.stringify(sortValue(value));
function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,sortValue(value[k])]));
  return value;
}
function contentHash(drill) {
  const fields = ["schemaVersion","drillId","name","domain","minAge","maxAge","difficultyLevel","equipment","requiresPartner","positionSpecific","howTo","dose","maxFrequencyPerWeek","coachComments","adaptiveLevers"];
  const payload = Object.fromEntries(fields.map(key=>[key,drill[key] ?? null]));
  const { reviewStatus, ...policy } = drill.trainingPolicy || {};
  payload.trainingPolicy = policy;
  return crypto.createHash("sha256").update(canonical(payload)).digest("hex");
}
function bumpVersion(value) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value || ""));
  return m ? `${m[1]}.${m[2]}.${Number(m[3])+1}` : "1.0.1";
}

function createTrainingAuthoring({ db, bucket, authDirectory, FieldValue, HttpsError, now = () => Date.now() }) {
  const fail = (code,message) => { throw new HttpsError(code,message); };
  const id = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value) ? value : fail("invalid-argument","Choose a valid identifier.");
  const text = (value,max=2000) => typeof value === "string" && value.length<=max ? value.trim() : fail("invalid-argument",`Text must be at most ${max} characters.`);
  const integer = (value,min,max,label) => Number.isInteger(value) && value>=min && value<=max ? value : fail("invalid-argument",`${label} must be ${min}–${max}.`);
  function authenticated(auth) { if (!auth?.uid || auth.isAnonymous) fail("unauthenticated","Sign in to continue."); }
  function admin(auth) { authenticated(auth); if (!isClubAdmin(auth)) fail("permission-denied","A verified PoseTek administrator is required."); }
  const refs = drillId => ({drill:db.doc(`drillCatalog/${id(drillId)}`),author:db.doc(`drillCatalogAuthoring/${drillId}`)});
  async function reviewer(tx,auth) {
    authenticated(auth);
    const row = (await tx.get(db.doc(`trainingReviewers/${id(auth.uid)}`))).data();
    if (!row?.enabled || !row.qualification) fail("permission-denied","PoseTek must designate you as a qualified training reviewer first.");
    return row;
  }
  function currentRevision(row,baseRevision) {
    if (!row) fail("not-found","The production record no longer exists.");
    if (!Number.isInteger(baseRevision) || row.revision!==baseRevision) fail("aborted","This record changed. Reload it before reviewing or saving.");
  }
  function batchDrill(drill) {
    if (!drill || drill.productionBatchId!==BATCH || drill.trainingPolicy?.version!=="whole-body-v1") fail("failed-precondition","This drill is not in the whole-body production batch.");
  }
  function nextAuthor(row,patch,auth) { return {...row,...patch,revision:row.revision+1,updatedBy:auth.uid,updatedAt:new Date(now()).toISOString()}; }
  async function getAuthoring(input,auth) {
    admin(auth);
    const r = (await db.doc(`trainingReviewers/${id(auth.uid)}`).get()).data();
    const docs = input.drillId ? [await refs(input.drillId).author.get()] : (await db.collection("drillCatalogAuthoring").limit(1000).get()).docs;
    return {records:Object.fromEntries(docs.filter(d=>d.exists).map(d=>[d.id,d.data()])),canReview:r?.enabled===true && Boolean(r.qualification)};
  }
  function sourcesOf(sources) {
    if (!Array.isArray(sources) || !sources.length || sources.length>20) fail("invalid-argument","Provide 1–20 evidence sources.");
    return sources.map(s=>{
      const url=text(s.url,2000);
      try { if (new URL(url).protocol!=="https:") throw Error(); } catch { fail("invalid-argument","Evidence links must use HTTPS."); }
      const row={id:id(s.id),title:text(s.title,500),url,evidenceType:text(s.evidenceType,200),population:text(s.population,1000),applicability:text(s.applicability,3000),limitations:text(s.limitations,3000)};
      if(Object.values(row).some(value=>!value)) fail("invalid-argument","Every source needs its title, evidence type, population, applicability, and limitations.");
      return row;
    });
  }
  async function saveAuthoring(input,auth) {
    admin(auth);
    const patch=input.patch;
    const keys=["filmingWeek","productionNotes","filmingInstructions","sources","reviewNotes"];
    if (!patch || typeof patch!=="object" || Array.isArray(patch) || Object.keys(patch).some(k=>!keys.includes(k))) fail("invalid-argument","Only production fields can be edited here.");
    const clean={};
    if (patch.filmingWeek!==undefined) clean.filmingWeek=integer(patch.filmingWeek,1,4,"Filming week");
    for (const key of ["productionNotes","reviewNotes"]) if(patch[key]!==undefined) clean[key]=text(patch[key],6000);
    if (patch.sources!==undefined) clean.sources=sourcesOf(patch.sources);
    if (patch.filmingInstructions!==undefined) clean.filmingInstructions=Object.fromEntries(SLOTS.map(slot=>[slot,text(patch.filmingInstructions[slot],3000)]));
    return db.runTransaction(async tx=>{
      const r=refs(input.drillId); const [d,a]=await Promise.all([tx.get(r.drill),tx.get(r.author)]);
      const drill=d.data(),author=a.data(); batchDrill(drill);currentRevision(author,input.baseRevision);
      const changesEvidence=clean.sources!==undefined;
      if(changesEvidence && drill.status==="published") fail("failed-precondition","Archive the published drill before changing reviewed evidence.");
      const next=nextAuthor(author,{...clean,...(changesEvidence?{reviewStatus:"pending",reviewedContentHash:null,publicationHold:"Evidence changed; a new content review is required."}:{})},auth);
      tx.set(r.author,next);
      if(changesEvidence) tx.update(r.drill,{"trainingPolicy.reviewStatus":"pending"});
      return {authoring:next};
    });
  }
  async function reviewDrill(input,auth) {
    admin(auth);
    if(!["approved","pending"].includes(input.decision)) fail("invalid-argument","Choose an explicit review decision.");
    return db.runTransaction(async tx=>{
      await reviewer(tx,auth);
      const r=refs(input.drillId);const [d,a]=await Promise.all([tx.get(r.drill),tx.get(r.author)]);
      const drill=d.data(),author=a.data();batchDrill(drill);currentRevision(author,input.baseRevision);
      if(drill.status==="published") fail("failed-precondition","Archive this drill before changing its review.");
      validateTrainingDrill(drill,fail);
      sourcesOf(author.sources);
      if(drill.trainingPolicy.evidenceLinks.some(link=>link.sourceIds.some(sourceId=>!author.sources.some(source=>source.id===sourceId)))) fail("failed-precondition","Every objective relationship must have a matching evidence source.");
      if(!drill.trainingPolicy?.limits || !drill.trainingPolicy?.loadFamilies?.length || !SLOTS.every(slot=>author.filmingInstructions?.[slot])) fail("failed-precondition","Complete the exercise policy and filming instructions first.");
      const approved=input.decision==="approved";
      const next=nextAuthor(author,{reviewStatus:input.decision,reviewNotes:text(input.reviewNotes||"",6000),reviewedBy:auth.uid,reviewedAt:new Date(now()).toISOString(),reviewedContentHash:approved?contentHash(drill):null,publicationHold:approved?"Complete video approval and delivery compatibility checks before publishing.":"Content review is pending."},auth);
      tx.set(r.author,next);tx.update(r.drill,{"trainingPolicy.reviewStatus":input.decision});
      return {authoring:next};
    });
  }
  async function saveDrill(input,auth) {
    admin(auth);
    const w=input.write,keys=EDITABLE;
    if(!w || typeof w!=="object" || Object.keys(w).some(k=>!keys.includes(k))) fail("invalid-argument","Choose editable exercise fields only.");
    if(!['draft','archived'].includes(w.status)) fail("failed-precondition","Use the reviewed publication action to publish this exercise.");
    if(typeof input.expectedCatalogVersion!=="string" || !input.expectedCatalogVersion) fail("invalid-argument","Reload the exercise version before saving.");
    const patch={...w,positionSpecific:w.positionSpecific??null};
    return db.runTransaction(async tx=>{
      const r=refs(input.drillId),metaRef=db.doc('drillCatalogMeta/current');
      const [d,a,m]=await Promise.all([tx.get(r.drill),tx.get(r.author),tx.get(metaRef)]);
      const drill=d.data(),author=a.data();batchDrill(drill);if(!author)fail('not-found','Production record not found.');
      if(drill.catalogVersion!==input.expectedCatalogVersion) fail('aborted','This exercise changed. Reload it before saving.');
      validateTrainingDrill({...drill,...patch},fail);
      if(drill.status==='published' && (patch.status!=='archived' || contentHash({...drill,...patch})!==contentHash(drill)))fail('failed-precondition','Archive the published exercise without changing its content before editing it.');
      const version=bumpVersion(m.data()?.catalogVersion);
      tx.update(r.drill,{...patch,'trainingPolicy.reviewStatus':'pending',catalogVersion:version,updatedAt:FieldValue.serverTimestamp(),updatedBy:auth.uid});
      const next=nextAuthor(author,{reviewStatus:'pending',reviewedContentHash:null,publicationHold:'Instructions or dose changed; a new content review is required.'},auth);
      tx.set(r.author,next);
      tx.set(metaRef,{catalogVersion:version,updatedAt:FieldValue.serverTimestamp(),updatedBy:auth.uid,lastChange:{drillId:input.drillId,kind:'draft-content-edited'}},{merge:true});
      return {catalogVersion:version,authoring:next};
    });
  }
  async function verifyMedia(drillId,slot,asset) {
    if(!asset?.storagePath?.startsWith(`drillCatalogMedia/app/${drillId}/${slot}.`) || !asset.generation || !/^video\//.test(asset.contentType||"")) fail("failed-precondition",`Upload the ${slot} video first.`);
    if(!bucket) fail("failed-precondition","Media verification is unavailable.");
    const [meta]=await bucket.file(asset.storagePath).getMetadata();
    if(String(meta.generation)!==String(asset.generation) || !/^video\//.test(meta.contentType||"") || Number(meta.size)>300*1024*1024) fail("failed-precondition","The uploaded media changed. Reload and review the current video.");
  }
  async function approveMedia(input,auth) {
    admin(auth);
    if(!SLOTS.includes(input.slot)) fail("invalid-argument","Choose one of the three required video slots.");
    return db.runTransaction(async tx=>{
      await reviewer(tx,auth);
      const r=refs(input.drillId);const [d,a]=await Promise.all([tx.get(r.drill),tx.get(r.author)]);
      const drill=d.data(),author=a.data();batchDrill(drill);currentRevision(author,input.baseRevision);
      const asset=drill.media?.[input.slot];
      if(!input.generation || String(asset?.generation)!==String(input.generation)) fail("aborted","The video changed. Review the current version.");
      await verifyMedia(input.drillId,input.slot,asset);
      const next=nextAuthor(author,{mediaReviews:{...(author.mediaReviews||{}),[input.slot]:{generation:String(asset.generation),storagePath:asset.storagePath,reviewedBy:auth.uid,reviewedAt:new Date(now()).toISOString()}}},auth);
      tx.set(r.author,next);tx.update(r.drill,{[`media.${input.slot}.status`]:"approved"});
      return {authoring:next};
    });
  }
  async function publishDrill(input,auth) {
    admin(auth);
    return db.runTransaction(async tx=>{
      await reviewer(tx,auth);
      const r=refs(input.drillId),metaRef=db.doc("drillCatalogMeta/current");
      const [d,a,config,meta]=await Promise.all([tx.get(r.drill),tx.get(r.author),tx.get(db.doc("config/llm")),tx.get(metaRef)]);
      const drill=d.data(),author=a.data();batchDrill(drill);currentRevision(author,input.baseRevision);
      validateTrainingDrill(drill,fail);
      const contentReviewer=author?.reviewedBy ? (await tx.get(db.doc(`trainingReviewers/${id(author.reviewedBy)}`))).data():null;
      if(!contentReviewer?.enabled || author.reviewStatus!=="approved" || drill.trainingPolicy.reviewStatus!=="approved" || author.reviewedContentHash!==contentHash(drill)) fail("failed-precondition","A qualified reviewer must approve the current instructions, evidence, and dose.");
      sourcesOf(author.sources);
      for(const slot of SLOTS) {
        const asset=drill.media?.[slot],review=author.mediaReviews?.[slot];
        const mediaReviewer=review?.reviewedBy ? (await tx.get(db.doc(`trainingReviewers/${id(review.reviewedBy)}`))).data():null;
        if(!mediaReviewer?.enabled || !review || review.generation!==String(asset?.generation) || review.storagePath!==asset?.storagePath || asset?.status!=="approved") fail("failed-precondition",`The current ${slot} video needs approval.`);
        await verifyMedia(input.drillId,slot,asset);
      }
      if(drill.trainingPolicy.requiresVerifiedMobile && config.data()?.wholeBodyTraining?.mobileVerified!==true) fail("failed-precondition","Gym publication is held until mobile loading and supervision instructions pass device acceptance.");
      const catalogVersion=bumpVersion(meta.data()?.catalogVersion);
      const next=nextAuthor(author,{publicationHold:null,publishedAt:new Date(now()).toISOString(),publishedBy:auth.uid},auth);
      tx.set(r.author,next);
      tx.update(r.drill,{status:"published",catalogVersion,updatedAt:FieldValue.serverTimestamp(),updatedBy:auth.uid});
      tx.set(metaRef,{catalogVersion,updatedAt:FieldValue.serverTimestamp(),updatedBy:auth.uid,lastChange:{drillId:input.drillId,kind:"reviewed-publication"}},{merge:true});
      return {authoring:next,catalogVersion};
    });
  }
  async function setReviewer(input,auth) {
    admin(auth);const uid=id(input.uid);
    if(typeof input.enabled!=="boolean") fail("invalid-argument","Reviewer designation must be explicit.");
    const qualification=text(input.qualification||"",2000),displayName=text(input.displayName||"",200);
    if(input.enabled && (!qualification || !displayName)) fail("invalid-argument","Record the reviewer name and qualification before designation.");
    if(!authDirectory) fail("failed-precondition","Reviewer account verification is unavailable.");
    const account=await authDirectory.getUser(uid);
    if(account.disabled && input.enabled) fail("failed-precondition","A disabled account cannot review training.");
    const scopeType=isClubAdmin({uid,email:account.email,emailVerified:account.emailVerified}) ? "posetek" : "assignedPlayers";
    await db.doc(`trainingReviewers/${uid}`).set({enabled:input.enabled,qualification,displayName,scopeType,grantedBy:auth.uid,updatedAt:new Date(now()).toISOString()});
    return {uid,enabled:input.enabled};
  }
  async function playerAccess(tx,playerId,auth,staffOnly=false) {
    authenticated(auth);const p=(await tx.get(db.doc(`players/${id(playerId)}`))).data();
    if(!p) fail("not-found","Player not found.");
    if(isClubAdmin(auth)) return p;
    if(!staffOnly && (p.authenticationUID===auth.uid || p.userUID===auth.uid || playerId===auth.uid)) return p;
    if(p.organizationId) {
      const m=(await tx.get(db.doc(`organizations/${id(p.organizationId)}/members/${id(auth.uid)}`))).data();
      if(memberCanAccessPlayer(m,auth.uid,p)) return p;
    } else {
      const c=(await tx.get(db.doc(`coaches/${id(auth.uid)}`))).data();
      if(c?.userUID===auth.uid && (p.coachUID===auth.uid || c.members?.includes(playerId))) return p;
    }
    fail("permission-denied","This player is outside your current access.");
  }
  async function getReadiness(input,auth) {
    return db.runTransaction(async tx=>{
      await playerAccess(tx,input.playerId,auth,true);
      const [r,q]=await Promise.all([tx.get(db.doc(`players/${input.playerId}/privateProfile/trainingReadiness`)),tx.get(db.doc(`trainingReviewers/${id(auth.uid)}`))]);
      return {readiness:r.data()||null,canReview:q.data()?.enabled===true && Boolean(q.data()?.qualification),reviewer:q.data()||null};
    });
  }
  function readinessOf(raw) {
    if(!raw || raw.schemaVersion!==1 || !["pending","cleared"].includes(raw.status)) fail("invalid-argument","Choose a readiness status.");
    // Revocation never depends on filling out a new clearance or extending an
    // expired one. Remove every executable permission when returning to pending.
    if(raw.status==="pending") return {schemaVersion:1,status:"pending",loadFamilies:[],supervision:"qualifiedCoach",expiresAt:new Date(now()).toISOString(),limits:{setsPerSession:0,setsPerWeek:0,contactsPerSession:0,contactsPerWeek:0,holdSecondsPerSession:0,holdSecondsPerWeek:0,minRecoveryHours:24},exerciseLoads:{}};
    const loadFamilies=Array.isArray(raw.loadFamilies) ? [...new Set(raw.loadFamilies.map(id))] : [];
    if(loadFamilies.some(f=>!["knee","hip","hamstring","adductor","calf","trunk","upperPush","upperPull"].includes(f))) fail("invalid-argument","Choose a known movement family.");
    if(loadFamilies.length>30 || (raw.status==="cleared" && !loadFamilies.length)) fail("invalid-argument","Choose the movement families actually reviewed.");
    const expires=Date.parse(raw.expiresAt);
    if(!Number.isFinite(expires) || expires<=now() || expires>now()+366*86400000) fail("invalid-argument","Choose a future review date within one year.");
    if(!["qualifiedCoach","independent"].includes(raw.supervision)) fail("invalid-argument","Record the approved supervision conditions.");
    const limits={};
    for(const [key,max] of Object.entries({setsPerSession:100,setsPerWeek:300,contactsPerSession:300,contactsPerWeek:1000,holdSecondsPerSession:3600,holdSecondsPerWeek:10000,minRecoveryHours:168})) limits[key]=integer(raw.limits?.[key],key==="minRecoveryHours"?24:1,max,key);
    const exerciseLoads={};
    if(raw.exerciseLoads!==undefined && (!raw.exerciseLoads || typeof raw.exerciseLoads!=="object" || Array.isArray(raw.exerciseLoads))) fail("invalid-argument","Exercise loading must be a map keyed by drill ID.");
    const entries=Object.entries(raw.exerciseLoads||{});
    if(entries.length>100) fail("invalid-argument","Review at most 100 exercise loads at once.");
    for(const [key,row] of entries) {
      if(!row || typeof row.independentAllowed!=="boolean") fail("invalid-argument","Independent exercise approval must be explicit.");
      const instruction=text(row.instruction,500);if(!instruction) fail("invalid-argument","Record the actual coach-set loading instruction.");
      exerciseLoads[id(key)]={instruction,independentAllowed:row.independentAllowed};
    }
    return {schemaVersion:1,status:raw.status,loadFamilies,supervision:raw.supervision,expiresAt:new Date(expires).toISOString(),limits,exerciseLoads};
  }
  async function saveReadiness(input,auth) {
    const clean=readinessOf(input.readiness);
    return db.runTransaction(async tx=>{
      await playerAccess(tx,input.playerId,auth,true);await reviewer(tx,auth);
      const ref=db.doc(`players/${input.playerId}/privateProfile/trainingReadiness`),old=(await tx.get(ref)).data();
      if(input.baseRevision!==(old?.revision||0)) fail("aborted","Readiness changed. Reload before saving.");
      const readiness={...clean,reviewedBy:auth.uid,reviewedAt:new Date(now()).toISOString(),revision:(old?.revision||0)+1};
      tx.set(ref,readiness);return {readiness};
    });
  }
  return {getAuthoring,saveAuthoring,saveDrill,reviewDrill,approveMedia,publishDrill,setReviewer,getReadiness,saveReadiness};
}
module.exports={createTrainingAuthoring,contentHash,bumpVersion,BATCH,SLOTS};
