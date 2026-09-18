import { DRILLS, type Drill } from '../lib/drills';
import { createdMillis, displayValue, formatValue, metricRaw, repNumber, sessionsFor } from '../lib/metrics';
import { metricValue } from '../../../lib/result-values';
import type { Row } from './execution';
import type { ProfileSession } from './profile-activity';

export const NATIVE_DRILL_ICONS: Record<string, string> = { shooting: 'soccerball', sprint: 'figure.run', jump: 'figure.jumprope', broadJump: 'figure.jumprope', dribbling: 'figure.soccer', changeOfDirection: 'arrow.triangle.turn.up.right.diamond', freeRecord: 'video.fill' };
export const NATIVE_AXIS_ORDER = ['power', 'speed', 'agility', 'ballControl', 'striking'];
export const NATIVE_AXIS_ICONS: Record<string, string> = { power: 'bolt.fill', speed: 'hare.fill', agility: 'arrow.triangle.turn.up.right.diamond.fill', ballControl: 'soccerball', striking: 'target' };
export function nativeBenchmarkBand(score: number | null) {
  if (score === null) return null;
  return score >= 100 ? { label: 'At standard', icon: 'checkmark.seal.fill', key: 'elite' }
    : score >= 85 ? { label: 'Approaching', icon: 'arrow.up.right.circle.fill', key: 'approaching' }
      : score >= 65 ? { label: 'Developing', icon: 'chart.line.uptrend.xyaxis', key: 'developing' }
        : { label: 'Early stage', icon: 'circle.dashed', key: 'early' };
}
export const NATIVE_TIME_RANGES = [
  { key: 'week', label: '1 Week', months: 0, days: 7 }, { key: 'month', label: '1 Month', months: 1, days: 0 },
  { key: 'sixMonths', label: '6 Months', months: 6, days: 0 }, { key: 'year', label: '1 Year', months: 12, days: 0 },
  { key: 'all', label: 'All Time', months: 0, days: 0 },
];
export function nativeDashboardRows(reps: Row[], range: string, now = new Date()) {
  const choice = NATIVE_TIME_RANGES.find(item => item.key === range) || NATIVE_TIME_RANGES[4];
  const cutoff = new Date(now);
  if (choice.months) {
    const day = cutoff.getDate(); cutoff.setDate(1); cutoff.setMonth(cutoff.getMonth() - choice.months);
    const lastDay = new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 0).getDate(); cutoff.setDate(Math.min(day, lastDay));
  }
  if (choice.days) cutoff.setDate(cutoff.getDate() - choice.days);
  return reps.filter(rep => choice.key === 'all' || (createdMillis(rep) >= cutoff.getTime() && createdMillis(rep) <= now.getTime()))
    .sort((a, b) => createdMillis(b) - createdMillis(a) || repNumber(b) - repNumber(a));
}

/** Mirrors the native dashboard's measured-only summary and half-split trend. */
export function nativeDashboardMetrics(drill: Drill, source: Row[]) {
  if (!drill.metric) return [];
  const reps = source.filter(rep => metricRaw(rep, drill) !== null);
  const values = reps.map(rep => metricRaw(rep, drill)!);
  const average = (ns: number[]) => ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : null;
  const avg = formatValue(average(values), drill), best = formatValue(values.length ? (drill.higher ? Math.max(...values) : Math.min(...values)) : null, drill);
  const chronological = [...reps].sort((a, b) => createdMillis(a) - createdMillis(b) || String(a.id).localeCompare(String(b.id))).map(rep => displayValue(metricRaw(rep, drill), drill)!);
  const mid = Math.floor(chronological.length / 2), earlier = average(chronological.slice(0, mid)), later = average(chronological.slice(mid));
  const percent = earlier && later !== null ? (later - earlier) / earlier * 100 : null;
  const trend = percent === null ? '—' : Math.abs(percent) < .05 ? '→ 0%' : percent > 0 ? `↗ +${percent.toFixed(1)}%${drill.higher ? '' : ' slower'}` : `↘ ${drill.higher ? percent.toFixed(1) : Math.abs(percent).toFixed(1)}%${drill.higher ? '' : ' faster'}`;
  const item = (label: string, value: string) => ({ label, value });
  const fieldAverage = (field: string) => average(reps.map(rep => metricValue(rep, field)).filter((value): value is number => value !== null));
  const feet = (field: string) => { const value = fieldAverage(field); return value === null ? '—' : `${(value * 3.28084).toFixed(1)} ft`; };
  if (['dribbling', 'changeOfDirection'].includes(drill.key)) return [item('Best Time', best), item('Avg Time', avg), item('Avg Distance', feet('totalDistance')),
    ...(drill.key === 'dribbling' ? [item('Ball Distance', feet('avgBallDistance'))] : []),
    ...[['Accel Phase', 'phase1Time'], ['Turn Phase', 'phase2Time'], ['Return Phase', 'phase3Time']].map(([label, field]) => { const value = fieldAverage(field); return item(label, value === null ? '—' : `${value.toFixed(2)} s`); }), item('Total Runs', String(reps.length)), item('Time Trend', trend)];
  if (drill.key === 'shooting') {
    const angles = reps.map(rep => metricValue(rep, 'launch_angle', {}, ['launchAngle'])).filter((value): value is number => value !== null && value >= 0 && value < 179).map(value => Math.min(value, 180 - value));
    const angle = average(angles), left = reps.filter(rep => String(rep.strike_foot || '').toLowerCase() === 'left').length, right = reps.filter(rep => String(rep.strike_foot || '').toLowerCase() === 'right').length;
    return [item('Avg Ball Speed', avg), item('Max Ball Speed', best), item('Avg Launch Angle', angle === null ? '—' : `${angle.toFixed(1)}°`), item('Dominant Foot', left === right ? '—' : left > right ? 'Left' : 'Right'), item('Left Strikes', String(left)), item('Right Strikes', String(right)), item('Total Kicks', String(reps.length)), item('Recent Trend', trend)];
  }
  const names = drill.key === 'jump' ? ['Avg Height', 'Max Height', 'Total Jumps'] : drill.key === 'broadJump' ? ['Avg Distance', 'Max Distance', 'Total Jumps'] : ['Avg Top Speed', 'Max Speed', 'Total Sprints'];
  return [item(names[0], avg), item(names[1], best), item(names[2], String(reps.length)), item('Recent Trend', trend)];
}
export function nativeChartPoints(drill: Drill, reps: Row[], selectedFolder: string | null) {
  const sessions = sessionsFor(reps);
  const selected = sessions.find(session => session.folder === selectedFolder);
  if (selected) return selected.items.flatMap(rep => {
    const value = metricRaw(rep, drill);
    return value === null ? [] : [{ label: `Rep ${repNumber(rep)}`, value, folder: selected.folder, repId: String(rep.id) }];
  });
  return [...sessions].reverse().flatMap(session => {
    const values = session.items.map(rep => metricRaw(rep, drill)).filter((value): value is number => value !== null);
    return values.length ? [{ label: session.date ? new Date(session.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : `Session ${session.number}`, value: values.reduce((a, b) => a + b, 0) / values.length, folder: session.folder, repId: null }] : [];
  });
}

/** Native overview keeps individual measured reps visible for small histories. */
export function nativeSupportingPoints(drill: Drill, reps: Row[], selectedFolder: string | null) {
  if (selectedFolder) return [];
  const means = nativeChartPoints(drill, reps, null);
  if (means.length > 5) return [];
  return means.flatMap((mean, x) => nativeChartPoints(drill, reps, mean.folder).map(point => ({ ...point, x })));
}

/** Sample profiles have synthetic reps, so derive all three activity cards from those same fixtures. */
export function nativePreviewSessions(reps: Row[]): ProfileSession[] {
  return DRILLS.flatMap(drill => sessionsFor(reps.filter(rep => drill.types.includes(rep._statsDrill || rep.repType || rep.drillType))).map(session => ({
    id: `${drill.key}:${session.folder}`, drill: drill.key, folder: session.folder, time: session.date || null, repCount: session.items.length,
  })));
}
