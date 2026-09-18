import { domainLabel } from '../../../lib/contracts/types';
import { evidenceBasisLabel, methodologyPriorities } from '../../admin/lib/personalizedLogic';
import type { Row } from './execution';

const words = (value: string) => String(value).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
export function TrainingSheet({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; panel.current?.focus(); return () => { if (previous?.isConnected) previous.focus(); }; }, []);
  return <div className={`native-training-overlay ${className}`}><section className="native-training-sheet" role="dialog" aria-label={title} tabIndex={-1} ref={panel} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
    <header><h2>{title}</h2><button aria-label={`Close ${title}`} onClick={onClose}><NativeIcon name="close" size={16} /></button></header><div className="native-sheet-body">{children}</div>
  </section></div>;
}
export function trainingDomainIcon(domain: string) {
  return ({ linearSpeed: 'run', speed: 'run', verticalPower: 'arrow-up', horizontalPower: 'arrow-right', plyometrics: 'arrow-up', codAgility: 'agility', agility: 'agility', dribbling: 'soccer', passingReceiving: 'arrows-horizontal', passing: 'arrows-horizontal', shooting: 'soccer', strengthResilience: 'shield', strength: 'shield', representativeGames: 'court' } as Record<string, string>)[domain] || 'drills';
}
export function SavedPlanDetails({ plan }: { plan: Row }) {
  const priorities = methodologyPriorities(plan.assessment), intake = plan.intake || {};
  return <div className="native-plan-details"><header><p className="eyebrow">Plan details</p><h2>Your plan</h2></header><section className="portal-card"><p className="eyebrow">The big picture</p><p>{plan.assessment?.summary}</p><small>{plan.horizonWeeks} weeks · {plan.sessionsPerWeek || intake.sessionsPerWeek || intake.daysPerWeek} sessions per week · {plan.minutesPerSession || intake.minutesPerSession} minutes per session</small>{(plan.focusAreas || []).map((f: Row, i: number) => <p key={i}>{domainLabel(f.domain || f.title)}: {f.rationale || f.reason}</p>)}</section>
    {!!priorities.length && <section><h3>Why this plan fits you</h3>{priorities.map(priority => <section className="portal-card" key={priority.id}><strong>{priority.label}</strong><p>{priority.reason}</p><small>{evidenceBasisLabel(priority.evidenceBasis)}{priority.confidence ? ` · ${priority.confidence} confidence` : ''}</small>{priority.limitation && <p>{priority.limitation}</p>}{priority.progressCheck && <p>Progress check: {priority.progressCheck}</p>}</section>)}</section>}
    {!!plan.assessment?.findings?.length && <section><h3>Findings from your evidence</h3>{plan.assessment.findings.map((finding: Row, i: number) => <section className="portal-card" key={i}><strong>{domainLabel(finding.domain)}</strong>{finding.confidence && <small> · {finding.confidence} confidence</small>}<p>{finding.statement}</p>{finding.metricIds?.length > 0 && <small>From: {finding.metricIds.map(words).join(', ')}</small>}</section>)}</section>}
    {!!plan.assessment?.dataGaps?.length && <section><h3>What your data cannot show yet</h3><section className="portal-card"><ul>{plan.assessment.dataGaps.map((gap: string, i: number) => <li key={i}>{gap}</li>)}</ul></section></section>}
    <section><h3>What you told us</h3><section className="portal-card"><p>Goals: {intake.goals?.length ? intake.goals.map(words).join(', ') : 'Guided by your available evidence'}</p>{intake.freeTextGoals && <p>{intake.freeTextGoals}</p>}{intake.setting && <p>Setting: {words(intake.setting)}</p>}{intake.level && <p>Level: {words(intake.level)}</p>}<p>Equipment: {Array.isArray(intake.equipment) ? intake.equipment.length ? intake.equipment.map(words).join(', ') : 'None specified' : 'Not recorded'}</p>{plan.startDate && <p>Started: {plan.startDate}{plan.timezone ? ` · ${plan.timezone}` : ''}</p>}</section></section>
    {!!plan.disclaimers?.length && <section><h3>Worth knowing</h3><section className="portal-card">{plan.disclaimers.map((line: string, i: number) => <p key={i}>{line}</p>)}</section></section>}</div>;
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
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { NativeIcon } from './native-ui';
import './native-training.css';
