// Pure constants and helpers ported verbatim from athlete-mobile-pages.js
// (window.PoseTekMobilePages). No DOM, no Firebase — the views consume these.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const VIEW_LABELS: Record<string, string> = {
  home: "Athlete Home",
  profile: "Body Profile",
  aiCoach: "AI Coach",
  drills: "Drill Results",
  training: "Training",
  leaderboards: "Leaderboards",
};

export const POSE_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23],
  [12, 24], [23, 24], [23, 25], [25, 27], [27, 29], [29, 31],
  [24, 26], [26, 28], [28, 30], [30, 32],
];

export interface Limb {
  name: string;
  edge: [number, number];
  length: string;
  weight: string;
}

export const LIMBS: Limb[] = [
  { name: "Trunk", edge: [11, 23], length: "trunk_length", weight: "trunk" },
  { name: "Left upper arm", edge: [11, 13], length: "humerus_length", weight: "upper_arm_left" },
  { name: "Right upper arm", edge: [12, 14], length: "humerus_length", weight: "upper_arm_right" },
  { name: "Left forearm", edge: [13, 15], length: "forearm_length", weight: "forearm_left" },
  { name: "Right forearm", edge: [14, 16], length: "forearm_length", weight: "forearm_right" },
  { name: "Left thigh", edge: [23, 25], length: "femur_length", weight: "thigh_left" },
  { name: "Right thigh", edge: [24, 26], length: "femur_length", weight: "thigh_right" },
  { name: "Left shank", edge: [25, 27], length: "tibia_length", weight: "shank_left" },
  { name: "Right shank", edge: [26, 28], length: "tibia_length", weight: "shank_right" },
];

export const CHAT_SUGGESTIONS = [
  "How am I progressing over time?",
  "What are my best reps?",
  "How do I compare to the pro standard?",
  "What should I work on next?",
];

export interface LeaderboardCategory {
  key: string;
  label: string;
  icon: string;
  lower: boolean;
  unit: string;
  fields: string[];
  convert?: (value: number) => number;
}

export const LEADERBOARD_CATEGORIES: LeaderboardCategory[] = [
  { key: "changeOfDirection", label: "Agility", icon: "switch_access_shortcut", lower: true, unit: "s", fields: ["totalTime"] },
  { key: "sprint", label: "Sprint", icon: "sprint", lower: false, unit: "mph", fields: ["max_velocity", "maxVelocity"], convert: value => value * 2.23694 },
  { key: "jump", label: "Jump", icon: "jump_to_element", lower: false, unit: "in", fields: ["jumpHeight"], convert: value => value * 39.3701 },
  { key: "shooting", label: "Shooting", icon: "sports_soccer", lower: false, unit: "mph", fields: ["velocity"], convert: value => value * 2.23694 },
  { key: "dribbling", label: "Dribbling", icon: "sports_soccer", lower: true, unit: "s", fields: ["totalTime"] },
];

export function timestamp(value: any): Date | null {
  const date = value?.toDate?.() || (value instanceof Date ? value : value ? new Date(value) : null);
  return date && !Number.isNaN(date.valueOf()) ? date : null;
}

export function dateText(value: any): string {
  const date = timestamp(value);
  return date
    ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date)
    : "Recently";
}

export function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function initials(name: any): string {
  return String(name || "A").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}

export interface BodyPoint {
  id: number;
  x: number | null;
  y: number | null;
  z: number | null;
  visibility: number;
}

export function normalizePose(raw: any): BodyPoint[] {
  const source = Array.isArray(raw?.[0]) && typeof raw[0][0] === "number" ? raw : (Array.isArray(raw?.landmarks) ? raw.landmarks : raw);
  return (Array.isArray(source) ? source : []).map((point: any, index: number) => ({
    id: index,
    x: number(Array.isArray(point) ? point[0] : point?.x),
    y: number(Array.isArray(point) ? point[1] : point?.y),
    z: number(Array.isArray(point) ? point[2] : point?.z),
    visibility: number(Array.isArray(point) ? point[3] : point?.visibility) ?? 1,
  }));
}

// Body Profile physical stats (renderBodyProfile's inline formatting).
export function heightText(heightCm: number | null): string {
  return heightCm ? `${Math.floor(heightCm / 30.48)}′ ${Math.round((heightCm / 2.54) % 12)}″` : "—";
}

export function weightText(weightKg: number | null): string {
  return weightKg ? `${Math.round(weightKg * 2.20462)} lbs` : "—";
}

// setupBodyCanvas' nearest-limb hit test (34px threshold), extracted pure.
export function nearestLimb(
  points: BodyPoint[],
  click: { x: number; y: number },
  width: number,
  height: number,
): Limb | null {
  let nearest: Limb | null = null;
  let nearestDistance = 34;
  LIMBS.forEach(limb => {
    const a = points[limb.edge[0]], b = points[limb.edge[1]];
    if (!a || !b) return;
    const p = { x: (a.x ?? 0) * width, y: (a.y ?? 0) * height };
    const q = { x: (b.x ?? 0) * width, y: (b.y ?? 0) * height };
    const dx = q.x - p.x, dy = q.y - p.y;
    const t = Math.max(0, Math.min(1, ((click.x - p.x) * dx + (click.y - p.y) * dy) / Math.max(1, dx * dx + dy * dy)));
    const distance = Math.hypot(click.x - (p.x + t * dx), click.y - (p.y + t * dy));
    if (distance < nearestDistance) {
      nearest = limb;
      nearestDistance = distance;
    }
  });
  return nearest;
}

export function currentWeek(plan: any): number {
  const start = new Date(`${plan.startDate}T00:00:00`);
  if (Number.isNaN(start.valueOf())) return 1;
  return Math.min(
    Math.max(Math.floor((Date.now() - start.valueOf()) / 604800000) + 1, 1),
    number(plan.horizonWeeks) || (plan.weeks || []).length || 1,
  );
}

export function statsSnapshot(profile: any): any {
  return {
    schemaVersion: 1,
    benchmarkProfile: { ageBand: "senior", gender: "unspecified", isDefaulted: true },
    totalReps: profile.totalReps,
    totalSessions: profile.totalSessions,
    ...(profile.overall === null ? {} : { overallScore: Math.max(0, Math.min(400, Number(profile.overall.toFixed(2)))) }),
    axes: profile.axes.map((axis: any) => ({
      axis: axis.key,
      repCount: axis.repCount,
      missingDrills: [],
      ...(axis.score === null ? {} : { score: Math.max(0, Math.min(400, Number(axis.score.toFixed(2)))) }),
    })),
    drills: [],
  };
}

export function demoPlan(): any {
  return {
    id: "preview-plan",
    status: "active",
    startDate: new Date().toISOString().slice(0, 10),
    horizonWeeks: 6,
    intake: { daysPerWeek: 3, minutesPerSession: 60 },
    assessment: { summary: "Build first-step speed while maintaining power and ball control." },
    focusAreas: [
      { domain: "speedAgility", rationale: "Your acceleration has the clearest opportunity for improvement." },
      { domain: "strengthPower", rationale: "Power work supports sprint and jump performance." },
    ],
    weeks: Array.from({ length: 6 }, (_, index) => ({
      weekNumber: index + 1,
      theme: index === 5 ? "Retest and review" : `Build the base ${index + 1}`,
      focus: "Quality movement, controlled volume, and consistent technique.",
      progressionNote: "Complete each exposure with full recovery.",
      targets: [
        { domain: "speedAgility", exposures: 2, note: "short, high-quality efforts" },
        { domain: "strengthPower", exposures: 1, note: "explosive movement" },
      ],
      drills: index === 5 ? [] : [{ drillId: "SPD-010", name: "Acceleration starts", domain: "speedAgility", sets: 4, reps: 3, repUnit: "reps", restSeconds: 60 }],
    })),
  };
}

export interface StandingRow {
  id: string;
  name: string;
  value: number;
}

export interface RankedRow extends StandingRow {
  rank: number;
}

// renderBoard's sort + tied-rank assignment (ties within .0001 share a rank).
export function rankRows(rows: StandingRow[], lower: boolean): RankedRow[] {
  const sorted = [...rows].sort((a, b) => (lower ? a.value - b.value : b.value - a.value));
  let prior: number | null = null;
  let rank = 0;
  return sorted.map((row, index) => {
    if (prior === null || Math.abs(row.value - prior) > .0001) rank = index + 1;
    prior = row.value;
    return { ...row, rank };
  });
}

// renderBoard's athlete summary (rank / percentile) extracted pure.
export function boardSummary(
  ranked: RankedRow[],
  lower: boolean,
  playerId: string | null,
): { athlete: RankedRow | null; percentile: number | null } {
  const athlete = ranked.find(row => row.id === playerId) || null;
  const better = athlete
    ? ranked.filter(row => (lower ? row.value > athlete.value : row.value < athlete.value)).length
    : 0;
  const percentile = ranked.length > 1 && athlete ? Math.round(better / (ranked.length - 1) * 100) : null;
  return { athlete, percentile };
}

// loadTeamStandings' per-category best-result reduction, extracted pure.
export function boardsFromPlayers(
  players: { id: string; name: string; reps: any[] }[],
): Record<string, StandingRow[]> {
  return Object.fromEntries(LEADERBOARD_CATEGORIES.map(category => [
    category.key,
    players.map(player => {
      const values = player.reps
        .filter(rep => {
          const type = rep.repType || rep.drillType;
          return category.key === "shooting" ? ["deadballShot", "shooting", "side_kick"].includes(type) : type === category.key;
        })
        .map(rep => category.fields.map(field => number(rep[field])).find(value => value !== null))
        .filter((value): value is number => value !== undefined && value !== null);
      if (!values.length) return null;
      const raw = category.lower ? Math.min(...values) : Math.max(...values);
      return { id: player.id, name: player.name, value: category.convert ? category.convert(raw) : raw };
    }).filter((row): row is StandingRow => Boolean(row)),
  ]));
}
