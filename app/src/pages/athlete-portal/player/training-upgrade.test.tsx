import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../../../lib/firebase', () => ({ default: {}, auth: { currentUser: { uid: 'athlete-auth' } }, db: {}, cloud: {}, storage: {} }));
import { canMutateWorkout, restoreRuntime, resumeIndex, runtimeKey, runtimeSnapshot } from './workout-runtime';
import { elapsed, IDLE_MS, interactClock, newClock, pauseClock, reconcileClock, restSeconds, resumeClock, validClock } from './clock';
import { savedWorkout, unfinishedWorkout } from './execution';
import { weekProgress } from './progress';
import { recordedSessionLink, SavedPlanDetails } from './training-details';
import PlayerWorkout from './PlayerWorkout';

const blocks = [{ blockId: 'a', drillId: 'DRB-001', name: 'Control', sets: 2, restSeconds: 60 }, { blockId: 'b', drillId: 'PAS-001', name: 'Passing', sets: 2 }];
const owner = { uid: 'athlete-auth', playerId: 'player-doc', logId: 'old_slot', planId: 'old', workoutRevision: 3 };
const log = () => ({ id: 'old_slot', schemaVersion: 2, planId: 'old', weekNumber: 1, workoutId: 'slot', source: 'plan', workoutRevision: 3, startedAt: new Date(1000), workoutSnapshot: { title: 'Saved prescription', blocks }, blocks: [] });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('durable workout position and pauses', () => {
  it('restores the selected drill and frozen rest, including after a route-leave pause', () => {
    const working = { ...newClock(1000), restUntil: 61000, restTotal: 60 };
    const paused = pauseClock(working, 15500);
    const saved = runtimeSnapshot(owner, blocks, 1, paused);
    const restored = restoreRuntime(JSON.parse(JSON.stringify(saved)), owner, blocks, log(), 90000)!;
    expect(restored.index).toBe(1); expect(restSeconds(restored.clock, 90000)).toBe(46);
    expect(elapsed(restored.clock, 90000)).toBe(14.5);
    expect(canMutateWorkout(restored.clock, false, false, 90000)).toBe(false);
    const resumed = resumeClock(restored.clock, 90000);
    expect(restSeconds(resumed, 90500)).toBe(45);
    expect(canMutateWorkout(resumed, false, false, 90500)).toBe(true);
  });
  it('rejects another account, player, log, prescription or removed drill', () => {
    const saved = runtimeSnapshot(owner, blocks, 1, newClock(1000));
    for (const changed of [{ uid: 'other' }, { playerId: 'other' }, { logId: 'other' }, { planId: 'other' }, { workoutRevision: 4 }]) {
      expect(restoreRuntime(saved, { ...owner, ...changed }, blocks, log(), 2000)).toBeNull();
    }
    expect(restoreRuntime(saved, owner, blocks.slice(0, 1), log(), 2000)).toBeNull();
    expect(restoreRuntime(saved, owner, blocks, { ...log(), endedAt: 2000 }, 2000)).toBeNull();
    expect(runtimeKey(owner)).not.toBe(runtimeKey({ ...owner, uid: 'other' }));
  });
  it('rejects corrupt clocks and unrecognized runtime versions', () => {
    for (const clock of [null, {}, { ...newClock(1000), seconds: -1 }, { ...newClock(1000), frozenRest: '60' }, { ...newClock(1000), restTotal: Infinity }]) expect(validClock(clock)).toBe(false);
    expect(restoreRuntime({ ...runtimeSnapshot(owner, blocks, 0, newClock(1000)), schemaVersion: 2 }, owner, blocks, log(), 2000)).toBeNull();
  });
  it('does not infer complete timer coverage for a resumed workout from another device', () => {
    expect(restoreRuntime(runtimeSnapshot(owner, blocks, 0, newClock(1000)), owner, blocks, log(), 2000)?.timerStartedHere).toBe(false);
    expect(restoreRuntime(runtimeSnapshot(owner, blocks, 0, newClock(1000), true), owner, blocks, log(), 2000)?.timerStartedHere).toBe(true);
  });
  it('keeps completed-but-unended workouts on their last drill', () => {
    const all = { ...log(), blocks: [{ blockId: 'a', status: 'done' }, { blockId: 'b', status: 'skipped' }] };
    expect(resumeIndex(blocks, all)).toBe(1);
    expect(resumeIndex(blocks, { ...all, blocks: [{ blockId: 'a', status: 'done' }] })).toBe(1);
    expect(resumeIndex([], all)).toBe(0);
  });
  it('requires explicit resume after inactivity and rejects mutations during saves or after finish', () => {
    const c = newClock(1000), now = 1000 + IDLE_MS + 100;
    expect(canMutateWorkout(c, false, false, now)).toBe(false);
    expect(interactClock(c, now).pauseReason).toBe('inactivity');
    const resumed = resumeClock(reconcileClock(c, now), now);
    expect(elapsed(resumed, now + 1000)).toBe(1801);
    expect(canMutateWorkout(resumed, true, false, now)).toBe(false);
    expect(canMutateWorkout(resumed, false, true, now)).toBe(false);
  });
  it('cannot extend prescribed rest or reduce time after a backward clock adjustment', () => {
    const c = { ...newClock(1000), seconds: 7, restUntil: 61000, restTotal: 60 };
    expect(restSeconds(c, 0)).toBe(60);
    const paused = pauseClock(c, 0);
    expect(elapsed(paused, 0)).toBe(7); expect(restSeconds(paused, 0)).toBe(60);
  });
});

describe('cross-plan training evidence', () => {
  const plan = { id: 'current', startDate: '2026-09-07', timezone: 'America/Los_Angeles', weeks: [{ weekNumber: 1, workouts: [{ workoutId: 'slot', blocks }], targets: [{ domain: 'dribbling', exposures: 2 }], allocations: [{ domain: 'dribbling', minutes: 20 }, { domain: 'strength', minutes: 10 }] }] };
  const adhoc = { ...log(), id: 'extra', source: 'adhoc', startedAt: new Date('2026-09-08T12:00:00Z'), blocks: [{ blockId: 'a', drillId: 'DRB-001', domain: 'dribbling', status: 'partial', estimatedMinutes: 9 }] };
  it('credits same-week ad-hoc work from an earlier plan once, including allocation-only domains', () => {
    const progress = weekProgress(plan, plan.weeks[0], [adhoc, adhoc], [], []);
    expect(progress.minutes).toBe(4);
    expect(progress.domains.find(d => d.domain === 'dribbling')).toMatchObject({ done: 1, target: 2, minutes: 4, minutesRemaining: 16 });
    expect(progress.domains.find(d => d.domain === 'strength')).toMatchObject({ done: 0, minutes: 0, targetMinutes: 10, minutesRemaining: 10 });
  });
  it('does not credit old scheduled slots or ad-hoc work outside local calendar bounds', () => {
    const rows = [{ ...adhoc, source: 'plan' }, { ...adhoc, id: 'before', startedAt: new Date('2026-09-07T06:59:59Z') }, { ...adhoc, id: 'after', startedAt: new Date('2026-09-14T07:00:00Z') }];
    expect(weekProgress(plan, plan.weeks[0], rows, [], []).minutes).toBe(0);
    expect(weekProgress(plan, plan.weeks[0], [{ ...adhoc, startedAt: new Date('2026-09-07T07:00:00Z') }], [], []).minutes).toBe(4);
  });
  it('keeps an old snapshot reviewable and selects the earliest unfinished log without reopening finished work', () => {
    const old = log(), finished = { ...old, id: 'finished', endedAt: new Date(2000) };
    expect(savedWorkout(old)?.blocks).toEqual(blocks);
    expect(unfinishedWorkout([finished, { ...old, id: 'later', startedAt: new Date(3000) }, old])?.id).toBe('old_slot');
    expect(unfinishedWorkout([finished, { id: 'legacy' }])).toBeNull();
  });
});

describe('player-facing details and control states', () => {
  it('shows only saved evidence and keeps confidence, gaps and equipment visible', () => {
    const html = renderToStaticMarkup(<SavedPlanDetails plan={{ horizonWeeks: 2, intake: { goals: [], equipment: ['ball'], setting: 'solo' }, assessment: { summary: 'Saved summary', findings: [{ domain: 'speed', statement: 'Saved finding', confidence: 'low' }], dataGaps: ['No complete sprint test'], methodologyVersion: 'evidence-objectives-v1', priorities: [{ id: 'p', label: 'Close control', reason: 'Reviewed recording', rank: 1, role: 'support', evidenceBasis: 'conditionalEstimate', confidence: 'low', progressCheck: 'Retest the complete course' }] } }} />);
    expect(html).toContain('low confidence'); expect(html).toContain('No complete sprint test');
    expect(html).toContain('Conditional estimate'); expect(html).toContain('Retest the complete course');
    expect(html).toContain('Equipment: Ball'); expect(html).not.toContain('undefined');
  });
  it('creates explicit player/session routes and rejects unknown or missing references', () => {
    const link = recordedSessionLink({ drillType: 'deadballShot', sessionNumber: 3 }, 'canonical player', true)!;
    const query = new URL(link, 'https://posetek.net').searchParams;
    expect(query.get('player')).toBe('canonical player'); expect(query.get('drill')).toBe('shooting'); expect(query.get('session')).toBe('session3'); expect(query.get('preview')).toBe('1');
    expect(recordedSessionLink({ drillType: 'unknown', sessionNumber: 3 }, 'p')).toBeNull();
    expect(recordedSessionLink({ drillType: 'sprint' }, 'p')).toBeNull();
  });
  it('renders restored pause controls disabled and preserves the chosen drill', () => {
    vi.useFakeTimers(); vi.setSystemTime(90000);
    const saved = runtimeSnapshot(owner, blocks, 1, pauseClock(newClock(1000), 2000));
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === runtimeKey(owner) ? JSON.stringify(saved) : null });
    const workout = savedWorkout(log())!;
    const store = { logFor: () => log(), saving: false } as any;
    const html = renderToStaticMarkup(<MemoryRouter><PlayerWorkout workout={workout} store={store} playerId="player-doc" preview={false} onExit={() => {}} /></MemoryRouter>);
    expect(html).toContain('Workout paused. Resume to continue.'); expect(html).toContain('Drill 2 of 2');
    expect(html.match(/<button[^>]*>Complete set 1<\/button>/)?.[0]).toContain('disabled');
    expect(html.match(/<button[^>]*>Skip drill<\/button>/)?.[0]).toContain('disabled');
  });
  it('offers sharing only from a saved workout and never publishes as part of rendering', () => {
    const finish = vi.fn(); const store = { logFor: () => ({ ...log(), endedAt: new Date() }), finish } as any;
    const html = renderToStaticMarkup(<MemoryRouter><PlayerWorkout workout={savedWorkout(log())!} store={store} playerId="player-doc" preview onExit={() => {}} /></MemoryRouter>);
    expect(html).toContain('Workout saved'); expect(html).toContain('/feed?scope=mine&amp;preview=1'); expect(finish).not.toHaveBeenCalled();
  });
});
