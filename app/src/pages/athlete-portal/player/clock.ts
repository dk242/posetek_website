// Date-based native clock semantics: explicit resume, frozen rest and a 30-minute idle cap.
export type WorkClock = { blockId: string; setNumber: number; active: boolean; sets: Record<string, number>; drills: Record<string, number>; runningSince: number | null };
export type Clock = { seconds: number; runningSince: number | null; lastInteraction: number; restUntil: number | null; frozenRest: number | null; restTotal?: number | null; pauseReason?: 'user' | 'inactivity' | null; work?: WorkClock };
export const IDLE_MS = 30 * 60 * 1000;
export const newClock = (now: number): Clock => ({ seconds: 0, runningSince: now, lastInteraction: now, restUntil: null, frozenRest: null, restTotal: null, pauseReason: null });
export function elapsed(clock: Clock, now: number) { return clock.seconds + (clock.runningSince === null ? 0 : Math.max(0, Math.min(now, clock.lastInteraction + IDLE_MS) - clock.runningSince) / 1000); }
export function restSeconds(clock: Clock, now: number) {
  const value = clock.frozenRest ?? (clock.restUntil === null ? 0 : (clock.restUntil - Math.min(now, clock.lastInteraction + IDLE_MS)) / 1000);
  return Math.max(0, Math.ceil(Math.min(value, clock.restTotal ?? Infinity)));
}
const workKey = (work: WorkClock) => `${work.blockId}:${work.setNumber}`;
const savedSeconds = (values: Record<string, number> | undefined, key: string) => values && Object.hasOwn(values, key) ? values[key] : 0;
export function workElapsed(clock: Clock, now: number) {
  const work = clock.work;
  const extra = work?.runningSince == null ? 0 : Math.max(0, Math.min(now, clock.lastInteraction + IDLE_MS) - work.runningSince) / 1000;
  return { set: (work ? savedSeconds(work.sets, workKey(work)) : 0) + extra, drill: (work ? savedSeconds(work.drills, work.blockId) : 0) + extra };
}
function freezeWork(clock: Clock, now: number): Clock {
  if (!clock.work) return clock;
  const amount = workElapsed(clock, now), work = clock.work;
  return { ...clock, work: { ...work, sets: { ...work.sets, [workKey(work)]: amount.set }, drills: { ...work.drills, [work.blockId]: amount.drill }, runningSince: null } };
}
export function targetWork(clock: Clock, blockId: string, setNumber: number, now: number, active = true): Clock {
  const c = freezeWork(reconcileClock(clock, now), now);
  return { ...c, work: { blockId, setNumber, active, sets: c.work?.sets || {}, drills: c.work?.drills || {}, runningSince: active && c.runningSince !== null && !restSeconds(c, now) ? now : null } };
}
export function stopRest(clock: Clock, now = Date.now()): Clock {
  const c = freezeWork(clock, now);
  return { ...c, restUntil: null, frozenRest: null, restTotal: null,
    ...(c.work ? { work: { ...c.work, runningSince: c.work.active && c.runningSince !== null ? now : null } } : {}) };
}
export function startRest(clock: Clock, duration: number, now: number): Clock {
  const c = freezeWork(clock, now);
  return { ...c, restTotal: duration, restUntil: c.runningSince !== null ? now + duration * 1000 : null, frozenRest: c.runningSince === null ? duration : null };
}
export function pauseClock(clock: Clock, now: number, reason: Clock['pauseReason'] = 'user'): Clock {
  if (clock.runningSince === null) return clock;
  const at = Math.max(clock.runningSince, Math.min(now, clock.lastInteraction + IDLE_MS));
  // A throttled browser may skip the exact rest deadline. Credit work only
  // after that deadline, even when pause is the first subsequent event.
  const reconciled = clock.restUntil !== null && at >= clock.restUntil ? stopRest(clock, clock.restUntil) : clock;
  const remaining = reconciled.frozenRest ?? (reconciled.restUntil === null ? null : Math.max(0, Math.min(reconciled.restTotal ?? Infinity, (reconciled.restUntil - at) / 1000)));
  const paused = { ...freezeWork(reconciled, at), seconds: elapsed(clock, at), runningSince: null, frozenRest: remaining, restUntil: null,
    pauseReason: now >= clock.lastInteraction + IDLE_MS ? 'inactivity' as const : reason };
  return remaining ? paused : stopRest(paused);
}
export function reconcileClock(clock: Clock, now: number): Clock {
  if (clock.runningSince === null) return clock;
  if (now >= clock.lastInteraction + IDLE_MS) return pauseClock(clock, now, 'inactivity');
  return clock.restUntil !== null && now >= clock.restUntil ? stopRest(clock, clock.restUntil) : clock;
}
export function resumeClock(clock: Clock, now: number): Clock {
  const c = reconcileClock(clock, now);
  return c.runningSince !== null ? c : { ...c, runningSince: now, lastInteraction: now, restUntil: c.frozenRest ? now + c.frozenRest * 1000 : null, frozenRest: null, pauseReason: null,
    ...(c.work ? { work: { ...c.work, runningSince: c.frozenRest || !c.work.active ? null : now } } : {}) };
}
export function interactClock(clock: Clock, now: number): Clock {
  const c = reconcileClock(clock, now);
  return c.runningSince === null ? c : { ...c, lastInteraction: Math.max(c.lastInteraction, now) };
}
export function validClock(value: unknown): value is Clock {
  const record = (entry: unknown): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry) && [Object.prototype, null].includes(Object.getPrototypeOf(entry));
  if (!record(value)) return false;
  const c = value as Clock;
  const finiteOrNull = (n: unknown) => n === null || (typeof n === 'number' && Number.isFinite(n) && n >= 0);
  if (!(Number.isFinite(c.seconds) && c.seconds >= 0 && Number.isFinite(c.lastInteraction) && c.lastInteraction >= 0 &&
    finiteOrNull(c.runningSince) && finiteOrNull(c.restUntil) && finiteOrNull(c.frozenRest) &&
    (c.restTotal === undefined || finiteOrNull(c.restTotal)) &&
    (c.pauseReason == null || c.pauseReason === 'user' || c.pauseReason === 'inactivity'))) return false;
  // A stored rest clock must be either running with the workout or frozen with it.
  if (c.runningSince === null ? c.restUntil !== null : c.frozenRest !== null) return false;
  if (c.work === undefined) return true;
  const work = c.work;
  if (!record(work) || typeof work.blockId !== 'string' || !work.blockId.trim() || typeof work.active !== 'boolean' ||
    !Number.isSafeInteger(work.setNumber) || work.setNumber <= 0 || !finiteOrNull(work.runningSince) ||
    ![work.sets, work.drills].every(values => record(values) && Object.values(values).every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0))) return false;
  // Corrupt cache state must never count paused, inactive, or prescribed rest as work.
  return work.runningSince === null || (work.active && c.runningSince !== null && c.restUntil === null && c.frozenRest === null && work.runningSince >= c.runningSince);
}
