import { resultUsable } from './result-values';

/** Separate coaching evidence. Never pass this object as a measured rep. */
export interface ProvisionalEstimate {
  id: string;
  repId: string;
  drill: 'dribbling';
  axis: 'ballControl';
  kind: 'conditionalEstimate';
  method: 'constant_return_pace_v1';
  estimatedTotalSeconds: number;
  lowerSeconds: number;
  upperSeconds: number;
  observedCourseFraction: number;
  recordedAtMillis: number;
  reviewedAtMillis: number;
  confidence: 'low';
  assumption: string;
  limitation: string;
}

export function parseProvisionalEstimates(value: unknown): ProvisionalEstimate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is ProvisionalEstimate => {
    if (!entry || typeof entry !== 'object') return false;
    return typeof entry.id === 'string' && typeof entry.repId === 'string'
      && entry.drill === 'dribbling' && entry.axis === 'ballControl'
      && entry.kind === 'conditionalEstimate' && entry.method === 'constant_return_pace_v1'
      && entry.confidence === 'low'
      && [entry.estimatedTotalSeconds, entry.lowerSeconds, entry.upperSeconds,
        entry.observedCourseFraction, entry.recordedAtMillis, entry.reviewedAtMillis]
        .every(v => typeof v === 'number' && Number.isFinite(v))
      && entry.lowerSeconds >= 2 && entry.upperSeconds <= 60
      && entry.lowerSeconds <= entry.estimatedTotalSeconds && entry.estimatedTotalSeconds <= entry.upperSeconds
      && entry.observedCourseFraction >= .75 && entry.observedCourseFraction < 1
      && entry.recordedAtMillis > 0 && entry.reviewedAtMillis >= entry.recordedAtMillis
      && typeof entry.assumption === 'string' && typeof entry.limitation === 'string';
  }).slice(0, 10);
}

export function provisionalDribbling(estimates: unknown, reps: Record<string, any>[]): ProvisionalEstimate | null {
  const dribbles = reps.filter(rep => (rep._statsDrill || rep.repType || rep.drillType) === 'dribbling');
  if (dribbles.some(resultUsable)) return null;
  const eligible = parseProvisionalEstimates(estimates).filter(estimate => dribbles.some(rep =>
    rep.id === estimate.repId && rep.resultStatus?.qualified === false && !rep.resultStatus?.duplicate
    && rep.createdAtMillis === estimate.recordedAtMillis));
  return eligible.sort((a, b) => b.reviewedAtMillis - a.reviewedAtMillis || a.id.localeCompare(b.id))[0] || null;
}

export function provisionalScore(estimate: ProvisionalEstimate | null, reference: number | null): number | null {
  return estimate && reference && reference > 0 ? 100 * reference / estimate.estimatedTotalSeconds : null;
}

/** Plain factual context, separate from best results and scoring inputs. */
export function estimatePlanningContext(estimate: ProvisionalEstimate | null): string {
  if (!estimate) return '';
  return `One-time dribbling estimate: ~${estimate.estimatedTotalSeconds.toFixed(1)}s (${estimate.lowerSeconds.toFixed(1)}–${estimate.upperSeconds.toFixed(1)}s at ±20% return pace). `
    + `Finish missing; low-confidence assumption, not a measured test or agility result. Dribbling is a coaching priority pending retest.`;
}
