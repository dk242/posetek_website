import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../../../lib/firebase', () => ({ default: {}, auth: { currentUser: { uid: 'athlete-auth' } }, db: {}, cloud: {}, storage: {} }));
import { canMutateWorkout, restoreRuntime, resumeIndex, runtimeKey, runtimeSnapshot } from './workout-runtime';
import { elapsed, IDLE_MS, interactClock, newClock, pauseClock, reconcileClock, restSeconds, resumeClock, validClock, targetWork, workElapsed, startRest, stopRest } from './clock';
import { savedWorkout, unfinishedWorkout } from './execution';
import { weekProgress } from './progress';
import { recordedSessionLink, SavedPlanDetails } from './training-details';
import PlayerWorkout, { timedDose } from './PlayerWorkout';
import { WeekProgress } from './PlayerTraining';

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
  it('keeps unscheduled training credit visible without claiming a nonexistent target was met', () => {
    const plan = { id: 'p', sessionsPerWeek: 2, minutesPerSession: 30 }, week = { weekNumber: 1, workouts: [{ workoutId: 'slot' }], targets: [{ domain: 'dribbling', exposures: 2 }] };
    const logs = [{ id: 'p_slot', source: 'plan', planId: 'p', workoutId: 'slot', blocks: [{ blockId: 'b', drillId: 'shot', domain: 'shooting', status: 'done', estimatedMinutes: 12 }] }];
    const html = renderToStaticMarkup(<WeekProgress plan={plan} week={week} logs={logs} reps={[]} sessions={[]} />);
    expect(html).toContain('1 completed'); expect(html).toContain('No target set'); expect(html).not.toContain('1/0');
    expect(html).toContain('12 min'); expect(html).toContain('0/2');
  });
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
    expect(html.match(/<button[^>]*>Complete set 1 of 2<\/button>/)?.[0]).toContain('disabled');
    expect(html.match(/<button[^>]*>Skip drill<\/button>/)?.[0]).toContain('disabled');
  });
  it('opens a start acknowledged after tab departure paused, without counting hidden training', () => {
    vi.useFakeTimers(); vi.setSystemTime(90000);
    const workout = { ...savedWorkout(log())!, pausedOnOpen: true };
    const store = { logFor: () => log(), saving: false } as any;
    const html = renderToStaticMarkup(<MemoryRouter><PlayerWorkout workout={workout} store={store} playerId="player-doc" preview onExit={() => {}} /></MemoryRouter>);
    expect(html).toContain('Workout paused. Resume to continue.');
    expect(html).toContain('Session 0:00');
    expect(html.match(/<button[^>]*>Complete set 1 of 2<\/button>/)?.[0]).toContain('disabled');
  });
  it('offers sharing only from a saved workout and never publishes as part of rendering', () => {
    const finish = vi.fn(); const store = { logFor: () => ({ ...log(), endedAt: new Date() }), finish } as any;
    const html = renderToStaticMarkup(<MemoryRouter><PlayerWorkout workout={savedWorkout(log())!} store={store} playerId="player-doc" preview onExit={() => {}} /></MemoryRouter>);
    expect(html).toContain('Workout saved'); expect(html).toContain('/feed?scope=mine&amp;preview=1'); expect(finish).not.toHaveBeenCalled();
  });
});

describe('native set, drill and rest clocks', () => {
  it('excludes rest from set and drill time and starts the next set at the exact deadline', () => {
    let c = targetWork(newClock(1000), 'a', 1, 1000);
    expect(workElapsed(c, 11000)).toEqual({ set: 10, drill: 10 });
    c = startRest(c, 30, 11000);
    c = targetWork(c, 'a', 2, 11000);
    expect(workElapsed(c, 31000)).toEqual({ set: 0, drill: 10 });
    c = reconcileClock(c, 46000);
    expect(workElapsed(c, 46000)).toEqual({ set: 5, drill: 15 });
    expect(elapsed(c, 46000)).toBe(45);
  });
  it('freezes a fractional rest and work clock across pause, serialized reload and resume', () => {
    let c = targetWork(newClock(1000), 'a', 1, 1000);
    c = targetWork(startRest(c, 30, 11500), 'a', 2, 11500);
    c = pauseClock(c, 20000);
    const saved = runtimeSnapshot(owner, blocks, 0, c, true);
    c = restoreRuntime(JSON.parse(JSON.stringify(saved)), owner, blocks, log(), 90000)!.clock;
    expect(workElapsed(c, 90000)).toEqual({ set: 0, drill: 10.5 });
    c = resumeClock(c, 90000);
    c = reconcileClock(c, 115000);
    expect(workElapsed(c, 115000)).toEqual({ set: 3.5, drill: 14 });
  });
  it('keeps drill totals when navigating and does not run completed sets after resume', () => {
    let c = targetWork(newClock(1000), 'a', 1, 1000);
    c = targetWork(stopRest(c, 6000), 'b', 1, 6000);
    expect(workElapsed(c, 9000)).toEqual({ set: 3, drill: 3 });
    c = targetWork(c, 'a', 1, 9000);
    expect(workElapsed(c, 10000)).toEqual({ set: 6, drill: 6 });
    c = targetWork(c, 'a', 1, 10000, false);
    c = resumeClock(pauseClock(c, 11000), 20000);
    expect(workElapsed(c, 30000)).toEqual({ set: 6, drill: 6 });
  });
  it('accounts for a missed rest deadline before pause, with no dependence on timer ticks', () => {
    let c = targetWork(newClock(1000), 'a', 1, 1000);
    c = targetWork(startRest(c, 10, 6000), 'a', 2, 6000);
    c = pauseClock(c, 21500);
    expect(workElapsed(c, 90000)).toEqual({ set: 5.5, drill: 10.5 });
  });
  it('treats only duration units as timed prescriptions and rejects corrupt work timing', () => {
    expect(timedDose({ reps: 2, repUnit: 'minutes' })).toBe(120);
    expect(timedDose({ reps: 45, repUnit: 'seconds' })).toBe(45);
    for (const repUnit of ['reps', 'meters', 'contacts', 'passes']) expect(timedDose({ reps: 20, repUnit })).toBeNull();
    expect(validClock({ ...newClock(1000), work: { blockId: 'a', setNumber: 1, active: true, sets: { a: -1 }, drills: {}, runningSince: 1000 } })).toBe(false);
  });
});
