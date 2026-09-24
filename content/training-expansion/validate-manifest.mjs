import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
export const expectedCategories={strength:28,isometric:12,plyometric:16,speedCod:12,ball:12};
const weekly={strength:7,isometric:3,plyometric:4,speedCod:3,ball:3};
const domains=new Set(['ballMastery','dribbling','passing','receiving','shooting','speed','agility','plyometrics','strength','games']);
const equipment=new Set(['ball','cones','markers','wall','goal','hurdles','box','sledOrBand','timer','bench','mat','kneePad','tapeMeasure','cueDevice','dumbbells','barbell','weightPlates','squatRack','trapBar','kettlebell','cableMachine','resistanceBand','medicineBall','pullUpBar','legCurlMachine','legPressMachine','jumpRope','sliders']);
const repUnits=new Set(['reps','seconds','minutes','meters','contacts','cues','passes','shots']);
const families=new Set(['knee','hip','hamstring','adductor','calf','trunk','upperPush','upperPull']);
const objectives=new Set(['shooting_speed','short_sprint','vertical_jump','horizontal_jump','dribble_completion','planned_change_direction']);
const slots=['primaryDemo','teachingDetail','errorCorrection'];
const cleanName=s=>String(s).toLowerCase().replace(/[^a-z0-9]/g,'');
export function validateManifest(manifest,sources,reference){
  const errors=[];
  const check=(ok,message)=>{if(!ok)errors.push(message);};
  const rows=manifest.drills??[];
  const sourceMap=new Map(sources.sources.map(s=>[s.id,s]));
  const knownIds=new Set([...reference.live,...reference.matrix].map(r=>r.id));
  const existingNames=new Set([...reference.live,...reference.matrix].map(r=>cleanName(r.name)));
  check(rows.length===80,'Manifest must contain exactly80 NEW drills.');
  check(manifest.status==='draft'&&manifest.humanContentReview==='pending','Batch must remain draft with human content review pending.');
  check(reference.live.length>=128&&reference.matrix.length===85,'Compare against all128 live entries and85 matrix rows.');
  check(new Set(rows.map(r=>r.manifestId)).size===rows.length,'Manifest keys must be unique.');
  check(new Set(rows.map(r=>r.proposedDrillId)).size===rows.length,'Proposed IDs must be unique.');
  check(new Set(rows.map(r=>cleanName(r.drill?.name))).size===rows.length,'Exercise names must be unique.');
  for(const [cat,count] of Object.entries(expectedCategories))check(rows.filter(r=>r.category===cat).length===count,`${cat} must contain${count} drills.`);
  for(let week=1;week<=4;week++){
    const wk=rows.filter(r=>r.filmingWeek===week);
    check(wk.length===20,`Week${week} must have20 complete packages.`);
    for(const [cat,count] of Object.entries(weekly))check(wk.filter(r=>r.category===cat).length===count,`Week${week} needs${count} ${cat}.`);
  }
  for(const [index,row] of rows.entries()){
    const d=row.drill??{},a=row.authoring??{},p=d.trainingPolicy??{},dose=d.dose??{};
    const label=`${row.manifestId} ${d.name}`;
    const verify=(ok,msg)=>check(ok,`${label}: ${msg}`);
    verify(row.manifestId===`wb-${String(index+1).padStart(3,'0')}`,'immutable keys must follow the authored weekly sequence.');
    verify(!knownIds.has(row.proposedDrillId),'proposed ID collides with captured catalog/matrix.');
    verify(!existingNames.has(cleanName(d.name)),'existing name cannot count as a new drill.');
    verify(d.drillId===row.proposedDrillId&&/^[A-Z]{3}-[5-9]\d\d$/.test(d.drillId),'schema drillId must match the advisory domain ID>=501.');
    verify(d.schemaVersion===2&&d.status==='draft','schema2 draft required.');
    verify(d.minAge===10&&d.maxAge===18,'target age envelope10-18 required.');
    verify(domains.has(d.domain),'unsupported catalog domain.');
    verify(typeof d.name==='string'&&d.name.length>0&&d.name.length<=80,'name limit80.');
    verify(typeof d.howTo?.setup==='string'&&d.howTo.setup.length>30&&d.howTo.setup.length<=400,'setup must be meaningful and<=400chars.');
    verify(Array.isArray(d.howTo?.steps)&&d.howTo.steps.length>=3&&d.howTo.steps.length<=12&&d.howTo.steps.every(s=>s.length>10&&s.length<=240),'three or more real steps, each<=240chars.');
    verify(Array.isArray(d.equipment)&&d.equipment.every(x=>equipment.has(x)),'unknown equipment token.');
    verify(typeof d.requiresPartner==='boolean'&&d.positionSpecific===null,'explicit partner setting and no unsupported position restriction.');
    verify(Number.isInteger(d.difficultyLevel)&&d.difficultyLevel>=1&&d.difficultyLevel<=5,'difficulty range1-5.');
    verify(d.coachComments?.length>=3&&d.coachComments.length<=8&&d.coachComments.every(s=>s.length<=200),'coach-comment count/length.');
    verify(d.adaptiveLevers?.length===2&&d.adaptiveLevers.every(s=>s.length<=200),'separate bounded regression/progression required.');
    verify(Object.keys(d.media??{}).length===0,'unfilmed draft cannot contain media or fake placeholders.');
    verify(repUnits.has(dose.repUnit),'invalid dose unit.');
    for(const [min,max] of [['setsMin','setsMax'],['repsMin','repsMax'],['restSecondsMin','restSecondsMax']])verify(Number.isFinite(dose[min])&&Number.isFinite(dose[max])&&dose[min]>=0&&dose[max]>=dose[min],`invalid bounds${min}/${max}.`);
    verify(dose.setsMin>=1&&dose.repsMin>=1,'positive sets and amount.');
    verify(['sets','reps'].includes(dose.restScope),'valid explicit rest scope required.');
    if(['seconds','minutes','meters'].includes(dose.repUnit))verify(dose.restScope==='sets','continuous effort cannot have per-rep rest.');
    if(dose.restScope==='reps')verify(dose.restBetweenSetsSecondsMin>=0&&dose.restBetweenSetsSecondsMax>=dose.restBetweenSetsSecondsMin,'per-rep rest requires valid between-set rest.');
    verify(p.version==='whole-body-v1'&&p.reviewStatus==='pending'&&p.progression==='coachReviewed','policy version/review/progression required.');
    verify(p.requiresClearance===true&&p.supervision==='clearance','all80 must require coach clearance.');
    verify(p.loadFamilies?.length>0&&p.loadFamilies.every(f=>families.has(f)),'unsupported load family.');
    verify(typeof p.loaded==='boolean'&&typeof p.loadingInstructions==='string'&&p.loadingInstructions.length>40,'explicit individualized loading policy.');
    if(['strength','isometric','plyometric'].includes(row.category))verify(p.requiresVerifiedMobile===true,'new strength/power requires a verified capable mobile client.');
    verify(p.limits?.setsPerSession===dose.setsMax&&p.limits.setsPerWeek>=dose.setsMax,'sets limits must agree with draft dose.');
    const multiplier=dose.perSide?2:1;
    if(row.category==='plyometric')verify(p.limits.contactsPerSession===dose.setsMax*dose.repsMax*multiplier&&p.limits.contactsPerWeek===p.limits.contactsPerSession*2,'contact caps must include both sides.');
    if(row.category==='isometric')verify(p.limits.holdSecondsPerSession===dose.setsMax*dose.repsMax*multiplier&&p.limits.holdSecondsPerWeek===p.limits.holdSecondsPerSession*2,'hold caps must include both sides.');
    verify(a.reviewStatus==='pending'&&a.publicationHold==='Awaiting content review and three approved videos.','private authoring must retain review and publication hold.');
    verify(a.review?.researchStatus==='reviewed'&&a.review.qualifiedReviewer===null&&a.review.reviewedAt===null,'do not claim qualified human approval.');
    verify(a.reviewedDosePolicy?.status==='pending','draft doses remain pending qualified review.');
    verify(a.filmingWeek===row.filmingWeek&&a.manifestId===row.manifestId,'authoring identity/week must match.');
    verify(slots.every(s=>typeof a.filmingInstructions?.[s]==='string'&&a.filmingInstructions[s].length>120),'all3 real clip briefs required.');
    verify(a.package?.requiredSlots?.join(',')===slots.join(',')&&slots.every(s=>a.package?.clips?.[s]==='notFilmed'),'all3 media slots must remain unfilmed.');
    verify(a.evidence?.sourceIds?.length>=2&&a.evidence.sourceIds.every(id=>sourceMap.has(id)),'evidence must reference known primary/official sources.');
    verify(a.evidence?.limitations?.length>70,'specific evidence limits are required.');
    verify(a.distinctness?.rationale?.length>60&&Array.isArray(a.distinctness.comparedWith),'explain why this is new rather than a renamed drill.');
    verify(a.distinctness?.comparedWith?.every(id=>knownIds.has(id)),'comparison IDs must exist in captured references.');
    verify(a.sources?.every(s=>sourceMap.has(s.id)&&s.url===sourceMap.get(s.id).url),'full source cards must match the reviewed registry.');
    for(const link of p.evidenceLinks??[])verify(objectives.has(link.objectiveId)&&['direct','support'].includes(link.relationship)&&[0.5,1].includes(link.weight)&&link.sourceIds.every(id=>sourceMap.has(id)),'invalid objective link.');
    if(a.evidence?.testRelationship==='general')verify(p.evidenceLinks?.length===0,'general support must not invent a six-test objective.');
  }
  return errors;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const manifest=JSON.parse(fs.readFileSync(path.join(here,'manifest.json'),'utf8'));
  const sources=JSON.parse(fs.readFileSync(path.join(here,'sources.json'),'utf8'));
  const reference=JSON.parse(fs.readFileSync(path.join(here,'deduplication-reference.json'),'utf8'));
  const errors=validateManifest(manifest,sources,reference);
  if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}
  else console.log('PASS:80 distinct draft records;4 balanced weeks;240 clip briefs;schema/dose/evidence/readiness gates;128live+85matrix comparison.');
}
