import { useCallback, useEffect, useState } from "react";
import type { CatalogDrill } from "../../../lib/contracts/drillV2";
import { MEDIA_SLOT_LABELS } from "../../../lib/contracts/types";
import { authoringAction, loadDrillAuthoring } from "../lib/trainingAuthoring";
import { REQUIRED_FILM_SLOTS, filmingProgress, sourceLink, type DrillAuthoring } from "../lib/wholeBodyTraining";
import "../personalized.scss";
import { storage } from "../../../lib/firebase";

export default function DrillProductionPanel({ drill, onChanged }: { drill: CatalogDrill; onChanged?: () => void }) {
  const [record, setRecord] = useState<DrillAuthoring | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [week, setWeek] = useState(1);
  const [notes, setNotes] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(async () => {
    const result = await loadDrillAuthoring(drill.drillId);
    const next = result.records[drill.drillId] ?? null;
    setRecord(next); setCanReview(result.canReview); setLoaded(true);
    if (next) { setWeek(next.filmingWeek); setNotes(next.productionNotes ?? ""); setReviewNotes(next.reviewNotes ?? ""); setInstructions(next.filmingInstructions ?? {}); }
  }, [drill.drillId]);
  useEffect(() => { let live = true; void load().catch(e => { if (live) { setError(e.message); setLoaded(true); } }); return () => { live = false; }; }, [load, drill.updatedAt, drill.mediaPublishedAt]);
  async function act(action: Parameters<typeof authoringAction>[0], extra: Record<string, unknown>) {
    if (!record || busy) return;
    setBusy(true); setError("");
    try { await authoringAction(action, { drillId: drill.drillId, baseRevision: record.revision, ...extra }); await load(); onChanged?.(); }
    catch (e) { setError(e instanceof Error ? e.message : "The update could not be saved. Reload to check its current state."); }
    finally { setBusy(false); }
  }
  if (!record && !drill.productionBatchId && !error) return null;
  const progress = filmingProgress(drill.media);
  return <section className="admin-card training-production" aria-label="Drill production">
    <h3>Production & evidence</h3>
    <p className="admin-note">Private production notes stay in the admin library. Athlete instructions and coaching cues are edited above.</p>
    {error && <p className="form-message" role="alert">{error}</p>}
    {!loaded && <p role="status">Loading production details…</p>}
    {loaded && !record && <p className="admin-note">Production details are unavailable. Publishing is held until the record can be checked.</p>}
    {record && <>
      <div className="admin-row-meta"><span className={`admin-chip ${record.reviewStatus === "approved" ? "accent" : "warn"}`}>Content review: {record.reviewStatus}</span><span className="admin-chip">{progress.uploaded}/3 clips uploaded · {progress.approved}/3 approved</span></div>
      <p className="admin-note">{record.publicationHold || (record.reviewStatus === "approved" && progress.approved === 3 ? "Ready for a final server publication check." : "Publication held: content review and all three approved clips are required.")}</p>
      <fieldset disabled={busy} className="admin-form"><legend>Filming queue</legend>
        <label className="admin-field"><span>Filming week</span><select value={week} onChange={e => setWeek(+e.target.value)}>{[1, 2, 3, 4].map(n => <option key={n} value={n}>Week {n} · {n === 1 ? "Sept 21–27" : n === 2 ? "Sept 28–Oct 4" : n === 3 ? "Oct 5–11" : "Oct 12–18"}</option>)}</select></label>
        <div className="admin-media-grid">{REQUIRED_FILM_SLOTS.map(slot => {
          const asset = drill.media?.[slot];
          return <div className="admin-media-slot" key={slot}><h4>{MEDIA_SLOT_LABELS[slot]}</h4><p className="admin-note">{asset?.storagePath ? asset.status === "approved" ? "Approved" : "Uploaded · awaiting review" : "To film"}</p>
            {asset?.storagePath && <AdminMediaReviewPreview path={asset.storagePath} generation={String(asset.generation ?? "")} title={MEDIA_SLOT_LABELS[slot]} />}
            <label className="admin-field"><span>{MEDIA_SLOT_LABELS[slot]} filming directions</span><textarea rows={4} maxLength={3000} value={instructions[slot] ?? ""} onChange={e => setInstructions(old => ({ ...old, [slot]: e.target.value }))} /></label>
            {canReview && asset?.storagePath && asset.status !== "approved" && <button type="button" className="quiet-button" onClick={() => void act("trainingApproveDrillMedia", { slot, generation: asset.generation })}>Approve reviewed clip</button>}
          </div>;
        })}</div>
        <label className="admin-field"><span>Private production notes</span><textarea rows={3} maxLength={4000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
        <button type="button" className="quiet-button" onClick={() => void act("trainingSaveDrillAuthoring", { patch: { filmingWeek: week, productionNotes: notes, filmingInstructions: instructions } })}>Save production details</button>
      </fieldset>
      <h4>Research supporting this exercise</h4>
      <p className="admin-note">Study findings support the stated training purpose; they do not establish an individual diagnosis or guarantee a test improvement.</p>
      {(record.sources ?? []).length ? <div className="training-evidence-list">{record.sources.map((source, index) => <details key={source.id || index}><summary>{source.title || source.id} · {({ officialConsensus: "Expert consensus", controlledTrial: "Controlled trial", interventionStudy: "Training study", officialCoachingGuidance: "Coaching guidance" } as Record<string, string>)[source.evidenceType] ?? source.evidenceType.replace(/([a-z])([A-Z])/g, "$1 $2")}</summary><p><strong>Population:</strong> {source.population}</p><p><strong>Application:</strong> {source.applicability}</p><p><strong>Limits:</strong> {source.limitations}</p>{sourceLink(source.url) && <a href={sourceLink(source.url)} target="_blank" rel="noopener noreferrer">Read research source</a>}</details>)}</div> : <p className="admin-note">Research sources are awaiting review.</p>}
      {canReview ? <fieldset disabled={busy} className="admin-form"><legend>Qualified content review</legend><label className="admin-field"><span>Review notes</span><textarea rows={3} maxLength={4000} value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} /></label><p className="admin-note">Approval covers the current content, dose and eligibility policy. Material edits require another review.</p><div className="admin-form-actions"><button type="button" className="quiet-button" onClick={() => void act("trainingReviewDrill", { decision: "pending", reviewNotes })}>Return to review</button><button type="button" className="quiet-button" disabled={!reviewNotes.trim()} onClick={() => void act("trainingReviewDrill", { decision: "approved", reviewNotes })}>Approve reviewed content</button></div></fieldset> : <p className="admin-note">A designated qualified reviewer must approve content and clips. An admin account alone does not grant qualification.</p>}
      {drill.status !== "published" && <button type="button" className="primary-cta" disabled={busy || record.reviewStatus !== "approved" || progress.approved !== 3} onClick={() => void act("trainingPublishDrill", {})}>{busy ? "Checking…" : "Publish reviewed drill"}</button>}
    </>}
  </section>;
}

function AdminMediaReviewPreview({ path, generation, title }: { path: string; generation: string; title: string }) {
  const [url, setUrl] = useState(""); const [error, setError] = useState("");
  useEffect(() => { let live = true; setUrl(""); setError(""); void storage.ref(path).getDownloadURL().then(next => { if (live) setUrl(next); }).catch(() => { if (live) setError("The review video could not load. Reload before approving it."); }); return () => { live = false; }; }, [path, generation]);
  return <>{url && <video controls playsInline preload="metadata" src={url} aria-label={`Review ${title}`} style={{ width: "100%", maxHeight: 280 }} />}{error && <p className="form-message" role="alert">{error}</p>}</>;
}

