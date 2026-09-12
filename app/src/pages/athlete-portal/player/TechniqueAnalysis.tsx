import { useEffect, useRef, useState } from 'react';
import { auth, db } from '../../../lib/firebase';
import { submitLlmJob } from '../lib/loaders';
import { dateText } from '../lib/mobile';
import { capabilityEnabled, useCoachConfig } from './gateway';
import { drillKey } from './scoring';
import type { Row } from './execution';

export default function TechniqueAnalysis({ playerId, reps, preview, onReplay }: { playerId: string; reps: Row[]; preview: boolean; onReplay: (rep: Row) => void }) {
  const config = useCoachConfig(preview), [analyses, setAnalyses] = useState<Row[]>([]), [comparisons, setComparisons] = useState<Row[]>([]);
  const [jobs, setJobs] = useState<Row[]>([]), [selected, setSelected] = useState(''), [compare, setCompare] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(preview);
  const [feedback, setFeedback] = useState<Row | null>(null);
  const submitting = useRef(false);
  const kicks = reps.filter(r => drillKey(r) === 'shooting');
  useEffect(() => {
    if (preview) return;
    const player = db.collection('players').doc(playerId), confirmed = new Set<string>();
    const settle = (key: string, snap: any) => { if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) confirmed.add(key); setReady(confirmed.size === 2); };
    const fail = (e: any) => { setReady(false); setError(e.message); };
    const a = player.collection('aiAnalyses').onSnapshot({ includeMetadataChanges: true }, s => { setAnalyses(s.docs.map(d => ({ ...d.data(), id: d.id }))); settle('analyses', s); }, fail);
    const j = db.collection('llmJobs').where('playerId', '==', playerId).where('requestedByUid', '==', auth.currentUser!.uid).where('capability', '==', 'kick_analysis').onSnapshot({ includeMetadataChanges: true }, s => { setJobs(s.docs.map(d => ({ ...d.data(), id: d.id }))); settle('jobs', s); }, fail);
    const c = player.collection('aiKickComparisons').onSnapshot(s => setComparisons(s.docs.map(d => ({ ...d.data(), id: d.id }))), e => setError(e.message));
    return () => { a(); j(); c(); };
  }, [playerId, preview]);
  const report = analyses.find(a => a.repId === selected || a.id === selected);
  useEffect(() => {
    setFeedback(null);
    if (!selected || preview) return;
    let active = true;
    // A published correction is accepted only against a server-confirmed source.
    const player = db.collection('players').doc(playerId);
    Promise.all([player.collection('aiAnalyses').doc(selected).get({ source: 'server' }), player.collection('aiAnalysisCorrections').doc(`single_${selected}`).get({ source: 'server' })]).then(([source, correction]) => {
      const f = correction.data();
      if (active && f?.playerId === playerId && f.targetType === 'single' && f.targetId === selected && (source.exists ? !!source.data()?.jobId && f.sourceJobId === source.data()?.jobId : !f.sourceJobId)) setFeedback(f.feedback);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [playerId, selected, report?.jobId, preview]);
  const pending = jobs.find(j => j.params?.repId === selected && ['pending', 'running'].includes(j.status));
  const submit = async () => {
    if (submitting.current || !ready || pending || report || !selected) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      if (preview) { setError('Analysis generation is available on your signed-in recorded kicks.'); return; }
      const job = await submitLlmJob(playerId, 'kick_analysis', { repId: selected });
      setJobs(old => [...old, { id: job.id, status: 'pending', params: { repId: selected } }]);
    } catch (e: any) { setError(e.message); }
    finally { submitting.current = false; setBusy(false); }
  };
  const savedComparison = comparisons.find(c => c.id === compare);
  return <section className="portal-card"><h2>Technique analysis</h2><p>Open an existing analysis, choose a recorded kick to analyze, or review a saved left/right comparison.</p>
    <label>Recorded kick<select value={selected} onChange={e => { setSelected(e.target.value); setCompare(''); }}><option value="">Choose a kick</option>{kicks.map(r => <option key={r.id} value={r.id}>Session {r.sessionNumber || '—'} · Rep {r.repNumber || '—'} · {r.strike_foot || 'Foot unknown'}{analyses.some(a => a.id === r.id || a.repId === r.id) ? ' · Analysis saved' : ''}</option>)}</select></label>
    {selected && <div className="player-actions"><button disabled={busy || !ready || !!pending || !!report || !capabilityEnabled(config, 'kick_analysis')} onClick={() => void submit()}>{pending ? 'Analysis in progress…' : report ? 'Analysis saved' : 'Analyze kick'}</button><button onClick={() => { const rep = kicks.find(r => r.id === selected); if (rep) onReplay(rep); }}>Watch this kick</button></div>}
    {error && <p role="alert" className="player-error">{error}</p>}
    {jobs.filter(j => j.params?.repId === selected && j.status === 'failed').map(j => <p key={j.id}>{j.error?.message || 'Analysis failed. You can retry.'}</p>)}
    {feedback && <section><p className="eyebrow">Published coach feedback</p><p>{feedback.summary}</p><FocusAreas areas={feedback.focusAreas || []} /></section>}
    {report && <><p className="eyebrow">Saved analysis · {dateText(report.generatedAt)}</p><FocusAreas areas={report.focusAreas || []} />{!report.focusAreas?.length && <p>No supported technique priorities were identified in this analysis.</p>}<p>{(report.dataQuality?.notes || []).join(' ')}</p><details><summary>Measurements and evidence</summary>{(report.metrics || []).map((m: Row) => <p key={m.id}><strong>{m.meaning || m.metric}</strong>: {m.valid && m.athlete !== null ? `${Number(m.athlete).toFixed(2)} ${m.units || ''}` : 'Unavailable'}{m.valid && m.pro !== null ? ` · Pro ${Number(m.pro).toFixed(2)}` : ''}{m.note ? ` · ${m.note}` : ''}</p>)}</details></>}
    <details><summary>Completed analyses ({analyses.length})</summary>{analyses.map(a => <button className="player-list-button" key={a.id} onClick={() => setSelected(a.repId || a.id)}>Kick {a.repId || a.id}<small>{dateText(a.generatedAt)}</small></button>)}</details>
    <details><summary>Compare left / right kicks ({comparisons.length})</summary>{!comparisons.length && <p>Your coach’s saved comparisons will appear here.</p>}{comparisons.filter(c => c.playerId === playerId && kicks.some(r => r.id === c.leftRepId && r.strike_foot === 'left') && kicks.some(r => r.id === c.rightRepId && r.strike_foot === 'right')).map(c => <button className="player-list-button" key={c.id} onClick={() => setCompare(c.id)}>{c.summary || 'Left / right comparison'}<small>{dateText(c.generatedAt)}</small></button>)}</details>
    {savedComparison && <section><h3>Left / right comparison</h3><p>{savedComparison.summary}</p><FocusAreas areas={savedComparison.focusAreas || []} /><div className="player-actions">{[savedComparison.leftRepId, savedComparison.rightRepId].map(id => <button key={id} onClick={() => { const rep = kicks.find(r => r.id === id); if (rep) onReplay(rep); }}>Watch {id === savedComparison.leftRepId ? 'left' : 'right'} kick</button>)}</div></section>}
  </section>;
}
function FocusAreas({ areas }: { areas: Row[] }) { return <>{[...areas].sort((a, b) => a.rank - b.rank).map((f, i) => <article className="player-metric" key={f.id || f.observationId || i}><small>{f.frameKey || `Priority ${f.rank}`}</small><h3>{f.title}</h3><p>{f.observation}</p><p><strong>{f.cue}</strong></p><p>{f.whyItMatters}</p>{f.evidence && <p className="muted-copy">{f.evidence}</p>}</article>)}</>; }
