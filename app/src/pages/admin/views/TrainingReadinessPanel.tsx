/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { getTrainingReadiness, saveTrainingReadiness, designateTrainingReviewer } from "../lib/trainingAuthoring";
import { LOAD_FAMILIES } from "../lib/wholeBodyTraining";

const label = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());
const isoDate = (value: any) => { const date = value?.toDate?.() ?? (value?.seconds ? new Date(value.seconds * 1000) : new Date(value)); return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : ""; };
const blank = () => ({ schemaVersion: 1, status: "pending", loadFamilies: [] as string[], supervision: "qualifiedCoach", expiresAt: "", limits: { setsPerSession: "", setsPerWeek: "", contactsPerSession: "", contactsPerWeek: "", holdSecondsPerSession: "", holdSecondsPerWeek: "", minRecoveryHours: 48 } as Record<string, number | string>, exerciseLoads: {} as Record<string, { instruction: string; independentAllowed: boolean }> });

export default function TrainingReadinessPanel({ playerId, playerName }: { playerId: string; playerName: string }) {
  const [value, setValue] = useState(blank);
  const [revision, setRevision] = useState(0);
  const [canReview, setCanReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [newDrillId, setNewDrillId] = useState("");
  useEffect(() => { let live = true; void getTrainingReadiness(playerId).then(result => {
    if (!live) return;
    setCanReview(result.canReview === true); setRevision(result.readiness?.revision ?? 0);
    if (result.readiness) setValue({ ...blank(), ...result.readiness, expiresAt: isoDate(result.readiness.expiresAt) });
    setLoaded(true);
  }).catch(e => { if (live) { setLoaded(true); setMessage(e.message); } }); return () => { live = false; }; }, [playerId]);
  async function save(status: string) {
    if (!canReview || busy) return;
    setBusy(true); setMessage("");
    try {
      const readiness = { ...value, status, expiresAt: value.expiresAt ? `${value.expiresAt}T23:59:59.000Z` : null,
        limits: Object.fromEntries(Object.entries(value.limits).map(([key, entry]) => [key, entry === "" ? null : Number(entry)])) };
      const result = await saveTrainingReadiness(playerId, revision, readiness);
      setRevision(result.readiness?.revision ?? revision + 1); setValue(result.readiness ? { ...blank(), ...result.readiness, expiresAt: isoDate(result.readiness.expiresAt) } : { ...value, status }); setMessage("Readiness review saved. Future training is checked against this review.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Readiness could not be saved."); }
    finally { setBusy(false); }
  }
  return <details className="training-readiness"><summary>Verified training readiness · {playerName}</summary>
    {!loaded && <p role="status">Checking reviewer access…</p>}
    {message && <p className="personalized-notice" role="status">{message}</p>}
    <p className="personalized-meta">Review status: {value.status}. Reported experience and gym access cannot clear a player. A qualified reviewer records competence and loading conditions.</p>
    {canReview && <fieldset disabled={busy}><legend>Qualified reviewer assessment</legend>
      <div className="personalized-fields"><label>Review expires<input type="date" value={value.expiresAt} onChange={e => setValue({ ...value, expiresAt: e.target.value })} /></label><label>Supervision condition<select value={value.supervision} onChange={e => setValue({ ...value, supervision: e.target.value })}><option value="qualifiedCoach">Qualified coach required</option><option value="independent">Individually approved for independent use</option></select></label></div>
      <fieldset><legend>Movement families assessed</legend><div className="personalized-equipment">{LOAD_FAMILIES.map(family => <label key={family}><input type="checkbox" checked={value.loadFamilies.includes(family)} onChange={() => setValue({ ...value, loadFamilies: value.loadFamilies.includes(family) ? value.loadFamilies.filter(f => f !== family) : [...value.loadFamilies, family] })} />{label(family)}</label>)}</div></fieldset>
      <div className="personalized-fields">{Object.entries(value.limits).map(([key, entry]) => <label key={key}>{label(key)}<input type="number" min={0} value={entry} onChange={e => setValue({ ...value, limits: { ...value.limits, [key]: e.target.value } })} /></label>)}</div>
      <h4>Individual exercise loading</h4>
      <p className="personalized-meta">Specify the actual starting load and permitted progression for each cleared exercise. Independent use requires its own approval.</p>
      {Object.entries(value.exerciseLoads).map(([drillId, load]) => <fieldset key={drillId}><legend>{drillId}</legend><label>Starting load, limits & permitted progression<textarea maxLength={500} value={load.instruction} onChange={e => setValue({ ...value, exerciseLoads: { ...value.exerciseLoads, [drillId]: { ...load, instruction: e.target.value } } })} /></label><label className="personalized-checkbox"><input type="checkbox" checked={load.independentAllowed} onChange={e => setValue({ ...value, exerciseLoads: { ...value.exerciseLoads, [drillId]: { ...load, independentAllowed: e.target.checked } } })} />Approved for independent use under these exact conditions</label><button type="button" className="quiet-button" onClick={() => setValue({ ...value, exerciseLoads: Object.fromEntries(Object.entries(value.exerciseLoads).filter(([id]) => id !== drillId)) })}>Remove {drillId} clearance</button></fieldset>)}
      <div className="personalized-fields"><label>Exercise ID<input value={newDrillId} onChange={e => setNewDrillId(e.target.value.toUpperCase())} placeholder="STR-601" autoComplete="off" spellCheck={false} /></label><button type="button" className="quiet-button" disabled={!/^[A-Z]{3}-\d+$/.test(newDrillId.trim()) || Boolean(value.exerciseLoads[newDrillId.trim()])} onClick={() => { setValue({ ...value, exerciseLoads: { ...value.exerciseLoads, [newDrillId.trim()]: { instruction: "", independentAllowed: false } } }); setNewDrillId(""); }}>Add exercise clearance</button></div>
      <p className="personalized-meta">Set conservative individual limits after an observed competence assessment. Scores and elapsed weeks never increase a starting load.</p>
      <div className="personalized-row-actions"><button type="button" className="quiet-button" onClick={() => void save("pending")}>Revoke / return to review</button><button type="button" className="quiet-button" disabled={!value.expiresAt || !value.loadFamilies.length || Object.values(value.limits).some(entry => entry === "")} onClick={() => void save("cleared")}>Save verified readiness</button></div>
    </fieldset>}
    {loaded && !canReview && <p className="personalized-meta">Only a designated qualified reviewer can change readiness.</p>}
  </details>;
}

export function TrainingReviewerDesignation() {
  const [uid, setUid] = useState(""); const [name, setName] = useState(""); const [qualification, setQualification] = useState("");
  const [confirmed, setConfirmed] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function save(enabled: boolean) {
    setBusy(true); setMessage("");
    try { await designateTrainingReviewer(uid.trim(), enabled, qualification.trim(), name.trim()); setMessage(enabled ? "Qualified reviewer designation saved. Reload to refresh review controls." : "Reviewer designation revoked."); setConfirmed(false); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Designation could not be saved."); } finally { setBusy(false); }
  }
  return <details className="admin-card training-reviewer-designation"><summary>Qualified training reviewers</summary><p className="admin-note">Designate a reviewer only after confirming their identity and qualifications. This grants content, media and player-readiness approval rights.</p><fieldset disabled={busy} className="admin-form"><legend>Reviewer designation</legend><label className="admin-field"><span>Reviewer account UID</span><input value={uid} onChange={e => setUid(e.target.value)} autoComplete="off" spellCheck={false} /></label><label className="admin-field"><span>Reviewer name</span><input value={name} onChange={e => setName(e.target.value)} /></label><label className="admin-field"><span>Verified qualifications</span><textarea maxLength={2000} value={qualification} onChange={e => setQualification(e.target.value)} /></label><label><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> I verified this account and this reviewer’s qualifications.</label><div className="admin-form-actions"><button type="button" className="quiet-button" disabled={!uid.trim()} onClick={() => void save(false)}>Revoke reviewer</button><button type="button" className="quiet-button" disabled={!confirmed || !uid.trim() || !name.trim() || !qualification.trim()} onClick={() => void save(true)}>Designate qualified reviewer</button></div></fieldset>{message && <p role="status">{message}</p>}</details>;
}


