import type { AthleteSummary } from './logic';
import { toDate } from '../../athlete-portal/lib/training';

export type CoachFollowUp = {
  playerId: string;
  playerName: string;
  kind: 'pain' | 'endedEarly' | 'noPlan';
  title: string;
  detail: string;
  endedAt: number | null;
};

export function coachFollowUps(summaries: AthleteSummary[], now = new Date(), days = 30): CoachFollowUp[] {
  const since = now.valueOf() - days * 86400000;
  const rows: CoachFollowUp[] = [];
  for (const summary of summaries) {
    const playerId = String(summary.athlete.id);
    const playerName = `${summary.athlete.firstName || ''} ${summary.athlete.lastName || ''}`.trim() || 'Player';
    if (!summary.plan) rows.push({ playerId, playerName, kind: 'noPlan', title: 'No active plan',
      detail: 'Review whether a plan is needed.', endedAt: null });
    const outcomes = new Map<string, { end: number; pain: boolean; early: boolean }>();
    summary.logs.forEach((log, index) => {
      const end = toDate(log?.endedAt)?.valueOf();
      if (!end || end < since || end > now.valueOf()) return;
      const key = `${log?.source === 'personal' ? 'personal' : 'assigned'}:${log?.planId || ''}:${log?.workoutId || log?.id || index}`;
      const previous = outcomes.get(key);
      const pain = log?.endReason === 'pain' || (Array.isArray(log?.blocks) && log.blocks.some((block: { skipReason?: string }) => block.skipReason === 'pain'));
      const early = log?.endReason === 'endedEarly' || (log?.source === 'personal' && log?.endReason === 'stopped');
      outcomes.set(key, { end: Math.max(end, previous?.end || 0), pain: pain || previous?.pain || false,
        early: early || previous?.early || false });
    });
    for (const outcome of outcomes.values()) {
      if (outcome.pain) rows.push({ playerId, playerName, kind: 'pain', title: 'Pain reported',
        detail: 'Review this saved workout before the next session.', endedAt: outcome.end });
      else if (outcome.early) rows.push({ playerId, playerName, kind: 'endedEarly',
        title: 'Workout ended early', detail: 'Review the reason and follow up if needed.', endedAt: outcome.end });
    }
  }
  const priority = { pain: 0, endedEarly: 1, noPlan: 2 };
  return rows.sort((a, b) => priority[a.kind] - priority[b.kind] || (b.endedAt || 0) - (a.endedAt || 0)
    || a.playerName.localeCompare(b.playerName));
}
