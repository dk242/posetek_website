export const USAGE_FEATURES = ['overview', 'results', 'training', 'workout', 'video', 'feed', 'planner', 'other'] as const;
export type UsageFeature = typeof USAGE_FEATURES[number];
export type UsageInterval = { startedAtMillis: number; endedAtMillis: number; feature: UsageFeature };
export type UsageBatch = { schemaVersion: 1; sessionId: string; sequence: number; platform: 'web'; build: string; intervals: UsageInterval[] };
export const IDLE_MS = 120000;
export const OFFLINE_MS = 72 * 3600000;

export class EngagementClock {
  private lastMono: number;
  private lastWall: number;
  private interacted: number;
  private visible = false;
  private feature: UsageFeature | null = null;
  private passiveUntil = { workout: 0, video: 0 };
  constructor(mono: number, wall: number) { this.lastMono = this.interacted = mono; this.lastWall = wall; }
  configure(visible: boolean, feature: UsageFeature | null) { this.visible = visible; this.feature = feature; }
  interact(mono: number) { this.interacted = mono; }
  progress(feature: 'workout' | 'video', mono: number) { this.passiveUntil[feature] = mono + 1500; }
  stopProgress(feature?: 'workout' | 'video') { if (feature) this.passiveUntil[feature] = 0; else this.passiveUntil = { workout: 0, video: 0 }; }
  sample(mono: number, wall: number): UsageInterval[] {
    const before = this.lastMono, wallBefore = this.lastWall;
    this.lastMono = mono; this.lastWall = wall;
    const elapsed = mono - before;
    // A suspended timer or changed wall clock cannot manufacture activity.
    if (!this.visible || !this.feature || elapsed <= 0 || elapsed > 5000 || Math.abs((wall - wallBefore) - elapsed) > 2000) return [];
    const idleEnd = this.interacted + IDLE_MS;
    const boundaries = [...new Set([before, mono, idleEnd, ...Object.values(this.passiveUntil)])]
      .filter(value => value >= before && value <= mono).sort((a, b) => a - b);
    const rows: UsageInterval[] = [];
    for (let index = 1; index < boundaries.length; index++) {
      const start = boundaries[index - 1], end = boundaries[index];
      const feature = this.passiveUntil.workout > start ? 'workout' : this.passiveUntil.video > start ? 'video' : start < idleEnd ? this.feature : null;
      if (feature && end > start) rows.push({ startedAtMillis: Math.round(wallBefore + start - before), endedAtMillis: Math.round(wallBefore + end - before), feature });
    }
    return rows;
  }
}

export function appendInterval(rows: UsageInterval[], row: UsageInterval): UsageInterval[] {
  if (row.endedAtMillis <= row.startedAtMillis) return rows;
  const last = rows.at(-1);
  if (last && last.feature === row.feature && last.endedAtMillis === row.startedAtMillis && row.endedAtMillis - last.startedAtMillis <= 60000) {
    return [...rows.slice(0, -1), { ...last, endedAtMillis: row.endedAtMillis }];
  }
  return [...rows, row];
}
export function validSavedBatch(batch: unknown, now: number): batch is UsageBatch {
  const b = batch as UsageBatch;
  return !!b && Object.keys(b).sort().join(',') === 'build,intervals,platform,schemaVersion,sequence,sessionId'
    && b.schemaVersion === 1 && b.platform === 'web' && typeof b.sessionId === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(b.sessionId)
    && Number.isSafeInteger(b.sequence) && b.sequence >= 0 && typeof b.build === 'string' && /^[A-Za-z0-9._+()-]{1,64}$/.test(b.build)
    && Array.isArray(b.intervals) && b.intervals.length > 0 && b.intervals.length <= 60 && b.intervals.every(r => r && Object.keys(r).sort().join(',') === 'endedAtMillis,feature,startedAtMillis' && USAGE_FEATURES.includes(r.feature)
      && Number.isSafeInteger(r.startedAtMillis) && Number.isSafeInteger(r.endedAtMillis) && r.startedAtMillis >= now - OFFLINE_MS
      && r.endedAtMillis <= now + 60000 && r.endedAtMillis > r.startedAtMillis && r.endedAtMillis - r.startedAtMillis <= 60000);
}
export function featureForLocation(path: string, query: string): UsageFeature | null {
  const q = new URLSearchParams(query);
  if (q.has('preview') || q.has('share') || q.has('viewAs')) return null;
  if (path === '/feed' || path === '/feed.html') return 'feed';
  if (path === '/programs') return 'planner';
  if (path !== '/athlete' && path !== '/profile.html') return null;
  if (q.has('session') || q.has('drill') || ['drills', 'results'].includes(q.get('view') || '')) return 'results';
  if (q.get('view') === 'training') return 'training';
  if (q.get('view') === 'aiCoach') return 'planner';
  return 'overview';
}
