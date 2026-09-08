import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { loadOrganizations } from "../lib/accounts";
import type { OrganizationRow, PlayerRow } from "../lib/accounts";
import { resultsPath } from "../lib/results";
import type { RepArtifactBundle } from "../lib/repToolsData";
import { resolveClipTiming } from "../lib/repTools";
import { comparisonTime, eligibleEvidence, feedbackFromResult, LIMBS, manualArtifactsChanged, PHASES, phaseFrame, poseJoint, reliableFoot, reorderedFocus, selectComparisonPair, sourceEvidence, validSavedComparisons } from "../lib/analysisReview";
import type { Phase, ReviewFeedback, ReviewFocus, ReviewNotes, TechniqueAnnotation } from "../lib/analysisReview";
import { exportAnalysisReviews, generateAnalysis, loadAnalysisReps, loadAnnotationArtifacts, loadComparisons, loadReviewTarget, organizationAthletes, saveAnalysisReview } from "../lib/analysisReviewData";
import type { ObservedSource, ReviewTarget } from "../lib/analysisReviewData";
import "../analysis.scss";

const repLabel = (rep: any) => `Session ${rep.sessionNumber ?? "?"} · Rep ${rep.repNumber ?? "?"} · ${reliableFoot(rep) ? `${reliableFoot(rep)} foot` : "foot unassigned"}`;
const phaseLabel = (phase: string) => phase === "followThrough" ? "Follow-through" : phase.charAt(0).toUpperCase() + phase.slice(1);
const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export default function AnalysisWorkspace() {
  const [search] = useSearchParams();
  const [organizations, setOrganizations] = useState<OrganizationRow[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [playerId, setPlayerId] = useState(search.get("player") || "");
  const [reps, setReps] = useState<any[]>([]);
  const [comparisons, setComparisons] = useState<any[]>([]);
  const [mode, setMode] = useState<"single" | "comparison">("single");
  const [repId, setRepId] = useState(search.get("rep") || "");
  const [pairSelection, setPairSelection] = useState({ playerId: "", leftId: "", rightId: "" });
  const { leftId, rightId } = pairSelection.playerId === playerId ? pairSelection : { leftId: "", rightId: "" };
  const [target, setTarget] = useState<ReviewTarget | null>(null);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { document.title = "Technique review | PoseTek admin"; loadOrganizations().then(setOrganizations).catch(error => setError(error.message)); }, []);
  useEffect(() => {
    let live = true;
    setPlayers([]);
    if (organizationId) organizationAthletes(organizationId).then(rows => { if (live) setPlayers(rows); }).catch(error => { if (live) setError(error.message); });
    return () => { live = false; };
  }, [organizationId]);
  useEffect(() => {
    let live = true;
    setReps([]); setComparisons([]); setTarget(null);
    if (playerId) Promise.all([loadAnalysisReps(playerId), loadComparisons(playerId)]).then(([kicks, pairs]) => {
      if (!live) return;
      setReps(kicks); setComparisons(pairs);
      setRepId(current => kicks.some(rep => rep.id === current) ? current : kicks[0]?.id || "");
      setPairSelection(current => ({ playerId, ...selectComparisonPair(kicks, pairs, current.playerId === playerId ? current : undefined) }));
    }).catch(error => { if (live) setError(error.message); });
    return () => { live = false; };
  }, [playerId, reload]);
  const savedComparisons = validSavedComparisons(reps, comparisons);
  const pair = savedComparisons.find(row => row.leftRepId === leftId && row.rightRepId === rightId);
  const targetId = mode === "single" ? repId : pair?.comparisonId || "";
  useEffect(() => {
    let live = true;
    setTarget(null);
    if (playerId && targetId) loadReviewTarget(playerId, mode, targetId).then(value => { if (live) setTarget(value); }).catch(error => { if (live) setError(error.message); });
    return () => { live = false; };
  }, [playerId, mode, targetId, reload]);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  function change(action: () => void) {
    if (dirty && !window.confirm("Discard the unsaved review before changing the selection?")) return;
    setDirty(false); setError(""); setStatus(""); action();
  }
  async function generate() {
    if (dirty && !window.confirm("Generate a new analysis and discard your unsaved review?")) return;
    setBusy(true); setError(""); setDirty(false);
    try {
      await generateAnalysis(playerId, mode === "single" ? "kick_analysis" : "kick_foot_comparison", mode === "single" ? { repId } : { leftRepId: leftId, rightRepId: rightId }, message => { if (alive.current) setStatus(message); });
      if (alive.current) { setStatus("Analysis saved. Ready for review."); setReload(value => value + 1); }
    } catch (error: any) { if (alive.current) setError(error.message); }
    finally { if (alive.current) setBusy(false); }
  }
  async function exportDataset(all: boolean) {
    setBusy(true); setError("");
    try { const count = await exportAnalysisReviews(all ? players.map(row => row.id) : [playerId]); setStatus(`Downloaded ${count} approved review examples. Athlete train/evaluation splits and source versions are included.`); }
    catch (error: any) { setError(error.message); }
    finally { setBusy(false); }
  }
  const selectedReps = (mode === "single" ? [repId] : [leftId, rightId]).map(id => reps.find(row => row.id === id)).filter(Boolean);
  const ready = Boolean(playerId && (mode === "single" ? repId : leftId && rightId && leftId !== rightId));
  return <div className="analysis-workspace">
    <section className="admin-heading"><div><p className="eyebrow">Expert review</p><h1>Kick technique</h1><p>Inspect the evidence, identify what matters, and improve the feedback athletes receive.</p></div></section>
    <section className="admin-card analysis-selection">
      <label className="admin-field"><span>Organization</span><select value={organizationId} disabled={busy} onChange={event => change(() => { setOrganizationId(event.target.value); setPlayerId(""); setRepId(""); })}><option value="">Choose organization</option>{organizations.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label className="admin-field"><span>Athlete</span><select value={playerId} disabled={busy} onChange={event => change(() => setPlayerId(event.target.value))}><option value="">Choose athlete</option>{playerId && !players.some(row => row.id === playerId) && <option value={playerId}>Linked athlete</option>}{players.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label className="admin-field"><span>Analysis</span><select value={mode} disabled={busy} onChange={event => change(() => setMode(event.target.value as "single" | "comparison"))}><option value="single">Single kick</option><option value="comparison">Left versus right</option></select></label>
      {mode === "single" ? <RepSelect label="Recorded kick" value={repId} reps={reps} disabled={busy} onChange={value => change(() => setRepId(value))} /> : <>
        {savedComparisons.length > 0 && <label className="admin-field"><span>Saved comparison</span><select value={pair?.comparisonId || ""} disabled={busy} onChange={event => change(() => {
          const selected = savedComparisons.find(row => row.comparisonId === event.target.value);
          setPairSelection({ playerId, leftId: selected?.leftRepId || "", rightId: selected?.rightRepId || "" });
        })}><option value="">Choose kicks manually</option>{savedComparisons.map(row => <option key={row.comparisonId} value={row.comparisonId}>{comparisonTime(row) ? new Date(comparisonTime(row)).toLocaleString() : "Saved analysis"} · {repLabel(reps.find(rep => rep.id === row.leftRepId))} / {repLabel(reps.find(rep => rep.id === row.rightRepId))}</option>)}</select></label>}
        <RepSelect label="Left-foot kick" value={leftId} reps={reps.filter(rep => reliableFoot(rep) === "left")} disabled={busy} onChange={value => change(() => setPairSelection({ playerId, leftId: value, rightId }))} />
        <RepSelect label="Right-foot kick" value={rightId} reps={reps.filter(rep => reliableFoot(rep) === "right")} disabled={busy} onChange={value => change(() => setPairSelection({ playerId, leftId, rightId: value }))} />
      </>}
      <div className="admin-form-actions"><button type="button" className="primary-cta" disabled={busy || !ready} onClick={generate}>{busy ? "Working…" : target?.result ? "Generate new analysis" : "Generate analysis"}</button>{playerId && <button type="button" className="quiet-button" disabled={busy} onClick={() => exportDataset(false)}>Export athlete reviews</button>}{players.length > 0 && <button type="button" className="quiet-button" disabled={busy || players.length > 100} onClick={() => exportDataset(true)}>Export organization reviews</button>}</div>
      {mode === "comparison" && playerId && (!leftId || !rightId) && <p className="admin-note">A comparison needs a labeled left-foot kick and a labeled right-foot kick. Assign missing foot labels in <Link to={resultsPath(playerId, "shooting")}>rep tools</Link>.</p>}
    </section>
    {error && <p className="form-message" role="alert">{error}</p>}{status && <p className="analysis-status" role="status">{status}</p>}
    {target && selectedReps.length > 0 ? <ReviewEditor key={`${playerId}:${mode}:${targetId}:${reload}`} playerId={playerId} reps={selectedReps} target={target} blocked={busy} onDirty={setDirty} onSaving={setBusy} onSaved={() => { setDirty(false); setStatus("Review saved. The original analysis is preserved."); setReload(value => value + 1); }} /> : ready && <section className="admin-card"><p>{mode === "comparison" && !pair ? "Generate this left/right comparison to start a review." : "Loading analysis…"}</p></section>}
  </div>;
}

function RepSelect({ label, value, reps, onChange, disabled }: { label: string; value: string; reps: any[]; onChange: (value: string) => void; disabled: boolean }) {
  return <label className="admin-field"><span>{label}</span><select value={value} disabled={disabled} onChange={event => onChange(event.target.value)}><option value="">Choose kick</option>{reps.map(rep => <option key={rep.id} value={rep.id}>{repLabel(rep)}</option>)}</select></label>;
}

function ReviewEditor({ playerId, reps, target, blocked, onDirty, onSaving, onSaved }: { playerId: string; reps: any[]; target: ReviewTarget; blocked: boolean; onDirty: (value: boolean) => void; onSaving: (value: boolean) => void; onSaved: () => void }) {
  const sameSource = (target.review?.source?.jobId || null) === (target.result?.jobId || null);
  const previous = sameSource ? target.review : null;
  const [feedback, setFeedback] = useState<ReviewFeedback>(previous?.feedback || feedbackFromResult(target.result));
  const [annotations, setAnnotations] = useState<TechniqueAnnotation[]>(previous?.annotations || []);
  const [notes, setNotes] = useState<ReviewNotes>(previous?.notes || { incorrect: "", missedPriorities: "", other: "" });
  const [approved, setApproved] = useState(false);
  const [publish, setPublish] = useState(Boolean(previous?.published));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [phase, setPhase] = useState<Phase>("contact");
  const [manual, setManual] = useState(!target.result);
  const [historyId, setHistoryId] = useState("");
  const [sourceStates, setSourceStates] = useState<Record<string, { identities: ObservedSource; ready: boolean }>>({});
  const [manualReset, setManualReset] = useState(false);
  const manualDrift = !manualReset && manualArtifactsChanged(previous, sourceStates);
  const sourceLoaded = useCallback((repId: string, identities: ObservedSource, ready: boolean) => setSourceStates(current => ({ ...current, [repId]: { identities, ready } })), []);
  const canApprove = !manualDrift && (Boolean(target.result?.jobId) || (annotations.length > 0 && reps.every(rep => sourceStates[rep.id]?.ready)));
  const dirty = () => onDirty(true);
  const evidence = sourceEvidence(target.result);
  const originalFeedback = feedbackFromResult(target.result);
  const historical = target.history.find(row => row.reviewId === historyId);
  function editFocus(index: number, patch: Partial<ReviewFocus>) { dirty(); setFeedback(current => ({ ...current, focusAreas: current.focusAreas.map((row, i) => i === index ? { ...row, ...patch } : row) })); }
  async function save() {
    setSaving(true); onSaving(true); setError("");
    try {
      if (manualDrift) throw new Error("Start a fresh manual review before saving labels for this changed recording.");
      await saveAnalysisReview({ playerId, targetType: target.targetType, targetId: target.targetId, sourceJobId: target.result?.jobId || null, baseRevision: target.head?.revision || 0, feedback, annotations, notes, datasetApproved: approved && canApprove, publish, observedSources: Object.fromEntries(Object.entries(sourceStates).map(([key, value]) => [key, value.identities])), resetManualSource: manualReset });
      onSaved();
    } catch (error: any) { setError(error.message); }
    finally { setSaving(false); onSaving(false); }
  }
  return <fieldset disabled={saving || blocked} className="analysis-editor-fields">
    {!sameSource && <p className="form-message">A previous review belongs to an older generation. Its history is preserved below. This draft starts from the current original.</p>}
    {manualDrift && <section className="admin-card"><p className="form-message">The recording changed since the saved manual review. Those annotations belong to the earlier source, which remains in history.</p><button className="quiet-button" type="button" onClick={() => { setManualReset(true); setFeedback({ summary: "", focusAreas: [] }); setAnnotations([]); setNotes({ incorrect: "", missedPriorities: "", other: "" }); setApproved(false); setPublish(false); dirty(); }}>Start fresh manual review</button></section>}
    <section className="admin-card analysis-evidence">
      <div className="analysis-card-heading"><div><h2>{target.targetType === "comparison" ? "Compare both feet" : "Inspect this kick"}</h2><p className="admin-note">Phase buttons pause each kick at its own event. All limbs refer to the athlete’s physical left and right.</p></div><label className="analysis-check"><input type="checkbox" checked={manual} onChange={event => setManual(event.target.checked)} />Annotation tools</label></div>
      <div className="analysis-phase-tabs" role="group" aria-label="Kick phase">{PHASES.map(key => <button key={key} type="button" className={`quiet-button ${phase === key ? "active" : ""}`} onClick={() => setPhase(key)}>{phaseLabel(key)}</button>)}</div>
      <div className={`analysis-videos ${reps.length > 1 ? "paired" : ""}`}>{reps.map(rep => <AnnotationViewer key={rep.id} playerId={playerId} rep={rep} onSource={sourceLoaded} result={target.targetType === "single" ? target.result : { keyFrames: rep.id === target.result?.leftRepId ? target.result?.leftKeyFrames : target.result?.rightKeyFrames, fps: rep.id === target.result?.leftRepId ? target.result?.leftFps : target.result?.rightFps }} phase={phase} enabled={manual} annotations={annotations.filter(row => row.repId === rep.id)} onAdd={annotation => { dirty(); setAnnotations(rows => [...rows, annotation]); }} />)}</div>
      {annotations.length > 0 && <div className="analysis-annotations"><h3>Frame annotations</h3>{annotations.map(row => <div key={row.id} className="analysis-annotation"><div><strong>{phaseLabel(row.phase)} · frame {row.frame}</strong><p>{reps.find(rep => rep.id === row.repId) ? repLabel(reps.find(rep => rep.id === row.repId)) : row.repId}</p><p>{row.limbs.map(key => LIMBS[key]?.label || key).join(", ")}</p><textarea aria-label={`Annotation at frame ${row.frame}`} maxLength={2000} value={row.comment} onChange={event => { dirty(); setAnnotations(rows => rows.map(value => value.id === row.id ? { ...value, comment: event.target.value } : value)); }} /></div><button type="button" className="quiet-button small" onClick={() => { dirty(); setAnnotations(rows => rows.filter(value => value.id !== row.id)); }}>Remove</button></div>)}</div>}
      <details><summary>Measured evidence ({evidence.length}) and data quality</summary><div className="analysis-table-wrap"><table><thead><tr><th>Evidence</th><th>{target.targetType === "comparison" ? "Left" : "Athlete"}</th><th>{target.targetType === "comparison" ? "Right" : "Reference"}</th><th>Delta</th><th>Quality</th></tr></thead><tbody>{evidence.map((row: any) => <tr key={row.id}><td><strong>{row.metric || row.kind || row.id}</strong><br />{row.frameKey} · {row.side || "whole body"}<br /><code>{row.id}</code></td><td>{formatReading(row.left ?? row.athlete, row.units)}</td><td>{formatReading(row.right ?? row.pro, row.units)}</td><td>{formatReading(row.delta, row.units)}</td><td>{eligibleEvidence(row) ? "Available" : "Unavailable"}<br />{row.note || row.notes?.join(" ") || row.qualityNotes?.join(" ") || row.meaning}</td></tr>)}</tbody></table></div><pre>{pretty(target.result?.dataQuality || { notes: ["Manual review: no generated evidence table."] })}</pre></details>
      <details><summary>Generation provenance</summary><pre>{pretty(target.result?.provenance || { note: "No immutable generation yet. A manual review will preserve the recorded rep." })}</pre></details>
    </section>
    <div className="analysis-review-columns">
      <section className="admin-card"><h2>Original feedback</h2><p className="admin-note">Preserved exactly as generated.</p>{originalFeedback.summary && <p>{originalFeedback.summary}</p>}{originalFeedback.focusAreas.length === 0 && <p>No generated priorities. You can write a manual review.</p>}{originalFeedback.focusAreas.map(row => <article className="analysis-original" key={row.id}><h3>{row.rank}. {row.title}</h3><p>{row.observation}</p><strong>{row.cue}</strong><p>{row.whyItMatters}</p><small>{row.evidenceIds.join(", ")}</small></article>)}<details><summary>Full original output</summary><pre>{pretty(target.result)}</pre></details></section>
      <section className="admin-card"><h2>Reviewed feedback</h2><p className="admin-note">Put the most important change first. Keep zero priorities when no correction is supported.</p>
        <label className="admin-field"><span>Athlete summary</span><textarea maxLength={6000} value={feedback.summary} onChange={event => { dirty(); setFeedback(current => ({ ...current, summary: event.target.value })); }} /></label>
        {feedback.focusAreas.map((row, index) => <article className="analysis-priority" key={row.id}><div className="analysis-card-heading"><h3>Priority {index + 1}</h3><div><button type="button" className="quiet-button small" aria-label={`Move priority ${index + 1} up`} disabled={!index} onClick={() => { dirty(); setFeedback(current => ({ ...current, focusAreas: reorderedFocus(current.focusAreas, index, -1) })); }}>↑</button><button type="button" className="quiet-button small" aria-label={`Move priority ${index + 1} down`} disabled={index === feedback.focusAreas.length - 1} onClick={() => { dirty(); setFeedback(current => ({ ...current, focusAreas: reorderedFocus(current.focusAreas, index, 1) })); }}>↓</button><button type="button" className="quiet-button small" onClick={() => { dirty(); setFeedback(current => ({ ...current, focusAreas: current.focusAreas.filter(value => value.id !== row.id).map((value, i) => ({ ...value, rank: i + 1 })) })); }}>Remove</button></div></div>
          <label className="admin-field"><span>Title</span><input maxLength={200} value={row.title} onChange={event => editFocus(index, { title: event.target.value })} /></label>
          <label className="admin-field"><span>What you observed</span><textarea maxLength={4000} value={row.observation} onChange={event => editFocus(index, { observation: event.target.value })} /></label>
          <label className="admin-field"><span>Actionable coaching cue</span><textarea maxLength={1000} value={row.cue} onChange={event => editFocus(index, { cue: event.target.value })} /></label>
          <label className="admin-field"><span>Why this matters</span><textarea maxLength={4000} value={row.whyItMatters} onChange={event => editFocus(index, { whyItMatters: event.target.value })} /></label>
          <details><summary>Supporting evidence ({row.evidenceIds.length})</summary>{evidence.filter(eligibleEvidence).map((value: any) => <label className="analysis-check" key={value.id}><input type="checkbox" checked={row.evidenceIds.includes(value.id)} onChange={event => editFocus(index, { evidenceIds: event.target.checked ? [...row.evidenceIds, value.id] : row.evidenceIds.filter(id => id !== value.id) })} />{value.id}</label>)}{!evidence.length && <p>Use frame annotations to support a manual observation.</p>}</details>
        </article>)}
        <button type="button" className="quiet-button" disabled={feedback.focusAreas.length >= 12} onClick={() => { dirty(); setFeedback(current => ({ ...current, focusAreas: [...current.focusAreas, { id: `focus_${crypto.randomUUID()}`, rank: current.focusAreas.length + 1, title: "", observation: "", cue: "", whyItMatters: "", evidenceIds: [] }] })); }}>Add priority</button>
      </section>
    </div>
    <section className="admin-card"><h2>Private review notes</h2><p className="admin-note">These notes stay in the admin review and approved dataset. They are never included in athlete feedback.</p><div className="analysis-notes">{([['incorrect', 'What the agent got wrong'], ['missedPriorities', 'What it should have focused on'], ['other', 'Other context']] as const).map(([key, label]) => <label key={key} className="admin-field"><span>{label}</span><textarea maxLength={6000} value={notes[key]} onChange={event => { dirty(); setNotes(current => ({ ...current, [key]: event.target.value })); }} /></label>)}</div>
      {annotations.length > 0 && reps.some(rep => !Number.isInteger(target.result?.provenance?.sources?.[rep.id]?.frameCount)) && <p className="admin-note">The source record does not include every clip’s frame count. Verify frame annotations against the recording before approving this example; unverified frame bounds are retained in its source history.</p>}
      <label className="analysis-check"><input type="checkbox" checked={approved && canApprove} disabled={!canApprove} onChange={event => { dirty(); setApproved(event.target.checked); }} />Approve this revision for training and evaluation examples</label>
      {!canApprove && <p className="admin-note">Manual training examples require a frame annotation and verified source pose, recorded FPS and image dimensions. You can save and publish this review while approval is unavailable.</p>}
      <label className="analysis-check"><input type="checkbox" checked={publish} onChange={event => { dirty(); setPublish(event.target.checked); }} />Publish this reviewed feedback to the athlete</label>
      <p className="admin-note">Each save creates a new immutable revision. Dataset approval must be chosen for this save. Saving without publication removes the published correction for this target.</p>
      {error && <p className="form-message" role="alert">{error}</p>}<button className="primary-cta" type="button" disabled={saving} onClick={save}>{saving ? "Saving review…" : `Save revision ${(target.head?.revision || 0) + 1}`}</button>
    </section>
    {target.history.length > 0 && <section className="admin-card"><h2>Review history</h2><select aria-label="Saved review revision" value={historyId} onChange={event => setHistoryId(event.target.value)}><option value="">Choose revision to inspect</option>{target.history.map(row => <option key={row.reviewId} value={row.reviewId}>Revision {row.revision} · {row.reviewerEmail} · {row.datasetApproved ? "approved dataset" : "excluded from dataset"}</option>)}</select>{historical && <pre>{pretty(historical)}</pre>}</section>}
  </fieldset>;
}

function formatReading(value: unknown, units: string) { return typeof value === "number" && Number.isFinite(value) ? `${Number(value.toFixed(3))} ${units || ""}` : "—"; }

function AnnotationViewer({ playerId, rep, result, phase, enabled, annotations, onAdd, onSource }: { playerId: string; rep: any; result: any; phase: Phase; enabled: boolean; annotations: TechniqueAnnotation[]; onAdd: (value: TechniqueAnnotation) => void; onSource: (repId: string, identities: ObservedSource, ready: boolean) => void }) {
  const [bundle, setBundle] = useState<RepArtifactBundle | null>(null);
  const [error, setError] = useState("");
  const [frame, setFrame] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [limbs, setLimbs] = useState<string[]>([]);
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [comment, setComment] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let live = true;
    loadAnnotationArtifacts(playerId, rep).then(value => {
      if (!live) return;
      setBundle(value);
      const metadata = value.metadata || {}, capture = value.reprocessContext?.capture || {};
      const width = metadata.videoDisplayWidth ?? metadata.frameWidth, height = metadata.videoDisplayHeight ?? metadata.frameHeight;
      if (typeof width === "number" && width > 0 && typeof height === "number" && height > 0) setAspect(width / height);
      const fps = metadata.framesPerSecond ?? capture.clipFramesPerSecondUsed;
      const frames = Array.isArray(value.pose) ? value.pose : value.pose?.frames;
      const ready = Boolean(value.sourceIdentities["pose.json"] && Array.isArray(frames) && frames.length > 0 && typeof fps === "number" && fps > 0 && width > 0 && height > 0);
      onSource(rep.id, value.sourceIdentities, ready);
    }).catch(error => { if (live) setError(error.message); });
    return () => { live = false; };
  }, [playerId, rep, onSource]);
  const poseFrames = Array.isArray(bundle?.pose) ? bundle.pose : bundle?.pose?.frames || [];
  const timing = resolveClipTiming({ metadata: typeof result?.fps === "number" && result.fps > 0 ? { ...bundle?.metadata, framesPerSecond: result.fps } : bundle?.metadata, reprocessContext: bundle?.reprocessContext, poseFrameCount: poseFrames.length, videoDuration: duration });
  const keyFrame = phaseFrame(result, bundle?.metadata, phase);
  const maxFrame = Math.max(timing.totalFrames - 1, frame);
  function seek(value: number) {
    const next = Math.max(0, Math.min(timing.totalFrames - 1, Math.round(value))); setFrame(next);
    if (video.current) { video.current.pause(); video.current.currentTime = (next + 0.5) / timing.fps; }
  }
  useEffect(() => { if (keyFrame !== null) { setFrame(keyFrame); if (video.current) { video.current.pause(); video.current.currentTime = (keyFrame + 0.5) / timing.fps; } } }, [phase, keyFrame, timing.fps]);
  const pose = poseFrames[frame];
  const at = (index: number) => aspect ? poseJoint(pose, index) : null;
  function toggleLimb(key: string) { setLimbs(rows => rows.includes(key) ? rows.filter(value => value !== key) : [...rows, key]); }
  function add() {
    onAdd({ id: `annotation_${crypto.randomUUID()}`, repId: rep.id, phase, frame, limbs, point, comment: comment.trim() });
    setLimbs([]); setPoint(null); setComment("");
  }
  return <div className="analysis-video-card">
    <div className="analysis-card-heading"><strong>{repLabel(rep)}</strong><Link to={resultsPath(playerId, "shooting", rep.id)} target="_blank" rel="noreferrer">Rep tools ↗</Link></div>
    {error && <p className="form-message">{error}</p>}{!bundle ? <p>Loading recording…</p> : <>
      <div className="analysis-video-stage" style={{ aspectRatio: aspect || 16 / 9 }}>
        {bundle.mediaUrl ? <video ref={video} src={bundle.mediaUrl} controls playsInline preload="metadata" onLoadedMetadata={event => { const el = event.currentTarget; setDuration(el.duration); if (el.videoWidth && el.videoHeight) setAspect(el.videoWidth / el.videoHeight); if (keyFrame !== null) el.currentTime = (keyFrame + 0.5) / timing.fps; }} onTimeUpdate={event => setFrame(Math.floor(event.currentTarget.currentTime * timing.fps))} /> : <div className="analysis-video-missing">No saved video. Pose frames and annotations remain available.</div>}
        <svg className={`analysis-pose ${enabled ? "editable" : ""}`} viewBox="0 0 1000 1000" preserveAspectRatio="none" role="img" aria-label="Pose and frame annotations" onClick={event => { if (!enabled) return; const bounds = event.currentTarget.getBoundingClientRect(); setPoint({ x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) }); }}>
          {Object.entries(LIMBS).map(([key, limb]) => { const a = at(limb.joints[0]), b = at(limb.joints[1]); if (!a || !b) return null; const marked = limbs.includes(key) || annotations.some(row => row.frame === frame && row.limbs.includes(key)); return <line key={key} x1={a.x * 1000} y1={a.y * 1000} x2={b.x * 1000} y2={b.y * 1000} stroke={marked ? "#ff826e" : "#b7f34a"} strokeWidth={marked ? 7 : 3} vectorEffect="non-scaling-stroke" onClick={event => { if (enabled) { event.stopPropagation(); toggleLimb(key); } }}><title>{limb.label}</title></line>; })}
          {annotations.filter(row => row.frame === frame && row.point).map(row => <circle key={row.id} cx={row.point!.x * 1000} cy={row.point!.y * 1000} r="12" fill="#ffd36b"><title>{row.comment}</title></circle>)}
          {point && <circle cx={point.x * 1000} cy={point.y * 1000} r="12" fill="#ff826e" />}
        </svg>
      </div>
      {!aspect && <p className="admin-note">Image geometry is unavailable. Pose overlays and new frame annotations stay disabled until source dimensions are known.</p>}<div className="analysis-transport"><button type="button" className="quiet-button small" onClick={() => seek(frame - 1)} aria-label="Previous frame">←</button><input aria-label={`Frame for ${repLabel(rep)}`} type="range" min="0" max={maxFrame} value={frame} onChange={event => seek(Number(event.target.value))} /><button type="button" className="quiet-button small" onClick={() => seek(frame + 1)} aria-label="Next frame">→</button><span>Frame {frame}</span></div>
      <p className="admin-note">{keyFrame === null ? `${phaseLabel(phase)} frame is unavailable; scrub to set your observation.` : `${phaseLabel(phase)}: frame ${keyFrame}.`} {timing.fpsSource === "default" ? "Frame rate unknown; 60 fps preview estimate. Verify timing in rep tools before annotating." : `${Number(timing.fps.toFixed(2))} fps · ${timing.fpsSource}`}</p>
      {enabled && <div className="analysis-annotation-tools"><p className="admin-note">Click a limb to highlight it or click the image to place a comment marker.</p><div className="analysis-limb-picks">{Object.entries(LIMBS).map(([key, limb]) => <button type="button" key={key} className={`quiet-button small ${limbs.includes(key) ? "active" : ""}`} onClick={() => toggleLimb(key)}>{limb.label}</button>)}</div><label className="admin-field"><span>Observation at frame {frame}</span><textarea value={comment} maxLength={2000} onChange={event => setComment(event.target.value)} placeholder="Describe what you see and why it matters." /></label><button type="button" className="quiet-button" disabled={!comment.trim() || !aspect || annotations.length >= 100 || timing.fpsSource === "default"} onClick={add}>Add frame annotation</button></div>}
    </>}
  </div>;
}
