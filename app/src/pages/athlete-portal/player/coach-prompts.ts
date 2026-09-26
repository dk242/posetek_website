import type { Row } from './execution';

export function coachPrompts(capability: string, target?: Row): string[] {
  if (capability === 'coaching_chat') return ['Explain this drill step by step', 'What should I focus on during each set?', 'How can I tell if I am doing this correctly?'];
  if (capability === 'workout_chat') return target?.kind === 'new'
    ? ['Build a session for the time I have', 'I have only a ball and a small space', 'Give me a lighter session today']
    : ['Shorten this workout to 20 minutes', 'Suggest an alternative with less equipment', 'Explain why these drills are in my workout'];
  return ['Help me plan 20 minutes of training', 'Explain my next assigned workout', 'How has my training progressed?'];
}

export function coachToolStatus(name: unknown, finished: boolean): string {
  const label = typeof name === 'string' && /catalog|drill/.test(name) ? 'suitable exercises'
    : typeof name === 'string' && /plan|workout|schedule/.test(name) ? 'your training'
    : typeof name === 'string' && /result|stat|evidence/.test(name) ? 'your progress' : 'your request';
  return `${finished ? 'Checked' : 'Checking'} ${label}${finished ? '.' : '…'}`;
}
