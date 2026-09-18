import { domainLabel } from '../../../lib/contracts/types';
import { evidenceBasisLabel, methodologyPriorities } from '../../admin/lib/personalizedLogic';
import type { Row } from './execution';

const words = (value: string) => String(value).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
export function SavedPlanDetails({ plan }: { plan: Row }) {
  const priorities = methodologyPriorities(plan.assessment), intake = plan.intake || {};
  return <><h2>Plan details</h2><p>{plan.assessment?.summary}</p>
    <p>{plan.horizonWeeks} weeks · {plan.sessionsPerWeek || intake.sessionsPerWeek || intake.daysPerWeek} sessions per week · {plan.minutesPerSession || intake.minutesPerSession} minutes per session</p>
    <p>Goals: {intake.goals?.length ? intake.goals.map(words).join(', ') : 'Guided by your available evidence'}</p>
    {intake.freeTextGoals && <p>{intake.freeTextGoals}</p>}
    {(plan.focusAreas || []).map((f: Row, i: number) => <p key={i}>{domainLabel(f.domain || f.title)}: {f.rationale || f.reason}</p>)}
    {!!priorities.length && <details><summary>Why this plan fits you</summary>{priorities.map(priority => <div key={priority.id}><strong>{priority.label}</strong><p>{priority.reason}</p><small>{evidenceBasisLabel(priority.evidenceBasis)}{priority.confidence ? ` · ${priority.confidence} confidence` : ''}</small>{priority.limitation && <p>{priority.limitation}</p>}{priority.progressCheck && <p>Progress check: {priority.progressCheck}</p>}</div>)}</details>}
    {!!plan.assessment?.findings?.length && <details><summary>Findings from your evidence</summary>{plan.assessment.findings.map((finding: Row, i: number) => <div key={i}><strong>{domainLabel(finding.domain)}</strong>{finding.confidence && <small> · {finding.confidence} confidence</small>}<p>{finding.statement}</p>{finding.metricIds?.length > 0 && <small>From: {finding.metricIds.map(words).join(', ')}</small>}</div>)}</details>}
    {!!plan.assessment?.dataGaps?.length && <details><summary>What your data cannot show yet</summary><ul>{plan.assessment.dataGaps.map((gap: string, i: number) => <li key={i}>{gap}</li>)}</ul></details>}
    <details><summary>Your training settings</summary>{intake.setting && <p>Setting: {words(intake.setting)}</p>}{intake.level && <p>Level: {words(intake.level)}</p>}<p>Equipment: {Array.isArray(intake.equipment) ? intake.equipment.length ? intake.equipment.map(words).join(', ') : 'None specified' : 'Not recorded'}</p>{plan.startDate && <p>Started: {plan.startDate}{plan.timezone ? ` · ${plan.timezone}` : ''}</p>}</details>
    <p>{(plan.disclaimers || []).join(' ')}</p></>;
}

/** Only link references with a known drill and an explicit session identity. */
export function recordedSessionLink(ref: Row, playerId: string, preview = false): string | null {
  const drill = ({ deadballShot: 'shooting', side_kick: 'shooting', shooting: 'shooting', jump: 'jump', sprint: 'sprint', broadJump: 'broadJump', changeOfDirection: 'changeOfDirection', dribbling: 'dribbling', freeRecord: 'freeRecord' } as Record<string, string>)[ref.drillType];
  const number = Number(ref.sessionNumber);
  const folder = /^session\d+$/.test(ref.sessionFolder || '') ? ref.sessionFolder : Number.isInteger(number) && number > 0 ? `session${number}` : null;
  if (!drill || !folder) return null;
  const params = new URLSearchParams({ player: playerId, view: 'drills', drill, session: folder });
  if (preview) params.set('preview', '1');
  return `/athlete?${params}`;
}
