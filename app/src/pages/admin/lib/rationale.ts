export const RATIONALE_MIN = 3;
export const RATIONALE_MAX = 2000;
export const NO_FEEDBACK_RATIONALE = "I have no feedback to provide here";

/** Persist an explicit opt-out using a declaration accepted by existing rules. */
export function workoutRationale(rationale: string, noFeedback = false): string | null {
  if (noFeedback) return NO_FEEDBACK_RATIONALE;
  const trimmed = rationale.trim();
  return trimmed.length >= RATIONALE_MIN && trimmed.length <= RATIONALE_MAX ? trimmed : null;
}
