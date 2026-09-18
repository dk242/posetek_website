import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../../lib/firebase';
import { currentWeekNumber, nextWorkout, orderedWeeks, orderedWorkouts, stateOf, workoutStates, findWorkout, weekWindow, weekWindowLabel, localDayString, daysBetween } from '../../../lib/contracts/planV3';
import { blockDoseLine } from '../../../lib/contracts/drillV2';
import { domainLabel } from '../../../lib/contracts/types';
import { submitLlmJob, waitForJob } from '../lib/loaders';
import { dateText } from '../lib/mobile';
import type { PortalContext } from '../views/shared';
import TrainingView from '../views/TrainingView';
import '../views/training-hub.css';
import { completedMinutes, executable, savedWorkout, unfinishedWorkout } from './execution';
import type { Row } from './execution';
import { usePlayerWorkouts } from './use-player-workouts';
import { capabilityEnabled, useCoachConfig } from './gateway';
import ProgramIntake from './ProgramIntake';
import PlayerWorkout from './PlayerWorkout';
import DrillMedia from './DrillMedia';
import CoachChat from './CoachChat';
import { weekProgress } from './progress';
import { SavedPlanDetails, recordedSessionLink, TrainingSheet, trainingDomainIcon } from './training-details';
import { NativeIcon } from './native-ui';
import './native-training.css';

export function previewProgram(): Row {
  const today = new Date();
  return { id: 'preview-plan', schemaVersion: 3, status: 'active', horizonWeeks: 2, startDate: today.toLocaleDateString('en-CA'), timezone: 'America/Los_Angeles', sessionsPerWeek: 2, minutesPerSession: 30,
    assessment: { summary: 'A focused block to improve close control and quick changes of direction.' }, intake: { goals: ['dribbling', 'speedAgility'], setting: 'solo' },
    weeks: [1, 2].map(weekNumber => ({ weekNumber, theme: weekNumber === 1 ? 'Own your first touch' : 'Keep control at speed', focus: 'Stay controlled, then build speed.', targets: [{ domain: 'dribbling', exposures: 2 }, { domain: 'passing', exposures: 2 }],
      workouts: [1, 2].map(order => ({ workoutId: `w${weekNumber}s${order}`, revision: 1, order, title: order === 1 ? 'Keep the ball close' : 'Quick feet, sharp turns', intent: 'Build clean touches and stay balanced.', estimatedMinutes: 28, budgetMinutes: 30, focusDomains: ['dribbling', 'passing'],
        blocks: [{ blockId: 'b1', order: 1, drillId: 'DRB-005', name: 'Cone maze', kind: 'main', domain: 'dribbling', sets: 3, reps: 60, repUnit: 'seconds', restSeconds: 30, restScope: 'sets', estimatedMinutes: 14, cues: ['Small touches', 'Eyes up'] }, { blockId: 'b2', order: 2, drillId: 'PAS-001', name: 'Wall pass rhythm', kind: 'main', domain: 'passing', sets: 3, reps: 60, repUnit: 'seconds', restSeconds: 30, restScope: 'sets', estimatedMinutes: 12, cues: ['Open your body'] }] })) })) };
}

export default function PlayerTraining({ ctx, statsProfile, request, onAcknowledge }: { ctx: PortalContext; statsProfile: Row; request: Row | null; onAcknowledge: () => void }) {
  const preview = ctx.access === 'preview';
  const [plans, setPlans] = useState<Row[] | null>(preview ? [previewProgram()] : null), [error, setError] = useState('');
  const [intake, setIntake] = useState(false), [seed, setSeed] = useState(''), [reveal, setReveal] = useState(false);
  const [selected, setSelected] = useState<number | null>(null), [panel, setPanel] = useState('');
  const [review, setReview] = useState<Row | null>(null), [playing, setPlaying] = useState<Row | null>(null), [drillId, setDrillId] = useState('');
  const [chatTarget, setChatTarget] = useState<Row | null>(null), [proposal, setProposal] = useState<Row | null>(null);
  const [applying, setApplying] = useState(false), [newTime, setNewTime] = useState(30), [energy, setEnergy] = useState('normal'), [focus, setFocus] = useState<string[]>([]);
  const config = useCoachConfig(preview);
  const trainingSurface = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const plan = plans?.find(p => p.status === 'active') || plans?.find(p => p.status === 'completed') || null;
  const store = usePlayerWorkouts(ctx.playerId!, playing?.planId || plan?.id || null, preview);
  const [recordedSessions, setRecordedSessions] = useState<Row[]>([]);
  useEffect(() => {
    if (preview) return;
    return db.collection('players').doc(ctx.playerId!).collection('trainingSessions').onSnapshot(s => setRecordedSessions(s.docs.map(d => ({ ...d.data(), id: d.id }))), e => setError(e.message));
  }, [ctx.playerId, preview]);
  useEffect(() => {
    if (preview) return;
    return db.collection('players').doc(ctx.playerId!).collection('trainingPlans').onSnapshot(s => {
      setPlans(s.docs.map(d => ({ ...d.data(), id: d.id })).sort((a: Row, b: Row) => (b.generatedAt?.toMillis?.() || 0) - (a.generatedAt?.toMillis?.() || 0)));
      setError('');
    }, e => setError(e.message));
  }, [ctx.playerId, preview]);
  useEffect(() => {
    if (!request || !plans || playing || review || chatTarget) return;
    setSeed(request.request || '');
    if (request.destination !== 'program_intake' && plan?.schemaVersion === 3 && plan.status === 'active') {
      const supplied = request.workoutRef;
      setChatTarget(supplied && (supplied.kind === 'adhoc' || (['new', 'plan'].includes(supplied.kind) && supplied.planId === plan.id)) ? supplied : { kind: 'new', planId: plan.id, timeAvailableMinutes: 30, energy: 'normal' });
    } else setIntake(true);
    onAcknowledge();
  }, [request, plans, playing, review, chatTarget]);
  const start = async (w: Row) => { try {
    const ready = await store.start(w);
    if (!mounted.current) return;
    // A slow acknowledged start can finish after a tab switch. The saved
    // session remains resumable, but it must not begin timing off-screen.
    setPlaying({ ...ready, pausedOnOpen: document.hidden || !trainingSurface.current?.getClientRects().length }); setReview(null); setChatTarget(null);
  } catch { /* store owns error */ } };
  const apply = async (andStart: boolean) => {
    if (!proposal || applying) return;
    setApplying(true); setError('');
    const stops: (() => void)[] = [];
    try {
      const ref = await submitLlmJob(ctx.playerId!, 'apply_workout_draft', { draftId: proposal.draftId });
      const job = await waitForJob(ref.id, () => {}, u => stops.push(u));
      if (!mounted.current) return;
      const result = job.result;
      if (!result?.applied || !['plan', 'adhoc'].includes(result.target?.kind)) throw new Error('The saved workout reference is unavailable. Retry this proposal.');
      if (result.target.kind === 'plan' && (result.target.planId !== proposal.target?.planId || result.target.workoutId !== proposal.target?.workoutId)) throw new Error('The saved target does not match this proposal. Reload training.');
      let ready: Row;
      if (result.target.kind === 'plan') {
        const doc = await db.collection('players').doc(ctx.playerId!).collection('trainingPlans').doc(result.target.planId).get({ source: 'server' });
        const p = { ...doc.data(), id: doc.id }, found = findWorkout(p, result.target.workoutId);
        if (!found) throw new Error('The saved workout could not be loaded. Refresh training.');
        ready = executable(p, found.workout, found.week.weekNumber);
      } else {
        const doc = await db.collection('players').doc(ctx.playerId!).collection('plannedWorkouts').doc(result.target.plannedWorkoutId).get({ source: 'server' });
        if (!doc.exists) throw new Error('The saved workout could not be loaded.');
        ready = executable(plan!, { ...doc.data(), id: doc.id }, doc.data()!.weekNumber, 'adhoc'); store.noteWorkout(ready);
      }
      if (!mounted.current) return;
      setChatTarget(null); setProposal(null); setReview(ready);
      if (andStart) await start(ready);
    } catch (e: any) { setError(e.message); }
    finally { setApplying(false); stops.forEach(s => s()); }
  };
  const logs = Object.values(store.logs);
  const weekNumber = selected || (plan ? currentWeekNumber(plan) : 1);
  const week = plan && orderedWeeks(plan).find(w => w.weekNumber === weekNumber);
  const next = plan && nextWorkout(plan, logs);
  const unfinished = unfinishedWorkout(logs);
  const states = workoutStates(plan?.id || '', logs);
  const progress = plan ? weekProgress(plan, week || undefined, logs, ctx.allStatsReps(), recordedSessions) : null;
  const openPlan = () => { setSeed(''); setIntake(true); setPanel(''); };
  const back = <button className="text-button" disabled={applying} onClick={() => { setPanel(''); setReview(null); setChatTarget(null); setDrillId(''); setProposal(null); }}>← Training</button>;
  const message = (error || store.error) && <p className="player-error" role="alert">{error || store.error}</p>;

  if (playing) return <PlayerWorkout key={playing.id} workout={playing} store={store} playerId={ctx.playerId!} preview={preview} onExit={() => { const saved = store.logFor(playing.id); setPlaying(null); if (saved?.endedAt) setReview(savedWorkout(saved)); }} />;
  if (intake) return <ProgramIntake playerId={ctx.playerId!} athlete={ctx.athlete} statsProfile={statsProfile} preview={preview} initialText={seed} onReady={() => { setIntake(false); setReveal(true); }} onBack={() => setIntake(false)} />;
  if (!plans) return <section className="portal-card"><p>{error || 'Loading training…'}</p></section>;
  if (panel === 'history') return <>{back}<TrainingHistory playerId={ctx.playerId!} preview={preview} plans={plans} currentLogs={logs} onReview={w => { setPanel(''); setReview(w); }} /></>;
  if (drillId) return <><button className="text-button" onClick={() => setDrillId('')}>← Back</button><DrillMedia drillId={drillId} preview={preview} fallback={[...(review?.blocks || []), ...(proposal?.workout?.blocks || []), ...orderedWeeks(plan).flatMap(w => orderedWorkouts(w).flatMap(w => w.blocks || []))].find((b: Row) => b.drillId === drillId)} /></>;
  if (!plan && review) { const saved = store.logFor(review.id); return <section ref={trainingSurface} className="native-training">{back}<section className="portal-card"><p className="eyebrow">Saved workout</p><h2>{review.title}</h2><WorkoutBlocks workout={review} onDrill={setDrillId} />{saved && !saved.endedAt && <button className="primary-cta" disabled={store.saving || !store.logsLoaded} onClick={() => void start(review)}>Resume saved workout</button>}{message}</section></section>; }
  if (!plan) return <section className="native-training native-training-empty"><section className="portal-card"><NativeIcon name="sparkles" size={28} /><p className="eyebrow">Your next step</p><h2>Train with a plan built for you</h2><p>Your goals, your schedule, your next step. Build a focused training block from the evidence you have.</p><button className="primary-cta" onClick={openPlan}>Build my plan</button></section><button className="hub-secondary" onClick={() => setPanel('history')}><NativeIcon name="history" size={16} /> Training history</button><p className="muted-copy">Record drill tests and free sessions in the PoseTek app. Saved results are available in Drills.</p></section>;
  if (plan.schemaVersion !== 3) return <><button className="hub-secondary" onClick={openPlan}>Build a new plan</button><TrainingView ctx={ctx} /></>;
  if (panel === 'details') return <section className="native-training">{back}<SavedPlanDetails plan={plan} /><button className="hub-secondary" onClick={openPlan}>Start a new plan</button></section>;
  const currentWeek = currentWeekNumber(plan), window = weekWindow(plan, weekNumber);
  const daysLeft = window ? Math.max(0, daysBetween(localDayString(new Date(), plan.timezone), window.end) || 0) : null;
  const drills = [...new Map(orderedWorkouts(week).flatMap(w => w.blocks).map(b => [b.drillId, b])).values()];
  const closeOverlay = () => { if (!applying) { setReview(null); setChatTarget(null); setProposal(null); setPanel(''); } };
  const selectedLog = review && store.logFor(review.id), snapshot = selectedLog?.workoutSnapshot || review;
  const focusChoices = [...new Set<string>(orderedWorkouts(week).flatMap(w => w.focusDomains || w.blocks.map(b => b.domain)))];
  return <section ref={trainingSurface} className="player-training native-training">{message}
    {reveal && <section className="portal-card"><h2>Your plan is ready</h2><p>{plan.assessment?.summary}</p><button onClick={() => setReveal(false)}>Explore my plan</button></section>}
    {plan.status === 'completed' && <section className="portal-card"><h2>Block complete</h2><p>Review your work and build your next block.</p><button className="primary-cta" onClick={openPlan}>Plan my next block</button></section>}
    <section className="native-block-rail"><h2>The block</h2><nav className="player-week-rail" aria-label="Plan weeks">{orderedWeeks(plan).map(w => <button key={w.weekNumber} aria-pressed={w.weekNumber === weekNumber} onClick={() => { setSelected(w.weekNumber); setFocus([]); }}><strong className={w.weekNumber === currentWeek ? 'is-current' : ''}>Week {w.weekNumber}{w.weekNumber === currentWeek && <i aria-label="Current week" />}</strong><span>{w.theme}</span></button>)}</nav></section>
    <section className="portal-card native-week-card"><div className="native-card-heading"><p className="eyebrow">Week {weekNumber} of {plan.horizonWeeks}</p>{weekNumber === currentWeek && daysLeft !== null ? <span className="native-status">{daysLeft} {daysLeft === 1 ? 'day' : 'days'} left</span> : window && <small>{weekWindowLabel(window)}</small>}</div><button className="native-week-link" onClick={() => setPanel('week')}><h2>{week?.theme || `Week ${weekNumber}`}</h2><NativeIcon name="chevron-right" size={14} /></button><p>{week?.focus}</p></section>
    {unfinished && <button className="native-resume-note" disabled={!store.logsLoaded} onClick={() => setReview(unfinished)}><NativeIcon name="history" size={20} /><span>You have an unfinished workout. Tap to resume your saved session.{unfinished.planId !== plan.id && <small>From an earlier plan</small>}</span></button>}
    {next && <button className="portal-card native-next-workout" disabled={!store.logsLoaded} onClick={() => setReview(executable(plan, next.workout, next.weekNumber))}><span className="native-card-heading"><span className="eyebrow">Next workout</span><span className="native-status"><NativeIcon name={next.reason === 'resume' ? 'play' : 'circle'} size={12} />{next.reason === 'resume' ? 'In progress' : 'Ready'}</span></span><strong>{next.workout.title || `Week ${next.weekNumber} workout`}</strong>{next.workout.intent && <p>{next.workout.intent}</p>}<span className="native-next-meta">{next.workout.blocks.length} drills · ~{next.workout.estimatedMinutes} min{next.weekNumber !== currentWeek && ` · Week ${next.weekNumber}`}<NativeIcon name="arrow-up-right" size={17} /></span></button>}
    {!unfinished && !next && plan.status === 'active' && <section className="portal-card"><h2>You’ve reached the end of this schedule</h2><p>Review your progress or create a new workout.</p><button onClick={openPlan}>Build a new plan</button></section>}
    <WeekProgress plan={plan} week={week} logs={logs} reps={ctx.allStatsReps()} sessions={recordedSessions} />
    <details className="portal-card native-week-drills" key={weekNumber}><summary><span className="eyebrow">This week’s drills</span><span>{drills.length} drills <NativeIcon name="chevron-down" size={12} /></span></summary>{drills.map(b => <button className="native-drill-row" key={b.drillId} onClick={() => setDrillId(b.drillId)}><span className="native-domain-badge"><NativeIcon name={trainingDomainIcon(b.domain)} size={16} /></span><span><strong>{b.name}</strong><small>In {progress?.drillTargets[b.drillId] || 0} workouts this week</small></span><span className={`native-status ${(progress?.drillDone[b.drillId] || 0) >= (progress?.drillTargets[b.drillId] || 1) ? 'is-done' : ''}`}>{progress?.drillDone[b.drillId] || 0}/{progress?.drillTargets[b.drillId] || 0}</span><NativeIcon name="chevron-right" size={12} /></button>)}</details>
    {plan.status === 'active' && <button className="primary-cta native-create-workout" disabled={!capabilityEnabled(config, 'workout_chat')} onClick={() => setPanel('create')}><NativeIcon name="sparkles" size={18} />Create your workout</button>}
    <div className="native-training-links"><button onClick={() => setPanel('history')}><NativeIcon name="history" size={16} />History<NativeIcon name="chevron-right" size={12} /></button><button onClick={() => setPanel('details')}><NativeIcon name="document" size={16} />Plan details<NativeIcon name="chevron-right" size={12} /></button></div>
    {!!store.workouts.length && <details className="native-saved-workouts"><summary>Saved extra workouts</summary>{store.workouts.map(w => <button className="player-list-button" key={w.id} onClick={() => setReview(executable(plan, w, w.weekNumber, 'adhoc'))}>{w.title || 'Workout'}<small>{dateText(w.generatedAt)}</small></button>)}</details>}
    <p className="muted-copy">Record drill tests and free sessions in the PoseTek app. Your saved results and videos appear in Drills.</p>
    {panel === 'week' && <TrainingSheet title={`Week ${weekNumber}`} onClose={closeOverlay}><p className="eyebrow">Week {weekNumber} of {plan.horizonWeeks}</p><h2>{week?.theme}</h2><p>{week?.focus}</p>{window && <small>{weekWindowLabel(window)}</small>}{!!week?.allocations?.length && <section className="portal-card"><h3>Minutes this week</h3>{week.allocations.map(a => <p className="native-card-heading" key={a.domain}><span>{domainLabel(a.domain)}</span><strong>{a.minutes} min</strong></p>)}</section>}{!!week?.targets?.length && <section className="portal-card"><h3>This week asks for</h3>{week.targets.map(t => <p className="native-card-heading" key={t.domain}><span>{domainLabel(t.domain)}</span><strong>{t.exposures}×</strong></p>)}</section>}<h3>This week’s workouts</h3>{orderedWorkouts(week).map(w => <section className="portal-card" key={w.workoutId}><button className="native-week-link" onClick={() => { setPanel(''); setReview(executable(plan, w, weekNumber)); }}><strong>{w.title}</strong><NativeIcon name="chevron-right" size={14} /></button><p>{w.intent}</p><small>{stateOf(states, w.workoutId).kind === 'finished' ? 'Finished' : stateOf(states, w.workoutId).kind === 'inProgress' ? 'In progress' : 'Not started'} · ~{w.estimatedMinutes} min</small><WorkoutBlocks workout={w} onDrill={setDrillId} /></section>)}{week?.progressionNote && <section className="portal-card"><p className="eyebrow">What comes next</p><p>{week.progressionNote}</p></section>}</TrainingSheet>}
    {panel === 'create' && <TrainingSheet title="Create your workout" onClose={closeOverlay}><h3>How much time do you have?</h3><div className="native-time-choices">{[15, 30, 45, 60].map(n => <button key={n} aria-pressed={newTime === n} onClick={() => setNewTime(n)}>{n} min</button>)}</div><label className="native-custom-time">Custom minutes<input type="number" min={1} max={135} value={newTime} onChange={e => setNewTime(Number(e.target.value))} /></label><h3>How are you feeling?</h3><div className="native-energy-choices">{[{ id: 'low', name: 'Running on empty', detail: 'Keep it light — technique over intensity' }, { id: 'normal', name: 'Normal', detail: 'A standard session from this week’s plan' }, { id: 'high', name: 'Fresh', detail: 'Ready for max-quality work' }].map(e => <button key={e.id} aria-pressed={energy === e.id} onClick={() => setEnergy(e.id)}><NativeIcon name={energy === e.id ? 'check-circle' : 'circle'} size={20} /><span><strong>{e.name}</strong><small>{e.detail}</small></span></button>)}</div>{focusChoices.length > 0 && <><h3>What would you like to focus on?</h3><p className="muted-copy">Optional — your coach can choose.</p><div className="native-focus-choices">{focusChoices.map(domain => <button key={domain} aria-pressed={focus.includes(domain)} onClick={() => setFocus(f => f.includes(domain) ? f.filter(d => d !== domain) : [...f, domain])}>{domainLabel(domain)}</button>)}</div></>}<button className="primary-cta" disabled={!capabilityEnabled(config, 'workout_chat') || !Number.isInteger(newTime) || newTime < 1 || newTime > 135} onClick={() => { setSeed(`Build a ${newTime}-minute workout. My energy is ${energy}.${focus.length ? ` Focus on ${focus.map(domainLabel).join(', ')}.` : ''}`); setPanel(''); setChatTarget({ kind: 'new', planId: plan.id, timeAvailableMinutes: newTime, energy }); }}>Continue with workout coach</button><small>Review the proposal before saving. Up to three workout adjustment requests per day.</small></TrainingSheet>}
    {review && snapshot && <TrainingSheet title={selectedLog?.endedAt ? 'Saved workout' : 'Your workout'} onClose={closeOverlay}><p className="eyebrow">{selectedLog?.endedAt ? selectedLog.endReason === 'completed' ? 'Completed' : selectedLog.endReason === 'abandoned' ? 'Abandoned' : 'Ended early' : selectedLog ? 'In progress' : 'Ready'}</p><h2>{snapshot.title || 'Workout'}</h2><p>{snapshot.intent}</p><p>~{snapshot.estimatedMinutes} min · {snapshot.blocks?.length || 0} drills</p>{message}<WorkoutBlocks workout={snapshot} onDrill={setDrillId} />{selectedLog?.endedAt ? <><p>Saved {dateText(selectedLog.endedAt)}. Completed sets remain in your history.</p><Link to={preview ? '/feed?scope=mine&preview=1' : '/feed?scope=mine'}>Share your workout</Link></> : <button className="primary-cta" disabled={store.saving || !store.logsLoaded || (!selectedLog && plan?.status !== 'active')} onClick={() => void start(review)}>{store.saving ? 'Starting…' : selectedLog ? 'Resume workout' : 'Start workout'}</button>}{!selectedLog && plan.status === 'active' && <button className="hub-secondary" disabled={!capabilityEnabled(config, 'workout_chat')} onClick={() => { setSeed(''); setChatTarget(review.source === 'plan' ? { kind: 'plan', planId: plan.id, workoutId: review.workoutId } : { kind: 'adhoc', plannedWorkoutId: review.workoutId }); setReview(null); }}>Adjust with your coach</button>}</TrainingSheet>}
    {chatTarget && <TrainingSheet title={chatTarget.kind === 'new' ? 'Create your workout' : 'Adjust your workout'} className="native-workout-chat-sheet" onClose={closeOverlay}>{message}<CoachChat key={JSON.stringify(chatTarget)} playerId={ctx.playerId!} preview={preview} capability="workout_chat" context={{ workoutRef: chatTarget }} initialText={seed} onDraft={setProposal} />{proposal && <section className="portal-card"><p className="eyebrow">Proposed workout · not saved yet</p><h3>{proposal.workout?.title}</h3><p>{proposal.workout?.intent}</p><WorkoutBlocks workout={proposal.workout} onDrill={setDrillId} /><div className="player-actions"><button className="primary-cta" disabled={applying || !capabilityEnabled(config, 'apply_workout_draft')} onClick={() => void apply(false)}>{applying ? 'Saving…' : 'Save workout'}</button><button disabled={applying || !capabilityEnabled(config, 'apply_workout_draft')} onClick={() => void apply(true)}>Save and start</button></div></section>}</TrainingSheet>}
  </section>;
}
function WorkoutBlocks({ workout, onDrill }: { workout: Row; onDrill: (id: string) => void }) {
  return <div className="native-workout-blocks">{(workout?.blocks || []).map((b: Row) => <button className="native-drill-row" key={b.blockId} onClick={() => onDrill(b.drillId)}><span className="native-domain-badge"><NativeIcon name={trainingDomainIcon(b.domain)} size={16} /></span><span><strong>{b.name}</strong><small>{blockDoseLine({ ...b, sets: b.sets, reps: b.reps, repUnit: b.repUnit })}</small></span><NativeIcon name="chevron-right" size={12} /></button>)}</div>;
}

export function WeekProgress({ plan, week, logs, reps, sessions }: { plan: Row; week: any; logs: Row[]; reps: Row[]; sessions: Row[] }) {
  const progress = weekProgress(plan, week, logs, reps, sessions);
  const budget = Number(plan.weeklyBudgetMinutes) || Number(plan.sessionsPerWeek || plan.intake?.daysPerWeek || 0) * Number(plan.minutesPerSession || plan.intake?.minutesPerSession || 0);
  return <section className="portal-card native-week-progress"><h2 className="eyebrow">This week’s targets</h2>{progress.domains.length ? <div className="native-target-rings">{progress.domains.map(d => { const fraction = d.target > 0 ? Math.min(1, d.done / d.target) : 0, met = d.target > 0 && d.done >= d.target; return <div className="native-target" key={d.domain} aria-label={d.target > 0 ? `${domainLabel(d.domain)}: ${d.done} of ${d.target} exposures${met ? ', complete' : ''}` : `${domainLabel(d.domain)}: ${d.done} completed; no target set`}><span className="native-ring"><svg viewBox="0 0 58 58" aria-hidden="true"><circle cx="29" cy="29" r="24" /><circle cx="29" cy="29" r="24" pathLength="100" strokeDasharray={`${fraction * 100} 100`} /></svg><strong>{met ? <NativeIcon name="check" size={16} /> : d.target > 0 ? `${Math.round(fraction * 100)}%` : <NativeIcon name={trainingDomainIcon(d.domain)} size={17} />}</strong></span><strong>{domainLabel(d.domain)}</strong><small>{d.target > 0 ? `${d.done}/${d.target}` : `${d.done} completed`}</small>{d.target === 0 && <small>No target set</small>}</div>; })}</div> : <p>This week has no domain targets set.</p>}<div className="native-time-trained"><div><span className="native-domain-badge"><NativeIcon name="clock" size={13} /></span><strong>Time trained</strong><span><b>{progress.minutes} min</b>{budget > 0 && <small> of ~{budget}</small>}</span></div>{budget > 0 && <progress aria-label="Time trained this week" max={budget} value={progress.minutes} />}</div></section>;
}

function TrainingHistory({ playerId, preview, plans, currentLogs, onReview }: { playerId: string; preview: boolean; plans: Row[]; currentLogs: Row[]; onReview: (w: Row) => void }) {
  const [logs, setLogs] = useState<Row[]>(currentLogs), [sessions, setSessions] = useState<Row[]>([]), [error, setError] = useState('');
  useEffect(() => {
    if (preview) return;
    const player = db.collection('players').doc(playerId);
    const stop = player.collection('workoutLogs').onSnapshot(s => setLogs(s.docs.map(d => ({ ...d.data(), id: d.id }))), e => setError(e.message));
    const stopSessions = player.collection('trainingSessions').onSnapshot(s => setSessions(s.docs.map(d => ({ ...d.data(), id: d.id }))), e => setError(e.message));
    return () => { stop(); stopSessions(); };
  }, [playerId, preview]);
  const timestamp = (v: any) => v?.toMillis?.() || new Date(v).getTime() || 0;
  const rows = [...logs.map(row => ({ kind: 'workout', row })), ...sessions.map(row => ({ kind: 'session', row }))]
    .sort((a, b) => timestamp(b.row.startedAt) - timestamp(a.row.startedAt));
  return <section className="native-training native-training-history"><h2>Training history</h2>{error && <p role="alert">{error}</p>}{!rows.length && <section className="portal-card"><p className="eyebrow">Nothing yet</p><p>Workouts you run and free sessions you record in the app will both show up here.</p></section>}
    {rows.map(({ kind, row: l }) => kind === 'workout' ? <article className="portal-card native-history-card" key={`workout:${l.id}`}><header><span className="native-domain-badge"><NativeIcon name="bolt" size={15} /></span><div><strong>{l.workoutSnapshot?.title || 'Workout'} · Week {l.weekNumber}</strong><small>{dateText(l.startedAt)}</small></div><span className={`native-status status-${l.endReason || 'progress'}`}>{l.endedAt ? l.endReason === 'completed' ? 'Completed' : l.endReason === 'abandoned' ? 'Abandoned' : 'Ended early' : 'In progress'}</span></header><p>{(l.blocks || []).filter((b: Row) => b.status === 'done').length} of {(l.blocks || []).length} drills done{(l.blocks || []).some((b: Row) => b.status === 'skipped') && ` · ${(l.blocks || []).filter((b: Row) => b.status === 'skipped').length} skipped`}{l.endedAt ? ` · ${Math.round(completedMinutes(l))} min ${Number.isFinite(l.activeSeconds) ? 'on the saved timer' : 'elapsed estimate'}` : ''}</p>{!plans.some(p => p.id === l.planId && p.status === 'active') && <p className="muted-copy"><NativeIcon name="history" size={13} /> From an earlier plan.</p>}{(l.blocks || []).some((b: Row) => b.skipReason === 'pain') && <p className="native-history-pain">You stopped something for pain in this workout.</p>}{savedWorkout(l) && <button className="native-history-open" onClick={() => onReview(savedWorkout(l)!)}>{l.endedAt ? 'View workout' : 'Resume saved workout'}<NativeIcon name="chevron-right" size={13} /></button>}<details><summary>Completed sets</summary>{(l.blocks || []).map((b: Row) => <p key={b.blockId}>{l.workoutSnapshot?.blocks?.find((v: Row) => v.blockId === b.blockId)?.name || b.drillId}: {b.setsCompleted}/{b.targetSets} · {b.status}{b.skipReason ? ` · ${b.skipReason}` : ''}</p>)}</details></article>
      : <details className="portal-card native-history-card" key={`session:${l.id}`}><summary><span className="native-domain-badge native-record-badge"><NativeIcon name="record" size={15} /></span><span>{l.title || 'Free session'}<small>{dateText(l.startedAt)}</small></span></summary><p>{l.isActive ? 'In progress' : l.endReason === 'completed' ? 'Completed' : l.endReason === 'inactivity' ? 'Auto-closed after inactivity' : 'Ended'}{l.endedAt ? ` · ${dateText(l.endedAt)}` : ''}</p>{(l.sessionRefs || []).map((ref: Row, i: number) => { const href = recordedSessionLink(ref, playerId, preview); return <p key={ref.sessionDocId || i}>{href ? <Link to={href}>{ref.drillType} · Session {ref.sessionNumber} · View results</Link> : `${ref.drillType} · Session reference unavailable`}</p>; })}<p>Open a drill session to see its saved videos and measurements.</p></details>)}
  </section>;
}
