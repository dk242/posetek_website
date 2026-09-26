import { useEffect, useRef, useState } from 'react';
import { blockDoseLine } from '../../../lib/contracts/drillV2';
import { EQUIPMENT } from '../../../lib/contracts/types';
import { localDayString } from '../../../lib/contracts/planV3';
import TrainingLoadInstructions from '../../../components/TrainingLoadInstructions';
import type { Row } from './execution';
import type { PersonalWorkoutStore } from './use-personal-workouts';
import { personalAge, personalCapabilityEnabled } from './personal-workouts';
import type { SourceWorkout } from './personal-workouts';
import { suppliedWorkoutConditions } from './personal-conversation';
import PlayerWorkout from './PlayerWorkout';
import './personal-workouts.css';

export function PersonalPrescription({ proposal }: { proposal: Row }) {
  const w = proposal.workout || proposal, target = proposal.requestedMinutes ?? proposal.timeAvailableMinutes ?? w.budgetMinutes;
  return <section className="personal-prescription" aria-label="Workout prescription"><div className="personal-duration"><span><strong>{w.estimatedMinutes} min</strong><small>Calculated, including rest and transitions</small></span>{target && <span><strong>{target} min</strong><small>Your approximate target</small></span>}</div><h2>{w.title}</h2><p>{w.intent}</p><ol className="personal-prescription-list">{(w.blocks || []).map((b: Row, i: number) => <li className="portal-card" key={b.blockId}><span className="personal-drill-number" aria-hidden="true">{i + 1}</span><div><h3>{b.name}</h3><p>{blockDoseLine(b as any)}</p><small>About {b.estimatedMinutes} min · {b.restSeconds}s rest {b.restScope === 'reps' ? 'between repetitions' : 'between sets'}</small>{b.whyIncluded && <p className="muted-copy">{b.whyIncluded}</p>}<TrainingLoadInstructions block={b} /></div></li>)}</ol></section>;
}

type Props = { store: PersonalWorkoutStore; playerId: string; athlete: Row; config: Row | null; preview: boolean;
  source?: { workout: Row; reference?: SourceWorkout }; initialWorkout?: Row; initialCreate?: boolean; initialRequest?: string; initialHandoff?: Row; initialConversation?: boolean;
  coachOnly?: boolean; onReview?: (proposal: Row) => void; onSelection?: (id?: string) => void; onBack: () => void };

export default function PersonalWorkoutHub({ store, playerId, athlete, config, preview, source, initialWorkout, initialCreate = false, initialRequest = '', initialHandoff, initialConversation = false, coachOnly = false, onReview, onSelection, onBack }: Props) {
  const [mode, setMode] = useState<'list' | 'chat' | 'saved'>(source || initialRequest || initialCreate || initialConversation ? 'chat' : initialWorkout ? 'saved' : 'list');
  const [selected, setSelected] = useState<Row | null>(initialWorkout || null), [playing, setPlaying] = useState<Row | null>(null);
  const [editing, setEditing] = useState<Row | null>(null), [sourceRef, setSourceRef] = useState(source?.reference);
  const [copyFromWorkoutId, setCopyFromWorkoutId] = useState<string | undefined>();
  const [requestText, setRequestText] = useState(initialConversation ? '' : initialRequest), [submitted, setSubmitted] = useState(!initialConversation && !!initialRequest);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', today = localDayString(new Date(), timezone);
  const latest = new Date(`${today}T12:00:00Z`); latest.setUTCDate(latest.getUTCDate() + 28);
  const [scheduledDate, setScheduledDate] = useState(today), [answers, setAnswers] = useState<Row>({});
  const [revisionDate, setRevisionDate] = useState<string | undefined>();
  const [equipmentConfirmed, setEquipmentConfirmed] = useState(false), [startPain, setStartPain] = useState('');
  const supplied = suppliedWorkoutConditions(requestText, initialHandoff?.timeAvailableMinutes ?? initialHandoff?.workoutRef?.timeAvailableMinutes);
  const conditions: Row = { ...supplied, ...answers, ...(personalAge(athlete) ? { age: personalAge(athlete) } : {}) };
  const p = mode === 'chat' ? store.proposal : null;
  const published = !!p && store.conversation?.publishedProposalId === p.proposalId;
  const ready = !!conditions.age && Number.isInteger(conditions.minutes) && conditions.minutes >= 1 && conditions.minutes <= 135 && Array.isArray(conditions.equipment) && !!conditions.setting && conditions.painAnswer === 'no' && scheduledDate >= today && scheduledDate <= latest.toISOString().slice(0, 10);
  const blocked = store.saving || store.scheduleRevision === null || !!(store.pending && !store.pending.terminalFailed) || store.conversationLoading;
  const autoStarted = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const fail = (e: unknown) => store.setError(e instanceof Error ? e.message : 'The request could not finish. Your last reviewed draft is preserved.');
  const openSaved = (w: Row) => { setSelected(w); setMode('saved'); setEquipmentConfirmed(false); setStartPain(''); };
  const begin = (w?: Row, copy = false) => {
    store.newConversation(); onSelection?.(); setMode('chat'); setSubmitted(false); setRequestText(w ? `${copy ? 'Create a personal session like' : 'Adjust'} ${w.title}.` : '');
    setAnswers({}); setScheduledDate(today); setEditing(w?.source === 'personal' && !copy ? w : null); setSourceRef(copy ? undefined : w?.sourceWorkout || undefined); setCopyFromWorkoutId(copy ? selected?.workoutId : undefined);
  };
  const send = async () => {
    if (blocked || requestText.trim().length < 3) return;
    setSubmitted(true);
    try {
      if (p) {
        const changes = suppliedWorkoutConditions(requestText), intakeChanges = { ...(changes.equipment ? { equipment: changes.equipment } : {}), ...(changes.setting ? { setting: changes.setting } : {}), ...(changes.painAnswer === 'yes' ? { painFlag: true } : {}) };
        const result = await store.refine(requestText.trim(), { expectedScheduleRevision: store.scheduleRevision, scheduledDate: revisionDate || (p.scheduledDate < today ? today : p.scheduledDate), timezone: p.timezone || timezone, ...(changes.minutes ? { timeAvailableMinutes: changes.minutes } : {}), ...(Object.keys(intakeChanges).length ? { intake: { ...p.intake, ...intakeChanges } } : {}) });
        if (!mounted.current) return;
        onSelection?.(result.conversationId);
      } else {
        if (!ready) return;
        const result = await store.generate({ requestText: requestText.trim(), timeAvailableMinutes: conditions.minutes, expectedRevision: editing?.revision || 0, expectedScheduleRevision: store.scheduleRevision, scheduledDate, timezone,
          intake: { age: conditions.age, equipment: conditions.equipment, setting: conditions.setting, painFlag: false }, ...(editing ? { workoutId: editing.workoutId } : {}), ...(sourceRef ? { sourceWorkout: sourceRef } : {}), ...(copyFromWorkoutId ? { copyFromWorkoutId } : {}),
          ...(initialHandoff?.originConversationId && initialHandoff?.originMessageId ? { originConversationId: initialHandoff.originConversationId, originMessageId: initialHandoff.originMessageId } : {}) });
        if (!mounted.current) return;
        onSelection?.(result.conversationId);
      }
      setRequestText(''); setSubmitted(false);
    } catch (e) { fail(e); }
  };
  useEffect(() => { if (coachOnly && initialRequest && ready && !blocked && !p && !autoStarted.current) { autoStarted.current = true; void send(); } }, [coachOnly, ready, blocked, p]);
  useEffect(() => { if (!coachOnly && store.lastResult?.capability === 'save_personal_workout' && store.lastResult.result.workout && mode === 'chat' && store.lastResult.result.workout.personalConversationId === store.conversationId) { openSaved(store.lastResult.result.workout); store.consumeResult(); } }, [store.lastResult, mode]);
  const publish = async () => { try { const result = await store.publish(); if (mounted.current) openSaved(result.workout); } catch (e) { if (mounted.current) fail(e); } };
  const openConversation = async (id: string) => { try { await store.openConversation(id); onSelection?.(id); setMode('chat'); setRequestText(''); setSubmitted(false); } catch (e) { fail(e); } };
  const start = async () => { if (selected && equipmentConfirmed && startPain === 'no') try { setPlaying(await store.start(selected, { equipmentConfirmed: true, painFlag: false })); } catch (e) { fail(e); } };
  const notice = <>{store.error && <p className="player-error" role="alert">{store.error}</p>}{store.saving && <p role="status">{store.status || 'Checking your workout…'}</p>}{store.pending && !store.saving && !store.pending.terminalFailed && <section className="portal-card"><p>Your request is saved. Recover its result to continue.</p><button onClick={() => void store.recover()}>Recover saved request</button></section>}</>;
  if (playing) return <>{notice}<PlayerWorkout key={playing.id} workout={playing} store={store.adapter} playerId={playerId} preview={preview} onExit={() => { setPlaying(null); setMode('list'); }} /></>;
  if (!store.enabled) return <section className="portal-card"><h2>Personal workouts</h2><p>Personal workout tools are not enabled for this account yet.</p><button onClick={onBack}>Back to training</button></section>;
  return <section className={`personal-workouts${coachOnly ? ' personal-coach-creation' : ''}`}>
    {!coachOnly && <><button className="text-button" disabled={store.saving} onClick={() => { if (mode === 'list') onBack(); else { setMode('list'); onSelection?.(); } }}>← {mode === 'list' ? 'Training' : 'Personal workouts'}</button><p className="eyebrow">Your own sessions</p><h1>{mode === 'chat' ? 'Your workout conversation.' : mode === 'saved' ? selected?.title || 'Your workout' : 'Personal workouts'}</h1></>}{notice}
    {mode === 'list' && <><p>Tell your AI coach what you want to work on, review your session, then make it yours.</p><button className="primary-cta" disabled={blocked} onClick={() => begin()}>Create workout</button>
      {!!store.conversations?.length && <section className="portal-card"><h2>Workout conversations</h2><p className="muted-copy">Private drafts and earlier revisions stay here.</p>{store.conversations.map(c => <button className="player-list-button" key={c.id} onClick={() => void openConversation(c.id)}><strong>{c.title || 'Workout conversation'}</strong><small>{c.publishedWorkoutId ? 'Published workout · continue conversation' : 'Private draft · continue conversation'}</small></button>)}</section>}
      {!store.loaded ? <p role="status">Loading your workouts…</p> : !store.workouts.length ? <section className="portal-card"><h2>Your first session starts here</h2><p>Create a single workout without a multiweek plan. Review the prescription before publishing it.</p></section> : <div className="personal-workout-list">{[...store.workouts].sort((a, b) => String(b.scheduledDate).localeCompare(String(a.scheduledDate))).map(w => { const log = store.logs[w.workoutId]; return <button className="player-list-button" key={w.workoutId} onClick={() => openSaved(w)}><span className="personal-workout-meta">{log?.endedAt ? 'Finished' : log ? 'Resume' : 'Ready'} · {w.scheduledDate}</span><strong>{w.title}</strong><small>{w.estimatedMinutes} min · {w.blocks?.length || 0} drills</small></button>; })}</div>}
    </>}
    {mode === 'chat' && <>
      {sourceRef && <p className="muted-copy">You are creating a personal copy. Your assigned workout stays as prescribed.</p>}{store.conversationLoading && <p role="status">Opening your saved conversation…</p>}
      {!p && !store.messages?.length && <div className="personal-conversation-welcome"><span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span><h2>{coachOnly ? 'Let’s prepare your workout.' : 'What would you like to work on?'}</h2><p>Tell me your focus and how much time you have. I’ll prepare a workout for you to review.</p></div>}
      {!!store.messages?.length && <div className="personal-conversation-messages" aria-label="Workout conversation" aria-live="polite">{store.messages.map((m, i) => <article key={m.id || i} className={`chat-message ${m.role === 'user' ? 'user' : 'assistant'}`}><small>{m.role === 'user' ? 'You' : 'AI Coach'}</small><p>{m.content || m.text}</p></article>)}</div>}
      {p && <><p className="eyebrow">{published ? 'Published prescription' : `Draft ${p.proposalRevision || 1} · private until published`}</p><PersonalPrescription proposal={p} />{coachOnly ? <button className="primary-cta" onClick={() => onReview?.(p)}>Review in Training</button> : <div className="personal-save-bar"><span><strong>{p.workout.estimatedMinutes} min</strong><small>Review above, then publish</small></span><button className="primary-cta" disabled={blocked} onClick={() => void publish()}>{store.saving ? 'Checking…' : published ? 'Open published workout' : store.conversation?.publishedWorkoutId ? 'Republish workout' : 'Publish workout'}</button></div>}</>}
      {(!coachOnly || !p) && <form className="personal-conversation-composer" onSubmit={e => { e.preventDefault(); void send(); }}>
        <label>{p ? 'What would you like to change?' : 'Your focus and available time'}<textarea rows={3} maxLength={500} value={requestText} disabled={blocked} onChange={e => setRequestText(e.target.value)} placeholder={p ? 'Add passing, replace a drill, or make it shorter…' : 'I have 20 minutes for ball control. I’m solo and have a ball and cones…'} /></label>
        {p && <details><summary>Training date · {revisionDate || (p.scheduledDate < today ? today : p.scheduledDate)}</summary><label>Training date for this revision<input type="date" min={today} max={latest.toISOString().slice(0, 10)} value={revisionDate || (p.scheduledDate < today ? today : p.scheduledDate)} onChange={e => setRevisionDate(e.target.value)} disabled={blocked} /></label><p className="muted-copy">Sending a change checks the current schedule again. Review the new draft before publishing.</p></details>}
        {submitted && !p && <fieldset disabled={blocked} className="personal-session-fields"><legend>A few details for this session</legend><p className="muted-copy">I’ve carried forward the details you supplied.</p>
          {!supplied.minutes && <label>About how many minutes?<input type="number" inputMode="numeric" min={1} max={135} value={conditions.minutes || ''} onChange={e => setAnswers(a => ({ ...a, minutes: Number(e.target.value) }))} /></label>}
          {!personalAge(athlete) && !supplied.age && <label>Your age<input type="number" inputMode="numeric" min={5} max={80} value={conditions.age || ''} onChange={e => setAnswers(a => ({ ...a, age: Number(e.target.value) }))} /><small>Used for this session; this does not change your birthday.</small></label>}
          {!supplied.setting && <label>Training with<select value={conditions.setting || ''} onChange={e => setAnswers(a => ({ ...a, setting: e.target.value }))}><option value="">Choose a setting</option><option value="solo">Just me</option><option value="partner">A partner</option></select></label>}
          {!supplied.equipment && <div><p>What equipment do you have?</p><div className="personal-equipment">{EQUIPMENT.map(item => <label key={item}><input type="checkbox" checked={(conditions.equipment || []).includes(item)} onChange={e => setAnswers(a => ({ ...a, equipment: e.target.checked ? [...(a.equipment || []), item] : (a.equipment || []).filter((v: string) => v !== item) }))} />{item.replace(/([A-Z])/g, ' $1')}</label>)}</div><label><input type="checkbox" checked={Array.isArray(conditions.equipment) && !conditions.equipment.length} onChange={e => setAnswers(a => ({ ...a, equipment: e.target.checked ? [] : undefined }))} />No equipment</label></div>}
          {supplied.painAnswer !== 'no' && <label>Any pain or restriction affecting this session?<select value={conditions.painAnswer || ''} onChange={e => setAnswers(a => ({ ...a, painAnswer: e.target.value }))}><option value="">Choose an answer</option><option value="no">No</option><option value="yes">Yes — I need a review</option></select></label>}
          {conditions.painAnswer === 'yes' && <p role="alert">Pause workout creation and ask your coach about a suitable return to training.</p>}
          <details><summary>Training date · {scheduledDate}</summary><label>Training date<input type="date" min={today} max={latest.toISOString().slice(0, 10)} value={scheduledDate} onChange={e => setScheduledDate(e.target.value)} /></label></details>
        </fieldset>}
        <button className="primary-cta" type="submit" disabled={blocked || requestText.trim().length < 3 || !personalCapabilityEnabled(config, 'generate_personal_workout', preview) || (submitted && !p && !ready)}>{store.saving ? 'Preparing your workout…' : p ? 'Send changes' : submitted ? 'Create my workout' : 'Send request'}</button><small>{p ? 'Changes create a new draft to review before republishing.' : 'You can ask for changes before you publish. Available time is an approximate target.'}</small>
      </form>}
    </>}
    {mode === 'saved' && selected && (() => { const log = store.logs[selected.workoutId], snapshot = log?.workoutSnapshot || selected; return <><p className="personal-workout-meta">Saved to Personal workouts · {selected.scheduledDate}</p><PersonalPrescription proposal={snapshot} />
      {log?.endedAt ? <p className="workout-pause-note">{log.endReason === 'completed' ? 'Completed' : log.endReason === 'pain' ? 'Stopped for pain' : 'Ended early'} · {Math.floor(Number(log.elapsedSeconds || 0) / 60)}:{String(Number(log.elapsedSeconds || 0) % 60).padStart(2, '0')} active. Your completed sets remain in history.</p> : <fieldset className="portal-card" disabled={blocked}><legend>{log ? 'Ready to resume?' : 'Before you start'}</legend><label><input type="checkbox" checked={equipmentConfirmed} onChange={e => setEquipmentConfirmed(e.target.checked)} />I have the equipment and a safe space for this workout</label><label>Any pain or restriction today?<select value={startPain} onChange={e => setStartPain(e.target.value)}><option value="">Choose an answer</option><option value="no">No</option><option value="yes">Yes — pause training</option></select></label><button className="primary-cta" disabled={!equipmentConfirmed || startPain !== 'no' || !personalCapabilityEnabled(config, 'start_personal_workout', preview)} onClick={() => void start()}>{log ? 'Resume workout' : 'Start workout'}</button></fieldset>}
      <button className="hub-secondary" disabled={blocked} onClick={() => { if (!log && selected.personalConversationId) void openConversation(selected.personalConversationId); else begin(snapshot, !!log); }}>{log ? 'Ask AI for a personal copy' : 'Ask AI to change this workout'}</button></>; })()}
  </section>;
}
