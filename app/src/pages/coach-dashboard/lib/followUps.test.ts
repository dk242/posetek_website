import { describe, expect, it } from 'vitest';
import { athleteSummary } from './logic';
import { coachFollowUps } from './followUps';

const now = new Date('2026-09-26T12:00:00Z');
const player = { id: 'one', firstName: 'Sam', lastName: 'Example' };
const active = [{ id: 'plan', status: 'active', generatedAt: now }];
const log = (day: string, endReason: string, extras = {}) => ({ id: day + endReason,
  workoutId: day + endReason, startedAt: new Date(day + 'T11:30:00Z'),
  endedAt: new Date(day + 'T12:00:00Z'), endReason, ...extras });

describe('coach follow-ups from saved data', () => {
  it('shows current missing plan and dated pain or early endings in the last 30 days', () => {
    const summary = athleteSummary(player, [], [], [log('2026-09-24', 'pain'), log('2026-09-23', 'endedEarly'),
      log('2026-08-01', 'pain'), log('2026-09-25', 'completed')]);
    expect(coachFollowUps([summary], now).map(row => row.kind)).toEqual(['pain', 'endedEarly', 'noPlan']);
  });
  it('does not infer inactivity or abandonment from missing or unfinished logs', () => {
    const summary = athleteSummary(player, [], active, [{ startedAt: new Date('2026-09-20'), endReason: 'pain' }]);
    expect(coachFollowUps([summary], now)).toEqual([]);
  });
  it('flags recorded skipped-set pain while preserving an active plan', () => {
    const summary = athleteSummary(player, [], active, [log('2026-09-25', 'completed',
      { blocks: [{ blockId: 'one', status: 'skipped', skipReason: 'pain' }] })]);
    expect(coachFollowUps([summary], now).map(row => row.kind)).toEqual(['pain']);
  });
  it('keeps pain from a newer duplicate even when an older log has the saved prescription', () => {
    const earlier = { ...log('2026-09-23', 'completed'), id: 'old', workoutId: 'same', workoutSnapshot: { blocks: [] } };
    const later = { ...log('2026-09-24', 'pain'), id: 'new', workoutId: 'same' };
    const summary = athleteSummary(player, [], active, [earlier, later]);
    expect(coachFollowUps([summary], now).map(row => row.kind)).toEqual(['pain']);
  });
});
