import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { auth } from '../../../lib/firebase';
import { blockDoseLine } from '../../../lib/contracts/drillV2';
import { blockLogRow, skippedLogRow, SKIP_REASONS, endReasonFor, domainExposures } from '../lib/training';
import { domainLabel } from '../../../lib/contracts/types';
import type { PlayerWorkoutStore } from './use-player-workouts';
import type { Row } from './execution';
import DrillMedia from './DrillMedia';
import CoachChat from './CoachChat';
import { newClock, elapsed, restSeconds, pauseClock, resumeClock, reconcileClock, interactClock, stopRest, validClock } from './clock';
import type { Clock } from './clock';
import { canMutateWorkout, restoreRuntime, resumeIndex, runtimeKey, runtimeSnapshot } from './workout-runtime';

export default function PlayerWorkout({ workout, store, playerId, preview, onExit }: {
  workout: Row; store: PlayerWorkoutStore; playerId: string; preview: boolean; onExit: () => void;
}) {
  const log = store.logFor(workout.id);
  const [blocks] = useState<Row[]>(() => workout.blocks || []);
  const [owner] = useState(() => ({ uid: auth.currentUser?.uid || 'preview', playerId, logId: String(workout.id), planId: String(workout.planId), workoutRevision: Number(workout.workoutRevision) }));
  const key = runtimeKey(owner), legacyKey = `posetek:workout-clock:${owner.uid}:${playerId}:${workout.id}`;
  const [initial] = useState(() => {
    if (!preview) try {
      const saved = restoreRuntime(JSON.parse(localStorage.getItem(key) || 'null'), owner, blocks, log, Date.now());
      if (saved) return saved;
      const legacy = JSON.parse(localStorage.getItem(legacyKey) || 'null');
      if (validClock(legacy)) return { clock: reconcileClock(legacy, Date.now()), index: resumeIndex(blocks, log), timerStartedHere: false };
    } catch { /* Corrupt or unavailable device storage cannot prevent server-log recovery. */ }
    return { clock: newClock(Date.now()), index: resumeIndex(blocks, log), timerStartedHere: workout.timerStartedHere === true };
  });
  const [clock, updateClock] = useState<Clock>(initial.clock), clockRef = useRef(clock);
  const setClock = useCallback((change: Clock | ((old: Clock) => Clock)) => { const next = typeof change === 'function' ? change(clockRef.current) : change; clockRef.current = next; updateClock(next); }, []);
  const [now, setNow] = useState(() => Date.now()), [index, updateIndex] = useState(initial.index), indexRef = useRef(index);
  const setIndex = (i: number) => { indexRef.current = i; updateIndex(i); };
  const ended = useRef(!!log?.endedAt);
  useEffect(() => { ended.current = ended.current || !!log?.endedAt; }, [log?.endedAt]);
  const [accountValid, setAccountValid] = useState(preview || auth.currentUser?.uid === owner.uid);
  const [summary, setSummary] = useState(false), [skip, setSkip] = useState(false), [chat, setChat] = useState(''), [pain, setPain] = useState(false);
  const seconds = Math.floor(elapsed(clock, now));
  const usageElement = useRef<HTMLElement>(null);
  useEffect(() => {
    const report = () => window.dispatchEvent(new CustomEvent('posetek:usage-workout', { detail: { active: !!usageElement.current?.getClientRects().length && !preview && !summary && !chat && !log?.endedAt && reconcileClock(clock, Date.now()).runningSince !== null } }));
    report(); const timer = setInterval(report, 500);
    return () => { clearInterval(timer); window.dispatchEvent(new CustomEvent('posetek:usage-workout', { detail: { active: false } })); };
  }, [clock, preview, summary, chat, log?.endedAt]);
  useEffect(() => { const id = setInterval(() => { const time = Date.now(); setNow(time); setClock(c => reconcileClock(c, time)); }, 500); return () => clearInterval(id); }, [setClock]);
  const persist = useCallback(() => { if (!preview) try {
    if (ended.current) { localStorage.removeItem(key); localStorage.removeItem(legacyKey); }
    else localStorage.setItem(key, JSON.stringify(runtimeSnapshot(owner, blocks, indexRef.current, clockRef.current, initial.timerStartedHere)));
  } catch { /* Device storage is optional; Firestore owns completed sets. */ } }, [preview, key, legacyKey, owner, blocks, initial.timerStartedHere]);
  useEffect(persist, [persist, clock, index, log?.endedAt]);
  const pause = useCallback((at = Date.now()) => { setClock(c => pauseClock(c, at)); persist(); }, [setClock, persist]);
  const attachment = useRef(0);
  useEffect(() => {
    const attached = ++attachment.current;
    const leave = () => pause();
    window.addEventListener('posetek:player-route-leave', leave);
    window.addEventListener('pagehide', leave);
    const stop = preview ? () => {} : auth.onAuthStateChanged(user => { const valid = user?.uid === owner.uid; setAccountValid(valid); if (!valid) leave(); });
    return () => {
      const detachedAt = Date.now();
      stop(); window.removeEventListener('posetek:player-route-leave', leave); window.removeEventListener('pagehide', leave);
      // StrictMode reattaches in the same turn. Real unmounts and hidden Activity
      // boundaries pause at their detach time, without counting the hidden time.
      queueMicrotask(() => { if (attachment.current === attached) pause(detachedAt); });
    };
  }, [pause, preview, owner.uid]);
  const allowed = () => (preview || auth.currentUser?.uid === owner.uid) && !pain && canMutateWorkout(clockRef.current, store.saving, ended.current, Date.now());
  const enabled = accountValid && !pain && canMutateWorkout(clock, store.saving, !!log?.endedAt, now);
  const move = (i: number) => { if (!allowed()) return; setIndex(i); setClock(c => stopRest(c)); };
  const block = blocks[index];
  const row = log?.blocks?.find((r: Row) => r.blockId === block?.blockId);
  const done = row?.setsCompleted || 0, target = Math.max(1, block?.sets || 1);
  const rest = restSeconds(clock, now);
  const tick = async (count: number) => {
    if (!allowed()) return;
    try {
      const next = Math.max(0, Math.min(target, count));
      const r = next ? { ...blockLogRow(block, next), estimatedMinutes: block.estimatedMinutes || 0 } : null;
      await store.saveBlock(workout.id, block.blockId, r);
      const restSeconds = block.restScope === 'reps' ? Number(block.restBetweenSetsSeconds || 0) : Number(block.restSeconds || 0);
      setClock(c => next > done && next < target && restSeconds > 0 ? { ...c, restTotal: restSeconds, restUntil: c.runningSince !== null ? Date.now() + restSeconds * 1000 : null, frozenRest: c.runningSince === null ? restSeconds : null } : stopRest(c));
    } catch { /* store surfaces the retryable error */ }
  };
  const skipBlock = async (reason: string) => {
    if (!allowed()) return;
    try {
      await store.saveBlock(workout.id, block.blockId, { ...skippedLogRow(block, done, reason), estimatedMinutes: block.estimatedMinutes || 0 });
      setSkip(false); setClock(c => stopRest(c));
      if (reason === 'pain') { pause(); setPain(true); }
      else if (index + 1 < blocks.length) setIndex(index + 1); else { pause(); setSummary(true); }
    } catch { /* retry remains visible */ }
  };
  const finish = async () => {
    if (!accountValid || (!preview && auth.currentUser?.uid !== owner.uid)) return;
    try {
      // A clock first opened midway through a native/other-device workout cannot
      // replace its full duration with the minutes observed on this browser.
      await store.finish(workout.id, endReasonFor(blocks, log), initial.timerStartedHere ? seconds : undefined);
      ended.current = true;
      persist();
      onExit();
    } catch { /* do not dismiss before acknowledged save */ }
  };
  if (log?.endedAt) return <section className="portal-card"><h2>Workout saved</h2><p>This workout has ended.</p><button className="primary-cta" onClick={onExit}>Back to training</button><Link to={preview ? '/feed?scope=mine&preview=1' : '/feed?scope=mine'}>Share your workout</Link></section>;
  if (chat) return <section><button className="text-button" onClick={() => setChat('')}>Back to workout</button><h2>Ask about this drill</h2><CoachChat key={block.blockId} playerId={playerId} preview={preview} capability="coaching_chat" initialText={chat.slice(0, 1900)} /></section>;
  return <section ref={usageElement} className="player-guided" onClickCapture={() => setClock(c => interactClock(c, Date.now()))}>
    <header className="player-workout-bar"><button aria-label="Back to training" onClick={() => { pause(); onExit(); }}>←</button><strong>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</strong><button disabled={!accountValid || pain} onClick={() => clock.runningSince !== null ? pause() : setClock(c => resumeClock(c, Date.now()))}>{clock.runningSince !== null ? 'Pause' : 'Resume'}</button><button disabled={store.saving || !accountValid} onClick={() => { pause(); setSummary(true); }}>End</button></header>
    {!accountValid ? <p role="alert">Your account changed. Return to training before continuing.</p> : clock.runningSince === null && !summary && <p role="status">{clock.pauseReason === 'inactivity' ? 'Paused after 30 minutes without activity. Resume when you are ready.' : 'Workout paused. Resume to continue.'}</p>}
    {store.error && <p className="player-error" role="alert">{store.error} Your last confirmed progress is preserved. Retry the action.</p>}
    {store.saving && <p role="status">Saving progress…</p>}
    {pain && <section className="portal-card"><h2>Stop here</h2><p>Tell a parent or coach about the pain and get it checked before training that area again.</p><button className="primary-cta" disabled={store.saving} onClick={() => void finish()}>End workout</button><button onClick={() => { setPain(false); setSummary(true); }}>Review what I completed</button></section>}
    {summary ? <>
      <section className="portal-card"><p className="eyebrow">Session summary</p><h2>{endReasonFor(blocks, log) === 'completed' ? 'Nice work.' : 'Your work counts.'}</h2><p>{Math.floor(seconds / 60)} minutes on this timer{!initial.timerStartedHere ? ' · Earlier timing was not collected here' : ''}</p>
        {blocks.map(b => { const r = log?.blocks?.find((v: Row) => v.blockId === b.blockId); return <div className="player-history-row" key={b.blockId}><strong>{b.name}</strong><span>{r?.status === 'skipped' ? `Skipped · ${r.skipReason}` : `${r?.setsCompleted || 0}/${b.sets || 1} sets`}</span></div>; })}
        <p>{domainExposures(blocks, log).map(e => `${domainLabel(e.domain)} +${e.count}`).join(' · ')}</p>
      </section><button className="primary-cta" disabled={store.saving || !accountValid} onClick={() => void finish()}>Save and finish</button><button className="hub-secondary" disabled={store.saving || !accountValid || pain} onClick={() => { setSummary(false); setClock(c => resumeClock(c, Date.now())); }}>Keep training</button>
    </> : block && <>
      <nav className="player-block-strip" aria-label="Workout drills">{blocks.map((b, i) => <button key={b.blockId} disabled={!enabled} aria-label={`Drill ${i + 1}: ${b.name}`} aria-current={i === index ? 'step' : undefined} onClick={() => move(i)}>{i + 1}{log?.blocks?.find((r: Row) => r.blockId === b.blockId)?.status === 'done' ? ' ✓' : ''}</button>)}</nav>
      <p className="eyebrow">{domainLabel(block.domain)} · Drill {index + 1} of {blocks.length}</p><h2>{block.name}</h2><p>{blockDoseLine({ ...block, sets: block.sets, reps: block.reps, repUnit: block.repUnit })}</p>
      <DrillMedia key={block.drillId} drillId={block.drillId} preview={preview} fallback={block} onChat={setChat} />
      <section className="portal-card"><p className="eyebrow">{rest > 0 ? 'Rest now' : done >= target ? 'Drill complete' : `Up next · Set ${done + 1} of ${target}`}</p>
        {rest > 0 && <div className="player-rest"><strong>{Math.floor(rest / 60)}:{String(rest % 60).padStart(2, '0')}</strong>{clock.restTotal ? <small>{clock.restTotal - rest}s of {clock.restTotal}s rested</small> : null}<button disabled={!enabled} onClick={() => { if (allowed()) setClock(c => stopRest(c)); }}>Skip rest</button></div>}
        <div className="player-sets">{Array.from({ length: target }, (_, i) => i + 1).map(n => <button key={n} disabled={!enabled} aria-pressed={n <= done} aria-label={`Set ${n}${n <= done ? ', completed' : ''}`} onClick={() => void tick(n === done ? n - 1 : n)}>{n <= done ? '✓' : n}</button>)}</div>
        {block.cues?.length > 0 && <ul>{block.cues.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>}{block.whyIncluded && <p>{block.whyIncluded}</p>}
      </section>
      {skip ? <section className="portal-card"><h3>Why are you skipping this drill?</h3><div className="player-actions">{SKIP_REASONS.map(r => <button disabled={!enabled} key={r.id} onClick={() => void skipBlock(r.id)}>{r.label}</button>)}<button onClick={() => setSkip(false)}>Cancel</button></div></section> : <button className="text-button" disabled={!enabled} onClick={() => setSkip(true)}>Skip drill</button>}
      <div className="player-workout-controls"><button disabled={index === 0 || !enabled} onClick={() => move(index - 1)} aria-label="Previous drill">←</button><button className="primary-cta" disabled={!enabled} onClick={() => done < target && row?.status !== 'skipped' ? void tick(done + 1) : index + 1 < blocks.length ? move(index + 1) : (pause(), setSummary(true))}>{done < target && row?.status !== 'skipped' ? `Complete set ${done + 1}` : index + 1 < blocks.length ? 'Next drill' : 'See summary'}</button><button disabled={!enabled} aria-label="Next drill" onClick={() => index + 1 < blocks.length ? move(index + 1) : (pause(), setSummary(true))}>→</button></div>
    </>}
  </section>;
}
