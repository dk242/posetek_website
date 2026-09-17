export interface InsightMetric {
  drill: string;
  field: string;
  lowerIsBetter: boolean;
  weeklyBest: (number | null)[];
}

export interface InsightPlayer {
  id: string;
  firstName: string;
  lastName: string;
  lastActiveMillis: number | null;
  undatedReps: number;
  futureDatedReps?: number;
  repsTruncated?: boolean;
  recordedDocumentsRead?: number;
  weeklyReps: number[];
  drillCounts: Record<string, number>;
  metrics: InsightMetric[];
}

export interface ClubInsights {
  organizationId: string;
  teamId: string;
  teamName: string;
  generatedAtMillis: number;
  rosterTruncated: boolean;
  historyTruncated?: boolean;
  repLimitPerPlayer?: number;
  recordedDocumentsRead?: number;
  weeks: number[];
  players: InsightPlayer[];
}

export interface Trend {
  first: number;
  last: number;
  improved: boolean | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const DRILL_LABELS: Record<string, string> = {
  sprint: "Sprint",
  jump: "Vertical jump",
  broadJump: "Broad jump",
  shooting: "Shooting",
  changeOfDirection: "Change of direction",
  dribbling: "Dribbling",
  freeRecord: "Free record",
};

const METRIC_UNITS: Record<string, { label: string; unit: string; convert: (value: number) => number; digits: number }> = {
  max_velocity: { label: "Max speed", unit: "mph", convert: value => value * 2.23694, digits: 1 },
  maxVelocity: { label: "Max speed", unit: "mph", convert: value => value * 2.23694, digits: 1 },
  velocity: { label: "Ball speed", unit: "mph", convert: value => value * 2.23694, digits: 1 },
  jump_height_m: { label: "Jump height", unit: "in", convert: value => value * 39.37007874015748, digits: 1 },
  jumpHeight: { label: "Jump height", unit: "in", convert: value => value * 39.37007874015748, digits: 1 },
  jump_height_in: { label: "Jump height", unit: "in", convert: value => value, digits: 1 },
  jump_height_inches: { label: "Jump height", unit: "in", convert: value => value, digits: 1 },
  broadJumpDistance: { label: "Distance", unit: "ft", convert: value => value * 3.28084, digits: 1 },
  totalTime: { label: "Total time", unit: "s", convert: value => value, digits: 2 },
};

export function drillLabel(drill: string): string {
  return DRILL_LABELS[drill] || drill;
}

export function metricLabel(metric: Pick<InsightMetric, "drill" | "field">): string {
  return `${drillLabel(metric.drill)} · ${METRIC_UNITS[metric.field]?.label || metric.field}`;
}

export function metricValue(field: string, value: number): number {
  const spec = METRIC_UNITS[field];
  return spec ? Number(spec.convert(value).toFixed(spec.digits)) : value;
}

export function metricUnit(field: string): string {
  return METRIC_UNITS[field]?.unit || "";
}

export function formatMetric(field: string, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const spec = METRIC_UNITS[field];
  return spec ? `${spec.convert(value).toFixed(spec.digits)} ${spec.unit}` : String(value);
}

export function weekLabel(millis: number): string {
  return new Date(millis).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function trendOf(metric: InsightMetric): Trend | null {
  const values = metric.weeklyBest.filter((value): value is number => value !== null);
  if (!values.length) return null;
  const first = values[0];
  const last = values[values.length - 1];
  const shownFirst = metricValue(metric.field, first);
  const shownLast = metricValue(metric.field, last);
  const improved = values.length < 2 || shownFirst === shownLast ? null : metric.lowerIsBetter ? shownLast < shownFirst : shownLast > shownFirst;
  return { first, last, improved };
}

export function totalReps(player: Pick<InsightPlayer, "weeklyReps">): number {
  return player.weeklyReps.reduce((sum, count) => sum + count, 0);
}

export function teamWeeklyReps(insights: Pick<ClubInsights, "weeks" | "players">): number[] {
  return insights.weeks.map((_, index) => insights.players.reduce((sum, player) => sum + (player.weeklyReps[index] || 0), 0));
}

export function teamSummary(insights: Pick<ClubInsights, "weeks" | "players">) {
  const last = insights.weeks.length - 1;
  const weekly = teamWeeklyReps(insights);
  return {
    players: insights.players.length,
    activeThisWeek: insights.players.filter(player => (player.weeklyReps[last] || 0) > 0).length,
    repsThisWeek: weekly[last] || 0,
    repsInWindow: weekly.reduce((sum, count) => sum + count, 0),
    inactiveInWindow: insights.players.filter(player => totalReps(player) === 0).length,
  };
}

export function lastActiveText(lastActiveMillis: number | null, nowMillis: number): string {
  if (lastActiveMillis === null) return "No dated recordings";
  const days = Math.floor(nowMillis / DAY_MS) - Math.floor(lastActiveMillis / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export function sortPlayers(players: InsightPlayer[], key: "name" | "reps" | "lastActive"): InsightPlayer[] {
  const name = (player: InsightPlayer) => `${player.firstName} ${player.lastName}`.trim();
  return [...players].sort((a, b) => {
    if (key === "reps") return totalReps(b) - totalReps(a) || name(a).localeCompare(name(b));
    if (key === "lastActive") return (b.lastActiveMillis ?? -Infinity) - (a.lastActiveMillis ?? -Infinity) || name(a).localeCompare(name(b));
    return name(a).localeCompare(name(b));
  });
}
