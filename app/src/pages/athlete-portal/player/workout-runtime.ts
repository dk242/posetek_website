import { reconcileClock, validClock } from './clock';
import type { Clock } from './clock';
import type { Row } from './execution';

export type RuntimeOwner = { uid: string; playerId: string; logId: string; planId: string; workoutRevision: number };
export type WorkoutRuntime = RuntimeOwner & { schemaVersion: 1; blockId: string; clock: Clock; timerStartedHere: boolean };
export function runtimeKey(owner: RuntimeOwner) { return `posetek:workout-runtime:${[owner.uid, owner.playerId, owner.logId].map(encodeURIComponent).join(':')}`; }
export function resumeIndex(blocks: Row[], log: Row | null): number {
  const next = blocks.findIndex(b => !log?.blocks?.some((r: Row) => r.blockId === b.blockId && ['done', 'skipped'].includes(r.status)));
  return next < 0 ? Math.max(0, blocks.length - 1) : next;
}
export function runtimeSnapshot(owner: RuntimeOwner, blocks: Row[], index: number, clock: Clock, timerStartedHere = false): WorkoutRuntime {
  return { ...owner, schemaVersion: 1, blockId: blocks[index]?.blockId || '', clock, timerStartedHere };
}
export function restoreRuntime(value: unknown, owner: RuntimeOwner, blocks: Row[], log: Row | null, now: number): { clock: Clock; index: number; timerStartedHere: boolean } | null {
  if (!value || typeof value !== 'object' || log?.endedAt) return null;
  const saved = value as WorkoutRuntime;
  if (saved.schemaVersion !== 1 || !validClock(saved.clock) || !owner.uid ||
      !(['uid', 'playerId', 'logId', 'planId', 'workoutRevision'] as const).every(k => saved[k] === owner[k])) return null;
  const index = blocks.findIndex(b => b.blockId === saved.blockId);
  return index < 0 ? null : { clock: reconcileClock(saved.clock, now), index, timerStartedHere: saved.timerStartedHere === true };
}
export function canMutateWorkout(clock: Clock, saving: boolean, ended: boolean, now: number): boolean {
  return !saving && !ended && reconcileClock(clock, now).runningSince !== null;
}
