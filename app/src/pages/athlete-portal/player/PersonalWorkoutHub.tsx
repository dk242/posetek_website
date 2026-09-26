import { useEffect, useRef, useState } from 'react';
import { blockDoseLine } from '../../../lib/contracts/drillV2';
import { domainLabel, EQUIPMENT } from '../../../lib/contracts/types';
import { localDayString } from '../../../lib/contracts/planV3';
import { doseBoundsFor } from '../../admin/lib/editor';
import type { Row } from './execution';
import type { PersonalWorkoutStore } from './use-personal-workouts';
import { addPersonalDrill, eligiblePersonalDrill, personalAge, personalCapabilityEnabled, personalDraft, personalDraftErrors, personalGenerationErrors, personalWorkoutPayload, recomputePersonalDraft } from './personal-workouts';
import type { PersonalDraft, PersonalIntake, SourceWorkout } from './personal-workouts';
import PlayerWorkout from './PlayerWorkout';
import './personal-workouts.css';

export default function PersonalWorkoutHub({ store, playerId, athlete, config, preview, source, initialWorkout, initialCreate = false, initialRequest = '', onBack }: {
  store: PersonalWorkoutStore; playerId: string; athlete: Row; config: Row | null; preview: boolean;
  source?: { workout: Row; reference?: SourceWorkout }; initialWorkout?: Row; initialCreate?: boolean; initialRequest?: string; onBack: () => void;
}) {
  const [mode, setMode] = useState<'list' | 'edit' | 'review' | 'saved'>(source || initialRequest || initialCreate ? 'edit' : initialWorkout ? 'saved' : 'list');
  const [draft, setDraft] = useState<PersonalDraft>(() => personalDraft(source?.workout));
  const [sourceRef, setSourceRef] = useState<SourceWorkout | undefined>(source?.reference);
  const [editing, setEditing] = useState<Row | null>(null), [selected, setSelected] = useState<Row | null>(initialWorkout || null), [playing, setPlaying] = useState<Row | null>(null);
  const [search, setSearch] = useState(''), [requestText, setRequestText] = useState(initialRequest), [proposalId, setProposalId] = useState<string | undefined>();
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const today = localDayString(new Date(), timezone);
  const latest = new Date(`${today}T12:00:00Z`); latest.setUTCDate(latest.getUTCDate() + 28);
  const [scheduledDate, setScheduledDate] = useState(today);
  const knownAge = personalAge(athlete);
  const [intakeState, setIntake] = useState<PersonalIntake>(() => ({ ...(knownAge ? { age: knownAge } : preview ? { age: 15 } : {}), equipment: preview ? ['ball', 'cones', 'wall'] : [], setting: 'solo', painFlag: false }));
  const intake = knownAge === undefined ? intakeState : { ...intakeState, age: knownAge };
  const [painAnswer, setPainAnswer] = useState(''), [equipmentConfirmed, setEquipmentConfirmed] = useState(false), [startPain, setStartPain] = useState('');
  const seenProposal = useRef('');
  const maxDifficulty = typeof athlete.maxDrillDifficulty === 'number' ? athlete.maxDrillDifficulty : 5;
  const eligible = store.catalog.filter(d => eligiblePersonalDrill(d, intake, maxDifficulty));
  const errors = personalDraftErrors(draft, store.catalog, intake, maxDifficulty);
  const generationErrors = personalGenerationErrors(intake, draft.budgetMinutes, requestText);
  const conditionsReady = painAnswer === 'no' && scheduledDate >= today && scheduledDate <= latest.toISOString().slice(0, 10);
  useEffect(() => {
    const p = store.proposal;
    if (!p?.proposalId || seenProposal.current === p.proposalId) return;
    seenProposal.current = p.proposalId;
    setDraft(personalDraft(p.workout, true)); setProposalId(p.proposalId);
    setEditing(p.workoutId ? { workoutId: p.workoutId, revision: p.expectedRevision } : null);
    if (p.intake) setIntake(p.intake);
    if (p.scheduledDate) setScheduledDate(p.scheduledDate);
    if (p.timezone) setTimezone(p.timezone);
    setSourceRef(p.sourceWorkout || undefined); setPainAnswer('no'); setMode('review');
  }, [store.proposal]);
  useEffect(() => {
    if (store.lastResult?.capability !== 'save_personal_workout' || !store.lastResult.result.workout) return;
    setSelected(store.lastResult.result.workout); setEditing(null); setMode('saved'); setEquipmentConfirmed(false); setStartPain('');
    store.consumeResult();
  }, [store.lastResult]);
  const clearProposal = () => { setProposalId(undefined); if (store.proposal) store.clearProposal(); };
  const changeDraft = (value: PersonalDraft) => { setDraft(recomputePersonalDraft(value)); clearProposal(); };
  const changeIntake = (patch: Partial<PersonalIntake>) => { setIntake(v => ({ ...v, ...patch })); clearProposal(); };
  const catchError = (e: unknown) => store.setError(e instanceof Error ? e.message : 'The workout could not be saved. Try again.');
  const begin = (workout?: Row, asCopy = false) => {
    const isPersonal = !!workout?.workoutId && workout?.source === 'personal';
    setDraft(personalDraft(workout, isPersonal && !asCopy)); setEditing(isPersonal && !asCopy ? workout! : null);
    setSourceRef(isPersonal && asCopy ? undefined : workout?.sourceWorkout || undefined); setProposalId(undefined); store.clearProposal();
    if (workout?.intake) setIntake({ ...workout.intake });
    setScheduledDate(today); setPainAnswer(''); setMode('edit');
  };
  const params = () => ({ ...(editing ? { workoutId: editing.workoutId } : {}), expectedRevision: proposalId ? store.proposal?.expectedRevision ?? editing?.revision ?? 0 : editing?.revision || 0,
    expectedScheduleRevision: proposalId ? store.proposal?.expectedScheduleRevision ?? store.scheduleRevision : store.scheduleRevision, scheduledDate, timezone,
    intake: { equipment: intake.equipment, setting: intake.setting, painFlag: intake.painFlag, ...(Number.isInteger(intake.age) ? { age: intake.age } : {}) },
    ...(sourceRef ? { sourceWorkout: sourceRef } : {}) });
  const save = async () => {
    if (errors.length || !conditionsReady || store.scheduleRevision === null) return;
    try {
      const result = await store.save({ ...params(), workout: personalWorkoutPayload(draft), ...(proposalId ? { proposalId } : {}) });
      setSelected(result.workout); setEditing(null); setMode('saved'); setEquipmentConfirmed(false); setStartPain('');
    } catch (e) { catchError(e); }
  };
  const generate = async () => {
    if (!conditionsReady || generationErrors.length || store.scheduleRevision === null) return;
    try {
      if (preview) {
        store.setError('Live AI generation is available after sign-in. Try the manual builder in this sample.'); return;
      }
      await store.generate({ ...params(), requestText: requestText.trim(), timeAvailableMinutes: draft.budgetMinutes });
    } catch (e) { catchError(e); }
  };
  const start = async () => {
    if (!selected || !equipmentConfirmed || startPain !== 'no') return;
    try { setPlaying(await store.start(selected, { equipmentConfirmed: true, painFlag: false })); } catch (e) { catchError(e); }
  };
  const opening = (w: Row) => { setSelected(w); setMode('saved'); setEquipmentConfirmed(false); setStartPain(''); };
  const blocked = store.saving || store.scheduleRevision === null || !!(store.pending && !store.pending.terminalFailed);
  const notice = <>{store.error && <p className="player-error" role="alert">{store.error}</p>}{store.saving && <p role="status">{store.status || 'Saving…'}</p>}{store.pending && !store.saving && !store.pending.terminalFailed && <section className="portal-card"><p>A saved request needs its result checked before you make another change.</p><button onClick={() => void store.recover()}>Recover saved request</button></section>}</>;

  if (playing) return <>{store.pending && !store.saving && !store.pending.terminalFailed && <section className="portal-card"><p>A progress save needs its result checked. Your confirmed sets are preserved.</p><button className="primary-cta" onClick={() => void store.recover()}>Recover saved progress</button></section>}<PlayerWorkout key={playing.id} workout={playing} store={store.adapter} playerId={playerId} preview={preview} onExit={() => { setPlaying(null); setMode('list'); }} /></>;
  if (!store.enabled) return <section className="portal-card"><h2>Personal workouts</h2><p>Personal workout tools are not enabled for this account yet.</p><button onClick={onBack}>Back to training</button></section>;
  return <section className="personal-workouts">
    <button className="text-button" disabled={store.saving} onClick={() => mode === 'list' ? onBack() : setMode('list')}>← {mode === 'list' ? 'Training' : 'Personal workouts'}</button>
    <p className="eyebrow">Your own sessions</p><h1>{mode === 'edit' ? editing ? 'Fine-tune your workout.' : sourceRef ? 'Make it your own.' : 'Build your workout.' : mode === 'review' ? 'Review your workout.' : mode === 'saved' ? selected?.title || 'Your workout' : 'Personal workouts'}</h1>{notice}
    {mode === 'list' && <>
      <p>Choose your drills, adjust the dose, and track the work you complete.</p>
      <button className="primary-cta" disabled={blocked} onClick={() => begin()}>Create workout</button>
      {!store.loaded ? <p role="status">Loading your workouts…</p> : !store.workouts.length ? <section className="portal-card"><h2>Your first session starts here</h2><p>You can build a single workout without a multiweek plan. Your coach’s assigned sessions stay in Training.</p></section> : <div className="personal-workout-list">{[...store.workouts].sort((a, b) => String(b.scheduledDate).localeCompare(String(a.scheduledDate))).map(w => {
        const log = store.logs[w.workoutId], count = log?.blocks?.reduce((sum: number, b: Row) => sum + Number(b.setsCompleted || 0), 0) || 0;
        return <button className="player-list-button" key={w.workoutId} onClick={() => opening(w)}><span className="personal-workout-meta">{log?.endedAt ? log.endReason === 'completed' ? 'Completed' : log.endReason === 'pain' ? 'Stopped for pain' : 'Ended early' : log ? 'Resume' : 'Ready'} · {w.scheduledDate}</span><strong>{w.title}</strong><small>{w.estimatedMinutes} min planned · {w.blocks?.length || 0} {w.blocks?.length === 1 ? 'drill' : 'drills'}{log ? ` · ${count} ${count === 1 ? 'set' : 'sets'} saved` : ''}</small></button>;
      })}</div>}
    </>}
    {mode === 'edit' && <>
      {sourceRef && <p className="muted-copy">You are customizing a personal copy. Your assigned workout stays as prescribed.</p>}
      {initialRequest && <blockquote className="personal-carried-request"><small>Your AI Coach request</small><p>{initialRequest}</p></blockquote>}
      <fieldset disabled={blocked} className="personal-session-fields"><legend>Today’s training conditions</legend>
        {!knownAge && <label>Your age<input type="number" min={5} max={80} value={intake.age || ''} onChange={e => changeIntake({ age: e.target.value ? Number(e.target.value) : undefined })} /><small>Used for this workout. This does not change your recorded birthday.</small></label>}
        <div className="player-choice-grid"><label>Training date<input type="date" min={today} max={latest.toISOString().slice(0, 10)} value={scheduledDate} onChange={e => { setScheduledDate(e.target.value); clearProposal(); }} /></label><label>Training with<select value={intake.setting} onChange={e => changeIntake({ setting: e.target.value as 'solo' | 'partner' })}><option value="solo">Just me</option><option value="partner">A partner</option></select></label></div>
        <details><summary>Available equipment · {intake.equipment.length} selected</summary><div className="personal-equipment">{EQUIPMENT.map(e => <label key={e}><input type="checkbox" checked={intake.equipment.includes(e)} onChange={event => changeIntake({ equipment: event.target.checked ? [...intake.equipment, e] : intake.equipment.filter(item => item !== e) })} />{e.replace(/([A-Z])/g, ' $1')}</label>)}</div></details>
        <label>Any pain or restriction affecting this session?<select value={painAnswer} onChange={e => { setPainAnswer(e.target.value); changeIntake({ painFlag: e.target.value === 'yes' }); }}><option value="">Choose an answer</option><option value="no">No</option><option value="yes">Yes — I need a review</option></select></label>
      </fieldset>
      <fieldset disabled={blocked}><legend>Your workout</legend><label>Workout name<input maxLength={80} value={draft.title} onChange={e => changeDraft({ ...draft, title: e.target.value })} /></label><label>Target minutes<input type="number" min={1} max={135} value={draft.budgetMinutes} onChange={e => changeDraft({ ...draft, budgetMinutes: Number(e.target.value) })} /></label>
        <details className="personal-ai" open={!!initialRequest}><summary>Ask AI to build this session</summary><p className="muted-copy">Describe your goal. You will review the proposed drills before saving.</p><label>What would you like to work on?<textarea maxLength={500} rows={3} placeholder="A 20-minute ball-control session with fewer cones" value={requestText} onChange={e => setRequestText(e.target.value)} /></label><button className="hub-secondary" disabled={!conditionsReady || generationErrors.length > 0 || !personalCapabilityEnabled(config, 'generate_personal_workout', preview)} onClick={() => void generate()}>Generate a proposal</button></details>
      </fieldset>
      <section><h2>Your drills <span className="muted-copy">{draft.blocks.length} / 12</span></h2>{!draft.blocks.length && <p className="muted-copy">Add drills from the library below.</p>}{draft.blocks.map((b, i) => {
        const drill = store.catalog.find(d => d.drillId === b.drillId), bounds = drill ? doseBoundsFor(drill) : null;
        const dose = (field: string, value: number) => changeDraft({ ...draft, blocks: draft.blocks.map((v, n) => n === i ? { ...v, [field]: value } : v) });
        const move = (offset: number) => { const blocks = [...draft.blocks]; blocks.splice(i, 1); blocks.splice(i + offset, 0, b); changeDraft({ ...draft, blocks }); };
        return <fieldset className="portal-card personal-drill-edit" disabled={blocked} key={b.blockId}><legend>{i + 1}. {b.name}</legend><p className="muted-copy">{domainLabel(b.domain)}{b.perSide ? ' · Each side' : ''} · About {b.estimatedMinutes} min</p><div className="personal-dose-grid"><label>Sets<input aria-label={`${b.name} sets`} type="number" min={bounds?.sets.min || 1} max={bounds?.sets.max || 10} value={b.sets} onChange={e => dose('sets', Number(e.target.value))} /></label><label>{b.repUnit === 'seconds' ? 'Seconds / set' : b.repUnit === 'minutes' ? 'Minutes / set' : `${b.repUnit} / set`}<input aria-label={`${b.name} amount per set`} type="number" min={bounds?.reps.min || 1} max={bounds?.reps.max || 600} value={b.reps} onChange={e => dose('reps', Number(e.target.value))} /></label><label>Rest seconds<input aria-label={`${b.name} rest seconds`} type="number" min={bounds?.restSeconds.min || 0} max={bounds?.restSeconds.max || 600} value={b.restSeconds} onChange={e => dose('restSeconds', Number(e.target.value))} /></label></div>
          {b.restScope === 'reps' && <p className="muted-copy">Rest is between repetitions. Between sets: {b.restBetweenSetsSeconds ?? b.restSeconds}s.</p>}
          <div className="personal-drill-actions"><button aria-label={`Move ${b.name} up`} disabled={i === 0} onClick={() => move(-1)}>↑</button><button aria-label={`Move ${b.name} down`} disabled={i === draft.blocks.length - 1} onClick={() => move(1)}>↓</button><button onClick={() => changeDraft({ ...draft, blocks: draft.blocks.filter(v => v.blockId !== b.blockId) })}>Remove</button></div>
        </fieldset>;
      })}</section>
      <section className="portal-card"><h2>Add a drill</h2><label>Search drills<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or training focus" /></label>{!intake.age ? <p>Enter your age to see suitable drills.</p> : <><p className="muted-copy">Published drills matching your age, equipment and setting. Current workload is checked before saving.</p>{eligible.filter(d => `${d.name} ${domainLabel(d.domain)}`.toLowerCase().includes(search.toLowerCase())).slice(0, 30).map(d => <button className="player-list-button" key={d.drillId} disabled={blocked || draft.blocks.length >= 12 || draft.blocks.some(b => b.drillId === d.drillId)} onClick={() => changeDraft(addPersonalDrill(draft, d))}><strong>{d.name}</strong><small>{domainLabel(d.domain)} · {draft.blocks.some(b => b.drillId === d.drillId) ? 'Already added' : 'Add drill +'}</small></button>)}{!eligible.length && <p>No drills match yet. Check the equipment you actually have available.</p>}</>}</section>
      {!!errors.length && <div className="personal-validation" role="status"><strong>Before you save</strong><ul>{errors.map(e => <li key={e}>{e}</li>)}</ul></div>}
      {draft.estimatedMinutes > 0 && draft.estimatedMinutes <= 135 && Math.abs(draft.estimatedMinutes - draft.budgetMinutes) > Math.max(5, draft.budgetMinutes / 10) && <button className="hub-secondary" disabled={blocked} onClick={() => changeDraft({ ...draft, budgetMinutes: draft.estimatedMinutes })}>Use the estimated {draft.estimatedMinutes} minutes</button>}
      <div className="personal-save-bar"><span><strong>{draft.estimatedMinutes} min</strong><small>Including transitions</small></span><button className="primary-cta" disabled={blocked || errors.length > 0 || !conditionsReady} onClick={() => setMode('review')}>Review workout</button></div>
    </>}
    {mode === 'review' && <><p className="muted-copy">{proposalId ? 'AI proposal · not saved yet' : 'Personal workout · not saved yet'}</p><h2>{draft.title}</h2><p>{draft.intent}</p><p>{draft.estimatedMinutes} minutes · {scheduledDate} · {intake.setting === 'partner' ? 'With a partner' : 'Solo'}</p>{draft.blocks.map(b => <div className="player-history-row" key={b.blockId}><strong>{b.name}</strong><span>{blockDoseLine(b)}</span></div>)}<p>Saving checks current eligibility and your other scheduled training. Starting always requires today’s confirmation.</p>{!!errors.length && <p className="player-error">{errors.join(' ')}</p>}<button className="primary-cta" disabled={blocked || errors.length > 0 || !conditionsReady} onClick={() => void save()}>{store.saving ? 'Checking and saving…' : 'Save personal workout'}</button><button className="hub-secondary" disabled={store.saving} onClick={() => setMode('edit')}>Fine-tune drills</button></>}
    {mode === 'saved' && selected && (() => {
      const log = store.logs[selected.workoutId], snapshot = log?.workoutSnapshot || selected;
      return <><p>{snapshot.intent}</p><p>{snapshot.estimatedMinutes} minutes planned · {selected.scheduledDate}</p>{snapshot.blocks?.map((b: Row) => <div className="player-history-row" key={b.blockId}><strong>{b.name}</strong><span>{blockDoseLine(b as any)}</span><small>{log?.blocks?.find((r: Row) => r.blockId === b.blockId)?.setsCompleted || 0} of {b.sets} sets saved</small></div>)}{log?.endedAt ? <p className="workout-pause-note">{log.endReason === 'completed' ? 'Completed' : log.endReason === 'pain' ? 'Stopped for pain' : 'Ended early'} · {Math.floor(Number(log.elapsedSeconds || 0) / 60)}:{String(Number(log.elapsedSeconds || 0) % 60).padStart(2, '0')} active. Your completed sets remain in history.</p> : <fieldset className="portal-card" disabled={blocked}><legend>{log ? 'Ready to resume?' : 'Before you start'}</legend><label><input type="checkbox" checked={equipmentConfirmed} onChange={e => setEquipmentConfirmed(e.target.checked)} />I have the listed equipment and training space.</label><label>Any pain or restriction affecting today’s session?<select value={startPain} onChange={e => setStartPain(e.target.value)}><option value="">Choose an answer</option><option value="no">No</option><option value="yes">Yes — I need a review</option></select></label>{startPain === 'yes' && <p>Pause training and ask your parent or coach for a review.</p>}<button className="primary-cta" disabled={!equipmentConfirmed || startPain !== 'no'} onClick={() => void start()}>{log ? 'Check and resume workout' : 'Check and start workout'}</button></fieldset>}<button className="hub-secondary" disabled={blocked} onClick={() => begin(selected, !!log)}>{log ? 'Customize a new copy' : 'Edit this workout'}</button></>;
    })()}
  </section>;
}
