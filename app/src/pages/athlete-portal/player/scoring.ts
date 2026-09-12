// One player scoring path shared by Profile, Overall standings and plan intake.
// Mirrors AthleteStatsBuilder and uses the same versioned benchmark dataset.
import bundled from './D1Benchmarks.json';
import { METRICS } from '../../../components/athlete-stats/profile';
import type { Row } from './execution';

export const AXES = [
  { key: 'striking', label: 'Striking' }, { key: 'power', label: 'Power' },
  { key: 'speed', label: 'Speed' }, { key: 'ballControl', label: 'Ball Control' }, { key: 'agility', label: 'Agility' },
];
export const defaultDataset: Row = bundled;
const positive = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const mean = (values: (number | null)[]) => { const ns = values.filter((n): n is number => n !== null); return ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : null; };
export const drillKey = (r: Row): string => (({ deadballShot: 'shooting', side_kick: 'shooting', staticJump: 'jump' } as Record<string, string>)[r._statsDrill || r.repType || r.drillType] || r._statsDrill || r.repType || r.drillType);
export function profileCell(athlete: Row, now = new Date()): string {
  let age = typeof athlete.age === 'number' ? Math.trunc(athlete.age) : null;
  const birth = (athlete.birthDate || athlete.dateOfBirth)?.toDate?.();
  if (age === null && birth) age = now.getFullYear() - birth.getFullYear() - (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate()) ? 1 : 0);
  const band = age === null ? 'senior' : age < 13 ? 'u12' : age < 15 ? 'u14' : age < 17 ? 'u16' : age < 19 ? 'u18' : 'senior';
  const raw = String(athlete.gender || '').toLowerCase();
  const gender = ['m', 'male', 'boy'].includes(raw) ? 'male' : ['f', 'female', 'girl'].includes(raw) ? 'female' : 'unspecified';
  return `${band}|${gender}`;
}
export function valueFor(rep: Row, fields: string[]): number | null {
  for (const f of fields) { const n = positive(rep[f]); if (n !== null) return n; }
  return null;
}
const sameCourse = (a: Row, b: Row) => positive(a.markerDistance) !== null && positive(b.markerDistance) !== null && Math.abs(Number(a.markerDistance) - Number(b.markerDistance)) / Math.max(Number(a.markerDistance), Number(b.markerDistance)) <= 0.05;
export function comparisons(reps: Row[]) {
  const kicks = reps.filter(r => drillKey(r) === 'shooting');
  const dribbles = reps.filter(r => drillKey(r) === 'dribbling' && positive(r.totalTime)).sort((a, b) => Number(a.totalTime) - Number(b.totalTime) || Number(!!positive(b.markerDistance)) - Number(!!positive(a.markerDistance)) || String(a.id).localeCompare(String(b.id)));
  const foot = (r: Row, key: string) => String(r[key] || '').toLowerCase();
  const best = (rows: Row[], key: string, lower: boolean) => { const values = rows.map(r => positive(r[key])).filter((n): n is number => n !== null); return values.length ? lower ? Math.min(...values) : Math.max(...values) : null; };
  const kickLeft = best(kicks.filter(r => foot(r, 'strike_foot') === 'left'), 'velocity', false), kickRight = best(kicks.filter(r => foot(r, 'strike_foot') === 'right'), 'velocity', false);
  const anchor = dribbles.find(r => ['left', 'right'].includes(foot(r, 'dribble_foot')) && dribbles.some(other => ['left', 'right'].includes(foot(other, 'dribble_foot')) && foot(r, 'dribble_foot') !== foot(other, 'dribble_foot') && sameCourse(r, other)));
  const left = anchor ? best(dribbles.filter(r => sameCourse(anchor, r) && foot(r, 'dribble_foot') === 'left'), 'totalTime', true) : null;
  const right = anchor ? best(dribbles.filter(r => sameCourse(anchor, r) && foot(r, 'dribble_foot') === 'right'), 'totalTime', true) : null;
  const fastest = dribbles[0];
  const cod = fastest ? best(reps.filter(r => drillKey(r) === 'changeOfDirection' && sameCourse(fastest, r)), 'totalTime', true) : null;
  return { kickRetention: kickLeft && kickRight ? 100 * Math.min(kickLeft, kickRight) / Math.max(kickLeft, kickRight) : null,
    kickLeft, kickRight, dribbleRetention: left && right ? 100 * Math.min(left, right) / Math.max(left, right) : null, dribbleLeft: left, dribbleRight: right,
    slowdown: fastest && cod ? 100 * (fastest.totalTime / cod - 1) : null,
    multiplier: fastest && cod ? 0.8 + 0.2 * Math.min(cod / fastest.totalTime, 1) : 1 };
}
export function playerProfile(reps: Row[], athlete: Row = {}, dataset: Row = defaultDataset) {
  const cell = profileCell(athlete), comparisonsValue = comparisons(reps);
  const metrics = METRICS.filter(m => !m.placeholder).map(m => {
    const reference = positive(dataset.cells?.[cell]?.[m.key]?.percentiles?.p50);
    const rows = reps.filter(r => m.drills.includes(drillKey(r)));
    const fields = m.key === 'sprintCompletionTime' ? ['totalTime'] : m.fields;
    const values = rows.map(r => valueFor(r, fields)).filter((n): n is number => n !== null);
    const best = values.length ? m.lowerIsBetter ? Math.min(...values) : Math.max(...values) : null;
    const score = best && reference ? 100 * (m.lowerIsBetter ? reference / best : best / reference) : null;
    const latest = [...rows].sort((a, b) => (b.createdAtMillis || 0) - (a.createdAtMillis || 0)).map(r => valueFor(r, fields)).find(v => v !== null) ?? null;
    return { ...m, reference, best, latest, score, repCount: values.length,
      sessionCount: new Set(rows.map(r => r.sessionNumber || r.sessionFolder || 1)).size,
      lastMillis: Math.max(0, ...rows.map(r => r.createdAtMillis || 0)) };
  });
  const scoreFor = (key: string) => metrics.find(m => m.key === key)?.score ?? null;
  const axes = AXES.map(a => ({ ...a, score: a.key === 'speed' ? scoreFor('sprintCompletionTime') : a.key === 'agility' ? scoreFor('codTotalTime') : a.key === 'ballControl' ? (scoreFor('dribbleTotalTime') === null ? null : scoreFor('dribbleTotalTime')! * comparisonsValue.multiplier) : mean(metrics.filter(m => m.axis === a.key).map(m => m.score)),
    repCount: reps.filter(r => metrics.some(m => m.axis === a.key && m.drills.includes(drillKey(r)))).length }));
  return { cell, axes, metrics, comparisons: comparisonsValue, overall: mean(axes.map(a => a.score)), totalReps: reps.length,
    totalSessions: new Set(reps.map(r => `${drillKey(r)}:${r.sessionNumber || r.sessionFolder || r.id}`)).size };
}
export type PlayerProfile = ReturnType<typeof playerProfile>;
const APP_DRILLS: Record<string, string[]> = { striking: ['shooting'], power: ['jump', 'broadJump'], speed: ['sprint'], ballControl: ['dribbling'], agility: ['changeOfDirection'] };
const LABELS: Record<string, string> = { shooting: 'Shooting', jump: 'Jump', broadJump: 'Broad Jump', sprint: 'Sprint', changeOfDirection: 'Change of Direction', dribbling: 'Dribbling' };
const UNITS: Record<string, string> = { ballSpeed: 'mph', shotAccuracy: '%', broadJumpDistance: 'ft', verticalJumpHeight: 'in', sprintMaxAcceleration: 'm/s²', sprintMaxSpeed: 'mph', dribbleBallControl: 'ft' };
export function intakeSnapshot(profile: PlayerProfile): Row {
  const [ageBand, gender] = profile.cell.split('|');
  const clamp = (n: number) => Math.min(400, Math.max(0, n));
  return { schemaVersion: 1, benchmarkProfile: { ageBand, gender, isDefaulted: profile.cell === 'senior|unspecified' }, totalReps: profile.totalReps, totalSessions: profile.totalSessions,
    ...(profile.overall !== null ? { overallScore: clamp(profile.overall) } : {}),
    axes: profile.axes.map(a => ({ axis: a.key, repCount: a.repCount, missingDrills: APP_DRILLS[a.key].filter(d => !profile.metrics.some(m => m.drills.includes(d) && m.repCount)).map(d => d === 'shooting' ? 'kick' : d), ...(a.score !== null ? { score: clamp(a.score) } : {}) })),
    drills: ['shooting', 'jump', 'broadJump', 'sprint', 'changeOfDirection', 'dribbling'].flatMap(drill => {
      const ms = profile.metrics.filter(m => m.drills.includes(drill) && m.score !== null && m.best !== null);
      return ms.length ? [{ drill: drill === 'shooting' ? 'kick' : drill, displayName: LABELS[drill], repCount: Math.max(...ms.map(m => m.repCount)), sessionCount: Math.max(...ms.map(m => m.sessionCount)), isLowConfidence: Math.max(...ms.map(m => m.repCount)) < 3,
        score: clamp(ms.reduce((sum, m) => sum + m.score!, 0) / ms.length),
        ...(Math.max(...ms.map(m => m.lastMillis)) > 0 ? { lastRecorded: new Date(Math.max(...ms.map(m => m.lastMillis))).toISOString() } : {}),
        metrics: ms.map(m => ({ metric: m.key, displayName: m.label, bestCanonical: m.best, latestCanonical: m.latest,
          bestFormatted: m.format(m.best), latestFormatted: m.format(m.latest), unitLabel: UNITS[m.key] || 's',
          score: clamp(m.score!), band: m.score! >= 100 ? 'elite' : m.score! >= 85 ? 'approaching' : m.score! >= 65 ? 'developing' : 'earlyStage',
          referenceCanonical: m.reference, referenceFormatted: m.format(m.reference), repCount: m.repCount })) }] : [];
    }) };
}
