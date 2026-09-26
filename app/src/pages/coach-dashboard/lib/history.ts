/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;
function millis(value: any): number | null {
  try {
    const result = value?.toMillis ? value.toMillis() : value instanceof Date ? value.getTime()
      : typeof value === 'number' ? value : typeof value === 'string' && value ? Date.parse(value)
      : typeof value?._seconds === 'number' ? value._seconds * 1000 : null;
    return typeof result === 'number' && Number.isFinite(result) && Math.abs(result) <= 8640000000000000 ? result : null;
  } catch { return null; }
}
export type WorkoutOutcome = 'completed' | 'endedEarly' | 'abandoned' | 'inProgress' | 'unknown';
export const OUTCOME_LABELS: Record<WorkoutOutcome, string> = {
  completed: 'Completed', endedEarly: 'Ended early', abandoned: 'Abandoned',
  inProgress: 'No ending recorded', unknown: 'Ending not specified',
};

/** Mirrors Insights V2's linked-log selection and time/outcome semantics.
 * Keep the pinned snapshot attached: current plan edits cannot rewrite history.
 * See parity fixtures in history.test.ts against the server projection helper. */
export function workoutHistory(logs: Row[]) {
  const groups = new Map<string, Row[]>();
  logs.forEach((log, index) => {
    const identity = log.source === 'personal' ? `personal:${log.workoutId || log.id || `missing-${index}`}`
      : log.planId && log.workoutId && log.source !== 'adhoc' ? `plan:${log.planId}:${log.workoutId}`
      : `adhoc:${log.workoutId || log.id || `missing-${index}`}`;
    groups.set(identity, [...(groups.get(identity) || []), log]);
  });
  return [...groups.entries()].map(([id, group]) => {
    group.sort((a, b) => Number(Boolean(b.workoutSnapshot)) - Number(Boolean(a.workoutSnapshot))
      || (millis(b.endedAt) ?? 0) - (millis(a.endedAt) ?? 0) || String(a.id).localeCompare(String(b.id)));
    const log = group[0], start = millis(log.startedAt), end = millis(log.endedAt);
    const reason = log.source === 'personal' && ['stopped', 'pain'].includes(log.endReason) ? 'endedEarly' : log.endReason;
    const status: WorkoutOutcome = end === null ? 'inProgress'
      : ['completed', 'endedEarly', 'abandoned'].includes(reason) ? reason : 'unknown';
    const completions = new Map<string, Row>((Array.isArray(log.blocks) ? log.blocks : [])
      .filter((b: Row) => b && typeof b.blockId === 'string').map((b: Row) => [b.blockId, b]));
    const blocks = [...completions.values()], frozen = log.workoutSnapshot?.blocks;
    let prescribedKnown = Array.isArray(frozen) && frozen.length > 0, allSets = prescribedKnown;
    for (const block of Array.isArray(frozen) ? frozen : []) {
      const sets = block.sets ?? block.dose?.sets;
      if (!Number.isSafeInteger(sets) || sets < 1) { prescribedKnown = false; allSets = false; continue; }
      const done = completions.get(block.blockId);
      if (!done || done.status !== 'done' || !Number.isSafeInteger(done.setsCompleted) || done.setsCompleted < sets) allSets = false;
    }
    const timer = typeof log.activeSeconds === 'number' && Number.isFinite(log.activeSeconds)
      && log.activeSeconds >= 0 && log.activeSeconds <= 7 * 86400 ? log.activeSeconds : null;
    const estimate = timer === null && start !== null && end !== null && end >= start && end - start <= 7 * 86400000
      ? (end - start) / 1000 : null;
    return { id, log, start, end, status, blocks, snapshot: log.workoutSnapshot || null,
      duplicateLogs: group.length - 1, timerSeconds: timer, estimatedSeconds: estimate,
      allSetsCompleted: prescribedKnown && allSets, prescribedKnown,
      doneBlocks: blocks.filter(b => b.status === 'done').length,
      skippedBlocks: blocks.filter(b => b.status === 'skipped').length,
      partialBlocks: blocks.filter(b => b.status === 'partial').length,
      setsCompleted: blocks.reduce((sum, b) => sum + (['done', 'partial', 'skipped'].includes(b.status)
        && Number.isSafeInteger(b.setsCompleted) && b.setsCompleted >= 0 ? b.setsCompleted : 0), 0),
    };
  }).sort((a, b) => (b.start ?? b.end ?? 0) - (a.start ?? a.end ?? 0));
}

export type WorkoutHistoryEntry = ReturnType<typeof workoutHistory>[number];
