/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { workoutHistory } from './history';
import { activePlan, trainingTotals } from './logic';

const { workoutEvents } = createRequire(import.meta.url)('../../../../../functions/insights-v2-qualification.js');
const start = new Date('2026-09-20T12:00:00Z'), end = new Date('2026-09-20T14:00:00Z');
const block = { blockId: 'b', name: 'Original drill', sets: 3, dose: { reps: 5 } };
const base = { id: 'one', planId: 'p', workoutId: 'w', startedAt: start, endedAt: end, endReason: 'completed',
  workoutSnapshot: { title: 'Original session', blocks: [block] }, blocks: [{ blockId: 'b', setsCompleted: 2, status: 'partial' }] };

describe('coach outcome parity with Insights V2', () => {
  const scenarios: [string, any[]][] = [
    ['paused timer', [{ ...base, activeSeconds: 600 }]],
    ['zero timer', [{ ...base, activeSeconds: 0 }]],
    ['legacy elapsed estimate', [base]],
    ['invalid timer uses estimate', [{ ...base, activeSeconds: -3 }]],
    ['timer over safety bound', [{ ...base, activeSeconds: 8 * 86400 }]],
    ['duplicate prefers immutable prescription', [base, { ...base, id: 'two', workoutSnapshot: undefined, endedAt: new Date('2026-09-21'), activeSeconds: 999 }]],
    ['newer ending of same pinned prescription', [base, { ...base, id: 'two', endedAt: new Date('2026-09-21'), activeSeconds: 400 }]],
    ['missing ending remains incomplete', [{ ...base, endedAt: null }]],
    ['abandoned', [{ ...base, endReason: 'abandoned' }]],
    ['ended early', [{ ...base, endReason: 'endedEarly' }]],
    ['personal pain ending', [{ ...base, source: 'personal', endReason: 'pain' }]],
    ['personal stopped ending', [{ ...base, source: 'personal', endReason: 'stopped' }]],
    ['legacy unknown ending preserved', [{ ...base, endReason: 'stopped' }]],
    ['unknown ending', [{ ...base, endReason: 'something-old' }]],
    ['unknown time and prescription', [{ id: 'old', endReason: 'completed' }]],
    ['fully completed prescription', [{ ...base, blocks: [{ blockId: 'b', status: 'done', setsCompleted: 3 }] }]],
    ['skipped drill still completed session', [{ ...base, blocks: [{ blockId: 'b', status: 'skipped', setsCompleted: 0, skipReason: 'pain' }] }]],
    ['deduplicated block outcomes', [{ ...base, blocks: [{ blockId: 'b', status: 'done', setsCompleted: 3 }, { blockId: 'b', status: 'partial', setsCompleted: 1 }] }]],
    ['serialized timestamp and epoch', [{ ...base, startedAt: 0, endedAt: { _seconds: 600 } }]],
  ];
  it.each(scenarios)('%s', (_name, logs) => {
    const browser = workoutHistory(logs)[0], server = workoutEvents(logs)[0];
    expect(browser.status).toBe(server.status);
    expect(browser.start).toBe(server.at); expect(browser.end).toBe(server.end);
    expect(browser.duplicateLogs).toBe(server.duplicateLogs);
    expect((browser.timerSeconds ?? 0) / 60).toBe(server.timerMinutes);
    expect((browser.estimatedSeconds ?? 0) / 60).toBe(server.estimatedMinutes);
    expect(Number(browser.prescribedKnown)).toBe(1 - server.unknownPrescription);
    expect(Number(browser.allSetsCompleted)).toBe(server.allPrescribedSetsCompleted);
    expect(browser.setsCompleted).toBe(server.setsCompleted);
    expect(browser.skippedBlocks).toBe(server.skippedBlocks);
  });
  it('does not confuse completed sessions with completed prescribed sets', () => {
    const history = workoutHistory([base]);
    expect(history[0].status).toBe('completed'); expect(history[0].allSetsCompleted).toBe(false);
    expect(history[0].snapshot?.blocks[0].name).toBe('Original drill');
  });
  it('separates timer minutes, estimates and unknown duration while counting linked workouts once', () => {
    const totals = trainingTotals([{ ...base, activeSeconds: 300 }, { ...base, id: 'duplicate', activeSeconds: 600 },
      { id: 'adhoc', source: 'adhoc', workoutId: 'extra', startedAt: start, endedAt: end, endReason: 'endedEarly' },
      { id: 'unstarted', endReason: 'completed' }], []);
    expect(totals.workoutsStarted).toBe(2); expect(totals.workoutsCompleted).toBe(1);
    expect(totals.timerSeconds).toBe(600); expect(totals.estimatedSeconds).toBe(7200); expect(totals.unknownDuration).toBe(1);
  });
  it('never presents a ready draft as active and prefers explicit activation date', () => {
    expect(activePlan([{ id: 'draft', status: 'ready', generatedAt: end }])).toBeNull();
    expect(activePlan([{ id: 'old', status: 'active', generatedAt: end },
      { id: 'reviewed', status: 'active', generatedAt: start, activatedAt: new Date('2026-09-22') }])?.id).toBe('reviewed');
  });
  it('keeps personal sessions separate even if their source workout has the same identity', () => {
    const rows = workoutHistory([base, { ...base, id: 'personal', source: 'personal' },
      { ...base, id: 'extra', source: 'adhoc' }]);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map(row => row.id))).toEqual(new Set(['plan:p:w', 'personal:w', 'adhoc:w']));
  });
});
