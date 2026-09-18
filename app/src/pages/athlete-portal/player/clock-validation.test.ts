import { describe, expect, it } from 'vitest';
import { IDLE_MS, elapsed, newClock, pauseClock, reconcileClock, resumeClock, startRest, targetWork, validClock, workElapsed } from './clock';
import { restoreRuntime, runtimeSnapshot } from './workout-runtime';

const owner = { uid: 'owner', playerId: 'player', logId: 'log', planId: 'plan', workoutRevision: 1 };
const blocks = [{ blockId: 'a', sets: 2 }];
const working = () => targetWork(newClock(1000), 'a', 1, 1000);

describe('untrusted cached workout clocks', () => {
  it('rejects malformed nested work clocks without throwing during runtime recovery', () => {
    for (const work of [null, false, 0, '', [], {}, { ...working().work, sets: [] }, { ...working().work, drills: null }, { ...working().work, sets: { bad: '12' } }, { ...working().work, setNumber: Number.MAX_SAFE_INTEGER + 1 }, { ...working().work, blockId: '' }]) {
      const clock = { ...newClock(1000), work };
      expect(validClock(clock)).toBe(false);
      expect(restoreRuntime({ ...runtimeSnapshot(owner, blocks, 0, newClock(1000)), clock }, owner, blocks, null, 2000)).toBeNull();
    }
  });
  it('rejects work that would keep advancing while paused, resting, or completed', () => {
    const c = working();
    for (const malformed of [
      { ...c, runningSince: null }, { ...c, restUntil: 60000 }, { ...c, frozenRest: 60 },
      { ...c, work: { ...c.work, active: false } }, { ...c, work: { ...c.work, runningSince: 0 } },
      { ...pauseClock(c, 2000), restUntil: 60000 },
    ]) expect(validClock(malformed)).toBe(false);
  });
  it('does not treat inherited object properties as previously recorded drill time', () => {
    for (const blockId of ['constructor', 'toString', '__proto__']) {
      let c = targetWork(newClock(1000), blockId, 1, 1000);
      expect(workElapsed(c, 2000)).toEqual({ set: 1, drill: 1 });
      c = pauseClock(c, 2000);
      expect(validClock(JSON.parse(JSON.stringify(c)))).toBe(true);
      expect(workElapsed(c, 90000)).toEqual({ set: 1, drill: 1 });
    }
  });
  it('preserves valid running, resting and paused clocks through serialized reload', () => {
    const c = working();
    for (const clock of [newClock(1000), c, startRest(c, 30, 6000), pauseClock(c, 6000), pauseClock(startRest(c, 30, 6000), 16000)]) {
      const saved = JSON.parse(JSON.stringify(runtimeSnapshot(owner, blocks, 0, clock)));
      expect(validClock(saved.clock)).toBe(true);
      expect(restoreRuntime(saved, owner, blocks, null, 20000)).not.toBeNull();
    }
  });
  it('excludes prescribed rest and all time after the inactivity cap from work on reload', () => {
    let c = targetWork(startRest(working(), 30, 6000), 'a', 2, 6000);
    c = reconcileClock(c, 1000 + IDLE_MS + 100000);
    expect(c.pauseReason).toBe('inactivity');
    expect(elapsed(c, 9000000)).toBe(1800);
    expect(workElapsed(c, 9000000)).toEqual({ set: 1765, drill: 1770 });
    const restored = restoreRuntime(JSON.parse(JSON.stringify(runtimeSnapshot(owner, blocks, 0, c))), owner, blocks, null, 9000000)!;
    expect(workElapsed(restored.clock, 9000000)).toEqual({ set: 1765, drill: 1770 });
    c = resumeClock(restored.clock, 9000000);
    expect(workElapsed(c, 9001000)).toEqual({ set: 1766, drill: 1771 });
  });
});
