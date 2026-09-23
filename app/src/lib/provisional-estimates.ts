import { resultUsable } from './result-values';

/** Separate coaching evidence. Never pass this object as a measured rep. */
export interface ProvisionalEstimate {
  id: string;
  repId: string;
  drill: 'dribbling' | 'changeOfDirection';
  axis: 'ballControl' | 'agility';
  kind: 'conditionalEstimate';
  method: 'constant_return_pace_v1' | 'partial_shuttle_visual_start_v1';
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
    const dribbling = entry.drill === 'dribbling' && entry.axis === 'ballControl' && entry.method === 'constant_return_pace_v1';
    const agility = entry.drill === 'changeOfDirection' && entry.axis === 'agility' && entry.method === 'partial_shuttle_visual_start_v1';
    return typeof entry.id === 'string' && typeof entry.repId === 'string'
      && (dribbling || agility) && entry.kind === 'conditionalEstimate'
      && entry.confidence === 'low'
      && [entry.estimatedTotalSeconds, entry.lowerSeconds, entry.upperSeconds,
        entry.observedCourseFraction, entry.recordedAtMillis, entry.reviewedAtMillis]
        .every(v => typeof v === 'number' && Number.isFinite(v))
      && entry.lowerSeconds >= 2 && entry.upperSeconds <= 60
      && entry.lowerSeconds <= entry.estimatedTotalSeconds && entry.estimatedTotalSeconds <= entry.upperSeconds
      && entry.observedCourseFraction >= (agility ? .6 : .75) && entry.observedCourseFraction < 1
      && entry.recordedAtMillis > 0 && entry.reviewedAtMillis >= entry.recordedAtMillis
      && typeof entry.assumption === 'string' && typeof entry.limitation === 'string';
  }).slice(0, 10);
}

export function provisionalDribbling(estimates: unknown, reps: Record<string, any>[]): ProvisionalEstimate | null {
  return provisionalForDrill(estimates, reps, 'dribbling');
}

export function provisionalForDrill(estimates: unknown, reps: Record<string, any>[], drill: ProvisionalEstimate['drill']): ProvisionalEstimate | null {
  const attempts = reps.filter(rep => (rep._statsDrill || rep.repType || rep.drillType) === drill);
  if (attempts.some(resultUsable)) return null;
  const eligible = parseProvisionalEstimates(estimates).filter(estimate => estimate.drill === drill && attempts.some(rep =>
    rep.id === estimate.repId && rep.resultStatus?.qualified === false && !rep.resultStatus?.duplicate
    && rep.createdAtMillis === estimate.recordedAtMillis));
  return eligible.sort((a, b) => b.reviewedAtMillis - a.reviewedAtMillis || a.id.localeCompare(b.id))[0] || null;
}

export function activeProvisionalEstimates(estimates: unknown, reps: Record<string, any>[]): ProvisionalEstimate[] {
  return (['dribbling', 'changeOfDirection'] as const).map(drill => provisionalForDrill(estimates, reps, drill))
    .filter((entry): entry is ProvisionalEstimate => entry !== null);
}

export function provisionalScore(estimate: ProvisionalEstimate | null, reference: number | null): number | null {
  return estimate && reference && reference > 0 ? 100 * reference / estimate.estimatedTotalSeconds : null;
}

/** Plain factual context, separate from best results and scoring inputs. */
export function estimatePlanningContext(estimate: ProvisionalEstimate | ProvisionalEstimate[] | null): string {
  if (Array.isArray(estimate)) return estimate.map(entry => estimatePlanningContext(entry)).join(' ');
  if (!estimate) return '';
  if (estimate.drill === 'changeOfDirection') return `One-time agility estimate: ~${estimate.estimatedTotalSeconds.toFixed(1)}s (${estimate.lowerSeconds.toFixed(1)}–${estimate.upperSeconds.toFixed(1)}s pace scenario). `
    + `Coach-confirmed shuttle; visual start, ~${Math.round(estimate.observedCourseFraction * 100)}% course seen. Most return projected; low confidence, not measured. Speed/agility priority pending retest.`;
  return `One-time dribbling estimate: ~${estimate.estimatedTotalSeconds.toFixed(1)}s (${estimate.lowerSeconds.toFixed(1)}–${estimate.upperSeconds.toFixed(1)}s at ±20% return pace). `
    + `Finish missing; low-confidence assumption, not a measured test or agility result. Dribbling is a coaching priority pending retest.`;
}
