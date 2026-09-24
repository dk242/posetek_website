import assert from 'node:assert/strict';
import {firestoreEmulator} from './canonicalRules.mjs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc, getDoc, setDoc, serverTimestamp, collection, getDocs, query, where, setLogLevel} from 'firebase/firestore';
setLogLevel('silent'); // Expected denial cases remain assertions, not noisy SDK logs.

const env = await initializeTestEnvironment({projectId:'demo-personalized-planner',
  firestore:firestoreEmulator()});
const actors = Object.fromEntries(['admin','athlete','coach','manager','wrong','inactive','malformed','mismatch','outsider','unverified','anonymous'].map(uid => {
  const claims = {email:`${uid}@example.test`, email_verified:true};
  if (uid === 'admin' || uid === 'unverified') claims.email = `${uid}@posetek.net`;
  if (uid === 'unverified') claims.email_verified = false;
  if (uid === 'anonymous') claims.firebase = {sign_in_provider:'anonymous'};
  return [uid, env.authenticatedContext(uid, claims).firestore()];
}));
const anon = env.unauthenticatedContext().firestore();
const bodies = {
  generate_personalized_plan:{engineVersion:'personalized-v1',planVersion:3,intake:{},timezone:'UTC'},
  assess_personalized_plan:{engineVersion:'personalized-v1',planVersion:3,intake:{},timezone:'UTC'},
  activate_personalized_plan:{engineVersion:'personalized-v1',draftId:'draft',comparisonToken:'opaque-token',expectedActivePlans:[]},
  discard_personalized_plan:{engineVersion:'personalized-v1',draftId:'draft'},
};
let checks = 0;
async function allowed(promise) { await assertSucceeds(promise); checks++; }
async function denied(promise) { await assertFails(promise); checks++; }
async function seed(write) { await env.withSecurityRulesDisabled(ctx => write(ctx.firestore())); }
function job(uid, playerId, capability, params=bodies[capability]) {
  return {schemaVersion:1,status:'pending',requestedByUid:uid,playerId,capability,params,createdAt:serverTimestamp()};
}
try {
  await seed(async db => {
    await setDoc(doc(db,'players/player'),{authenticationUID:'athlete',userUID:'athlete',coachUID:'coach',organizationCode:'legacy'});
    await setDoc(doc(db,'coaches/coach'),{userUID:'coach',members:['player','club-player'],organizationCode:'legacy'});
    await setDoc(doc(db,'players/club-player'),{authenticationUID:'athlete',userUID:'athlete',organizationId:'club',teamId:'girls',
      coachUID:'outsider',organizationCode:'legacy',signupEmail:'outsider@example.test'});
    for (const [uid, role, teamIds, status, userUID] of [
      ['coach','coach',['girls'],'active','coach'], ['manager','manager',[],'active','manager'],
      ['wrong','coach',['boys'],'active','wrong'], ['inactive','coach',['girls'],'inactive','inactive'],
      ['malformed','manager','girls','active','malformed'], ['mismatch','manager',[],'active','other'],
      ['anonymous','manager',[],'active','anonymous'],
    ]) await setDoc(doc(db,`organizations/club/members/${uid}`),{role,teamIds,status,userUID});
    for (const player of ['player','club-player']) {
      await setDoc(doc(db,`players/${player}/personalizedPlanDrafts/draft`),{status:'ready',playerId:player,createdByUid:'admin'});
      await setDoc(doc(db,`players/${player}/personalizedPlanDraftContexts/draft`),{rawCoachNote:'private',peerIdentities:['private']});
      await setDoc(doc(db,`players/${player}/trainingPlanContexts/plan`),{rawCoachNote:'private'});
      await setDoc(doc(db,`players/${player}/privateProfile/coachFeedback`),{text:'private'});
      await setDoc(doc(db,`players/${player}/personalizedPlanOperations/current`),{jobId:'job',token:'server-only'});
      for (const uid of ['admin','athlete','coach','manager']) {
        await setDoc(doc(db,`players/${player}/personalizedPlanDraftViews/${uid}`),{schemaVersion:1,status:'ready',playerId:player,createdByUid:uid});
      }
    }
  });
  for (const player of ['player','club-player']) {
    for (const sub of ['personalizedPlanDrafts','personalizedPlanDraftContexts','trainingPlanContexts']) {
      const id = sub === 'trainingPlanContexts' ? 'plan' : 'draft';
      await allowed(getDoc(doc(actors.admin,`players/${player}/${sub}/${id}`)));
      for (const uid of ['athlete','coach','manager','outsider','unverified']) await denied(getDoc(doc(actors[uid],`players/${player}/${sub}/${id}`)));
    }
    await denied(getDoc(doc(actors.athlete,`players/${player}/privateProfile/coachFeedback`)));
    for (const uid of ['admin','athlete','coach','manager']) {
      for (const sub of ['personalizedPlanDrafts','personalizedPlanDraftContexts','personalizedPlanDraftViews','personalizedPlanOperations']) {
        await denied(setDoc(doc(actors[uid],`players/${player}/${sub}/forged`),{status:'ready',createdByUid:uid}));
      }
    }
    for (const [capability, params] of Object.entries(bodies)) {
      for (const [uid, db] of Object.entries(actors)) {
        const can = ['admin','athlete','coach'].includes(uid) || (player === 'club-player' && uid === 'manager');
        await (can ? allowed : denied)(setDoc(doc(db,`llmJobs/${player}-${capability}-${uid}`),job(uid,player,capability)));
      }
      for (const paramsOverride of [{...params,engineVersion:'future'},{...params,unexpected:'field'}]) {
        await denied(setDoc(doc(actors.admin,`llmJobs/bad-${player}-${capability}`),job('admin',player,capability,paramsOverride)));
      }
      if (['generate_personalized_plan','assess_personalized_plan'].includes(capability)) {
        // The original actor loop above covers omission for every actor. These
        // explicit preferences must preserve precisely the same actor boundary.
        for (const preference of [true,false]) {
          for (const [uid,db] of Object.entries(actors)) {
            const can = ['admin','athlete','coach'].includes(uid) || (player === 'club-player' && uid === 'manager');
            await (can ? allowed : denied)(setDoc(doc(db,`llmJobs/estimate-${player}-${capability}-${uid}-${preference}`),
              job(uid,player,capability,{...params,useProvisionalEstimates:preference})));
          }
          await denied(setDoc(doc(actors.admin,`llmJobs/estimate-unknown-${player}-${capability}-${preference}`),
            job('admin',player,capability,{...params,useProvisionalEstimates:preference,unexpected:'field'})));
        }
        for (const [index,preference] of [null,'true','false',0,1,[],{},[true]].entries()) {
          await denied(setDoc(doc(actors.admin,`llmJobs/estimate-malformed-${player}-${capability}-${index}`),
            job('admin',player,capability,{...params,useProvisionalEstimates:preference})));
        }
        for (const [index,paramsOverride] of [params,{...params,useProvisionalEstimates:true},{...params,useProvisionalEstimates:false}].entries()) {
          await denied(setDoc(doc(anon,`llmJobs/estimate-unauthenticated-${player}-${capability}-${index}`),
            job('athlete',player,capability,paramsOverride)));
        }
      } else {
        for (const preference of [true,false]) {
          await denied(setDoc(doc(actors.admin,`llmJobs/estimate-wrong-capability-${player}-${capability}-${preference}`),
            job('admin',player,capability,{...params,useProvisionalEstimates:preference})));
        }
      }
    }
  }
  for (const uid of ['athlete','coach','manager']) {
    const db = actors[uid];
    await allowed(getDoc(doc(db,`players/club-player/personalizedPlanDraftViews/${uid}`)));
    await allowed(getDocs(query(collection(db,'players/club-player/personalizedPlanDraftViews'),where('createdByUid','==',uid))));
    await denied(getDocs(collection(db,'players/club-player/personalizedPlanDraftViews')));
    await denied(getDoc(doc(db,'players/club-player/personalizedPlanDraftViews/admin')));
    await denied(getDoc(doc(db,'players/club-player/personalizedPlanOperations/current')));
  }
  await allowed(getDocs(collection(actors.admin,'players/club-player/personalizedPlanDraftViews')));
  await denied(getDoc(doc(anon,'players/club-player/personalizedPlanDraftViews/athlete')));
  await denied(setDoc(doc(actors.athlete,'llmJobs/forged-execution'),{
    ...job('athlete','club-player','generate_personalized_plan'),personalizedExecution:{token:'forged'}}));
  await denied(setDoc(doc(actors.admin,'llmJobs/forged-version'),{
    ...job('admin','player','generate_training_plan',{}),engineVersion:'personalized-v1'}));
  await allowed(setDoc(doc(actors.athlete,'llmJobs/native-current'),job('athlete','club-player','generate_training_plan',{planVersion:3})));
  const coachJob = 'club-player-generate_personalized_plan-coach';
  await allowed(getDoc(doc(actors.coach,`llmJobs/${coachJob}`)));
  await allowed(getDocs(query(collection(actors.coach,'llmJobs'),where('requestedByUid','==','coach'),where('playerId','==','club-player'))));
  await seed(db => setDoc(doc(db,'organizations/club/members/coach'),{userUID:'coach',role:'coach',status:'inactive',teamIds:['girls']}));
  await denied(getDoc(doc(actors.coach,`llmJobs/${coachJob}`)));
  await denied(getDoc(doc(actors.coach,'players/club-player/personalizedPlanDraftViews/coach')));
  await denied(getDocs(query(collection(actors.coach,'players/club-player/personalizedPlanDraftViews'),where('createdByUid','==','coach'))));
  await denied(setDoc(doc(actors.coach,'llmJobs/revoked'),job('coach','club-player','generate_personalized_plan')));
  await seed(db => setDoc(doc(db,'organizations/club/members/coach'),{userUID:'coach',role:'coach',status:'active',teamIds:['girls']}));
  await seed(db => setDoc(doc(db,'players/club-player'),{authenticationUID:'athlete',userUID:'athlete',organizationId:'club',teamId:'boys',coachUID:'coach',organizationCode:'legacy'}));
  await denied(getDoc(doc(actors.coach,'players/club-player/personalizedPlanDraftViews/coach')));
  await denied(getDoc(doc(actors.coach,`llmJobs/${coachJob}`)));
  await allowed(getDoc(doc(actors.manager,'players/club-player/personalizedPlanDraftViews/manager')));
  await seed(db => setDoc(doc(db,'players/club-player'),{authenticationUID:'athlete',userUID:'other',organizationId:'club',teamId:'girls'}));
  await denied(getDoc(doc(actors.athlete,'players/club-player/personalizedPlanDraftViews/athlete')));
  await denied(getDoc(doc(actors.manager,'players/club-player/personalizedPlanDraftViews/manager')));
  assert.ok(checks > 200);
  console.log(`${checks} personalized rule assertions passed; original draft privacy and native submission retained.`);
} finally { await env.cleanup(); }
