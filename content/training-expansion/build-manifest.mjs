import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {exercises} from './exercises.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const sourceCatalog=JSON.parse(fs.readFileSync(path.join(here,'sources.json'),'utf8'));
const sourceMap=new Map(sourceCatalog.sources.map(s=>[s.id,s]));
const snapshotArg=process.argv.find(a=>a.startsWith('--catalog='));
const matrixArg=process.argv.find(a=>a.startsWith('--matrix='));
const referencePath=path.join(here,'deduplication-reference.json');
let reference;
if(snapshotArg && matrixArg){
  const liveBytes=fs.readFileSync(path.resolve(root,snapshotArg.slice(10)));
  const matrixBytes=fs.readFileSync(path.resolve(root,matrixArg.slice(9)));
  const live=JSON.parse(liveBytes.toString('utf8').replace(/^\uFEFF/,''));
  const matrix=JSON.parse(matrixBytes.toString('utf8').replace(/^\uFEFF/,''));
  reference={
    observedAt:live.at,
    catalogVersion:live.meta?.fields?.catalogVersion?.stringValue ?? 'unknown',
    note:'Names/IDs only. Private raw catalog and local source captures remain outside Git. Undefined legacy status is preserved as null and was not treated as absent.',
    liveSnapshotSha256:crypto.createHash('sha256').update(liveBytes).digest('hex'),
    matrixSnapshotSha256:crypto.createHash('sha256').update(matrixBytes).digest('hex'),
    live:live.rows.map(r=>({id:r.id,name:r.name,status:r.status ?? null})),
    matrix:matrix.map(r=>({id:r.drillId,name:r.name})),
  };
  fs.writeFileSync(referencePath,JSON.stringify(reference,null,2)+'\n');
}else{
  reference=JSON.parse(fs.readFileSync(referencePath,'utf8'));
}

const dates=[['2026-09-21','2026-09-27'],['2026-09-28','2026-10-04'],['2026-10-05','2026-10-11'],['2026-10-12','2026-10-18']];
const order=['strength','isometric','plyometric','speedCod','ball'];
const prefixes={strength:'STR',plyometrics:'PLY',speed:'SPD',agility:'AGL',ballMastery:'BMA',receiving:'RCV',passing:'PAS',shooting:'SHT'};
const highest={};
for(const r of reference.live){const m=/^([A-Z]+)-(\d+)$/.exec(r.id);if(m)highest[m[1]]=Math.max(highest[m[1]]??500,Number(m[2]));}
const patternMap={knee:'squat/lunge and knee extension',hip:'hip force and control',hamstring:'posterior-chain and knee-flexion capacity',adductor:'frontal-plane hip control',calf:'ankle and calf capacity',trunk:'trunk control',upperPush:'upper-body push/support',upperPull:'upper-body pull/scapular control'};
const normalizeName=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
const oldNames=new Set([...reference.live,...reference.matrix].map(x=>normalizeName(x.name)));
const sorted=[...exercises].sort((a,b)=>a.week-b.week||order.indexOf(a.category)-order.indexOf(b.category));

function domain(e){
  if(e.category==='strength'||e.category==='isometric')return 'strength';
  if(e.category==='plyometric')return 'plyometrics';
  if(e.category==='speedCod')return e.objectives.includes('planned_change_direction')?'agility':'speed';
  if(e.name.includes('juggling'))return 'ballMastery';
  if(e.name.includes('receive'))return 'receiving';
  if(e.doseCode==='K')return 'shooting';
  return 'passing';
}
function dose(e){
  const defaults={R:[6,8,'reps',60,90,'sets'],C:[10,15,'meters',60,90,'sets'],H:[10,20,'seconds',45,60,'sets'],J:[3,5,'reps',15,30,'reps'],Q:[8,12,'contacts',60,90,'sets'],S:[2,3,'reps',90,120,'reps'],B:[6,8,'reps',30,60,'sets'],P:[6,8,'passes',30,60,'sets'],K:[4,6,'shots',45,60,'sets']}[e.doseCode];
  const [repsMin,repsMax,repUnit,restSecondsMin,restSecondsMax,restScope]=defaults;
  const d={setsMin:1,setsMax:2,repsMin,repsMax,repUnit,perSide:e.perSide,restSecondsMin,restSecondsMax,restScope,
    restBetweenSetsSecondsMin:restScope==='reps'?(e.doseCode==='S'?120:60):null,
    restBetweenSetsSecondsMax:restScope==='reps'?(e.doseCode==='S'?180:90):null,
    familiarizationReps:0,
    doseText:`1-2 sets x ${repsMin}-${repsMax} ${repUnit}${e.perSide?' each side':''}`,
    restText:`${restSecondsMin}-${restSecondsMax} seconds between ${restScope}${restScope==='reps'?`; ${e.doseCode==='S'?'120-180':'60-90'} seconds between sets`:''}`,
    doseNote:'Draft coaching range, not an athlete prescription. Coach approves the dose, load and total weekly work. Stop before technique changes.'};
  if(e.doseCode==='S')d.doseNote+=' One repetition is one complete route; walk back during recovery.';
  if(e.doseCode==='J')d.doseNote+=' Reset between efforts; no height or distance competition.';
  if(e.doseCode==='Q')d.doseNote+=' Count every landing as one contact; do not chase fatigue.';
  if(e.doseCode==='H')d.doseNote+=' Breathe normally; no maximal straining or breath-holding.';
  if(e.doseCode==='B')d.doseNote+=' One repetition is one complete receive/control sequence.';
  return d;
}
function evidence(e){
  if(e.category==='ball'){
    const ids=e.doseCode==='K'?['FA_FINISH2022','USYS2017']:e.name.includes('receive')?['FIFA_RECEIVE2023','USYS2017']:['FA_PASS2022','USYS2017'];
    return {sourceIds:ids,specificity:'officialCoachingRationale',testRelationship:'general',
      claim:'Practises a distinct ball-control or passing/finishing technique as general soccer development.',
      limitations:'Official coaching guidance supports the skill family; this authored drill and draft dose have no isolated intervention proof. No direct change in dribbling time or shot speed is promised.'};
  }
  if(e.category==='isometric')return {sourceIds:['NSCA2009','AAP2020','ISO2026'],specificity:'consensusExtrapolation',testRelationship:'general',claim:'Adds a selected fixed-position strength/endurance option within a supervised whole-body program.',limitations:'The youth trial combined isometric and ballistic work in older males. It cannot prove this particular hold improves a six-test result; no tendon or pain treatment claim.'};
  if(e.category==='strength')return {sourceIds:e.objectives.length?['NSCA2009','AAP2020','NEGRA2016']:['NSCA2009','AAP2020'],specificity:'consensusExtrapolation',testRelationship:e.objectives.length?'support':'general',claim:e.objectives.length?'Develops a physical capacity that can support the linked performance domain as part of a complete program.':'Broadens whole-body strength beyond what the six-test suite directly measures.',limitations:'The named exercise, variation and dose were not isolated in the cited trials. Linking a domain is a coaching inference, not diagnosis of a weakness or a guaranteed test improvement.'};
  if(e.category==='plyometric')return {sourceIds:e.objectives.length?['NSCA2009','PJT2018','PJT2014']:['NSCA2009','AAP2020'],specificity:e.objectives.length?'programLevel':'consensusExtrapolation',testRelationship:e.objectives.length?'support':'general',claim:e.objectives.length?'Provides a coached jumping/hopping progression consistent with plyometric-program evidence.':'Adds upper-body reactive push/catch practice for general athletic development.',limitations:e.objectives.length?'Program-level youth evidence does not isolate this variation. Direction, support, experience and dose matter; vertical training has not consistently improved sprint time.':'Upper-body reactive work is not established as a direct improvement to a PoseTek test. Coach must check apparatus, load and catch/support competence.'};
  const cod=e.objectives.includes('planned_change_direction');
  return {sourceIds:cod?['COD2019','CONSENSUS2014']:['SPRINT2021','CONSENSUS2014'],specificity:'programLevel',testRelationship:cod?'direct':(/Two-point|Half-kneeling/.test(e.name)?'direct':'support'),claim:cod?'Provides coached practice of a specified direction-change or braking task.':'Provides short acceleration or supporting multidirectional running practice.',limitations:cod?'The controlled study used a small older-male sample and different coached tasks. A shuttle result alone cannot diagnose braking or cutting mechanics.':'The cited sprint trial studied individually resisted sprinting, not this exact start/route. The link is task/movement-family rationale, not exercise-specific proof or a load recommendation.'};
}

const rows=sorted.map((e,index)=>{
  if(oldNames.has(normalizeName(e.name)))throw new Error(`Existing catalog name: ${e.name}`);
  const manifestId=`wb-${String(index+1).padStart(3,'0')}`;
  const dom=domain(e), prefix=prefixes[dom];
  const proposedDrillId=`${prefix}-${highest[prefix]=(highest[prefix]??500)+1}`;
  const d=dose(e), ev=evidence(e), side=e.perSide?2:1;
  const fullBody=['strength','isometric','plyometric'].includes(e.category);
  const modality={strength:'resistance',isometric:'isometric',plyometric:'plyometric',speedCod:dom,ball:'ball'}[e.category];
  const limits={setsPerSession:2,setsPerWeek:4,minRecoveryHours:e.category==='ball'?0:48};
  if(e.category==='plyometric'){
    limits.contactsPerSession=d.setsMax*d.repsMax*side;
    limits.contactsPerWeek=limits.contactsPerSession*2;
  }
  if(e.category==='isometric'){
    limits.holdSecondsPerSession=d.setsMax*d.repsMax*side;
    limits.holdSecondsPerWeek=limits.holdSecondsPerSession*2;
  }
  const trainingPolicy={version:'whole-body-v1',modality,loadFamilies:e.families,requiresClearance:true,requiresVerifiedMobile:fullBody,
    reviewStatus:'pending',progression:'coachReviewed',loaded:e.loaded,supervision:'clearance',
    loadingInstructions:e.loaded?'Coach must choose and record the actual load/assistance for this exercise. Never infer weight from age, test percentile or an estimated 1RM.':'Use only the coach-cleared version and range. Bodyweight or a ball is not automatic readiness for this exercise.',
    evidenceLinks:e.objectives.map(objectiveId=>({objectiveId,relationship:ev.testRelationship==='direct'?'direct':'support',weight:ev.testRelationship==='direct'?1:0.5,sourceIds:ev.sourceIds})),limits};
  const comments=[e.cue,`Correct: ${e.error}`,'Coach-cleared exercise only. Use the approved version; stop for pain, dizziness or loss of control.'];
  if(e.loaded)comments.push('Coach selects the load or assistance and decides whether independent practice is allowed.');
  const drill={schemaVersion:2,drillId:proposedDrillId,name:e.name,domain:dom,minAge:10,maxAge:18,difficultyLevel:e.level,equipment:e.equipment,
    requiresPartner:e.name==='Sole layoff to supporting partner',positionSpecific:null,howTo:{setup:e.setup,steps:e.steps},dose:d,
    maxFrequencyPerWeek:2,coachComments:comments,adaptiveLevers:[`Easier: ${e.easier}`,`Harder: ${e.harder}`],media:{},status:'draft',
    catalogVersion:'pending-import',howToSource:'admin',coachCommentsSource:'admin',trainingPolicy};
  const filmingInstructions={
    primaryDemo:`Show ${e.name.toLowerCase()} from setup to finish at normal speed. Keep the whole body and equipment visible. ${e.steps.join('. ')}. Film both sides where relevant; show a reset rather than a fatigue set.`,
    teachingDetail:`Show the setup close enough to reproduce it: ${e.setup} Explain: ${e.cue} Demonstrate the easier option: ${e.easier} Explain that the coach chooses progression and any external load.`,
    errorCorrection:`Explain the error without deliberately loading an unsafe position: ${e.error} Contrast a safe low-effort example with the correct version. Refilm normal correct repetitions. Do not demonstrate pain, maximal strain, risky falls or unsafe equipment use.`};
  const authoring={revision:1,productionBatchId:'whole-body-2026-09',manifestId,category:e.category,filmingWeek:e.week,
    filmingStartDate:dates[e.week-1][0],filmingEndDate:dates[e.week-1][1],filmingInstructions,
    sources:ev.sourceIds.map(id=>{const s=sourceMap.get(id);return {id:s.id,title:s.title,url:s.url,evidenceType:s.kind,population:s.population,applicability:s.supports,limitations:s.limitations};}),
    reviewStatus:'pending',reviewNotes:'Research desk review completed; qualified human technique, dose, readiness and video review has not occurred.',publicationHold:'Awaiting content review and three approved videos.',
    evidence:ev,review:{researchStatus:'reviewed',contentStatus:'pending',qualifiedReviewer:null,reviewedAt:null},
    movementPatterns:e.families.map(f=>patternMap[f]),intendedAdaptation:ev.claim,regression:e.easier,progression:e.harder,
    distinctness:{comparedWith:e.comparedWith,rationale:e.distinctness,liveCatalogCount:reference.live.length,matrixCount:reference.matrix.length},
    reviewedDosePolicy:{status:'pending',rationale:'Low-volume starting authoring ranges for coach review, not an individual prescription. All sport, gym and match exposure must be considered.',setsCounting:'sets fields count complete schema sets; perSide doubles repetitions/seconds/contacts, not the sets field.',externalLoad:'No weight is authored. A qualified coach must set an athlete-specific exercise load or assistance.',maxFrequencyMeaning:'Per-exercise maximum is not permission to stack every exercise at that frequency.'},
    package:{status:'notFilmed',requiredSlots:['primaryDemo','teachingDetail','errorCorrection'],clips:{primaryDemo:'notFilmed',teachingDetail:'notFilmed',errorCorrection:'notFilmed'}}};
  return {manifestId,proposedDrillId,filmingWeek:e.week,category:e.category,drill,authoring};
});
const manifest={schemaVersion:1,productionBatchId:'whole-body-2026-09',title:'80 new whole-body training drafts',status:'draft',researchReviewedOn:'2026-09-22',humanContentReview:'pending',
  intendedAges:{min:10,max:18},allocation:{strength:28,isometric:12,plyometric:16,speedCod:12,ball:12},
  weeklyAllocation:{strength:7,isometric:3,plyometric:4,speedCod:3,ball:3},
  dateBasis:'America/Los_Angeles; week1 Sep21-27, week2 Sep28-Oct4, week3 Oct5-11, week4 Oct12-18 2026.',
  idPolicy:'manifestId is immutable. proposedDrillId is advisory; an importer must reserve actual IDs transactionally against the fresh live catalog and preserve the mapping.',
  releasePolicy:'Create drafts only. No publication, video fabrication, athlete assignment or saved-plan mutation. Pending human content review and three approved videos prevent publication.',
  deduplicationReference:{observedAt:reference.observedAt,catalogVersion:reference.catalogVersion,liveCount:reference.live.length,matrixCount:reference.matrix.length},drills:rows};
fs.writeFileSync(path.join(here,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');

const csvCell=x=>`"${String(x??'').replaceAll('"','""')}"`;
const csv=[['Manifest ID','Proposed ID (not reserved)','Week','Week start','Week end','Category','Name','Domain','Equipment','Dose draft','Rest draft','Patterns','Test relationship','Objectives','Source IDs','Evidence limitation','Distinctness','Primary demo brief','Teaching detail brief','Error correction brief','Review status','Publication hold'],
  ...rows.map(r=>[r.manifestId,r.proposedDrillId,r.filmingWeek,r.authoring.filmingStartDate,r.authoring.filmingEndDate,r.category,r.drill.name,r.drill.domain,r.drill.equipment.join('; '),r.drill.dose.doseText,r.drill.dose.restText,r.authoring.movementPatterns.join('; '),r.authoring.evidence.testRelationship,r.drill.trainingPolicy.evidenceLinks.map(x=>x.objectiveId).join('; '),r.authoring.evidence.sourceIds.join('; '),r.authoring.evidence.limitations,r.authoring.distinctness.rationale,...Object.values(r.authoring.filmingInstructions),r.authoring.reviewStatus,r.authoring.publicationHold])];
fs.writeFileSync(path.join(here,'filming-matrix.csv'),'\uFEFF'+csv.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n');
const md=['# Four-week filming and evidence matrix','','80 NEW exercises;20 complete three-clip packages per week,60 required clips weekly,240 total. Every item is a draft. Research review is not qualified human content approval.','','Each week includes7 strength,3 isometric,4 plyometric,3 speed/change-of-direction and3 ball packages. The filming sequence is not an athlete workout plan.','','The first date is Monday,September21,2026 (America/Los_Angeles). IDs shown below are suggestions until the importer reserves them. See sources.json for populations, source types and limitations.','','## Production standard','','- Primary demo: complete correct movement at normal speed, stable framing and both sides when relevant.','- Teaching detail: clear apparatus setup, contact points, the main cue and an easier option.','- Error correction: explain one recognizable mistake; demonstrate only a safe low-effort contrast and finish with correct movement.','- Record original demonstrations. Do not reuse research/publication media or claim medical treatment, guaranteed test gains or a completed qualified review.','- Review technique, age/experience eligibility, supervision, dose, wording and all three clips before publishing. Empty media fields are intentional.',''];
for(let week=1;week<=4;week++){
  md.push(`## Week${week}: ${dates[week-1][0]} to ${dates[week-1][1]}`,'','| Key | Category | Exercise | Equipment | Draft dose |','|---|---|---|---|---|');
  for(const r of rows.filter(r=>r.filmingWeek===week))md.push(`| ${r.manifestId} | ${r.category} | ${r.drill.name} | ${r.drill.equipment.join(', ')} | ${r.drill.dose.doseText} |`);
  md.push('');
}
md.push('## Individual filming cards','');
for(const r of rows){const a=r.authoring;md.push(`### ${r.manifestId}: ${r.drill.name}`,'',`**Week${r.filmingWeek}; ${r.category}.** ${a.intendedAdaptation}`,'',`Setup: ${r.drill.howTo.setup}`,'',...r.drill.howTo.steps.map((s,i)=>`${i+1}. ${s}.`),'',`Dose for review: ${r.drill.dose.doseText}; ${r.drill.dose.restText}. ${r.drill.dose.doseNote}`,'',`Easier: ${a.regression} Progression: ${a.progression}`,'',`Distinct from existing content: ${a.distinctness.rationale}${a.distinctness.comparedWith.length?' Compare '+a.distinctness.comparedWith.join(', ')+'.':''}`,'',`Evidence: ${a.evidence.specificity}; ${a.evidence.testRelationship}. ${a.sources.map(s=>`[${s.id}](${s.url})`).join(', ')}. ${a.evidence.limitations}`,'',`**Primary demo:** ${a.filmingInstructions.primaryDemo}`,'',`**Teaching detail:** ${a.filmingInstructions.teachingDetail}`,'',`**Error correction:** ${a.filmingInstructions.errorCorrection}`,'');}
fs.writeFileSync(path.join(here,'FILMING_MATRIX.md'),md.join('\n').trimEnd()+'\n');
console.log(`Built ${rows.length} drafts,${rows.length*3} clip briefs; comparison catalog${reference.live.length},matrix${reference.matrix.length}.`);
