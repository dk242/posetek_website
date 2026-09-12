import { localDayString, planLogId, weekWindow } from '../../../lib/contracts/planV3';
import { drillKey } from './scoring';
import type { Row } from './execution';

// WeeklyProgressBuilder.buildV3: scheduled slots keep their scheduled week;
// ad-hoc logs and free measured sessions use the plan's calendar window.
export function weekProgress(plan: Row, week: Row | undefined, logs: Row[], reps: Row[], sessions: Row[]) {
  const window = week && weekWindow(plan, week.weekNumber);
  const date = (v: any) => v?.toDate?.() || new Date(v);
  const within = (v: any) => { const d = date(v); if (!window || !Number.isFinite(d.getTime())) return false; const day = localDayString(d, plan.timezone); return day >= window.start && day < window.end; };
  const slotIds = new Set((week?.workouts || []).map((w: Row) => w.workoutId));
  const unique = <T extends Row>(rows: T[]): T[] => [...new Map(rows.map(r => [r.id, r])).values()];
  const included = unique(logs).filter(l => l.planId === plan.id && (l.source === 'plan' ? slotIds.has(l.workoutId) && l.id === planLogId(plan.id, l.workoutId) : l.source === 'adhoc' && within(l.startedAt)));
  const exposures: Record<string, number> = {}, minutes: Record<string, number> = {}, drillDone: Record<string, number> = {};
  const linked = new Set<string>();
  for (const log of included) {
    const active: Row[] = (log.blocks || []).filter((b: Row) => ['done', 'partial'].includes(b.status));
    if (active.length && log.linkedTrainingSessionId) linked.add(log.linkedTrainingSessionId);
    for (const domain of new Set(active.map(b => b.domain))) exposures[domain] = (exposures[domain] || 0) + 1;
    for (const b of active) minutes[b.domain] = (minutes[b.domain] || 0) + Math.floor(Math.max(0, b.estimatedMinutes || 0) / (b.status === 'partial' ? 2 : 1));
    for (const drill of new Set(active.map(b => b.drillId))) if ((log.blocks || []).filter((b: Row) => b.drillId === drill).every((b: Row) => b.status === 'done')) drillDone[drill] = (drillDone[drill] || 0) + 1;
  }
  const covered = new Set<string>(), coveredIds = new Set<string>();
  sessions.filter(s => linked.has(s.id)).forEach(s => (s.sessionRefs || []).forEach((r: Row) => { coveredIds.add(r.sessionDocId); covered.add(`${drillKey({ repType: r.drillType })}|${r.sessionNumber}`); }));
  const free = new Set<string>();
  const measured: Record<string, string> = { shooting: 'shooting', sprint: 'speed', jump: 'plyometrics', broadJump: 'plyometrics', changeOfDirection: 'agility', dribbling: 'dribbling' };
  for (const r of unique(reps)) {
    const type = drillKey(r), domain = measured[type];
    if (!domain || !within(r.createdAt || r.createdAtMillis) || coveredIds.has(r.id)) continue;
    const number = r.sessionFolder?.replace(/^session/, '') || r.sessionFolderName?.replace(/^session/, '') || r.sessionNumber || r.storagePath?.match(/session(\d+)/)?.[1];
    const key = `${type}|${number || r.id}`;
    if (covered.has(key) || free.has(key)) continue;
    free.add(key); exposures[domain] = (exposures[domain] || 0) + 1;
  }
  const domains = [...new Set([...(week?.targets || []).map((t: Row) => t.domain), ...Object.keys(exposures)])].map(domain => ({ domain, done: exposures[domain] || 0, target: (week?.targets || []).find((t: Row) => t.domain === domain)?.exposures || 0, minutes: minutes[domain] || 0 }));
  const drillTargets: Record<string, number> = {};
  for (const w of week?.workouts || []) for (const id of new Set<string>((w.blocks || []).map((b: Row) => b.drillId))) drillTargets[id] = (drillTargets[id] || 0) + 1;
  return { domains, minutes: Object.values(minutes).reduce((a, b) => a + b, 0), drillDone, drillTargets };
}
