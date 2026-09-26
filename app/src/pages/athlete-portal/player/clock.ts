// Date-based native clock semantics: explicit resume, frozen rest and a 30-minute idle cap.
export type Clock = { seconds: number; runningSince: number | null; lastInteraction: number; restUntil: number | null; frozenRest: number | null; restTotal?: number | null; pauseReason?: 'user' | 'inactivity' | null };
export const IDLE_MS = 30 * 60 * 1000;
export const newClock = (now: number): Clock => ({ seconds: 0, runningSince: now, lastInteraction: now, restUntil: null, frozenRest: null, restTotal: null, pauseReason: null });
export function elapsed(clock: Clock, now: number) { return clock.seconds + (clock.runningSince === null ? 0 : Math.max(0, Math.min(now, clock.lastInteraction + IDLE_MS) - clock.runningSince) / 1000); }
export function restSeconds(clock: Clock, now: number) {
  const value = clock.frozenRest ?? (clock.restUntil === null ? 0 : (clock.restUntil - Math.min(now, clock.lastInteraction + IDLE_MS)) / 1000);
  return Math.max(0, Math.ceil(Math.min(value, clock.restTotal ?? Infinity)));
}
export function stopRest(clock: Clock): Clock { return { ...clock, restUntil: null, frozenRest: null, restTotal: null }; }
export function pauseClock(clock: Clock, now: number, reason: Clock['pauseReason'] = 'user'): Clock {
  if (clock.runningSince === null) return clock;
  const at = Math.max(clock.runningSince, Math.min(now, clock.lastInteraction + IDLE_MS));
  const remaining = clock.frozenRest ?? (clock.restUntil === null ? null : Math.max(0, Math.min(clock.restTotal ?? Infinity, (clock.restUntil - at) / 1000)));
  const paused = { ...clock, seconds: elapsed(clock, at), runningSince: null, frozenRest: remaining, restUntil: null,
    pauseReason: now >= clock.lastInteraction + IDLE_MS ? 'inactivity' as const : reason };
  return remaining ? paused : stopRest(paused);
}
export function reconcileClock(clock: Clock, now: number): Clock {
  if (clock.runningSince === null) return clock;
  if (now >= clock.lastInteraction + IDLE_MS) return pauseClock(clock, now, 'inactivity');
  return clock.restUntil !== null && now >= clock.restUntil ? stopRest(clock) : clock;
}
export function resumeClock(clock: Clock, now: number): Clock {
  const c = reconcileClock(clock, now);
  return c.runningSince !== null ? c : { ...c, runningSince: now, lastInteraction: now, restUntil: c.frozenRest ? now + c.frozenRest * 1000 : null, frozenRest: null, pauseReason: null };
}
export function interactClock(clock: Clock, now: number): Clock {
  const c = reconcileClock(clock, now);
  return c.runningSince === null ? c : { ...c, lastInteraction: Math.max(c.lastInteraction, now) };
}
export function validClock(value: unknown): value is Clock {
  if (!value || typeof value !== 'object') return false;
  const c = value as Clock;
  const finiteOrNull = (n: unknown) => n === null || (typeof n === 'number' && Number.isFinite(n) && n >= 0);
  return Number.isFinite(c.seconds) && c.seconds >= 0 && Number.isFinite(c.lastInteraction) && c.lastInteraction >= 0 &&
    finiteOrNull(c.runningSince) && finiteOrNull(c.restUntil) && finiteOrNull(c.frozenRest) &&
    (c.runningSince === null ? c.restUntil === null : c.runningSince <= c.lastInteraction && c.frozenRest === null) &&
    (c.restTotal === undefined || finiteOrNull(c.restTotal)) &&
    (c.pauseReason == null || c.pauseReason === 'user' || c.pauseReason === 'inactivity');
}
