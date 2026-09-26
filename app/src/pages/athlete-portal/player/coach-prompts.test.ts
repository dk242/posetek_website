import { describe, expect, it } from 'vitest';
import { coachPrompts, coachToolStatus } from './coach-prompts';

describe('contextual coach entry points', () => {
  it('distinguishes building a session from changing a selected session', () => {
    expect(coachPrompts('workout_chat', { kind: 'new' })[0]).toContain('Build a session');
    expect(coachPrompts('workout_chat', { kind: 'plan' })[0]).toContain('Shorten this workout');
    expect(coachPrompts('coaching_chat')[0]).toContain('this drill');
    expect(coachPrompts('pose_chat')[1]).toContain('assigned workout');
  });
  it('describes work without exposing internal tool identifiers', () => {
    expect(coachToolStatus('load_workout_schedule_v3', false)).toBe('Checking your training…');
    expect(coachToolStatus('read_qualified_results', true)).toBe('Checked your progress.');
    expect(coachToolStatus(undefined, false)).toBe('Checking your request…');
  });
});
