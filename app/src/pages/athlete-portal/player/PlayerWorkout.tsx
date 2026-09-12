import { useEffect, useState } from 'react';
import { auth } from '../../../lib/firebase';
import { blockDoseLine } from '../../../lib/contracts/drillV2';
import { blockLogRow, skippedLogRow, SKIP_REASONS, endReasonFor, domainExposures } from '../lib/training';
import { domainLabel } from '../../../lib/contracts/types';
import type { PlayerWorkoutStore } from './use-player-workouts';
import type { Row } from './execution';
import DrillMedia from './DrillMedia';
import CoachChat from './CoachChat';
import { newClock, elapsed, restSeconds, pauseClock, resumeClock, reconcileClock, interactClock } from './clock';
import type { Clock } from './clock';

export default function PlayerWorkout({ workout, store, playerId, preview, onExit }: {
  workout: Row; store: PlayerWorkoutStore; playerId: string; preview: boolean; onExit: () => void;
}) {
  const log = store.logFor(workout.id);
  const blocks: Row[] = workout.blocks || [];
  const key = `posetek:workout-clock:${auth.currentUser?.uid || 'preview'}:${playerId}:${workout.id}`;
  const readClock = () => { try { return preview ? null : JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  const [clock, setClock] = useState<Clock>(() => { const saved = readClock(); return saved && Number.isFinite(saved.lastInteraction) ? reconcileClock(saved, Date.now()) : newClock(Date.now()); });
  const [now, setNow] = useState(() => Date.now()), [index, setIndex] = useState(() => Math.max(0, blocks.findIndex(b => !log?.blocks?.some((r: Row) => r.blockId === b.blockId && ['done', 'skipped'].includes(r.status)))));
  const [summary, setSummary] = useState(false), [skip, setSkip] = useState(false), [chat, setChat] = useState(''), [pain, setPain] = useState(false);
  const seconds = Math.floor(elapsed(clock, now));
  useEffect(() => { const id = setInterval(() => { const time = Date.now(); setNow(time); setClock(c => reconcileClock(c, time)); }, 500); return () => clearInterval(id); }, []);
  useEffect(() => { if (!preview) { try { localStorage.setItem(key, JSON.stringify(clock)); } catch { /* optional local clock */ } } }, [clock, key, preview]);
  const pause = () => {
    const paused = pauseClock(clock, Date.now());
    if (!preview) { try { localStorage.setItem(key, JSON.stringify(paused)); } catch { /* optional local clock */ } }
    setClock(paused);
  };
  const move = (i: number) => { setIndex(i); setClock(c => ({ ...c, restUntil: null, frozenRest: null })); };
  const block = blocks[index];
  const row = log?.blocks?.find((r: Row) => r.blockId === block?.blockId);
  const done = row?.setsCompleted || 0, target = Math.max(1, block?.sets || 1);
  const rest = restSeconds(clock, now);
  const tick = async (count: number) => {
    try {
      const next = Math.max(0, Math.min(target, count));
      const r = next ? { ...blockLogRow(block, next), estimatedMinutes: block.estimatedMinutes || 0 } : null;
      await store.saveBlock(workout.id, block.blockId, r);
      const restSeconds = block.restScope === 'reps' ? Number(block.restBetweenSetsSeconds || 0) : Number(block.restSeconds || 0);
      setClock(c => ({ ...c, restUntil: c.runningSince !== null && next > done && next < target && restSeconds > 0 ? Date.now() + restSeconds * 1000 : null, frozenRest: c.runningSince === null && next > done && next < target ? restSeconds : null }));
    } catch { /* store surfaces the retryable error */ }
  };
  const skipBlock = async (reason: string) => {
    try {
      await store.saveBlock(workout.id, block.blockId, { ...skippedLogRow(block, done, reason), estimatedMinutes: block.estimatedMinutes || 0 });
      setSkip(false); setClock(c => ({ ...c, restUntil: null, frozenRest: null }));
      if (reason === 'pain') { pause(); setPain(true); }
      else if (index + 1 < blocks.length) setIndex(index + 1); else { pause(); setSummary(true); }
    } catch { /* retry remains visible */ }
  };
  const finish = async () => {
    try {
      await store.finish(workout.id, endReasonFor(blocks, log), seconds);
      try { localStorage.removeItem(key); } catch { /* optional clock */ }
      onExit();
    } catch { /* do not dismiss before acknowledged save */ }
  };
  if (log?.endedAt) return <section className="portal-card"><h2>Workout saved</h2><p>This workout has ended.</p><button className="primary-cta" onClick={onExit}>Back to training</button></section>;
  if (chat) return <section><button className="text-button" onClick={() => setChat('')}>Back to workout</button><h2>Ask about this drill</h2><CoachChat key={block.blockId} playerId={playerId} preview={preview} capability="coaching_chat" initialText={chat.slice(0, 1900)} /></section>;
  return <section className="player-guided" onClickCapture={() => setClock(c => interactClock(c, Date.now()))}>
    <header className="player-workout-bar"><button aria-label="Back to training" onClick={() => { pause(); onExit(); }}>←</button><strong>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</strong><button onClick={() => clock.runningSince ? pause() : setClock(c => resumeClock(c, Date.now()))}>{clock.runningSince ? 'Pause' : 'Resume'}</button><button onClick={() => { pause(); setSummary(true); }}>End</button></header>
    {store.error && <p className="player-error" role="alert">{store.error} Your last confirmed progress is preserved. Retry the action.</p>}
    {store.saving && <p role="status">Saving progress…</p>}
    {pain && <section className="portal-card"><h2>Stop here</h2><p>Tell a parent or coach about the pain and get it checked before training that area again.</p><button className="primary-cta" disabled={store.saving} onClick={() => void finish()}>End workout</button><button onClick={() => { setPain(false); setSummary(true); }}>Review what I completed</button></section>}
    {summary ? <>
      <section className="portal-card"><p className="eyebrow">Session summary</p><h2>{endReasonFor(blocks, log) === 'completed' ? 'Nice work.' : 'Your work counts.'}</h2><p>{Math.floor(seconds / 60)} minutes active</p>
        {blocks.map(b => { const r = log?.blocks?.find((v: Row) => v.blockId === b.blockId); return <div className="player-history-row" key={b.blockId}><strong>{b.name}</strong><span>{r?.status === 'skipped' ? `Skipped · ${r.skipReason}` : `${r?.setsCompleted || 0}/${b.sets || 1} sets`}</span></div>; })}
        <p>{domainExposures(blocks, log).map(e => `${domainLabel(e.domain)} +${e.count}`).join(' · ')}</p>
      </section><button className="primary-cta" disabled={store.saving} onClick={() => void finish()}>Save and finish</button><button className="hub-secondary" disabled={store.saving} onClick={() => setSummary(false)}>Keep training</button>
    </> : block && <>
      <nav className="player-block-strip" aria-label="Workout drills">{blocks.map((b, i) => <button key={b.blockId} aria-label={`Drill ${i + 1}: ${b.name}`} aria-current={i === index ? 'step' : undefined} onClick={() => { setIndex(i); setClock(c => ({ ...c, restUntil: null, frozenRest: null })); }}>{i + 1}{log?.blocks?.find((r: Row) => r.blockId === b.blockId)?.status === 'done' ? ' ✓' : ''}</button>)}</nav>
      <p className="eyebrow">{domainLabel(block.domain)} · Drill {index + 1} of {blocks.length}</p><h2>{block.name}</h2><p>{blockDoseLine({ ...block, sets: block.sets, reps: block.reps, repUnit: block.repUnit })}</p>
      <DrillMedia key={block.drillId} drillId={block.drillId} preview={preview} onChat={setChat} />
      <section className="portal-card"><p className="eyebrow">{rest > 0 ? 'Rest now' : done >= target ? 'Drill complete' : `Up next · Set ${done + 1} of ${target}`}</p>
        {rest > 0 && <div className="player-rest"><strong>{Math.floor(rest / 60)}:{String(rest % 60).padStart(2, '0')}</strong><button onClick={() => setClock(c => ({ ...c, restUntil: null, frozenRest: null }))}>Skip rest</button></div>}
        <div className="player-sets">{Array.from({ length: target }, (_, i) => i + 1).map(n => <button key={n} disabled={store.saving} aria-pressed={n <= done} aria-label={`Set ${n}${n <= done ? ', completed' : ''}`} onClick={() => void tick(n === done ? n - 1 : n)}>{n <= done ? '✓' : n}</button>)}</div>
        {block.cues?.length > 0 && <ul>{block.cues.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>}{block.whyIncluded && <p>{block.whyIncluded}</p>}
      </section>
      {skip ? <section className="portal-card"><h3>Why are you skipping this drill?</h3><div className="player-actions">{SKIP_REASONS.map(r => <button disabled={store.saving} key={r.id} onClick={() => void skipBlock(r.id)}>{r.label}</button>)}<button onClick={() => setSkip(false)}>Cancel</button></div></section> : <button className="text-button" onClick={() => setSkip(true)}>Skip drill</button>}
      <div className="player-workout-controls"><button disabled={index === 0 || store.saving} onClick={() => move(index - 1)} aria-label="Previous drill">←</button><button className="primary-cta" disabled={store.saving} onClick={() => done < target && row?.status !== 'skipped' ? void tick(done + 1) : index + 1 < blocks.length ? move(index + 1) : (pause(), setSummary(true))}>{done < target && row?.status !== 'skipped' ? `Complete set ${done + 1}` : index + 1 < blocks.length ? 'Next drill' : 'See summary'}</button><button disabled={store.saving} aria-label="Next drill" onClick={() => index + 1 < blocks.length ? move(index + 1) : (pause(), setSummary(true))}>→</button></div>
    </>}
  </section>;
}
