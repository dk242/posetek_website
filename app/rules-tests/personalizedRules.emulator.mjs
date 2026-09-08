import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,serverTimestamp,collection,getDocs} from 'firebase/firestore';
const env=await initializeTestEnvironment({projectId:'demo-personalized-planner',firestore:{rules:fs.readFileSync('firestore.rules','utf8'),host:'127.0.0.1',port:8189}});
const admin=env.authenticatedContext('admin',{email:'staff@posetek.net',email_verified:true}).firestore();
const athlete=env.authenticatedContext('athlete',{email:'player@example.test',email_verified:true}).firestore();
const coach=env.authenticatedContext('coach',{email:'coach@example.test',email_verified:true}).firestore();
const unverified=env.authenticatedContext('unverified',{email:'staff@posetek.net',email_verified:false}).firestore();
const anon=env.unauthenticatedContext().firestore();
let checks=0;
try {
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await setDoc(doc(db,'players/player'),{authenticationUID:'athlete',coachUID:'coach',age:15});
  await setDoc(doc(db,'coaches/coach'),{userUID:'coach',members:['player']});
  await setDoc(doc(db,'players/player/personalizedPlanDrafts/draft'),{status:'ready',playerId:'player'});
  await setDoc(doc(db,'players/player/personalizedPlanDraftContexts/draft'),{private:true});
 });
 for(const sub of ['personalizedPlanDrafts','personalizedPlanDraftContexts']) {
  await assertSucceeds(getDoc(doc(admin,`players/player/${sub}/draft`)));checks++;
  await assertSucceeds(getDocs(collection(admin,`players/player/${sub}`)));checks++;
  for(const db of [athlete,coach,unverified,anon]) {await assertFails(getDoc(doc(db,`players/player/${sub}/draft`)));checks++;}
  for(const db of [admin,athlete,coach,anon]) {await assertFails(setDoc(doc(db,`players/player/${sub}/new`),{status:'ready'}));checks++;}
 }
 const params={generate_personalized_plan:{engineVersion:'personalized-v1',planVersion:3,intake:{},timezone:'UTC'},
 assess_personalized_plan:{engineVersion:'personalized-v1',planVersion:3,intake:{},timezone:'UTC'},
 activate_personalized_plan:{engineVersion:'personalized-v1',draftId:'draft',comparisonToken:'token',expectedActivePlans:[]},
 discard_personalized_plan:{engineVersion:'personalized-v1',draftId:'draft'}};
 for(const [capability,body] of Object.entries(params)) {
  for(const [uid,db,allowed] of [['admin',admin,true],['athlete',athlete,false],['coach',coach,false],['unverified',unverified,false]]) {
    const job={schemaVersion:1,status:'pending',requestedByUid:uid,playerId:'player',capability,params:body,createdAt:serverTimestamp()};
    await (allowed?assertSucceeds:assertFails)(setDoc(doc(db,`llmJobs/${capability}-${uid}`),job));checks++;
  }
  for(const malformed of [{...body,engineVersion:'future'},{...body,unexpected:'field'}]) {
   await assertFails(setDoc(doc(admin,`llmJobs/bad-${capability}`),{schemaVersion:1,status:'pending',requestedByUid:'admin',playerId:'player',capability,params:malformed,createdAt:serverTimestamp()}));checks++;
  }
 }
 await assertFails(setDoc(doc(admin,'llmJobs/forged-version'),{schemaVersion:1,status:'pending',requestedByUid:'admin',playerId:'player',capability:'generate_training_plan',params:{},createdAt:serverTimestamp(),engineVersion:'personalized-v1'}));checks++;
 await assertSucceeds(setDoc(doc(athlete,'llmJobs/legacy-current'),{schemaVersion:1,status:'pending',requestedByUid:'athlete',playerId:'player',capability:'generate_training_plan',params:{planVersion:3},createdAt:serverTimestamp()}));checks++;
 assert.equal(checks,46);
 console.log(`${checks} personalized rule assertions passed; current client submission retained.`);
} finally {await env.cleanup();}
