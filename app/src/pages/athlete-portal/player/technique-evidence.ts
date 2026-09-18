import type { Row } from './execution';

export type EvidenceStep = { id: string; title: string; cue: string; detail: string; frame: number; joints: number[]; evidence?: string; counterpartFrame?: number };
const phases = ['backswing', 'contact', 'followThrough'];
const mpToCoco: Record<number, number> = { 0: 0, 11: 5, 12: 6, 13: 7, 14: 8, 15: 9, 16: 10, 23: 11, 24: 12, 25: 13, 26: 14, 27: 15, 28: 16 };
const limbJoints: Record<string, number[]> = { leftUpperArm: [11, 13], leftForearm: [13, 15], rightUpperArm: [12, 14], rightForearm: [14, 16], leftThigh: [23, 25], leftShin: [25, 27], rightThigh: [24, 26], rightShin: [26, 28], leftFoot: [29, 31], rightFoot: [30, 32], hips: [23, 24], shoulders: [11, 12], trunk: [11, 23] };
export function clipJoints(ids: unknown, pointCount: number): number[] {
  if (!Array.isArray(ids) || ![17, 33].includes(pointCount)) return [];
  return [...new Set(ids.filter((id): id is number => Number.isInteger(id) && id >= 0 && id < 33)
    .map(id => pointCount === 17 ? mpToCoco[id] : id).filter((id): id is number => Number.isInteger(id)))];
}
export function evidenceFrame(value: unknown, frameCount: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < frameCount ? value : null;
}
export function techniqueEvidence(report: Row | null): Row[] {
  return Array.isArray(report?.evidence?.rows) ? report.evidence.rows : Array.isArray(report?.metrics) ? report.metrics : [];
}
export function eligibleTechniqueEvidence(row: Row): boolean {
  return typeof row.eligible === 'boolean' ? row.eligible : row.valid === true;
}
function singleFrame(report: Row | null, row: Row, count: number): number | null {
  // Modern evidence carries its actual source index. In particular, an event must
  // never silently borrow the named phase's frame when its own frame is missing.
  const value = 'frame' in row ? row.frame : 'athleteFrame' in row ? row.athleteFrame : String(row.id).startsWith('event.') ? null : report?.keyFrames?.[row.frameKey];
  return evidenceFrame(value, count);
}
/** A correction belongs to the current server-confirmed source, never just a rep name. */
export function boundFeedback(correction: Row | null, source: Row | null, target: { playerId: string; type: 'single' | 'comparison'; id: string }): Row | null {
  if (!correction || correction.playerId !== target.playerId || correction.targetType !== target.type || correction.targetId !== target.id || !correction.feedback) return null;
  if (source) {
    if (source.playerId !== target.playerId || (target.type === 'single' ? source.repId !== target.id : (source.comparisonId || source.id) !== target.id)) return null;
    return typeof source.jobId === 'string' && source.jobId.length > 0 && correction.sourceJobId === source.jobId ? correction : null;
  }
  return target.type === 'single' && !correction.sourceJobId ? correction : null;
}
export function supportedComparison(comparison: Row, playerId: string, reps: Row[]): boolean {
  return comparison.playerId === playerId && typeof comparison.jobId === 'string' && comparison.jobId.length > 0 &&
    !!comparison.leftRepId && comparison.leftRepId !== comparison.rightRepId &&
    reps.some(rep => rep.id === comparison.leftRepId && rep.strike_foot === 'left') &&
    reps.some(rep => rep.id === comparison.rightRepId && rep.strike_foot === 'right');
}
function annotations(feedback: Row | null, repId: string, frameCount: number, pointCount: number): EvidenceStep[] {
  return (Array.isArray(feedback?.annotations) ? feedback.annotations : []).flatMap((annotation: Row) => {
    const frame = evidenceFrame(annotation.frame, frameCount);
    if (annotation.repId !== repId || frame === null) return [];
    return [{ id: `annotation:${annotation.id}`, title: 'Coach’s marked frame', cue: String(annotation.comment || ''), detail: String(annotation.phase || ''), frame,
      joints: clipJoints((annotation.limbs || []).flatMap((limb: string) => limbJoints[limb] || []), pointCount) }];
  });
}
export function singleEvidenceSteps(report: Row | null, feedback: Row | null, repId: string, frameCount: number, pointCount: number): EvidenceStep[] {
  const focuses = feedback ? feedback.feedback.focusAreas : report?.focusAreas;
  const metrics = techniqueEvidence(report);
  const steps = (Array.isArray(focuses) ? focuses : []).flatMap((focus: Row, index: number) => {
    const ids = Array.isArray(focus.evidenceIds) && focus.evidenceIds.length ? focus.evidenceIds : focus.metricIds;
    const citations = metrics.filter(metric => Array.isArray(ids) && ids.includes(metric.id) && eligibleTechniqueEvidence(metric) && (!metric.repId || metric.repId === repId));
    const cited = citations.find(metric => singleFrame(report, metric, frameCount) !== null);
    const frame = cited ? singleFrame(report, cited, frameCount) : Array.isArray(ids) && ids.length ? null : phases.includes(focus.frameKey) ? evidenceFrame(report?.keyFrames?.[focus.frameKey], frameCount) : null;
    if (frame === null) return [];
    return [{ id: `focus:${focus.id || focus.observationId || index}`, title: String(focus.title || 'Technique finding'), cue: String(focus.cue || ''),
      detail: String(focus.whyItMatters || focus.observation || ''), frame,
      joints: clipJoints(cited ? citations.filter(metric => singleFrame(report, metric, frameCount) === frame).flatMap(metric => metric.jointIds || []) : focus.jointIds, pointCount), evidence: typeof focus.evidence === 'string' ? focus.evidence : undefined }];
  });
  return [...steps, ...annotations(feedback, repId, frameCount, pointCount)].sort((a, b) => a.frame - b.frame);
}
function comparisonFrame(comparison: Row, row: Row, foot: 'left' | 'right', count: number): number | null {
  // Events require their explicit source index; a missing event never borrows contact.
  const value = row[`${foot}Frame`] ?? (String(row.id).startsWith('event.') ? null : comparison[`${foot}KeyFrames`]?.[row.frameKey]);
  return evidenceFrame(value, count);
}
export function comparisonEvidenceSteps(comparison: Row, feedback: Row | null, foot: 'left' | 'right', frameCount: number, otherCount: number, pointCount: number): EvidenceStep[] {
  const focuses = feedback ? feedback.feedback.focusAreas : comparison.focusAreas;
  const differences: Row[] = Array.isArray(comparison.differences) ? comparison.differences : [];
  const other = foot === 'left' ? 'right' : 'left';
  const steps = (Array.isArray(focuses) ? focuses : []).flatMap((focus: Row, index: number) => {
    const row = differences.find(difference => focus.evidenceIds?.includes(difference.id) && difference.comparable === true &&
      [difference.left, difference.right, difference.delta].every(value => typeof value === 'number' && Number.isFinite(value)) &&
      comparisonFrame(comparison, difference, foot, frameCount) !== null && comparisonFrame(comparison, difference, other, otherCount) !== null);
    if (!row) return [];
    const frame = comparisonFrame(comparison, row, foot, frameCount)!;
    return [{ id: `comparison:${focus.id || focus.rank || index}`, title: String(focus.title || 'Compare this movement'), cue: String(focus.cue || ''), detail: String(focus.whyItMatters || focus.observation || ''),
      frame, counterpartFrame: comparisonFrame(comparison, row, other, otherCount)!, joints: [],
      evidence: `${String(row.metric).replaceAll('_', ' ')}: left ${row.left.toFixed(2)}, right ${row.right.toFixed(2)} ${row.units || ''}` }];
  });
  return [...steps, ...annotations(feedback, comparison[`${foot}RepId`], frameCount, pointCount)].sort((a, b) => a.frame - b.frame);
}
