"use strict";
// Same strict catalog boundary for draft edits, content review and publication.
// Keep vocabulary aligned with app/src/lib/contracts/types.ts and whole_body.py.
const DOMAINS = ['ballMastery','dribbling','passing','receiving','shooting','speed','agility','plyometrics','strength','games'];
const EQUIPMENT = ['ball','cones','markers','wall','goal','hurdles','box','sledOrBand','timer','bench','mat','kneePad','tapeMeasure','cueDevice','dumbbells','barbell','weightPlates','squatRack','trapBar','kettlebell','cableMachine','resistanceBand','medicineBall','pullUpBar','legCurlMachine','legPressMachine','jumpRope','sliders'];
const FAMILIES = ['knee','hip','hamstring','adductor','calf','trunk','upperPush','upperPull'];
const OBJECTIVES = ['shooting_speed','short_sprint','vertical_jump','horizontal_jump','dribble_completion','planned_change_direction'];
const DOSE_KEYS = ['setsMin','setsMax','repsMin','repsMax','repUnit','perSide','doseText','restSecondsMin','restSecondsMax','restText','restScope','restBetweenSetsSecondsMin','restBetweenSetsSecondsMax','familiarizationReps','doseNote'];
const EDITABLE = ['name','domain','minAge','maxAge','difficultyLevel','equipment','requiresPartner','positionSpecific','howTo','dose','maxFrequencyPerWeek','coachComments','adaptiveLevers','status'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validateTrainingDrill(d, fail) {
  const check = (ok, message) => { if (!ok) fail('invalid-argument', message); };
  const int = (n, low, high) => Number.isInteger(n) && n >= low && n <= high;
  const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
  const list = (v, max, chars, minimum=0) => Array.isArray(v) && v.length >= minimum && v.length <= max && v.every(x => text(x, chars));
  check(d.schemaVersion === 2 && DOMAINS.includes(d.domain), 'Use schema 2 and a canonical catalog domain.');
  check(text(d.name,80) && int(d.minAge,10,18) && int(d.maxAge,d.minAge,18) && int(d.difficultyLevel,1,5), 'Provide a name of at most 80 characters, ages 10–18 and difficulty 1–5.');
  check(Array.isArray(d.equipment) && d.equipment.length <= EQUIPMENT.length && new Set(d.equipment).size === d.equipment.length && d.equipment.every(e => EQUIPMENT.includes(e)), 'Choose known, nonduplicated equipment.');
  check(typeof d.requiresPartner === 'boolean' && (d.positionSpecific == null || ['GK','CB','FB','DM','CM','AM','W','ST'].includes(d.positionSpecific)), 'Choose valid partner and position requirements.');
  check(object(d.howTo) && Object.keys(d.howTo).every(k => ['setup','steps'].includes(k)) && text(d.howTo.setup,400) && list(d.howTo.steps,12,240,1), 'Provide setup of at most 400 characters and 1–12 steps of at most 240 characters.');
  check(list(d.coachComments,8,200) && list(d.adaptiveLevers,6,200) && int(d.maxFrequencyPerWeek,1,7), 'Use bounded coaching notes, adaptations and weekly frequency.');
  check(['draft','archived','published'].includes(d.status), 'Choose a valid catalog status.');
  const dose=d.dose;
  check(object(dose) && Object.keys(dose).every(k => DOSE_KEYS.includes(k)), 'Use the supported dose fields.');
  check(['reps','seconds','minutes','meters','contacts','cues','passes','shots'].includes(dose.repUnit) && typeof dose.perSide === 'boolean', 'Specify a valid amount unit and per-side setting.');
  for (const [low,high,min,max] of [['setsMin','setsMax',1,20],['repsMin','repsMax',1,1000],['restSecondsMin','restSecondsMax',0,3600]]) {
    check(int(dose[low],min,max) && int(dose[high],dose[low],max), `Provide bounded, ordered ${low}/${high}.`);
  }
  check(['sets','reps'].includes(dose.restScope), 'Specify whether rest is between repetitions or sets.');
  check(!['seconds','minutes','meters'].includes(dose.repUnit) || dose.restScope === 'sets', 'Continuous efforts cannot use per-repetition rest.');
  const between = ['restBetweenSetsSecondsMin','restBetweenSetsSecondsMax'];
  if (dose.restScope === 'reps' || between.some(k => dose[k] != null)) check(int(dose[between[0]],0,3600) && int(dose[between[1]],dose[between[0]],3600), 'Specify bounded between-set rest.');
  check(dose.familiarizationReps == null || int(dose.familiarizationReps,0,100), 'Familiarization repetitions must be a bounded integer.');
  check(!['seconds','minutes','meters'].includes(dose.repUnit) || !dose.familiarizationReps, 'Continuous efforts cannot include familiarization repetition counts.');
  for(const key of ['doseText','restText','doseNote']) check(dose[key] == null || (typeof dose[key] === 'string' && dose[key].length <= 500), 'Dose descriptions must be at most 500 characters.');
  const p=d.trainingPolicy;
  check(object(p) && p.version === 'whole-body-v1' && ['resistance','isometric','plyometric','speed','agility','ball','mobility'].includes(p.modality), 'Provide a supported training policy.');
  check(['pending','approved'].includes(p.reviewStatus) && p.progression === 'coachReviewed' && p.requiresClearance === true && p.supervision === 'clearance', 'This batch requires coach clearance and reviewed progression.');
  check(typeof p.loaded === 'boolean' && typeof p.requiresVerifiedMobile === 'boolean' && text(p.loadingInstructions,500), 'Provide bounded loading instructions and explicit delivery requirements.');
  check(!p.loaded || p.requiresVerifiedMobile, 'Loaded exercises require verified mobile delivery.');
  check(!['resistance','isometric','plyometric'].includes(p.modality) || p.requiresVerifiedMobile, 'Strength, isometric and plyometric exercises require verified mobile delivery.');
  check(Array.isArray(p.loadFamilies) && p.loadFamilies.length > 0 && new Set(p.loadFamilies).size === p.loadFamilies.length && p.loadFamilies.every(f => FAMILIES.includes(f)), 'Provide known, nonduplicated movement families.');
  const limits=p.limits,limitKeys=['setsPerSession','setsPerWeek','contactsPerSession','contactsPerWeek','holdSecondsPerSession','holdSecondsPerWeek','minRecoveryHours'];
  check(object(limits) && Object.keys(limits).every(k => limitKeys.includes(k)) && Object.values(limits).every(v => int(v,0,100000)) && int(limits.setsPerSession,1,100000) && int(limits.setsPerWeek,limits.setsPerSession,100000) && int(limits.minRecoveryHours,0,168), 'Provide complete bounded training limits.');
  check(dose.setsMax <= limits.setsPerSession && dose.setsMax <= limits.setsPerWeek, 'Dose exceeds the reviewed set limits.');
  const exposure=dose.setsMax*dose.repsMax*(dose.perSide?2:1);
  if(p.modality === 'plyometric') check(['reps','contacts'].includes(dose.repUnit) && int(limits.contactsPerSession,exposure,100000) && int(limits.contactsPerWeek,limits.contactsPerSession,100000), 'Plyometric contact limits must include the entire dose and both sides.');
  if(p.modality === 'isometric') check(['seconds','minutes'].includes(dose.repUnit) && int(limits.holdSecondsPerSession,exposure*(dose.repUnit==='minutes'?60:1),100000) && int(limits.holdSecondsPerWeek,limits.holdSecondsPerSession,100000), 'Isometric limits must include total hold seconds and both sides.');
  check(Array.isArray(p.evidenceLinks) && p.evidenceLinks.length <= 12, 'Evidence relationships must be a bounded list.');
  for(const link of p.evidenceLinks) check(object(link) && OBJECTIVES.includes(link.objectiveId) && ['direct','support'].includes(link.relationship) && link.weight === (link.relationship==='direct'?1:0.5) && list(link.sourceIds,20,100,1), 'Evidence relationships must name known objectives and explicit source IDs.');
}
module.exports={validateTrainingDrill,EDITABLE,DOMAINS,EQUIPMENT};
