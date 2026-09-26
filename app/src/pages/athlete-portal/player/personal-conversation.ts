import { EQUIPMENT } from '../../../lib/contracts/types';
import type { Row } from './execution';

const EQUIPMENT_WORDS: Record<string, string> = {
  ball: '(?:footballs?|soccer balls?|balls?)', cones: 'cones?', markers: '(?:flat )?markers?', wall: 'walls?', goal: 'goals?',
  hurdles: 'hurdles?', box: '(?:exercise |plyo )?box(?:es)?', sledOrBand: '(?:sleds?|sprint bands?|sled or band)',
  timer: 'timers?', bench: '(?:exercise )?bench(?:es)?', mat: '(?:(?:exercise|yoga) )?mats?', kneePad: 'knee pads?',
  tapeMeasure: '(?:tape measures?|measuring tapes?)', cueDevice: 'cue devices?', dumbbells: 'dumbbells?', barbell: 'barbells?',
  weightPlates: 'weight plates?', squatRack: 'squat racks?', trapBar: 'trap bars?', kettlebell: 'kettlebells?',
  cableMachine: 'cable machines?', resistanceBand: 'resistance bands?', medicineBall: 'medicine balls?',
  pullUpBar: 'pull[ -]?up bars?', legCurlMachine: 'leg[ -]?curl machines?', legPressMachine: 'leg[ -]?press machines?',
  jumpRope: 'jump ropes?', sliders: 'sliders?',
};
// These are suggestions for the visible setup, never confirmation. In particular,
// negated availability removes a resource and an ordinary drill request grants none.
export function equipmentChanges(text: string): { add: string[]; remove: string[]; replace: boolean } {
  const add = new Set<string>(), remove = new Set<string>();
  const none = /\b(?:no equipment|without (?:any )?equipment|no (?:access to )?any equipment)\b/i.test(text);
  let replace = none || /\b(?:only have|have only|with only|with just)\b/i.test(text);
  const clauses = text.replace(/[’]/g, "'").split(/[.!?;\n]|\bbut\b/i);
  for (const clause of clauses) {
    const ownership = /\b(?:I (?:have|own)|I've got|using|with only|with just|access to|only have|have only)\b/i.test(clause) || /\bequipment\s*[:=]/i.test(clause);
    for (const equipment of EQUIPMENT) {
      const words = EQUIPMENT_WORDS[equipment];
      for (const match of clause.matchAll(new RegExp(`\\b(?:${words})\\b`, 'gi'))) {
        // A medicine ball is not evidence of an ordinary football.
        if (equipment === 'ball' && /medicine\s+$/i.test(clause.slice(0, match.index))) continue;
        const prefix = clause.slice(0, match.index);
        const negative = /\b(?:no|without|not|don't|do not|cannot|can't|unavailable|lack)\b[^,;.!?]*$/i.test(prefix)
          || /^\s*(?:is |are )?(?:unavailable|missing|not available|not accessible|isn't available|aren't available)\b/i.test(clause.slice(match.index! + match[0].length));
        if (negative || none) { remove.add(equipment); add.delete(equipment); }
        else if (ownership) { add.add(equipment); remove.delete(equipment); }
      }
    }
  }
  if (none) { add.clear(); replace = true; }
  return { add: EQUIPMENT.filter(e => add.has(e)), remove: EQUIPMENT.filter(e => remove.has(e)), replace };
}
export function applyEquipmentChanges(previous: string[], text: string): string[] {
  const changes = equipmentChanges(text);
  return [...new Set([...(changes.replace ? [] : previous), ...changes.add])].filter(e => !changes.remove.includes(e)).sort();
}

// Prefill only explicit statements. Unknown conditions remain questions; a
// request mentioning a drill is not evidence that its equipment is available.
export function suppliedWorkoutConditions(text: string, suppliedMinutes?: number): Row {
  const minutes = [...text.matchAll(/\b(\d{1,3})\s*(?:-\s*)?(?:minutes?|mins?)\b/gi)].at(-1);
  const target = minutes ? Number(minutes[1]) : suppliedMinutes;
  const age = text.match(/\b(?:I(?:'m| am)|aged?)\s+(\d{1,2})\b(?!\s*(?:-\s*)?(?:minutes?|mins?|hours?|seconds?)\b)(?:\s*(?:years? old|year-old))?/i);
  const setting = /\b(?:alone|solo|by myself|just me|no partner)\b/i.test(text) ? 'solo'
    : /\b(?:with (?:a |my )?partner|with (?:a |my )?friend|partner available)\b/i.test(text) ? 'partner' : undefined;
  const changes = equipmentChanges(text), noEquipment = changes.replace && !changes.add.length;
  const equipment = changes.add;
  const painPresent = /\b(?:I have|I've got|with|feeling|experiencing)\s+(?:(?:some|a little|knee|ankle|back|hip|leg|shoulder)\s+)?pain\b|\b(?:hurts|injured|painful)\b/i.test(text);
  const painFree = !painPresent && /\b(?:no pain(?: or restrictions?)?|pain[- ]free|no restrictions?)\b/i.test(text);
  return { ...(Number.isInteger(target) && target! >= 1 && target! <= 135 ? { minutes: target } : {}),
    ...(age && Number(age[1]) >= 5 && Number(age[1]) <= 80 ? { age: Number(age[1]) } : {}),
    ...(setting ? { setting } : {}), ...(noEquipment || equipment.length ? { equipment: noEquipment ? [] : equipment } : {}),
    ...(painPresent ? { painAnswer: 'yes' } : painFree ? { painAnswer: 'no' } : {}) };
}

export function personalDraftLink(search: string, conversationId?: string, workoutId?: string) {
  const params = new URLSearchParams(search);
  params.set('view', 'training');
  ['drill', 'session', 'rep', 'personalConversation', 'personalWorkout'].forEach(k => params.delete(k));
  if (conversationId) params.set('personalConversation', conversationId);
  if (workoutId) params.set('personalWorkout', workoutId);
  return params.toString();
}
