import { EQUIPMENT } from '../../../lib/contracts/types';
import type { Row } from './execution';

// Prefill only explicit statements. Unknown conditions remain questions; a
// request mentioning a drill is not evidence that its equipment is available.
export function suppliedWorkoutConditions(text: string, suppliedMinutes?: number): Row {
  const minutes = [...text.matchAll(/\b(\d{1,3})\s*(?:-\s*)?(?:minutes?|mins?)\b/gi)].at(-1);
  const target = minutes ? Number(minutes[1]) : suppliedMinutes;
  const age = text.match(/\b(?:I(?:'m| am)|aged?)\s+(\d{1,2})\b(?!\s*(?:-\s*)?(?:minutes?|mins?|hours?|seconds?)\b)(?:\s*(?:years? old|year-old))?/i);
  const setting = /\b(?:alone|solo|by myself|just me|no partner)\b/i.test(text) ? 'solo'
    : /\b(?:with (?:a |my )?partner|with (?:a |my )?friend|partner available)\b/i.test(text) ? 'partner' : undefined;
  const noEquipment = /\b(?:no equipment|without any equipment)\b/i.test(text);
  const statements = [...text.matchAll(/\b(?:I have|I've got|equipment\s*[:=]|using|with only|with just)\s+([^.!?;\n]+)/gi)].map(m => m[1]).join(' ');
  const equipment = EQUIPMENT.filter(e => new RegExp(`\\b${e.replace(/([A-Z])/g, ' $1')}s?\\b`, 'i').test(statements)
    && !new RegExp(`\\b(?:no|without)\\s+(?:a\\s+)?${e}s?\\b`, 'i').test(statements));
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
