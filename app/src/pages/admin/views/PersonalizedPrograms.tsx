/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { auth, db } from "../../../lib/firebase";
import { loadOrganizations, loadTeams, playerRow, activePlan } from "../lib/accounts";
import type { OrganizationRow, PlayerRow, TeamRow } from "../lib/accounts";
import { loadAthleteEvidence, loadOrganizationPlayers } from "../lib/programBatch";
import type { AthleteLoad } from "../lib/programBatch";
import { DEFAULT_INTAKE, HORIZON_WEEKS, SESSIONS_PER_WEEK, MINUTES_PER_SESSION, SETTINGS } from "../lib/planJobs";
import { EQUIPMENT_OPTIONS, runBatch } from "../lib/programBatchLogic";
import { submitLlmJob } from "../../athlete-portal/lib/loaders";
import { activationParams, allocationRows, PERSONALIZED_CAPABILITIES, PERSONALIZED_ENGINE,
  personalizedParams, plannerLink, prescriptionSignature, previewEnabled, recentEvidence, operationLabel } from "../lib/personalizedLogic";
import "../personalized.scss";
import AthleteEvidenceBadges from "./AthleteEvidenceBadges";

const label = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());
const millis = (value: any) => value?.toMillis?.() ?? (typeof value === "string" ? Date.parse(value) : 0);
const terminal = (status: string) => status === "complete" || status === "failed";

export default function PersonalizedPrograms() {
  const [query] = useSearchParams();
  const initial = useRef({ orgId: query.get("orgId") ?? "", ids: (query.get("players") ?? "").split(",").filter(Boolean) });
  const [orgs, setOrgs] = useState<OrganizationRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [orgId, setOrgId] = useState(initial.current.orgId);
  const [teamId, setTeamId] = useState(query.get("teamId") ?? "");
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [selected, setSelected] = useState(new Set(initial.current.ids));
  const [focused, setFocused] = useState(initial.current.ids[0] ?? "");
  const [search, setSearch] = useState("");
  const [evidence, setEvidence] = useState<Record<string, AthleteLoad>>({});
  const [evidenceErrors, setEvidenceErrors] = useState<Record<string, string>>({});
  const [intake, setIntake] = useState({ ...DEFAULT_INTAKE, equipment: [...DEFAULT_INTAKE.equipment] });
  const [config, setConfig] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [draftId, setDraftId] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    document.title = "Personalized planner — Preview | PoseTek";
    let live = true;
    Promise.all([loadOrganizations(), loadTeams()]).then(async ([organizations, loadedTeams]) => {
      if (!live) return;
      setOrgs(organizations); setTeams(loadedTeams);
      let targetOrg = initial.current.orgId;
      if (!targetOrg && initial.current.ids[0]) {
        const p = await db.collection("players").doc(initial.current.ids[0]).get();
        targetOrg = p.data()?.organizationId ?? "";
        if (!targetOrg && p.exists && live) { setPlayers([playerRow(p.id, p.data())]); setLoading(false); return; }
      }
      if (live) setOrgId(targetOrg || organizations.find(o => o.schemaVersion === 2)?.id || organizations[0]?.id || "");
    }).catch(e => { if (live) { setMessage(e.message); setLoading(false); } });
    const stopConfig = db.collection("config").doc("llm").onSnapshot(s => setConfig(s.data() ?? {}), e => setMessage(e.message));
    const stopJobs = db.collection("llmJobs").where("requestedByUid", "==", auth.currentUser!.uid).onSnapshot(s => {
      setJobs(s.docs.map(d => ({ id: d.id, ...d.data() })).filter((j: any) => PERSONALIZED_CAPABILITIES.includes(j.capability))
        .sort((a: any, b: any) => millis(b.createdAt) - millis(a.createdAt)));
    }, e => setMessage(e.message));
    return () => { live = false; mounted.current = false; stopConfig(); stopJobs(); };
  }, []);

  useEffect(() => {
    if (!orgId) return;
    let live = true;
    setLoading(true); setMessage(""); setTeamId(initial.current.orgId === orgId ? query.get("teamId") ?? "" : "");
    loadOrganizationPlayers(orgId).then(rows => {
      if (!live) return;
      setPlayers(rows); setLoading(false);
      setSelected(new Set(initial.current.orgId === orgId || !initial.current.orgId ? initial.current.ids.filter(id => rows.some(p => p.id === id)) : []));
      setFocused(current => rows.some(p => p.id === current) ? current : rows[0]?.id ?? "");
    }).catch(e => { if (live) { setMessage(e.message); setLoading(false); } });
    return () => { live = false; };
  }, [orgId]);

  useEffect(() => {
    let live = true;
    setEvidence({}); setEvidenceErrors({});
    void runBatch(players, 4, async player => {
      try { const data = await loadAthleteEvidence(player); if (live) setEvidence(old => ({ ...old, [player.id]: data })); }
      catch (e: any) { if (live) setEvidenceErrors(old => ({ ...old, [player.id]: e.message })); }
    });
    return () => { live = false; };
  }, [players]);

  useEffect(() => {
    setDrafts([]); setPlans([]); setDraftId(""); setReviewed(false);
    if (!focused) return;
    const ref = db.collection("players").doc(focused);
    const a = ref.collection("personalizedPlanDrafts").onSnapshot(s => setDrafts(s.docs.map(d => ({ ...d.data(), draftId: d.id }))
      .sort((x: any, y: any) => millis(y.createdAt) - millis(x.createdAt))), e => setMessage(e.message));
    const b = ref.collection("trainingPlans").onSnapshot(s => setPlans(s.docs.map(d => ({ id: d.id, ...d.data() }))), e => setMessage(e.message));
    return () => { a(); b(); };
  }, [focused]);

  const visible = useMemo(() => players.filter(p => (!teamId || p.teamId === teamId) && `${p.name} ${p.email ?? ""}`.toLowerCase().includes(search.toLowerCase())), [players, teamId, search]);
  const teamNames = useMemo(() => new Map(teams.map(team => [team.id, team.name])), [teams]);
  const draft = drafts.find(d => d.draftId === draftId) ?? drafts.find(d => d.status === "ready") ?? drafts[0];
  const current = activePlan(plans);
  useEffect(() => { setReviewed(false); }, [draft?.comparisonToken, draft?.status, current?.id, current?.planRevision]);
  const athlete = players.find(p => p.id === focused);
  const assessmentJob = jobs.find(j => j.playerId === focused && j.capability === "assess_personalized_plan");
  const assessment = assessmentJob?.status === "complete" ? assessmentJob.result : null;
  const ongoing = jobs.filter(j => !terminal(j.status));
  const inFlight = (playerId: string) => ongoing.some(j => j.playerId === playerId);
  const canGenerate = previewEnabled(config) && !busy && !intake.painFlag && selected.size > 0
    && [...selected].every(id => evidence[id] && !inFlight(id));
  const today = draft?.plan?.timezone ? new Intl.DateTimeFormat("en-CA", { timeZone: draft.plan.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()) : "";
  const stale = draft && (draft.plan.startDate !== today || JSON.stringify(draft.expectedActivePlans) !== JSON.stringify(plans.filter(p => p.status === "active")
    .map(p => ({ planId: p.id, planRevision: p.planRevision ?? 1 })).sort((a, b) => a.planId.localeCompare(b.planId))));

  function toggle(id: string) { setSelected(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function generate() {
    if (!canGenerate) return;
    setBusy(true); setMessage("");
    const failures: string[] = [];
    await runBatch(players.filter(p => selected.has(p.id)), 3, async player => {
      try { const load = evidence[player.id]; await submitLlmJob(player.id, "generate_personalized_plan", personalizedParams(load.reps, player.raw, load.evidence.age, intake)); }
      catch (e: any) { failures.push(`${player.name}: ${e.message}`); }
    });
    if (mounted.current) { setBusy(false); setMessage(failures.length ? failures.join(" · ") : "Draft jobs submitted. They keep running when you leave this page; progress is restored when you return."); }
  }
  async function act(action: "activate_personalized_plan" | "discard_personalized_plan") {
    if (!draft || busy || inFlight(focused) || (action === "activate_personalized_plan" && (!reviewed || stale))) return;
    setBusy(true); setMessage("");
    try { await submitLlmJob(focused, action, action === "activate_personalized_plan" ? activationParams(draft) : { engineVersion: PERSONALIZED_ENGINE, draftId: draft.draftId });
      if (mounted.current) { setReviewed(false); setMessage(action === "activate_personalized_plan" ? "Activation submitted. The server will recheck this draft against current player activity." : "Discard submitted."); }
    } catch (e: any) { if (mounted.current) setMessage(e.message); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function assess() {
    if (!athlete || !evidence[focused] || busy || inFlight(focused)) return;
    setBusy(true); setMessage("");
    try { const load=evidence[focused]; await submitLlmJob(focused,"assess_personalized_plan",personalizedParams(load.reps,athlete.raw,load.evidence.age,intake)); }
    catch(e:any) { if(mounted.current) setMessage(e.message); }
    finally { if(mounted.current) setBusy(false); }
  }

  return <div className="personalized-planner">
    <nav className="planner-switch" aria-label="Workout planner version">
      <Link to={plannerLink(false, orgId, selected, teamId)}>Current planner</Link><span aria-current="page">Personalized planner · Preview</span>
    </nav>
    <header className="personalized-heading"><span className="eyebrow">Admin preview · {PERSONALIZED_ENGINE}</span><h1>Plans shaped by each player</h1>
      <p>Review recent testing, build a draft, then compare its actual training minutes with the active plan. Players see a change only after you choose <strong>Use this plan</strong>.</p></header>
    {!previewEnabled(config) && <p className="personalized-notice" role="status">Personalized submissions are currently disabled. You can review saved drafts or use the current planner.</p>}
    {message && <p className="personalized-notice" role="status">{message}</p>}
    <div className="personalized-setup">
      <section className="personalized-card"><h2>1. Players & evidence</h2>
        <div className="personalized-fields"><label>Organization<select value={orgId} onChange={e => setOrgId(e.target.value)} disabled={busy}>
          {!orgId && <option value="">Independent player</option>}{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label>Team<select value={teamId} onChange={e => setTeamId(e.target.value)}><option value="">All teams</option>{teams.filter(t => t.organizationId === orgId).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>
        <label>Find a player<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or email" /></label>
        <div className="personalized-row-actions"><button type="button" className="quiet-button" onClick={() => setSelected(new Set(visible.filter(p => evidence[p.id] && !inFlight(p.id)).map(p => p.id)))}>Select visible</button>
          <button type="button" className="quiet-button" onClick={() => setSelected(new Set())}>Clear</button><span>{selected.size} selected</span></div>
        {loading ? <p>Loading roster…</p> : visible.length === 0 ? <p>No players match this selection.</p> : <div className="personalized-roster">{visible.map(p => {
          const load = evidence[p.id], recent = load ? recentEvidence(load.reps) : null;
          const latest = jobs.find(j => j.playerId === p.id);
          return <div key={p.id} className={`personalized-player ${focused === p.id ? "is-focused" : ""}`}>
            <input type="checkbox" aria-label={`Select ${p.name}`} checked={selected.has(p.id)} disabled={!load || busy || inFlight(p.id)} onChange={() => toggle(p.id)} />
            <div className="personalized-player-copy">
              <button type="button" className="personalized-player-name" onClick={() => { setFocused(p.id); setReviewed(false); }}><strong>{p.name}</strong><span>{p.email || "Email unavailable"}</span></button>
              <div className="admin-row-meta personalized-player-badges">
                <span className="admin-chip">{teamNames.get(p.teamId ?? "") ?? "No team"}</span>
                <AthleteEvidenceBadges evidence={load?.evidence} loading={!load && !evidenceErrors[p.id]} error={evidenceErrors[p.id]} />
              </div>
              {(evidenceErrors[p.id] || recent) && <p className={`personalized-evidence-summary${evidenceErrors[p.id] ? " is-error" : ""}`}>
                {evidenceErrors[p.id] || `${recent!.reps.length} recent test reps${recent!.excluded ? ` · ${recent!.excluded} undated/older reps excluded` : ""}`}
              </p>}
            </div>
            {latest && <span className={`personalized-status ${latest.status === "failed" ? "is-error" : ""}`}>{operationLabel(latest.capability)}: {latest.status}</span>}
          </div>;
        })}</div>}
        <p className="personalized-meta">Priorities are calculated on the server from the selected schedule, position, recent primary results, eligible curriculum and private coach feedback. Missing evidence uses a clearly labelled baseline.</p>
        {athlete && <div className="personalized-preflight"><h3>Proposed priorities · {athlete.name}</h3>
          <button type="button" className="quiet-button" disabled={!evidence[focused] || busy || inFlight(focused) || intake.painFlag || !previewEnabled(config,"assess_personalized_plan")} onClick={() => void assess()}>Preview priorities</button>
          {assessment && <><p className="personalized-meta">Assessment from {new Date(millis(assessment.assessedAt)).toLocaleString()} · {assessment.intake.sessionsPerWeek} × {assessment.intake.minutesPerSession} minutes/week · {label(assessment.intake.setting)}. Generation recalculates these priorities from current inputs.</p>
            <p>{assessment.evidencePolicy.reason}</p><ul>{assessment.findings.map((f:any,i:number)=><li key={i}><strong>{label(f.domain)} · {f.confidence} confidence</strong><p>{f.statement}</p><small>{f.targetBeforePct}% baseline → {f.targetFinalPct}% final target. {f.limitation}</small></li>)}</ul>
            {!assessment.findings.length && <p>No supported measured gap. The age/position baseline and available curriculum determine the training mix.</p>}
            <p className="personalized-meta">Target mix: {Object.entries(assessment.focusSplit).filter(([,n])=>Number(n)>0).map(([d,n])=>`${label(d)} ${n}%`).join(" · ")}</p></>}
        </div>}
      </section>
      <section className="personalized-card"><h2>2. Training schedule</h2><div className="personalized-fields">
        <label>Duration<select value={intake.horizonWeeks} onChange={e => setIntake({ ...intake, horizonWeeks: +e.target.value })}>{HORIZON_WEEKS.map(n => <option key={n} value={n}>{n} weeks</option>)}</select></label>
        <label>Sessions per week<select value={intake.sessionsPerWeek} onChange={e => setIntake({ ...intake, sessionsPerWeek: +e.target.value })}>{SESSIONS_PER_WEEK.map(n => <option key={n}>{n}</option>)}</select></label>
        <label>Minutes per session<select value={intake.minutesPerSession} onChange={e => setIntake({ ...intake, minutesPerSession: +e.target.value })}>{MINUTES_PER_SESSION.map(n => <option key={n}>{n}</option>)}</select></label>
        <label>Training setting<select value={intake.setting} onChange={e => setIntake({ ...intake, setting: e.target.value as typeof intake.setting })}>{SETTINGS.map(s => <option key={s} value={s}>{s === "halfAndHalf" ? "Half and half" : label(s)}</option>)}</select></label>
      </div><fieldset><legend>Available equipment</legend><div className="personalized-equipment">{EQUIPMENT_OPTIONS.map(e => <label key={e.id}><input type="checkbox" checked={intake.equipment.includes(e.id)} onChange={() => setIntake({ ...intake, equipment: intake.equipment.includes(e.id) ? intake.equipment.filter(v => v !== e.id) : [...intake.equipment, e.id] })} />{e.label}</label>)}</div></fieldset>
        <label className="personalized-checkbox"><input type="checkbox" checked={intake.painFlag} onChange={e => setIntake({ ...intake, painFlag: e.target.checked })} />A selected player has pain requiring review</label>
        {intake.painFlag && <p className="personalized-notice">Automated generation is paused. Review this player individually before prescribing.</p>}
        <p className="personalized-meta">The existing difficulty ceiling remains in force. Only dated results from the last 180 days contribute to the best-result adjustment.</p>
        <button type="button" className="primary-cta" disabled={!canGenerate} onClick={() => void generate()}>{busy ? "Submitting…" : `Generate ${selected.size || ""} draft${selected.size === 1 ? "" : "s"}`}</button>
      </section>
    </div>
    {jobs.length > 0 && <section className="personalized-card"><h2>Generation & activation progress</h2><p className="personalized-meta">Each player is processed independently. Leaving this page does not cancel submitted jobs.</p>
      <div className="personalized-jobs">{jobs.filter(j => players.some(p => p.id === j.playerId)).slice(0, 20).map(job => <div key={job.id}>
        <strong>{players.find(p => p.id === job.playerId)?.name}</strong><span>{operationLabel(job.capability)} · {job.status}</span>
        {job.progress && !terminal(job.status) && <><progress max={1} value={job.progress.fraction ?? 0} aria-label="Generation progress" /><small>{job.progress.detail || job.progress.stage}</small></>}
        {job.error && <p role="status" className="is-error">{job.error.detail || job.error.message || "This operation failed."}</p>}
      </div>)}</div></section>}
    <section className="personalized-card personalized-review"><h2>3. Review {athlete ? `— ${athlete.name}` : "a player"}</h2>
      {athlete && <Link to={`/admin/accounts/player/${athlete.id}`}>Open player details & testing</Link>}
      {!draft ? <p>Select a player and generate a draft to inspect their assessment, target coverage and workouts.</p> : <>
        <label>Saved draft<select value={draft.draftId} onChange={e => { setDraftId(e.target.value); setReviewed(false); }}>{drafts.map(d => <option key={d.draftId} value={d.draftId}>{new Date(millis(d.createdAt)).toLocaleString()} · {d.status} · {d.engineVersion}</option>)}</select></label>
        <div className="personalized-notice"><strong>{draft.status === "activated" ? "This draft was activated." : "Draft — not visible to the player"}</strong><p>{draft.replacementPolicy}</p></div>
        <h3>Why this plan?</h3><p>{draft.plan.assessment.summary}</p><p>{draft.plan.assessment.inputs?.evidencePolicy?.reason}</p>
        <ul className="personalized-findings">{draft.plan.assessment.findings.map((f: any, i: number) => <li key={i}><strong>{label(f.domain)} · {label(f.basis)} · {f.confidence} confidence</strong><p>{f.statement}</p>
          <small>Target: {f.targetBeforePct}% → {f.targetAfterEvidencePct}% after evidence → {f.targetFinalPct}% final.{f.limitation ? ` ${f.limitation}` : ""}</small></li>)}</ul>
        {!draft.plan.assessment.findings.length && <p>No supported measured gap was inferred. This plan follows the player’s age/position baseline and available curriculum.</p>}
        <details><summary>Evidence gaps & curriculum capacity</summary><ul>{draft.plan.assessment.dataGaps.map((g: string, i: number) => <li key={i}>{g}</li>)}</ul>
          <p>Peer comparison: {label(draft.plan.assessment.inputs?.peer?.status ?? "unavailable")} · {label(draft.plan.assessment.inputs?.peer?.reason ?? "matching protocol cohort")}</p>
          <div className="personalized-table-scroll"><table><thead><tr><th>Domain</th><th>Published</th><th>Eligible</th><th>Limitations</th></tr></thead><tbody>{draft.plan.assessment.curriculum?.map((r: any) => <tr key={r.domain}><th>{label(r.domain)}</th><td>{r.publishedDrills}</td><td>{r.eligibleDrills}</td><td>{Object.entries(r.excludedReasons).map(([k,v]) => `${label(k.replaceAll("_", " "))}: ${v}`).join(" · ") || "Available"}</td></tr>)}</tbody></table></div></details>
        <h3>Target versus actual minutes</h3><p className="personalized-meta">Targets account for legal whole doses. Transitions are counted separately. Every accepted nonzero domain must fall within 5 minutes or 10% of its target, whichever is greater.</p>
        {draft.plan.weeks.map((w: any) => <details key={w.weekNumber} open={w.weekNumber === 1}><summary>Week {w.weekNumber} · {w.check.estimatedMinutes} / {w.check.budgetMinutes} minutes · {w.transitionMinutes} transition minutes</summary>
          <div className="personalized-table-scroll"><table><thead><tr><th>Domain</th><th>Target</th><th>Draft actual</th><th>Current actual</th><th>Fit</th></tr></thead><tbody>{allocationRows(draft.plan,w.weekNumber).filter((r: any) => r.targetMinutes || r.actualMinutes).map((r: any) => <tr key={r.domain}><th>{label(r.domain)}</th><td>{r.targetMinutes}m</td><td>{r.actualMinutes}m</td><td>{current?.weeks?.find((cw: any) => cw.weekNumber === w.weekNumber)?.actualMinutesByDomain?.[r.domain] ?? "—"}</td><td>{r.met ? "Within tolerance" : "Review"}</td></tr>)}</tbody></table></div>
          {!!Object.keys(w.check.allocationProjection?.foldedMinutesByDomain ?? {}).length && <p className="personalized-notice">Legal dose limits changed these small targets: {Object.entries(w.check.allocationProjection.foldedMinutesByDomain).map(([d,m]) => `${label(d)} ${m}m`).join(", ")}. Their minutes were redistributed before selection.</p>}
        </details>)}
        <h3>Current and proposed workouts</h3><p>{!current ? "No active plan exists." : prescriptionSignature(current) === prescriptionSignature(draft.plan) ? "The executable workouts are identical. Similar needs can produce the same prescription; review the target coverage above." : "The proposed drills, doses or weekly schedule differ from the active plan."}</p>
        <div className="personalized-comparison"><WorkoutList title="Current plan" plan={current} /><WorkoutList title="Proposed draft" plan={draft.plan} /></div>
        {draft.status === "ready" && <div className="personalized-activation">{stale && <p className="personalized-notice">The active plan or date has changed. Generate a fresh draft before activation.</p>}
          <label className="personalized-checkbox"><input type="checkbox" checked={reviewed} disabled={!!stale} onChange={e => setReviewed(e.target.checked)} />I reviewed the evidence, workouts and replacement policy for {athlete?.name}.</label>
          <div className="personalized-row-actions"><button type="button" className="primary-cta" disabled={!reviewed || !!stale || busy || inFlight(focused) || !previewEnabled(config,"activate_personalized_plan")} onClick={() => void act("activate_personalized_plan")}>Use this plan for {athlete?.name}</button>
            <button type="button" className="quiet-button" disabled={busy || inFlight(focused) || !previewEnabled(config,"discard_personalized_plan")} onClick={() => void act("discard_personalized_plan")}>Discard draft</button></div>
        </div>}
      </>}
    </section>
  </div>;
}

function WorkoutList({ title, plan }: { title: string; plan: any }) {
  return <div className="personalized-workouts"><h4>{title}</h4>{!plan ? <p>No active plan.</p> : plan.weeks?.map((week: any) => <details key={week.weekNumber} open={week.weekNumber === 1}><summary>Week {week.weekNumber} · {week.theme}</summary>{week.workouts?.map((workout: any) => <article key={workout.workoutId}>
    <strong>{workout.order}. {workout.title}</strong><p>{workout.intent}</p><small>{workout.estimatedMinutes} minutes</small><ol>{workout.blocks?.map((block: any, i: number) => <li key={block.blockId || i}><strong>{block.drillName || block.name || block.drillId}</strong><span>{block.sets} × {block.reps} {block.repUnit}{block.perSide ? " per side" : ""} · {block.estimatedMinutes}m</span><small>Rest: {block.restSeconds}s {block.restScope || ""}{block.restBetweenSetsSeconds != null ? ` · ${block.restBetweenSetsSeconds}s between sets` : ""}</small></li>)}</ol>
  </article>)}</details>)}</div>;
}
