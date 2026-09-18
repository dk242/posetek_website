import { useEffect, useRef, useState } from 'react';
import { auth, db } from '../../../lib/firebase';
import { dateText } from '../lib/mobile';
import { MultilineText } from '../views/shared';
import { capabilityEnabled, streamCoach, useCoachConfig, validHandoff } from './gateway';
import type { Row } from './execution';
import { NativeIcon } from './native-ui';
import { TrainingSheet } from './training-details';
import './native-training.css';

type Props = { playerId: string; playerName?: string | null; preview: boolean; capability?: string; context?: Row; initialText?: string;
  onDraft?: (draft: Row | null) => void; onHandoff?: (request: Row) => void };

export default function CoachChat({ playerId, playerName = '', preview, capability = 'pose_chat', context, initialText = '', onDraft, onHandoff }: Props) {
  const config = useCoachConfig(preview);
  const [draft, setDraft] = useState(initialText), [messages, setMessages] = useState<Row[]>([]);
  const [answer, setAnswer] = useState(''), [sending, setSending] = useState(false), [error, setError] = useState('');
  const [history, setHistory] = useState<Row[]>([]), [showHistory, setShowHistory] = useState(false);
  const [memory, setMemory] = useState<Row | null>(null), [showMemory, setShowMemory] = useState(false);
  const [status, setStatus] = useState('');
  const controller = useRef<AbortController | null>(null), conversation = useRef<string | null>(null);
  const turn = useRef(0), messageRoot = useRef<HTMLDivElement>(null);
  const workspace = capability === 'pose_chat' && config?.coachWorkspaceEnabled === true;
  const canChat = capabilityEnabled(config, capability);
  const readMessages = async (id: string): Promise<Row[]> => {
    const snap = await db.collection('players').doc(playerId).collection('aiConversations').doc(id).collection('messages').orderBy('createdAt').get({ source: 'server' });
    return snap.docs.map(d => ({ ...d.data(), id: d.id }));
  };
  useEffect(() => {
    if (preview) return;
    const base = db.collection('players').doc(playerId).collection('aiConversations')
      .where('capability', '==', capability).where('createdByUid', '==', auth.currentUser?.uid || '');
    return base.onSnapshot(s => setHistory(s.docs.map(d => ({ ...d.data(), id: d.id })).sort((a: Row, b: Row) =>
      (b.lastMessageAt?.toMillis?.() || 0) - (a.lastMessageAt?.toMillis?.() || 0))), e => setError(`History: ${e.message}`));
  }, [playerId, preview, capability]);
  useEffect(() => {
    // Activity boundaries suspend effects on a hidden tab. A stopped request
    // must not leave the re-opened composer permanently disabled.
    controller.current = null; setSending(false); setStatus(''); setAnswer('');
    return () => { turn.current++; controller.current?.abort(); controller.current = null; };
  }, []);
  useEffect(() => { messageRoot.current?.scrollTo({ top: messageRoot.current.scrollHeight }); }, [messages, answer]);

  const reset = () => {
    turn.current++; controller.current?.abort(); controller.current = null;
    conversation.current = null; setMessages([]); setAnswer(''); setSending(false); setError(''); onDraft?.(null);
  };
  const openHistory = async (item: Row) => {
    reset(); const token = turn.current;
    try {
      const bound = item.workoutTarget;
      const matches = (target: Row | undefined) => target && target.kind === context?.workoutRef?.kind &&
        (context?.workoutRef?.planId ? target.planId === context.workoutRef.planId : true) &&
        (target.kind === 'plan' ? target.workoutId === context?.workoutRef.workoutId : target.kind === 'adhoc' ? target.plannedWorkoutId === context?.workoutRef.plannedWorkoutId : true);
      if (capability === 'workout_chat' && !matches(bound)) {
        throw new Error('Open this workout from Training to continue its chat.');
      }
      const rows = await readMessages(item.id);
      if (token !== turn.current) return;
      conversation.current = item.id; setMessages(rows); setShowHistory(false);
      // Recover a durable proposal only through its completed assistant turn.
      if (capability === 'workout_chat') {
        const last = rows.at(-1);
        if (last?.role === 'assistant' && last.draftId) {
          const doc = await db.collection('players').doc(playerId).collection('workoutDrafts').doc(last.draftId).get({ source: 'server' });
          const d = doc.data();
          const lastUser = [...rows].reverse().find(r => r.role === 'user');
          if (token === turn.current && d?.status === 'proposed' && d.check?.ok === true && d.createdByUid === auth.currentUser?.uid &&
              d.playerId === playerId && d.conversationId === item.id && matches(d.target) &&
              (bound.kind !== 'new' || bound.weekNumber === d.target.weekNumber) && last.createdAt &&
              d.sourceMessageId === lastUser?.id && d.expiresAt?.toMillis?.() > Date.now()) onDraft?.({ ...d, draftId: doc.id });
        }
      }
    } catch (e: any) { if (token === turn.current) setError(e.message); }
  };

  const send = async (text: string, memoryAction?: Row) => {
    if (!canChat || controller.current || (!memoryAction && !text.trim())) return;
    const token = ++turn.current;
    controller.current = new AbortController(); setSending(true); setError(''); setAnswer(''); onDraft?.(null);
    if (!memoryAction) { setDraft(''); setMessages(rows => [...rows, { role: 'user', content: text }]); }
    let full = '', proposal: Row | null = null, memorySnapshot: Row | null = null, handoff: Row | null = null;
    try {
      if (preview) {
        if (memoryAction) setMemory({ workspace: { schemaVersion: 1, revision: (memory?.workspace.revision || 0) + 1, enabled: memoryAction.enabled ?? true }, memories: [] });
        else {
          setMessages(rows => [...rows, { role: 'assistant', content: 'This is a local preview. Your signed-in coach uses your results, training plan and the preferences you choose to save.' }]);
          if (capability === 'pose_chat') setMessages(rows => [...rows.slice(0, -1), { role: 'assistant', content: 'Ready to plan your session? Review your request in Training.', workoutRequest: { type: 'workout_request', playerId, request: text, destination: 'workout_builder' } }]);
        }
        return;
      }
      await streamCoach({ capability, playerId, message: text,
        ...(conversation.current ? { conversationId: conversation.current } : {}),
        context: { ...context, ...(workspace ? { coachWorkspaceVersion: 1 } : {}), ...(memoryAction ? { memoryAction } : {}) },
      }, controller.current.signal, frame => {
        if (token !== turn.current) return;
        if (frame.event === 'start' && !memoryAction) conversation.current = frame.data.conversationId;
        if (frame.event === 'delta') { full += frame.data.text || ''; setAnswer(full); }
        if (frame.event === 'tool') setStatus(frame.data.status === 'finished' ? '' : coachToolPhrase(String(frame.data.name || '')));
        if (frame.event === 'draft') proposal = frame.data;
        if (frame.event === 'memory') memorySnapshot = frame.data;
        if (frame.event === 'workout_request' || frame.data.type === 'workout_request') handoff = frame.data;
      });
      if (token !== turn.current) return;
      if (memorySnapshot) setMemory(old => (memorySnapshot!.workspace?.revision >= (old?.workspace?.revision || 0) ? memorySnapshot : old));
      if (!memoryAction) {
        const rows = conversation.current ? await readMessages(conversation.current) : [];
        if (token !== turn.current) return;
        setMessages(rows.length ? rows : [...messages, { role: 'user', content: text }, { role: 'assistant', content: full, workoutRequest: handoff }]);
        onDraft?.(proposal && (proposal as Row).check?.ok === true ? proposal : null);
      }
      setAnswer('');
    } catch (e: any) {
      if (token === turn.current && e.name !== 'AbortError') setError(e.message);
      if (token === turn.current) onDraft?.(null);
    } finally {
      if (token === turn.current) { controller.current = null; setSending(false); setStatus(''); }
    }
  };
  const memoryCommand = (kind: string, extra: Row = {}) => void send('', { kind, ...(kind !== 'list' ? { expectedRevision: memory?.workspace.revision } : {}), ...extra });
  const globalCoach = capability === 'pose_chat';
  const firstName = (playerName || '').trim().split(/\s+/)[0];
  const suggestions = globalCoach ? ['What should I work on today?', 'How am I improving?', 'Help me with first touch'] : capability === 'workout_chat' ? ['Make this a lighter session', 'Help me choose my focus', 'Explain this workout'] : ['How do I set this up?', 'What should I focus on?', 'How can I make this easier?'];
  const latest = messages.at(-1);
  const handoff = onHandoff && !sending && !error && latest?.role === 'assistant' && validHandoff(latest.workoutRequest, playerId) ? latest.workoutRequest : null;
  return <section className={`player-chat native-coach ${globalCoach ? 'native-coach-global' : 'native-coach-contextual'}`} aria-label={globalCoach ? 'AI Coach' : capability === 'workout_chat' ? 'Workout coach' : 'Drill coach'}>
    <header className="native-coach-header"><div><h2>{globalCoach ? 'AI Coach' : capability === 'workout_chat' ? 'Workout coach' : 'Drill coach'}</h2><p>{globalCoach ? 'One useful step at a time' : capability === 'workout_chat' ? 'Review every change before saving' : 'Help with this drill'}</p></div><div className="native-coach-tools">
      {workspace && <button type="button" aria-label="Coach memory" disabled={sending} onClick={() => { setShowMemory(true); setShowHistory(false); memoryCommand('list'); }}><NativeIcon name="bookmark" size={17} /></button>}
      <button type="button" aria-label="Conversation history" onClick={() => { setShowHistory(true); setShowMemory(false); }}><NativeIcon name="history" size={17} /></button>
      <button type="button" aria-label="New conversation" onClick={reset}><NativeIcon name="compose" size={17} /></button>
    </div></header>
    {handoff && <div className="native-coach-handoff"><p>{handoff.request}</p><button onClick={() => onHandoff!(handoff)}>{handoff.destination === 'program_intake' ? 'Set up my program' : 'Build this workout'} <NativeIcon name="arrow-up-right" size={14} /></button></div>}
    {showHistory && <TrainingSheet title="Conversation history" onClose={() => setShowHistory(false)}>{history.length ? history.map(item => <button className="player-list-button" key={item.id} onClick={() => void openHistory(item)}>{item.title || 'Conversation'}<small>{dateText(item.lastMessageAt)}</small></button>) : <p>No conversations yet.</p>}</TrainingSheet>}
    {showMemory && <TrainingSheet title="Coach memory" onClose={() => setShowMemory(false)}><p>Choose what your coach remembers across conversations.</p>
      {!memory ? <p>Loading memory…</p> : <>
        <label><input type="checkbox" checked={memory.workspace.enabled} disabled={sending} onChange={e => memoryCommand('setEnabled', { enabled: e.target.checked })} /> Use coach memory</label>
        {(memory.memories || []).filter((m: Row) => ['active', 'proposed'].includes(m.status) && (!m.expiresAt || new Date(m.expiresAt).getTime() > Date.now())).map((m: Row) => <article key={m.memoryId} className="player-memory"><small>{m.status === 'proposed' ? 'Suggestion' : 'Saved'} · {String(m.category).replaceAll('_', ' ')}</small><p>{m.text}</p>{m.sourceQuote && <blockquote>{m.sourceQuote}</blockquote>}<div className="player-actions">{m.status === 'proposed' && <button disabled={sending} onClick={() => memoryCommand('confirm', { memoryId: m.memoryId })}>Save</button>}<button disabled={sending} onClick={() => memoryCommand('forget', { memoryId: m.memoryId })}>Forget</button></div></article>)}
        <p>Forgetting stops older chats from recalling these details. Your chat and workout history stay available.</p>
        <button disabled={sending} onClick={() => { if (window.confirm('Forget all saved coach memories and suggestions?')) memoryCommand('forgetAll'); }}>Forget all memories</button>
      </>}
    </TrainingSheet>}
    <div className="player-chat-messages" ref={messageRoot} aria-live="polite">
      {!messages.length && <div className="player-chat-welcome"><NativeIcon name={globalCoach ? 'soccer-player' : 'chat'} size={34} /><h2>{globalCoach ? firstName ? `Ready, ${firstName}?` : 'What are we working on?' : capability === 'workout_chat' ? 'What would you like to change?' : 'Let’s work through this drill'}</h2><p>{globalCoach ? "Tell me what you’re working on. We’ll find your next step." : capability === 'workout_chat' ? 'Talk through the session. Review your coach’s proposal before saving it.' : 'Ask about the setup, technique or a cue from this drill.'}</p><div className="player-suggestions">{suggestions.map(s => <button key={s} disabled={!canChat || sending} onClick={() => setDraft(s)}><NativeIcon name="sparkles" size={14} /><span>{s}</span><NativeIcon name="arrow-up-right" size={12} /></button>)}</div></div>}
      {messages.map((m, i) => <article key={m.id || i} className={`chat-message ${m.role === 'user' ? 'user' : 'assistant'}`}><MultilineText text={m.content || ''} /></article>)}
      {answer && <article className="chat-message assistant"><MultilineText text={answer} /></article>}
    </div>
    {sending && <p className="native-coach-status" role="status">{status || 'Your coach is thinking…'}</p>}
    {error && <p className="player-error" role="alert">{error}</p>}
    {!canChat && <p>{config ? 'Your coach is temporarily unavailable. Your history is still here.' : 'Connecting to your coach…'}</p>}
    <form className="chat-composer" onSubmit={e => { e.preventDefault(); void send(draft.trim()); }}>
      <textarea aria-label="Message your coach" value={draft} onChange={e => { setDraft(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 124)}px`; }} maxLength={capability === 'workout_chat' ? 500 : 2000} placeholder="Ask your coach…" rows={1} disabled={sending} />
      <button type={sending ? 'button' : 'submit'} className={sending ? 'is-stopping' : ''} disabled={!sending && (!canChat || !draft.trim())} aria-label={sending ? 'Stop reply' : 'Send message'} onClick={sending ? () => controller.current?.abort() : undefined}><NativeIcon name={sending ? 'stop' : 'arrow-up'} size={17} /></button>
    </form>
  </section>;
}

function coachToolPhrase(name: string) {
  return ({ fetch_rep_metrics: 'Reading your reps…', fetch_pose_artifact: 'Looking at your pose data…', fetch_benchmark: 'Checking the benchmark…', search_drill_catalog: 'Finding drills…', search_drills: 'Finding drills…', get_drill_history: 'Checking recent training…', search_athlete_history: 'Looking back at your training…', search_training_research: 'Checking training guidance…', search_knowledge: 'Checking training guidance…' } as Record<string, string>)[name] || 'Checking the details…';
}
