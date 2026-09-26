import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
vi.mock('../../../lib/firebase', () => ({ default: {}, auth: { currentUser: { uid: 'athlete-auth' } }, db: {}, cloud: {}, storage: {} }));
import { applyConfirmedElapsed, canMutateWorkout, restoreRuntime, resumeIndex, runtimeKey, runtimeSnapshot, shouldYieldRuntime, watchWorkoutLifecycle } from './workout-runtime';
import { elapsed, IDLE_MS, interactClock, newClock, pauseClock, reconcileClock, restSeconds, resumeClock, validClock } from './clock';
import { createWorkoutWakeLock } from './use-workout-wake-lock';
import type { ScreenLock, WakeLockState } from './use-workout-wake-lock';
import PlayerWorkout from './PlayerWorkout';

const blocks = [{ blockId: 'a', drillId: 'DRB-001', name: 'Control', sets: 2, restSeconds: 60 }, { blockId: 'b', drillId: 'STR-001', name: 'Strength', sets: 2, loadingInstructions: '4 kg under coach supervision; no independent increase.' }];
const owner = { uid: 'athlete-auth', playerId: 'player-doc', logId: 'plan_slot', planId: 'plan', workoutRevision: 3 };
const log = () => ({ id: 'plan_slot', planId: 'plan', workoutRevision: 3, workoutSnapshot: { blocks }, blocks: [] });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('workout clock recovery', () => {
  it('restores the selected drill and exact frozen rest across reload', () => {
    const paused = pauseClock({ ...newClock(1000), restUntil: 61000, restTotal: 60 }, 15500);
    const saved = runtimeSnapshot(owner, blocks, 1, paused, true);
    const restored = restoreRuntime(JSON.parse(JSON.stringify(saved)), owner, blocks, log(), 90000)!;
    expect(restored.index).toBe(1); expect(restored.timerStartedHere).toBe(true);
    expect(elapsed(restored.clock, 90000)).toBe(14.5);
    expect(restSeconds(restored.clock, 90000)).toBe(46);
    expect(canMutateWorkout(restored.clock, false, false, 90000)).toBe(false);
    const resumed = resumeClock(restored.clock, 90000);
    expect(restSeconds(resumed, 90500)).toBe(45);
    expect(elapsed(resumed, 91000)).toBe(15.5);
  });
  it('accounts for a locked phone immediately, without advancing completed sets', () => {
    const serverLog = log(), saved = runtimeSnapshot(owner, blocks, 0, { ...newClock(1000), restUntil: 61000, restTotal: 60 });
    const restored = restoreRuntime(saved, owner, blocks, serverLog, 121000)!;
    expect(elapsed(restored.clock, 121000)).toBe(120);
    expect(restSeconds(restored.clock, 121000)).toBe(0);
    expect(restored.clock.restUntil).toBeNull();
    expect(serverLog.blocks).toEqual([]);
  });
  it('persists on page lifecycle changes but pauses only on route departure', () => {
    const page = new EventTarget(), doc = new EventTarget(), sync = vi.fn(), leave = vi.fn();
    const detach = watchWorkoutLifecycle(page, doc, sync, leave);
    doc.dispatchEvent(new Event('visibilitychange'));
    page.dispatchEvent(new Event('pagehide')); page.dispatchEvent(new Event('pageshow'));
    expect(sync).toHaveBeenCalledTimes(3); expect(leave).not.toHaveBeenCalled();
    page.dispatchEvent(new Event('posetek:player-route-leave')); expect(leave).toHaveBeenCalledOnce();
    detach(); doc.dispatchEvent(new Event('visibilitychange')); page.dispatchEvent(new Event('posetek:player-route-leave'));
    expect(sync).toHaveBeenCalledTimes(3); expect(leave).toHaveBeenCalledOnce();
  });
  it('rejects another account, player, log, revision, removed drill, or finished log', () => {
    const saved = runtimeSnapshot(owner, blocks, 1, newClock(1000));
    for (const changed of [{ uid: 'other' }, { playerId: 'other' }, { logId: 'other' }, { planId: 'other' }, { workoutRevision: 4 }]) {
      expect(restoreRuntime(saved, { ...owner, ...changed }, blocks, log(), 2000)).toBeNull();
    }
    expect(restoreRuntime(saved, owner, blocks.slice(0, 1), log(), 2000)).toBeNull();
    expect(restoreRuntime(saved, owner, blocks, { ...log(), endedAt: 2000 }, 2000)).toBeNull();
    expect(runtimeKey(owner)).not.toBe(runtimeKey({ ...owner, uid: 'other' }));
  });
  it('rejects malformed and contradictory clocks and unsupported runtime versions', () => {
    for (const c of [null, {}, { ...newClock(1000), seconds: -1 }, { ...newClock(1000), restTotal: Infinity }, { ...newClock(1000), frozenRest: 3 }, { ...newClock(1000), runningSince: 1001 }, { ...newClock(1000), runningSince: null, restUntil: 5000 }]) expect(validClock(c)).toBe(false);
    expect(restoreRuntime({ ...runtimeSnapshot(owner, blocks, 0, newClock(1000)), schemaVersion: 2 }, owner, blocks, log(), 2000)).toBeNull();
    expect(restoreRuntime(runtimeSnapshot({ ...owner, workoutRevision: NaN }, blocks, 0, newClock(1000)), { ...owner, workoutRevision: NaN }, blocks, log(), 2000)).toBeNull();
  });
  it('requires explicit resume after 30 minutes and refuses mutations during saving or after ending', () => {
    const c = newClock(1000), later = 1000 + IDLE_MS * 20;
    expect(elapsed(c, later)).toBe(1800);
    expect(interactClock(c, later).pauseReason).toBe('inactivity');
    expect(canMutateWorkout(c, false, false, later)).toBe(false);
    const resumed = resumeClock(reconcileClock(c, later), later);
    expect(elapsed(resumed, later + 1000)).toBe(1801);
    expect(canMutateWorkout(resumed, true, false, later)).toBe(false);
    expect(canMutateWorkout(resumed, false, true, later)).toBe(false);
  });
  it('does not turn device-only timing into full coverage of a resumed session', () => {
    expect(restoreRuntime(runtimeSnapshot(owner, blocks, 0, newClock(1000)), owner, blocks, log(), 2000)?.timerStartedHere).toBe(false);
  });
  it('adds new active time to the confirmed personal baseline without double-adding after reload', () => {
    const resumed = applyConfirmedElapsed(newClock(1000), 120, 1000);
    expect(elapsed(resumed, 31000)).toBe(150);
    const saved = runtimeSnapshot({ ...owner, kind: 'personal' }, blocks, 0, resumed, true);
    const restored = restoreRuntime(saved, { ...owner, kind: 'personal' }, blocks, log(), 31000)!;
    expect(elapsed(applyConfirmedElapsed(restored.clock, 150, 31000), 41000)).toBe(160);
    expect(runtimeKey({ ...owner, kind: 'personal' })).not.toBe(runtimeKey(owner));
  });
  it('does not extend rest or subtract accumulated time after a backward clock change', () => {
    const c = { ...newClock(1000), seconds: 7, restUntil: 61000, restTotal: 60 };
    expect(restSeconds(c, 0)).toBe(60);
    const paused = pauseClock(c, 0);
    expect(elapsed(paused, 0)).toBe(7); expect(restSeconds(paused, 0)).toBe(60);
  });
  it('keeps completed-but-unended sessions on their final drill', () => {
    expect(resumeIndex(blocks, { blocks: [{ blockId: 'a', status: 'done' }, { blockId: 'b', status: 'skipped' }] })).toBe(1);
  });
  it('yields its timer to another valid tab without accepting foreign or malformed snapshots', () => {
    const saved = runtimeSnapshot(owner, blocks, 0, newClock(1000), true, 'new-tab');
    expect(shouldYieldRuntime(saved, 'old-tab', owner, blocks, 2000)).toBe(true);
    expect(shouldYieldRuntime(saved, 'new-tab', owner, blocks, 2000)).toBe(false);
    expect(shouldYieldRuntime({ ...saved, uid: 'foreign' }, 'old-tab', owner, blocks, 2000)).toBe(false);
    expect(shouldYieldRuntime({ ...saved, clock: {} }, 'old-tab', owner, blocks, 2000)).toBe(false);
    expect(shouldYieldRuntime(null, 'old-tab', owner, blocks, 2000)).toBe(true);
  });
});

function screenLock() {
  const events = new EventTarget();
  const lock: ScreenLock = { released: false, addEventListener: events.addEventListener.bind(events), release: vi.fn(async () => { lock.released = true; events.dispatchEvent(new Event('release')); }) };
  return lock;
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('optional workout screen wake lock', () => {
  it('requests only while opted in and running, releasing on pause and end', async () => {
    const locks: ScreenLock[] = [], states: WakeLockState[] = [];
    const request = vi.fn(async () => { const lock = screenLock(); locks.push(lock); return lock; });
    const controller = createWorkoutWakeLock(request, s => states.push(s));
    controller.update(false, true); expect(request).not.toHaveBeenCalled();
    controller.update(true, true); await settle(); expect(states.at(-1)).toBe('active');
    controller.update(false, true); expect(locks[0].release).toHaveBeenCalledOnce(); expect(states.at(-1)).toBe('off');
    controller.update(true, true); await settle(); expect(request).toHaveBeenCalledTimes(2);
    controller.dispose(); expect(locks[1].release).toHaveBeenCalledOnce();
  });
  it('releases while hidden and reacquires on return only if still wanted', async () => {
    const locks: ScreenLock[] = [];
    const request = vi.fn(async () => { const lock = screenLock(); locks.push(lock); return lock; });
    const controller = createWorkoutWakeLock(request, () => {});
    controller.update(true, true); await settle(); controller.update(true, false);
    expect(locks[0].release).toHaveBeenCalledOnce();
    controller.update(true, true); await settle(); expect(request).toHaveBeenCalledTimes(2);
    controller.update(false, false); controller.update(false, true); expect(request).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
  it('handles rejection without a retry loop and lets the athlete retry', async () => {
    const states: WakeLockState[] = [], request = vi.fn<() => Promise<ScreenLock>>().mockRejectedValueOnce(new Error('Low power')).mockResolvedValueOnce(screenLock());
    const controller = createWorkoutWakeLock(request, s => states.push(s));
    controller.update(true, true); await settle(); expect(states.at(-1)).toBe('unavailable');
    controller.update(true, true); await settle(); expect(request).toHaveBeenCalledOnce();
    controller.retry(); await settle(); expect(states.at(-1)).toBe('active');
    controller.dispose();
  });
  it('releases a late result after hiding or unmounting', async () => {
    let resolve!: (lock: ScreenLock) => void;
    const lock = screenLock(), report = vi.fn();
    const controller = createWorkoutWakeLock(() => new Promise(r => { resolve = r; }), report);
    controller.update(true, true); controller.update(true, false); controller.dispose();
    const before = report.mock.calls.length; resolve(lock); await settle();
    expect(lock.release).toHaveBeenCalledOnce(); expect(report.mock.calls.length).toBe(before);
  });
  it('reports an OS release and unsupported browsers without claiming an active lock', async () => {
    const lock = screenLock(), states: WakeLockState[] = [];
    const controller = createWorkoutWakeLock(async () => lock, s => states.push(s));
    controller.update(true, true); await settle(); await lock.release();
    expect(states.at(-1)).toBe('unavailable'); controller.dispose();
    const unsupported = createWorkoutWakeLock(undefined, s => states.push(s));
    unsupported.update(true, true); expect(states.at(-1)).toBe('unsupported'); unsupported.dispose();
  });
});

describe('guided workout recovery display', () => {
  it('restores disabled pause controls, selected drill and reviewer-set loading', () => {
    vi.useFakeTimers(); vi.setSystemTime(90000);
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === runtimeKey(owner) ? JSON.stringify(runtimeSnapshot(owner, blocks, 1, pauseClock(newClock(1000), 2000))) : null });
    const html = renderToStaticMarkup(<PlayerWorkout workout={{ ...log(), blocks }} store={{ logFor: log, saving: false } as any} playerId="player-doc" preview={false} onExit={() => {}} />);
    expect(html).toContain('Workout paused. Resume to continue.'); expect(html).toContain('Drill 2 of 2');
    expect(html.match(/<button[^>]*>Complete set 1<\/button>/)?.[0]).toContain('disabled');
    expect(html).toContain('4 kg under coach supervision; no independent increase.');
    expect(html).toContain('Keep screen awake'); expect(html).toContain('cannot show a live lock-screen timer');
  });
  it('restores pain stop without allowing the athlete to complete more sets', () => {
    const stopped = { ...log(), blocks: [{ blockId: 'a', status: 'skipped', skipReason: 'pain' }] };
    const html = renderToStaticMarkup(<PlayerWorkout workout={{ ...log(), blocks }} store={{ logFor: () => stopped, saving: false } as any} playerId="player-doc" preview onExit={() => {}} />);
    expect(html).toContain('Stop here'); expect(html).not.toContain('Complete set');
    expect(html).toContain('Review what I completed');
  });
});
