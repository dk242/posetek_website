/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { auth, db } from "../../../lib/firebase";
import { activePlan } from "../lib/accounts";
import type { OrganizationRow, PlayerRow, TeamRow } from "../lib/accounts";
import { loadAthleteEvidence } from "../lib/programBatch";
import { loadPlannerScope } from "../lib/plannerScope";
import type { PlannerRole } from "../lib/plannerScope";
import type { AthleteLoad } from "../lib/programBatch";
import { DEFAULT_INTAKE, HORIZON_WEEKS, SESSIONS_PER_WEEK, MINUTES_PER_SESSION, SETTINGS } from "../lib/planJobs";
import { EQUIPMENT_OPTIONS, runBatch } from "../lib/programBatchLogic";
import { submitLlmJob } from "../../athlete-portal/lib/loaders";
import { activationParams, activePlansMatch, allocationRows, PERSONALIZED_CAPABILITIES, PERSONALIZED_ENGINE,
  personalizedParams, prescriptionSignature, previewEnabled, recentEvidence, operationLabel,
  createPlannerAccessGuard, isPlannerAuthorizationError, normalizeAssessment, plannerPlayerDetailsLink } from "../lib/personalizedLogic";
import "../personalized.scss";
import AthleteEvidenceBadges from "./AthleteEvidenceBadges";
import { estimatePlanningContext, provisionalDribbling } from '../../../lib/provisional-estimates';
import ProvisionalEstimateNote from '../../../components/athlete-stats/ProvisionalEstimateNote';

const label = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, c => c.toUpperCase());
const millis = (value: any) => value?.toMillis?.() ?? (typeof value === "string" ? Date.parse(value) : 0);
const terminal = (status: string) => status === "complete" || status === "failed";

type PlannerProps = {
  role?: PlannerRole; playerId?: string; initialText?: string; onActivated?: () => void;
};

export default function PersonalizedPrograms(props: PlannerProps) {
  const { search } = useLocation();
  const [uid, setUid] = useState(auth.currentUser?.uid ?? "");
  useEffect(() => auth.onAuthStateChanged(user => setUid(user?.uid ?? "")), []);
  if (!uid) return <p role="status">Sign in to open the personalized planner.</p>;
  return <Planner key={JSON.stringify([props.role ?? "admin", props.playerId ?? "", uid, search])} {...props} uid={uid} />;
}

function Planner({ role = "admin", playerId = "", initialText = "", onActivated, uid }: PlannerProps & { uid: string }) {
  const [query] = useSearchParams();
  const initial = useRef({ orgId: role === "athlete" ? "" : query.get("orgId") ?? "", ids: playerId ? [playerId] : (query.get("players") ?? "").split(",").filter(Boolean) });
  const [orgs, setOrgs] = useState<OrganizationRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [orgId, setOrgId] = useState(initial.current.orgId);
  const [teamId, setTeamId] = useState(role === "athlete" ? "" : query.get("teamId") ?? "");
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [selected, setSelected] = useState(new Set(initial.current.ids));
  const [focused, setFocused] = useState(initial.current.ids[0] ?? "");
  const [search, setSearch] = useState("");
  const [evidence, setEvidence] = useState<Record<string, AthleteLoad>>({});
  const [evidenceErrors, setEvidenceErrors] = useState<Record<string, string>>({});
  const [intake, setIntake] = useState({ ...DEFAULT_INTAKE, equipment: [...DEFAULT_INTAKE.equipment] });
  const [goals, setGoals] = useState<string[]>([]);
  const [freeTextGoals, setFreeTextGoals] = useState(initialText);
  const [config, setConfig] = useState<any>(null);
  const [jobs, setJobs] = useState<any[]>([]);
  const [drafts, setDrafts] = useState<any[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [draftId, setDraftId] = useState("");
  const [reviewPlayerId, setReviewPlayerId] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [limited, setLimited] = useState(false);
  const [retry, setRetry] = useState(0);
  const [accessReady, setAccessReady] = useState(false);
  const mounted = useRef(true);
  const submitting = useRef(false);
  const access = useRef(createPlannerAccessGuard()).current;
  const isCurrent = useCallback((token: number) => mounted.current && auth.currentUser?.uid === uid && access.isCurrent(token), [access, uid]);
  const canOperate = useCallback((token = access.capture()) => isCurrent(token) && access.permits(token), [access, isCurrent]);
  const clearScope = useCallback(() => {
    setPlayers([]); setSelected(new Set()); setFocused(""); setEvidence({}); setEvidenceErrors({});
    setJobs([]); setDrafts([]); setPlans([]); setDraftId(""); setReviewPlayerId(""); setReviewed(false);
  }, []);
  const failClosed = useCallback((error: any) => {
    access.block(); setAccessReady(false); clearScope(); setOrgs([]); setTeams([]); setLoading(false); setBusy(false);
    setMessage(isPlannerAuthorizationError(error)
      ? "Your access changed. Refresh the connection to check your current player permissions."
      : `The planner connection could not be verified. Refresh before continuing. ${error?.message ?? ""}`);
  }, [access, clearScope]);

  useEffect(() => {
    mounted.current = true;
    document.title = "Personalized planner | PoseTek";
    let live = true;
    const stopConfig = db.collection("config").doc("llm").onSnapshot(s => { if (live) setConfig(s.data() ?? {}); }, e => { if (live) { setConfig(null); failClosed(e); } });
    return () => { live = false; mounted.current = false; stopConfig(); };
  }, [failClosed, retry]);

  useEffect(() => {
    let live = true;
    const token = access.begin();
    setAccessReady(false); setLoading(true); setMessage(""); clearScope();
    loadPlannerScope(role, orgId, playerId || initial.current.ids[0] || "").then(scope => {
      if (!live || !isCurrent(token)) return;
      access.authorize(token); setAccessReady(true);
      const rows = scope.players;
      setOrgs(scope.organizations); setTeams(scope.teams); setLimited(scope.limited);
      // Do not trigger a second load while resolving the default organization.
      if (!orgId && scope.organizationId) initial.current.orgId = scope.organizationId;
      setPlayers(rows); setLoading(false);
      setSelected(new Set(initial.current.ids.filter(id => rows.some(p => p.id === id))));
      setFocused(initial.current.ids.find(id => rows.some(p => p.id === id)) ?? rows[0]?.id ?? "");
    }).catch(e => { if (live && isCurrent(token)) failClosed(e); });
    return () => { live = false; };
  }, [orgId, role, playerId, retry, access, clearScope, failClosed, isCurrent]);

  useEffect(() => {
    setJobs([]);
    const token = access.capture();
    if (!canOperate(token)) return;
    let live = true;
    const stops = players.map(player => db.collection("llmJobs").where("requestedByUid", "==", uid).where("playerId", "==", player.id)
      .onSnapshot(s => {
        if (!live || !canOperate(token)) return;
        const rows = s.docs.map(d => ({ id: d.id, ...d.data() })).filter((j: any) => PERSONALIZED_CAPABILITIES.includes(j.capability) || j.capability === "generate_training_plan");
        setJobs(old => [...old.filter(j => j.playerId !== player.id), ...rows].sort((a: any, b: any) => millis(b.createdAt) - millis(a.createdAt)));
      }, e => { if (live && isCurrent(token)) failClosed(e); }));
    return () => { live = false; stops.forEach(stop => stop()); };
  }, [players, retry, uid, access, canOperate, failClosed, isCurrent]);

  useEffect(() => {
    let live = true;
    const token = access.capture();
    setEvidence({}); setEvidenceErrors({});
    void runBatch(players, 4, async player => {
      if (!live || !canOperate(token)) return;
      try { const data = await loadAthleteEvidence(player); if (live && canOperate(token)) setEvidence(old => ({ ...old, [player.id]: data })); }
      catch (e: any) { if (live && canOperate(token)) {
        if (isPlannerAuthorizationError(e)) failClosed(e);
        else setEvidenceErrors(old => ({ ...old, [player.id]: e.message }));
      } }
    });
    return () => { live = false; };
  }, [players, access, canOperate, failClosed]);

  useEffect(() => {
    setDrafts([]); setPlans([]); setDraftId(""); setReviewed(false); setReviewPlayerId(focused);
    let live = true;
    const token = access.capture();
    if (!focused || !canOperate(token)) return;
    const ref = db.collection("players").doc(focused);
    // Existing admin-only historical drafts remain reviewable; other roles only read the safe projection.
    const draftQuery = role === "admin" ? ref.collection("personalizedPlanDrafts") : ref.collection("personalizedPlanDraftViews").where("createdByUid", "==", uid);
    const onError = (e: any) => { if (live && isCurrent(token)) failClosed(e); };
    const a = draftQuery.onSnapshot(s => { if (live && canOperate(token)) setDrafts(s.docs.map(d => ({ ...d.data(), draftId: d.id }))
      .sort((x: any, y: any) => millis(y.createdAt) - millis(x.createdAt))); }, onError);
    const b = ref.collection("trainingPlans").onSnapshot(s => { if (live && canOperate(token)) setPlans(s.docs.map(d => ({ id: d.id, ...d.data() }))); }, onError);
    return () => { live = false; a(); b(); };
  }, [focused, role, retry, uid, access, canOperate, failClosed, isCurrent]);

  const visible = useMemo(() => players.filter(p => (!teamId || p.teamId === teamId) && `${p.name} ${p.email ?? ""}`.toLowerCase().includes(search.toLowerCase())), [players, teamId, search]);
  useEffect(() => {
    if (visible.length && !visible.some(player => player.id === focused)) setFocused(visible[0].id);
    else if (!visible.length) setFocused("");
  }, [visible, focused]);
  const teamNames = useMemo(() => new Map(teams.map(team => [team.id, team.name])), [teams]);
  const focusedDrafts = reviewPlayerId === focused ? drafts : [];
  const focusedPlans = reviewPlayerId === focused ? plans : [];
  const draft = focusedDrafts.find(d => d.draftId === draftId) ?? focusedDrafts.find(d => d.status === "ready") ?? focusedDrafts[0];
  const current = activePlan(focusedPlans);
  useEffect(() => { setReviewed(false); }, [draft?.comparisonToken, draft?.status, current?.id, current?.planRevision]);
  const athlete = players.find(p => p.id === focused);
  const [useEstimates, setUseEstimates] = useState(true);
  const reviewedEstimate = (load?: AthleteLoad) => provisionalDribbling(load?.provisionalEstimates, load?.allResultReps || load?.reps || []);
  const focusedEstimate = reviewedEstimate(evidence[focused]);
  const estimateContextLength = useEstimates ? Math.max(0, ...[...selected, focused].map(id => {
    const context = estimatePlanningContext(reviewedEstimate(evidence[id])); return context ? context.length + 2 : 0;
  })) : 0;
  const contextLimit = Math.max(0, 500 - estimateContextLength);
  const assessmentJob = jobs.find(j => j.playerId === focused && j.capability === "assess_personalized_plan");
  const assessment = assessmentJob?.status === "complete" ? normalizeAssessment(assessmentJob.result) : null;
  const ongoing = jobs.filter(j => !terminal(j.status));
  const inFlight = (playerId: string) => ongoing.some(j => j.playerId === playerId);
  const canGenerate = accessReady && previewEnabled(config) && !limited && !busy && !loading && !intake.painFlag && selected.size > 0
    && freeTextGoals.trim().length <= contextLimit && [...selected].every(id => evidence[id] && !inFlight(id));
  const today = draft?.plan?.timezone ? new Intl.DateTimeFormat("en-CA", { timeZone: draft.plan.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()) : "";
  const stale = draft && (draft.plan.startDate !== today || !activePlansMatch(draft.expectedActivePlans, focusedPlans));

  function toggle(id: string) { setSelected(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  async function generate() {
    const token = access.capture();
    if (!canGenerate || !canOperate(token) || submitting.current) return;
    submitting.current = true;
    setBusy(true); setMessage("");
    const failures: string[] = [];
    await runBatch(players.filter(p => selected.has(p.id)), 3, async player => {
      if (!canOperate(token)) return;
      try {
        const load = await loadAthleteEvidence(player);
        if (!canOperate(token)) return;
        setEvidence(old => ({ ...old, [player.id]: load }));
        await submitLlmJob(player.id, "generate_personalized_plan", personalizedParams(load.reps, player.raw, load.evidence.age, intake, goals, freeTextGoals, useEstimates ? load.provisionalEstimates : [], load.allResultReps));
      }
      catch (e: any) { if (canOperate(token)) {
        if (isPlannerAuthorizationError(e)) failClosed(e);
        else failures.push(`${player.name}: ${e.message}`);
      } }
    });
    submitting.current = false;
    if (canOperate(token)) { setBusy(false); setMessage(failures.length ? failures.join(" · ") : "Draft jobs submitted. They keep running when you leave this page; progress is restored when you return."); }
  }
  async function act(action: "activate_personalized_plan" | "discard_personalized_plan") {
    const token = access.capture();
    if (!canOperate(token) || !previewEnabled(config, action) || !athlete || !draft || (draft.playerId && draft.playerId !== focused)
      || submitting.current || busy || inFlight(focused) || (action === "activate_personalized_plan" && (!reviewed || stale))) return;
    submitting.current = true;
    setBusy(true); setMessage("");
    try { await submitLlmJob(focused, action, action === "activate_personalized_plan" ? activationParams(draft) : { engineVersion: PERSONALIZED_ENGINE, draftId: draft.draftId });
      if (canOperate(token)) { setReviewed(false); setMessage(action === "activate_personalized_plan" ? "Activation submitted. The server will recheck this draft against current player activity." : "Discard submitted."); }
    } catch (e: any) { if (canOperate(token)) { if (isPlannerAuthorizationError(e)) failClosed(e); else setMessage(e.message); } }
    finally { submitting.current = false; if (canOperate(token)) setBusy(false); }
  }
  async function assess() {
    const token = access.capture();
    if (!canOperate(token) || !previewEnabled(config, "assess_personalized_plan") || intake.painFlag || !athlete || !evidence[focused] || submitting.current || busy || inFlight(focused)) return;
    submitting.current = true;
    setBusy(true); setMessage("");
    try {
      const load = await loadAthleteEvidence(athlete);
      if (canOperate(token)) {
        setEvidence(old => ({ ...old, [athlete.id]: load }));
        await submitLlmJob(focused,"assess_personalized_plan",personalizedParams(load.reps,athlete.raw,load.evidence.age,intake,goals,freeTextGoals,useEstimates ? load.provisionalEstimates : [],load.allResultReps));
      }
    }
    catch(e:any) { if(canOperate(token)) { if (isPlannerAuthorizationError(e)) failClosed(e); else setMessage(e.message); } }
    finally { submitting.current = false; if(canOperate(token)) setBusy(false); }
  }

  return <div className="personalized-planner">
    <header className="personalized-heading"><span className="eyebrow">Personalized training</span><h1>{role === "athlete" ? "Your next training plan" : "Plans shaped by each player"}</h1>
      <p>Review recent testing, build a draft, then compare its actual training minutes with the active plan. Players see a change only after you choose <strong>Use this plan</strong>.</p></header>
    {!previewEnabled(config) && <p className="personalized-notice" role="status">Personalized submissions are currently unavailable. Saved drafts remain available to review. Try again when generation is enabled.</p>}
    {message && <div className="personalized-notice" role="status">{message}<button className="quiet-button" disabled={busy} onClick={() => setRetry(r => r + 1)}>Refresh connection</button></div>}
    {limited && <p className="personalized-notice">This roster reached the service display limit. Choose a smaller organization before selecting a batch.</p>}
    <div className="personalized-setup">
      <section className="personalized-card"><h2>1. Players & evidence</h2>
        {role !== "athlete" && <><div className="personalized-fields"><label>Organization<select value={orgId || initial.current.orgId} onChange={e => { setTeamId(""); setOrgId(e.target.value); }} disabled={busy}>
          {!orgId && !initial.current.orgId && <option value="">Independent player</option>}{orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          <label>Team<select value={teamId} onChange={e => { setTeamId(e.target.value); setSelected(new Set()); }}><option value="">All teams</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label></div>
        <label>Find a player<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or email" /></label>
        <div className="personalized-row-actions"><button type="button" className="quiet-button" onClick={() => setSelected(new Set(visible.filter(p => evidence[p.id] && !inFlight(p.id)).map(p => p.id)))}>Select visible</button>
          <button type="button" className="quiet-button" onClick={() => setSelected(new Set())}>Clear</button><span>{selected.size} selected{[...selected].some(id => !visible.some(p => p.id === id)) ? ` · ${[...selected].filter(id => !visible.some(p => p.id === id)).length} outside this filter` : ""}</span></div></>}
        {loading ? <p>Loading roster…</p> : visible.length === 0 ? <p>No players match this selection.</p> : <div className="personalized-roster">{visible.map(p => {
          const load = evidence[p.id], recent = load ? recentEvidence(load.reps) : null;
          const latest = jobs.find(j => j.playerId === p.id);
          return <div key={p.id} className={`personalized-player ${focused === p.id ? "is-focused" : ""}`}>
            {role !== "athlete" && <input type="checkbox" aria-label={`Select ${p.name}`} checked={selected.has(p.id)} disabled={!load || busy || inFlight(p.id)} onChange={() => toggle(p.id)} />}
            <div className="personalized-player-copy">
              <button type="button" className="personalized-player-name" disabled={busy} onClick={() => { setFocused(p.id); setReviewed(false); }}><strong>{p.name}</strong><span>{p.email || "Email unavailable"}</span></button>
              <div className="admin-row-meta personalized-player-badges">
                <span className="admin-chip">{teamNames.get(p.teamId ?? "") ?? "No team"}</span>
                <AthleteEvidenceBadges evidence={load?.evidence} loading={!load && !evidenceErrors[p.id]} error={evidenceErrors[p.id]} />
                {reviewedEstimate(load) && <span className="admin-chip">Dribbling estimate available</span>}
              </div>
              {(evidenceErrors[p.id] || recent) && <p className={`personalized-evidence-summary${evidenceErrors[p.id] ? " is-error" : ""}`}>
                {evidenceErrors[p.id] || `${recent!.reps.length} recent test reps${recent!.excluded ? ` · ${recent!.excluded} undated/older reps excluded` : ""}`}
              </p>}
            </div>
            {latest && <span className={`personalized-status ${latest.status === "failed" ? "is-error" : ""}`}>{operationLabel(latest.capability)}: {latest.status}</span>}
          </div>;
        })}</div>}
        <p className="personalized-meta">Plans consider the schedule, position, recent results, available drills and coach feedback. Missing evidence uses a clearly labelled baseline.</p>
        {focusedEstimate && useEstimates && <ProvisionalEstimateNote estimate={focusedEstimate} planning />}
        {athlete && <div className="personalized-preflight"><h3>Proposed priorities · {athlete.name}</h3>
          <button type="button" className="quiet-button" disabled={!accessReady || !evidence[focused] || busy || inFlight(focused) || intake.painFlag || !previewEnabled(config,"assess_personalized_plan")} onClick={() => void assess()}>Preview priorities</button>
          {assessment && <><p className="personalized-meta">{millis(assessment.assessedAt) > 0 ? `Assessment from ${new Date(millis(assessment.assessedAt)).toLocaleString()}` : "Historical assessment date unavailable"} · {assessment.schedule ? `${assessment.schedule.sessionsPerWeek} × ${assessment.schedule.minutesPerSession} minutes/week · ${label(assessment.schedule.setting)}` : "Historical training schedule unavailable"}. Generation recalculates these priorities from current inputs.</p>
            <p>{assessment.evidenceReason}</p><ul>{assessment.findings.map((f:any,i:number)=><li key={i}><strong>{label(f.domain)} · {f.confidence} confidence</strong><p>{f.statement}</p><small>{f.targetBeforePct}% baseline → {f.targetFinalPct}% final target. {f.limitation}</small></li>)}</ul>
            {!assessment.findings.length && <p>No supported measured gap. The age/position baseline and available curriculum determine the training mix.</p>}
            <p className="personalized-meta">Target mix: {Object.entries(assessment.focusSplit).filter(([,n])=>Number(n)>0).map(([d,n])=>`${label(d)} ${n}%`).join(" · ")}</p></>}
        </div>}
      </section>
      <section className="personalized-card"><h2>2. Goals & training schedule</h2>
        <fieldset><legend>Choose up to two goals</legend><div className="personalized-equipment">{["speedAgility", "dribbling", "passing", "firstTouch", "shooting", "strengthPower"].map(goal => <label key={goal}><input type="checkbox" checked={goals.includes(goal)} disabled={!goals.includes(goal) && goals.length >= 2} onChange={() => setGoals(old => old.includes(goal) ? old.filter(g => g !== goal) : [...old, goal])} />{label(goal)}</label>)}</div></fieldset>
        {(focusedEstimate || [...selected].some(id => reviewedEstimate(evidence[id]))) && <>
          <label className="personalized-checkbox"><input type="checkbox" checked={useEstimates} onChange={e => setUseEstimates(e.target.checked)} />Use reviewed estimates as low-confidence coaching context</label>
          <p className="personalized-meta">Dribbling becomes a goal when a goal slot is available. Estimates stay separate from measured test results and peer comparisons.</p>
        </>}
        <label>What would you like to improve?<textarea maxLength={contextLimit} value={freeTextGoals} onChange={e => setFreeTextGoals(e.target.value)} placeholder="Optional goals or training context" /></label>
        {freeTextGoals.trim().length > contextLimit && <p className="personalized-notice">Shorten your context to {contextLimit} characters to leave room for the estimated result.</p>}
        <div className="personalized-fields">
        <label>Duration<select value={intake.horizonWeeks} onChange={e => setIntake({ ...intake, horizonWeeks: +e.target.value })}>{HORIZON_WEEKS.map(n => <option key={n} value={n}>{n} weeks</option>)}</select></label>
        <label>Sessions per week<select value={intake.sessionsPerWeek} onChange={e => setIntake({ ...intake, sessionsPerWeek: +e.target.value })}>{SESSIONS_PER_WEEK.map(n => <option key={n}>{n}</option>)}</select></label>
        <label>Minutes per session<select value={intake.minutesPerSession} onChange={e => setIntake({ ...intake, minutesPerSession: +e.target.value })}>{MINUTES_PER_SESSION.map(n => <option key={n}>{n}</option>)}</select></label>
        <label>Training setting<select value={intake.setting} onChange={e => setIntake({ ...intake, setting: e.target.value as typeof intake.setting })}>{SETTINGS.map(s => <option key={s} value={s}>{s === "halfAndHalf" ? "Half and half" : label(s)}</option>)}</select></label>
      </div><fieldset><legend>Available equipment</legend><div className="personalized-equipment">{EQUIPMENT_OPTIONS.map(e => <label key={e.id}><input type="checkbox" checked={intake.equipment.includes(e.id)} onChange={() => setIntake({ ...intake, equipment: intake.equipment.includes(e.id) ? intake.equipment.filter(v => v !== e.id) : [...intake.equipment, e.id] })} />{e.label}</label>)}</div></fieldset>
        <label className="personalized-checkbox"><input type="checkbox" checked={intake.painFlag} onChange={e => setIntake({ ...intake, painFlag: e.target.checked })} />A selected player has pain requiring review</label>
        {intake.painFlag && <p className="personalized-notice">Automated generation is paused. Review this player individually before prescribing.</p>}
        <p className="personalized-meta">Drills respect the player’s difficulty level. Dated results from the past 180 days inform the plan.</p>
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
      {athlete && <Link to={plannerPlayerDetailsLink(role, athlete, query.toString())}>Open player details & testing</Link>}
      {!draft ? <p>Select a player and generate a draft to inspect their assessment, target coverage and workouts.</p> : <>
        <label>Saved draft<select value={draft.draftId} disabled={busy} onChange={e => { setDraftId(e.target.value); setReviewed(false); }}>{focusedDrafts.map(d => <option key={d.draftId} value={d.draftId}>{new Date(millis(d.createdAt)).toLocaleString()} · {d.status}</option>)}</select></label>
        <div className="personalized-notice"><strong>{draft.status === "activated" ? "This draft was activated." : draft.status === "discarded" ? "This draft was discarded." : "Draft — awaiting your review"}</strong><p>{draft.replacementPolicy}</p>{draft.status === "activated" && onActivated && <button className="primary-cta" onClick={onActivated}>Open training</button>}</div>
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
          <label className="personalized-checkbox"><input type="checkbox" checked={reviewed} disabled={!accessReady || !!stale || busy} onChange={e => setReviewed(e.target.checked)} />I reviewed the evidence, workouts and replacement policy for {athlete?.name}.</label>
          <div className="personalized-row-actions"><button type="button" className="primary-cta" disabled={!accessReady || !reviewed || !!stale || busy || inFlight(focused) || !previewEnabled(config,"activate_personalized_plan")} onClick={() => void act("activate_personalized_plan")}>Use this plan for {athlete?.name}</button>
            <button type="button" className="quiet-button" disabled={!accessReady || busy || inFlight(focused) || !previewEnabled(config,"discard_personalized_plan")} onClick={() => void act("discard_personalized_plan")}>Discard draft</button></div>
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
