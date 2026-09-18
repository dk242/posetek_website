import { useEffect, useRef, useState } from 'react';
import { auth, db } from '../../../lib/firebase';
import { submitLlmJob } from '../lib/loaders';
import { dateText } from '../lib/mobile';
import { capabilityEnabled, useCoachConfig } from './gateway';
import { drillKey } from './scoring';
import type { Row } from './execution';
import TechniqueReplay from './TechniqueReplay';
import { eligibleTechniqueEvidence, supportedComparison, techniqueEvidence } from './technique-evidence';
import { usePublishedFeedback } from './use-published-feedback';

export default function TechniqueAnalysis({ playerId, reps, preview, onReplay }: { playerId: string; reps: Row[]; preview: boolean; onReplay: (rep: Row) => void }) {
  const config = useCoachConfig(preview), [analyses, setAnalyses] = useState<Row[]>([]), [comparisons, setComparisons] = useState<Row[]>([]);
  const [jobs, setJobs] = useState<Row[]>([]), [selected, setSelected] = useState(''), [compare, setCompare] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [ready, setReady] = useState(preview);
  const [reviewing, setReviewing] = useState(''), [comparisonFoot, setComparisonFoot] = useState<'left' | 'right'>('left');
  const submitting = useRef(false);
  const kicks = reps.filter(r => drillKey(r) === 'shooting');
  useEffect(() => {
    setAnalyses([]); setComparisons([]); setJobs([]); setReady(preview); setError('');
    if (preview) return;
    const owner = auth.currentUser?.uid;
    if (!owner) { setError('Sign in to open your technique analyses.'); return; }
    const player = db.collection('players').doc(playerId), confirmed = new Set<string>();
    const settle = (key: string, snap: any) => { if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) confirmed.add(key); else confirmed.delete(key); setReady(confirmed.size === 2); };
    const fail = (key: string, e: any) => { confirmed.delete(key); setReady(false); setError(e.message); };
    const a = player.collection('aiAnalyses').onSnapshot({ includeMetadataChanges: true }, s => { setAnalyses(s.docs.map(d => ({ ...d.data(), id: d.id }))); settle('analyses', s); }, e => fail('analyses', e));
    const j = db.collection('llmJobs').where('playerId', '==', playerId).where('requestedByUid', '==', owner).where('capability', '==', 'kick_analysis').onSnapshot({ includeMetadataChanges: true }, s => { setJobs(s.docs.map(d => ({ ...d.data(), id: d.id }))); settle('jobs', s); }, e => fail('jobs', e));
    const c = player.collection('aiKickComparisons').onSnapshot(s => setComparisons(s.docs.map(d => ({ ...d.data(), id: d.id }))), e => setError(e.message));
    return () => { a(); j(); c(); };
  }, [playerId, preview]);
  const validAnalyses = analyses.filter(a => a.playerId === playerId && a.repId === a.id && typeof a.jobId === 'string' && a.jobId.length > 0);
  const report = validAnalyses.find(a => a.repId === selected);
  const selectedRep = kicks.find(rep => rep.id === selected);
  const validComparisons = comparisons.filter(c => c.comparisonId === c.id && supportedComparison(c, playerId, kicks));
  const savedComparison = validComparisons.find(c => c.id === compare);
  const singlePublished = usePublishedFeedback(playerId, 'single', selected, report?.jobId, preview);
  const comparisonPublished = usePublishedFeedback(playerId, 'comparison', savedComparison?.id || '', savedComparison?.jobId, preview);
  const feedback = singlePublished.feedback;
  const pending = jobs.find(j => j.params?.repId === selected && ['pending', 'running'].includes(j.status));
  const submit = async () => {
    if (submitting.current || !ready || pending || report || !selectedRep) return;
    submitting.current = true; setBusy(true); setError('');
    try {
      if (preview) { setError('Analysis generation is available on your signed-in recorded kicks.'); return; }
      const job = await submitLlmJob(playerId, 'kick_analysis', { repId: selected });
      setJobs(old => [...old, { id: job.id, status: 'pending', params: { repId: selected } }]);
    } catch (e: any) { setError(e.message); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <section className="portal-card"><h2>Technique analysis</h2><p>Open an existing analysis, choose a recorded kick to analyze, or review a saved left/right comparison.</p>
    <label>Recorded kick<select value={selected} onChange={e => { setSelected(e.target.value); setCompare(''); setReviewing(''); }}><option value="">Choose a kick</option>{kicks.map(r => <option key={r.id} value={r.id}>Session {r.sessionNumber || '—'} · Rep {r.repNumber || '—'} · {r.strike_foot || 'Foot unknown'}{validAnalyses.some(a => a.repId === r.id) ? ' · Analysis saved' : ''}</option>)}</select></label>
    {selected && <div className="player-actions"><button disabled={busy || !ready || !!pending || !!report || !capabilityEnabled(config, 'kick_analysis')} onClick={() => void submit()}>{pending ? 'Analysis in progress…' : report ? 'Analysis saved' : 'Analyze kick'}</button><button onClick={() => { const rep = kicks.find(r => r.id === selected); if (rep) onReplay(rep); }}>Watch this kick</button></div>}
    {error && <p role="alert" className="player-error">{error}</p>}
    {jobs.filter(j => j.params?.repId === selected && j.status === 'failed').map(j => <p key={j.id}>{j.error?.message || 'Analysis failed. You can retry.'}</p>)}
    {singlePublished.error && <p role="status" className="muted-copy">{singlePublished.error}</p>}
    {feedback && <section><p className="eyebrow">Published coach feedback</p><p>{feedback.feedback.summary}</p><FocusAreas areas={feedback.feedback.focusAreas || []} /></section>}
    {report && <><p className="eyebrow">Saved analysis · {dateText(report.generatedAt)}</p><FocusAreas areas={report.focusAreas || []} />{!report.focusAreas?.length && <p>No supported technique priorities were identified in this analysis.</p>}<p>{(report.dataQuality?.notes || []).join(' ')}</p><details><summary>Measurements and evidence</summary>{techniqueEvidence(report).map((m: Row) => <p key={m.id}><strong>{m.meaning || m.metric}</strong>: {eligibleTechniqueEvidence(m) && typeof m.athlete === 'number' && Number.isFinite(m.athlete) ? `${m.athlete.toFixed(2)} ${m.units || ''}` : 'Unavailable'}{eligibleTechniqueEvidence(m) && typeof m.pro === 'number' && Number.isFinite(m.pro) ? ` · Pro ${m.pro.toFixed(2)}` : ''}{m.note ? ` · ${m.note}` : ''}{m.qualityNotes?.length ? ` · ${m.qualityNotes.join(' ')}` : ''}</p>)}</details></>}
    {selectedRep && (report || feedback) && <><button type="button" onClick={() => setReviewing(value => value === `single:${selected}` ? '' : `single:${selected}`)}>{reviewing === `single:${selected}` ? 'Close guided review' : 'Review findings with video'}</button>
      {reviewing === `single:${selected}` && <TechniqueReplay key={`single:${selected}`} playerId={playerId} rep={selectedRep} report={report} feedback={feedback} preview={preview} />}</>}
    <details><summary>Completed analyses ({validAnalyses.length})</summary>{validAnalyses.map(a => <button className="player-list-button" key={a.id} onClick={() => { setSelected(a.repId); setCompare(''); setReviewing(''); }}>Kick {a.repId}<small>{dateText(a.generatedAt)}</small></button>)}</details>
    <details><summary>Compare left / right kicks ({validComparisons.length})</summary>{!validComparisons.length && <p>Your coach’s saved comparisons will appear here.</p>}{validComparisons.map(c => <button className="player-list-button" key={c.id} onClick={() => { setCompare(c.id); setComparisonFoot('left'); setReviewing(''); }}>{c.summary || 'Left / right comparison'}<small>{dateText(c.generatedAt)}</small></button>)}</details>
    {savedComparison && <section><h3>Left / right comparison</h3>
      {comparisonPublished.error && <p role="status" className="muted-copy">{comparisonPublished.error}</p>}
      {comparisonPublished.feedback && <section><p className="eyebrow">Published coach feedback</p><p>{comparisonPublished.feedback.feedback.summary}</p><FocusAreas areas={comparisonPublished.feedback.feedback.focusAreas || []} /></section>}
      <p>{savedComparison.summary}</p><FocusAreas areas={savedComparison.focusAreas || []} /><div className="player-actions">{[savedComparison.leftRepId, savedComparison.rightRepId].map(id => <button key={id} onClick={() => { const rep = kicks.find(r => r.id === id); if (rep) onReplay(rep); }}>Watch {id === savedComparison.leftRepId ? 'left' : 'right'} kick</button>)}</div>
      <details><summary>Comparison measurements</summary>{(savedComparison.differences || []).map((row: Row) => <p key={row.id}><strong>{String(row.metric || '').replaceAll('_', ' ')}</strong>: {row.comparable === true && typeof row.left === 'number' && Number.isFinite(row.left) && typeof row.right === 'number' && Number.isFinite(row.right) ? `Left ${row.left.toFixed(2)} · Right ${row.right.toFixed(2)} ${row.units || ''}` : 'Unavailable'}{row.notes?.length ? ` · ${row.notes.join(' ')}` : ''}</p>)}</details>
      <button type="button" onClick={() => setReviewing(value => value === `comparison:${compare}` ? '' : `comparison:${compare}`)}>{reviewing === `comparison:${compare}` ? 'Close comparison review' : 'Review both feet with evidence'}</button>
      {reviewing === `comparison:${compare}` && <><div className="player-actions" role="group" aria-label="Foot to review">{(['left', 'right'] as const).map(foot => <button type="button" key={foot} aria-pressed={comparisonFoot === foot} onClick={() => setComparisonFoot(foot)}>{foot === 'left' ? 'Left foot' : 'Right foot'}</button>)}</div><TechniqueReplay key={`${compare}:${comparisonFoot}`} playerId={playerId} rep={kicks.find(r => r.id === savedComparison[`${comparisonFoot}RepId`])!} otherRep={kicks.find(r => r.id === savedComparison[`${comparisonFoot === 'left' ? 'right' : 'left'}RepId`])!} comparison={savedComparison} feedback={comparisonPublished.feedback} preview={preview} /></>}
    </section>}
  </section>;
}
function FocusAreas({ areas }: { areas: Row[] }) { return <>{[...areas].sort((a, b) => a.rank - b.rank).map((f, i) => <article className="player-metric" key={f.id || f.observationId || i}><small>{f.frameKey || `Priority ${f.rank}`}</small><h3>{f.title}</h3><p>{f.observation}</p><p><strong>{f.cue}</strong></p><p>{f.whyItMatters}</p>{f.evidence && <p className="muted-copy">{f.evidence}</p>}</article>)}</>; }
