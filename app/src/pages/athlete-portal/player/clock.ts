// WorkoutSessionClock: suspension-safe timing, user pause and 30-minute idle cap.
export type Clock = { seconds: number; runningSince: number | null; lastInteraction: number; restUntil: number | null; frozenRest: number | null };
export const IDLE_MS = 30 * 60 * 1000;
export const newClock = (now: number): Clock => ({ seconds: 0, runningSince: now, lastInteraction: now, restUntil: null, frozenRest: null });
export function elapsed(clock: Clock, now: number) { return clock.seconds + (clock.runningSince === null ? 0 : Math.max(0, Math.min(now, clock.lastInteraction + IDLE_MS) - clock.runningSince) / 1000); }
export function restSeconds(clock: Clock, now: number) { return Math.max(0, Math.ceil(clock.frozenRest ?? (clock.restUntil === null ? 0 : (clock.restUntil - Math.min(now, clock.lastInteraction + IDLE_MS)) / 1000))); }
export function pauseClock(clock: Clock, now: number): Clock {
  const at = Math.min(now, clock.lastInteraction + IDLE_MS);
  return { ...clock, seconds: elapsed(clock, at), runningSince: null, frozenRest: clock.frozenRest ?? (clock.restUntil === null ? null : Math.max(0, (clock.restUntil - at) / 1000)), restUntil: null };
}
export function reconcileClock(clock: Clock, now: number): Clock { return clock.runningSince !== null && now >= clock.lastInteraction + IDLE_MS ? pauseClock(clock, now) : clock; }
export function resumeClock(clock: Clock, now: number): Clock { const c = reconcileClock(clock, now); return c.runningSince !== null ? c : { ...c, runningSince: now, lastInteraction: now, restUntil: c.frozenRest ? now + c.frozenRest * 1000 : null, frozenRest: null }; }
export function interactClock(clock: Clock, now: number): Clock { const c = reconcileClock(clock, now); return c.runningSince === null ? c : { ...c, lastInteraction: now }; }
