import { elapsed, reconcileClock, validClock } from './clock';
import type { Clock } from './clock';
import type { Row } from './execution';

export type RuntimeOwner = { uid: string; playerId: string; logId: string; planId: string; workoutRevision: number; kind?: 'personal' };
export type WorkoutRuntime = RuntimeOwner & { schemaVersion: 1; blockId: string; clock: Clock; timerStartedHere: boolean; tabId?: string };
export function runtimeKey(owner: RuntimeOwner) { return `posetek:${owner.kind === 'personal' ? 'personal-' : ''}workout-runtime:${[owner.uid, owner.playerId, owner.logId].map(encodeURIComponent).join(':')}`; }
export function resumeIndex(blocks: Row[], log: Row | null): number {
  const next = blocks.findIndex(b => !log?.blocks?.some((r: Row) => r.blockId === b.blockId && ['done', 'skipped'].includes(r.status)));
  return next < 0 ? Math.max(0, blocks.length - 1) : next;
}
export function runtimeSnapshot(owner: RuntimeOwner, blocks: Row[], index: number, clock: Clock, timerStartedHere = false, tabId?: string): WorkoutRuntime {
  return { ...owner, schemaVersion: 1, blockId: blocks[index]?.blockId || '', clock, timerStartedHere, ...(tabId ? { tabId } : {}) };
}
export function restoreRuntime(value: unknown, owner: RuntimeOwner, blocks: Row[], log: Row | null, now: number): { clock: Clock; index: number; timerStartedHere: boolean } | null {
  if (!value || typeof value !== 'object' || log?.endedAt) return null;
  const saved = value as WorkoutRuntime;
  if (saved.schemaVersion !== 1 || !validClock(saved.clock) || !owner.uid || !owner.playerId || !owner.logId || !owner.planId || !Number.isInteger(owner.workoutRevision) || owner.workoutRevision < 1 ||
      !(['uid', 'playerId', 'logId', 'planId', 'workoutRevision', 'kind'] as const).every(k => saved[k] === owner[k])) return null;
  const index = blocks.findIndex(b => b.blockId === saved.blockId);
  return index < 0 ? null : { clock: reconcileClock(saved.clock, now), index, timerStartedHere: saved.timerStartedHere === true };
}
export function canMutateWorkout(clock: Clock, saving: boolean, ended: boolean, now: number): boolean {
  return !saving && !ended && reconcileClock(clock, now).runningSince !== null;
}

export function shouldYieldRuntime(value: unknown, tabId: string, owner: RuntimeOwner, blocks: Row[], now: number): boolean {
  if (value === null) return true; // Another tab finished and removed its runtime.
  return !!restoreRuntime(value, owner, blocks, null, now) && (value as WorkoutRuntime).tabId !== tabId;
}

export function applyConfirmedElapsed(clock: Clock, confirmed: unknown, now: number): Clock {
  if (typeof confirmed !== 'number' || !Number.isFinite(confirmed) || confirmed < 0) return clock;
  const missing = Math.max(0, confirmed - elapsed(clock, now));
  return missing ? { ...clock, seconds: clock.seconds + missing } : clock;
}

export function watchWorkoutLifecycle(page: EventTarget, document: EventTarget, sync: () => void, leave: () => void) {
  // Locking the phone does not pause a workout: timestamps reconcile on return.
  // Leaving the Training route is a deliberate pause.
  page.addEventListener('pagehide', sync);
  page.addEventListener('pageshow', sync);
  document.addEventListener('visibilitychange', sync);
  page.addEventListener('posetek:player-route-leave', leave);
  return () => {
    page.removeEventListener('pagehide', sync);
    page.removeEventListener('pageshow', sync);
    document.removeEventListener('visibilitychange', sync);
    page.removeEventListener('posetek:player-route-leave', leave);
  };
}
