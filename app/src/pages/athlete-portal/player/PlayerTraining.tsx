import { useEffect, useRef, useState } from 'react';
import { db } from '../../../lib/firebase';
import { currentWeekNumber, nextWorkout, orderedWeeks, orderedWorkouts, stateOf, workoutStates, findWorkout } from '../../../lib/contracts/planV3';
import { blockDoseLine } from '../../../lib/contracts/drillV2';
import { domainLabel } from '../../../lib/contracts/types';
import { submitLlmJob, waitForJob } from '../lib/loaders';
import { dateText } from '../lib/mobile';
import type { PortalContext } from '../views/shared';
import TrainingView from '../views/TrainingView';
import '../views/training-hub.css';
import { completedMinutes, executable } from './execution';
import type { Row } from './execution';
import { usePlayerWorkouts } from './use-player-workouts';
import { capabilityEnabled, useCoachConfig } from './gateway';
import ProgramIntake from './ProgramIntake';
import PlayerWorkout from './PlayerWorkout';
import DrillMedia from './DrillMedia';
import CoachChat from './CoachChat';
import { weekProgress } from './progress';

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
  const [applying, setApplying] = useState(false), [newTime, setNewTime] = useState(30), [energy, setEnergy] = useState('normal');
  const config = useCoachConfig(preview);
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
  const start = async (w: Row) => { try { setPlaying(await store.start(w)); setReview(null); setChatTarget(null); } catch { /* store owns error */ } };
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
  const states = workoutStates(plan?.id || '', logs);
  const progress = plan ? weekProgress(plan, week || undefined, logs, ctx.allStatsReps(), recordedSessions) : null;
  const openPlan = () => { setSeed(''); setIntake(true); setPanel(''); };
  const back = <button className="text-button" disabled={applying} onClick={() => { setPanel(''); setReview(null); setChatTarget(null); setDrillId(''); setProposal(null); }}>← Training</button>;
  const message = (error || store.error) && <p className="player-error" role="alert">{error || store.error}</p>;

  if (playing) return <PlayerWorkout workout={playing} store={store} playerId={ctx.playerId!} preview={preview} onExit={() => setPlaying(null)} />;
  if (intake) return <ProgramIntake playerId={ctx.playerId!} athlete={ctx.athlete} statsProfile={statsProfile} preview={preview} initialText={seed} onReady={() => { setIntake(false); setReveal(true); }} onBack={() => setIntake(false)} />;
  if (!plans) return <section className="portal-card"><p>{error || 'Loading training…'}</p></section>;
  if (panel === 'history') return <>{back}<TrainingHistory playerId={ctx.playerId!} preview={preview} plans={plans} currentLogs={logs} onReview={w => { setPanel(''); setReview(w); }} /></>;
  if (!plan) return <section className="portal-card"><p className="eyebrow">Your next step</p><h2>Train with a plan built for you</h2><p>Turn your goals and results into a week of focused sessions.</p><button className="primary-cta" onClick={openPlan}>Build my plan</button><button className="hub-secondary" onClick={() => setPanel('history')}>History</button>{panel === 'history' && <p>{plans.length ? `${plans.length} previous plans. Build a new plan to continue training.` : 'Your completed sessions will appear here.'}</p>}</section>;
  if (plan.schemaVersion !== 3) return <><button className="hub-secondary" onClick={openPlan}>Build a new plan</button><TrainingView ctx={ctx} /></>;
  if (drillId) return <><button className="text-button" onClick={() => setDrillId('')}>← Back</button><DrillMedia drillId={drillId} preview={preview} /></>;
  if (chatTarget) return <>{back}<h2>{chatTarget.kind === 'new' ? 'Create your workout' : 'Adjust with your coach'}</h2>{message}
    <CoachChat key={JSON.stringify(chatTarget)} playerId={ctx.playerId!} preview={preview} capability="workout_chat" context={{ workoutRef: chatTarget }} initialText={seed} onDraft={setProposal} />
    {proposal && <section className="portal-card"><p className="eyebrow">Proposed workout · not saved yet</p><h3>{proposal.workout?.title}</h3><p>{proposal.workout?.intent}</p><WorkoutBlocks workout={proposal.workout} onDrill={setDrillId} /><div className="player-actions"><button className="primary-cta" disabled={applying || !capabilityEnabled(config, 'apply_workout_draft')} onClick={() => void apply(false)}>{applying ? 'Saving…' : 'Save workout'}</button><button disabled={applying || !capabilityEnabled(config, 'apply_workout_draft')} onClick={() => void apply(true)}>Save and start</button></div></section>}
  </>;
  if (review) {
    const log = store.logFor(review.id), snapshot = log?.workoutSnapshot || review;
    return <>{back}<p className="eyebrow">{log?.endedAt ? log.endReason === 'completed' ? 'Completed' : 'Ended early' : log ? 'In progress' : 'Your workout'}</p><h2>{snapshot.title || 'Workout'}</h2><p>{snapshot.intent}</p><p>{snapshot.estimatedMinutes} minutes · {snapshot.blocks?.length || 0} drills</p>{message}<WorkoutBlocks workout={snapshot} onDrill={setDrillId} />
      {log?.endedAt ? <p>Saved {dateText(log.endedAt)}. Completed sets remain in your history.</p> : <button className="primary-cta" disabled={store.saving || !store.logsLoaded || plan.status !== 'active'} onClick={() => void start(review)}>{store.saving ? 'Starting…' : log ? 'Resume workout' : 'Start workout'}</button>}
      {!log && <button className="hub-secondary" disabled={!capabilityEnabled(config, 'workout_chat')} onClick={() => { setSeed(''); setChatTarget(review.source === 'plan' ? { kind: 'plan', planId: plan.id, workoutId: review.workoutId } : { kind: 'adhoc', plannedWorkoutId: review.workoutId }); setReview(null); }}>Adjust with your coach</button>}
    </>;
  }
  if (panel === 'details') return <>{back}<section className="portal-card"><h2>Plan details</h2><p>{plan.assessment?.summary}</p><p>{plan.horizonWeeks} weeks · {plan.sessionsPerWeek || plan.intake?.sessionsPerWeek} sessions per week · {plan.minutesPerSession || plan.intake?.minutesPerSession} minutes per session</p><p>Goals: {(plan.intake?.goals || []).join(', ')}</p>{plan.intake?.freeTextGoals && <p>{plan.intake.freeTextGoals}</p>}{(plan.focusAreas || []).map((f: Row, i: number) => <p key={i}>{f.domain || f.title}: {f.rationale || f.reason}</p>)}<p>{(plan.disclaimers || []).join(' ')}</p><button className="hub-secondary" onClick={openPlan}>Start a new plan</button></section></>;
  return <section className="player-training"><p className="eyebrow">Your training</p><h1>Make every session count.</h1>{message}
    {reveal && <section className="portal-card"><h2>Your plan is ready</h2><p>{plan.assessment?.summary}</p><button onClick={() => setReveal(false)}>Explore my plan</button></section>}
    {plan.status === 'completed' && <section className="portal-card"><h2>Block complete</h2><p>Review your work and build your next block.</p><button className="primary-cta" onClick={openPlan}>Plan my next block</button></section>}
    <nav className="player-week-rail" aria-label="Plan weeks">{orderedWeeks(plan).map(w => <button key={w.weekNumber} aria-pressed={w.weekNumber === weekNumber} onClick={() => setSelected(w.weekNumber)}><strong>Week {w.weekNumber}</strong><span>{w.theme}</span></button>)}</nav>
    <section className="portal-card"><p className="eyebrow">Week {weekNumber} of {plan.horizonWeeks}</p><h2>{week?.theme}</h2><p>{week?.focus}</p>{week?.progressionNote && <p>{week.progressionNote}</p>}</section>
    {next && <button className="primary-cta player-next" disabled={!store.logsLoaded} onClick={() => setReview(executable(plan, next.workout, next.weekNumber))}><span><small>{next.reason === 'resume' ? 'Resume' : `Next · Week ${next.weekNumber}`}</small><strong>{next.workout.title}</strong></span><span>→</span></button>}
    {!next && plan.status === 'active' && <section className="portal-card"><h2>You’ve reached the end of this schedule</h2><p>Review your progress or create a new workout.</p><button onClick={openPlan}>Build a new plan</button></section>}
    <WeekProgress plan={plan} week={week} logs={logs} reps={ctx.allStatsReps()} sessions={recordedSessions} />
    <section className="portal-card"><h2>This week’s workouts</h2>{orderedWorkouts(week).map(w => <button className="player-list-button" key={w.workoutId} onClick={() => setReview(executable(plan, w, weekNumber))}><strong>{w.title}</strong><small>{stateOf(states, w.workoutId).kind === 'finished' ? 'Finished' : stateOf(states, w.workoutId).kind === 'inProgress' ? 'In progress' : 'Not started'} · {w.estimatedMinutes} min</small></button>)}</section>
    <details className="portal-card"><summary>This week’s drills</summary>{[...new Map(orderedWorkouts(week).flatMap(w => w.blocks).map(b => [b.drillId, b])).values()].map(b => <button className="player-list-button" key={b.drillId} onClick={() => setDrillId(b.drillId)}>{b.name}<small>{progress?.drillDone[b.drillId] || 0}/{progress?.drillTargets[b.drillId] || 0} sessions completed · Demonstration →</small></button>)}</details>
    {plan.status === 'active' && <section className="portal-card"><h2>Create your workout</h2><p>Tell your coach what you have time and energy for today.</p><div className="player-choice-grid"><label>Minutes<input type="number" min={1} max={135} value={newTime} onChange={e => setNewTime(Number(e.target.value))} /></label><label>Energy<select value={energy} onChange={e => setEnergy(e.target.value)}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></select></label></div><button className="hub-secondary" disabled={!capabilityEnabled(config, 'workout_chat') || newTime < 1 || newTime > 135} onClick={() => { setSeed(''); setChatTarget({ kind: 'new', planId: plan.id, timeAvailableMinutes: newTime, energy }); }}>Choose my focus</button><small>Up to three workout adjustment requests per day.</small></section>}
    {!!store.workouts.length && <section className="portal-card"><h2>Extra workouts</h2>{store.workouts.map(w => <button className="player-list-button" key={w.id} onClick={() => setReview(executable(plan, w, w.weekNumber, 'adhoc'))}>{w.title || 'Workout'}<small>{dateText(w.generatedAt)}</small></button>)}</section>}
    <div className="player-actions"><button onClick={() => setPanel('history')}>History</button><button onClick={() => setPanel('details')}>Plan details</button></div>
    <p className="muted-copy">Record drill tests and free sessions in the PoseTek app. Your saved results and videos appear in Drills.</p>
  </section>;
}

function WorkoutBlocks({ workout, onDrill }: { workout: Row; onDrill: (id: string) => void }) {
  return <section className="portal-card">{(workout?.blocks || []).map((b: Row) => <button className="player-list-button" key={b.blockId} onClick={() => onDrill(b.drillId)}><strong>{b.name}</strong><small>{blockDoseLine({ ...b, sets: b.sets, reps: b.reps, repUnit: b.repUnit })}</small>{b.whyIncluded && <span>{b.whyIncluded}</span>}</button>)}</section>;
}

function WeekProgress({ plan, week, logs, reps, sessions }: { plan: Row; week: any; logs: Row[]; reps: Row[]; sessions: Row[] }) {
  const progress = weekProgress(plan, week, logs, reps, sessions);
  return <section className="portal-card"><h2>This week’s progress</h2>{progress.domains.map(d => <div className="player-progress-row" key={d.domain}><span>{domainLabel(d.domain)}</span><strong>{d.done}/{d.target}</strong><progress max={Math.max(1, d.target)} value={d.done} /></div>)}<p><strong>{progress.minutes} minutes</strong> credited from completed and partial drills.</p></section>;
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
  return <section className="portal-card"><h2>Training history</h2>{error && <p role="alert">{error}</p>}{!rows.length && <p>Your completed workouts and app sessions will appear here.</p>}
    {rows.map(({ kind, row: l }) => kind === 'workout' ? <article className="player-history-row" key={`workout:${l.id}`}><div><strong>{l.workoutSnapshot?.title || 'Workout'} · Week {l.weekNumber}</strong><small>{dateText(l.startedAt)} · {l.endedAt ? l.endReason === 'completed' ? 'Completed' : 'Ended early' : 'In progress'}</small><p>{(l.blocks || []).filter((b: Row) => b.status === 'done').length} drills completed · {Math.round(completedMinutes(l))} min</p></div>{l.workoutSnapshot && plans.some(p => p.id === l.planId && p.status === 'active') && <button onClick={() => onReview({ ...l.workoutSnapshot, ...l, blocks: l.workoutSnapshot.blocks })}>View</button>}<details><summary>Completed sets</summary>{(l.blocks || []).map((b: Row) => <p key={b.blockId}>{l.workoutSnapshot?.blocks?.find((v: Row) => v.blockId === b.blockId)?.name || b.drillId}: {b.setsCompleted}/{b.targetSets} · {b.status}{b.skipReason ? ` · ${b.skipReason}` : ''}</p>)}</details></article>
      : <details className="player-history-row" key={`session:${l.id}`}><summary>{l.title || 'Recorded training session'} · {dateText(l.startedAt)}</summary><p>{l.isActive ? 'In progress' : l.endReason === 'completed' ? 'Completed' : 'Ended'}</p>{(l.sessionRefs || []).map((ref: Row, i: number) => <p key={ref.sessionDocId || i}>{ref.drillType} · Session {ref.sessionNumber}</p>)}<p>View saved videos and measurements in Drills.</p></details>)}
  </section>;
}
