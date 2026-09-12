import { useEffect, useRef, useState } from 'react';
import { auth, db } from '../../../lib/firebase';
import { POSITIONS } from '../../../lib/contracts/types';
import { submitLlmJob } from '../lib/loaders';
import { capabilityEnabled, jobProgress, useCoachConfig } from './gateway';
import type { Row } from './execution';

const GOALS = ['speedAgility', 'dribbling', 'passing', 'firstTouch', 'shooting', 'strengthPower'];
export default function ProgramIntake({ playerId, athlete, statsProfile, preview, initialText = '', onReady, onBack }: {
  playerId: string; athlete: Row; statsProfile: Row; preview: boolean; initialText?: string; onReady: () => void; onBack: () => void;
}) {
  const config = useCoachConfig(preview);
  const [goals, setGoals] = useState<string[]>([]), [text, setText] = useState(initialText);
  const [weeks, setWeeks] = useState(2), [days, setDays] = useState(3), [minutes, setMinutes] = useState(30);
  const [age, setAge] = useState('');
  const [setting, setSetting] = useState('solo'), [position, setPosition] = useState(athlete.position || '');
  const [equipment, setEquipment] = useState(['ball', 'cones', 'markers', 'goal', 'timer', 'wall']);
  const [pain, setPain] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const key = `posetek:plan-job:${auth.currentUser?.uid || 'preview'}:${playerId}`;
  const [jobId, setJobId] = useState<string | null>(() => { try { return preview ? null : localStorage.getItem(key); } catch { return null; } });
  const [job, setJob] = useState<Row | null>(null), [retry, setRetry] = useState(0);
  const submitting = useRef(false);
  useEffect(() => {
    if (!jobId || preview) return;
    return db.collection('llmJobs').doc(jobId).onSnapshot(doc => {
      const data = doc.data(); if (!data) return;
      if (data.playerId !== playerId || data.requestedByUid !== auth.currentUser?.uid) { setError('This job belongs to another account.'); return; }
      setJob(data);
      if (['complete', 'failed'].includes(data.status)) {
        try { localStorage.removeItem(key); } catch { /* storage optional */ }
        setBusy(false);
        if (data.status === 'complete') onReady();
        else setError(data.error?.message || data.error?.detail || 'Could not finish the plan.');
      }
    }, e => { setError(`Could not reconnect to the accepted request: ${e.message}`); setBusy(false); });
  }, [jobId, playerId, preview, retry]);
  const submit = async () => {
    if (submitting.current || (jobId && job?.status !== 'failed')) return;
    if (pain) { setError('Pause training and discuss the pain with a qualified professional before starting a new plan.'); return; }
    if (!goals.length) { setError('Choose at least one goal.'); return; }
    submitting.current = true; setBusy(true); setError('');
    try {
      if (preview) { onReady(); return; }
      const ref = await submitLlmJob(playerId, 'generate_training_plan', { planVersion: 3, statsProfile,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        intake: { goals, freeTextGoals: text.trim() || null, horizonWeeks: weeks, sessionsPerWeek: days,
          minutesPerSession: minutes, setting, equipment, painFlag: false,
          level: (statsProfile.overallScore ?? 0) >= 85 ? 'performance' : (statsProfile.overallScore ?? 0) >= 65 ? 'club' : 'foundation',
          ...(position ? { position } : {}), ...(age.trim() ? { age: Number(age) } : {}) } });
      try { localStorage.setItem(key, ref.id); } catch { /* listener still works */ }
      setJobId(ref.id); setJob(null);
    } catch (e: any) { setError(e.message); setBusy(false); }
    finally { submitting.current = false; }
  };
  const pending = !!jobId && !['complete', 'failed'].includes(job?.status);
  return <section className="portal-card player-intake"><button className="text-button" onClick={onBack}>Back to training</button><h2>Build your training plan</h2><p>A focused block around your goals, schedule, and measured progress.</p>
    {pending ? <div role="status"><h3>Your plan is being built</h3><p>{job ? jobProgress(job) : 'Reconnecting to your request…'}</p>{typeof job?.progress?.fraction === 'number' && <progress max={1} value={job.progress.fraction} />}<p>You can leave this page and return. Your accepted request is saved.</p><button onClick={() => { setError(''); setRetry(r => r + 1); }}>Reconnect</button></div> : <form onSubmit={e => { e.preventDefault(); void submit(); }}>
      <fieldset><legend>Choose up to two goals</legend><div className="player-choice-grid">{GOALS.map(g => <label key={g}><input type="checkbox" checked={goals.includes(g)} onChange={e => setGoals(old => e.target.checked ? old.length < 2 ? [...old, g] : old : old.filter(v => v !== g))} />{{ speedAgility: 'Speed & agility', firstTouch: 'First touch', strengthPower: 'Strength & power', dribbling: 'Dribbling', passing: 'Passing', shooting: 'Shooting' }[g]}</label>)}</div></fieldset>
      <label>Program length<select value={weeks} onChange={e => setWeeks(Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => i + 1).map(v => <option key={v} value={v}>{v} {v === 1 ? 'week' : 'weeks'}</option>)}</select></label>
      <label>Sessions per week<select value={days} onChange={e => setDays(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6].map(v => <option key={v}>{v}</option>)}</select></label>
      <label>Minutes per session<select value={minutes} onChange={e => setMinutes(Number(e.target.value))}>{[15, 30, 45, 60, 75, 90].map(v => <option key={v}>{v}</option>)}</select></label>
      <label>Position<select value={position} onChange={e => setPosition(e.target.value)}><option value="">Use my profile</option>{POSITIONS.map(v => <option key={v} value={v}>{v.replaceAll('_', ' ')}</option>)}</select></label>
      <label>Age (optional)<input type="number" min={5} max={80} step={1} value={age} onChange={e => setAge(e.target.value)} placeholder="Use my profile" /></label>
      <label>Training setting<select value={setting} onChange={e => setSetting(e.target.value)}><option value="solo">Solo</option><option value="partner">With a partner</option><option value="halfAndHalf">Half solo, half partner</option></select></label>
      <fieldset><legend>Equipment available</legend><div className="player-choice-grid">{['ball', 'cones', 'markers', 'goal', 'timer', 'wall'].map(v => <label key={v}><input type="checkbox" checked={equipment.includes(v)} onChange={e => setEquipment(old => e.target.checked ? [...old, v] : old.filter(x => x !== v))} />{v}</label>)}</div></fieldset>
      <label>What would you like to improve?<textarea maxLength={500} value={text} onChange={e => setText(e.target.value)} /></label>
      <label><input type="checkbox" checked={pain} onChange={e => setPain(e.target.checked)} /> I have pain that affects training</label>
      <button className="primary-cta" disabled={busy || !capabilityEnabled(config, 'generate_training_plan') || config?.programV3Enabled !== true}>Generate my plan</button>
      <p className="muted-copy">One program request per day. Your existing plan stays active until the new one is ready.</p>
    </form>}
    {error && <p className="player-error" role="alert">{error}</p>}
  </section>;
}
