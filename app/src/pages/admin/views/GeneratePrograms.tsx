// Generate programs — one batch of v3 training programs for a club roster.
// Pick the organization, tick the athletes, set the horizon and session shape,
// and the console submits one `generate_training_plan` job per athlete through
// the exact path the single-athlete page uses (planJobs.ts). Jobs are watched
// live; an athlete's failure never stops the rest of the batch.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { plannerLink } from "../lib/personalizedLogic";
import "../personalized.scss";
import { loadOrganizations, loadTeams } from "../lib/accounts";
import type { OrganizationRow, PlayerRow, TeamRow } from "../lib/accounts";
import { DEFAULT_INTAKE, HORIZON_WEEKS, MINUTES_PER_SESSION, SESSIONS_PER_WEEK, SETTINGS } from "../lib/planJobs";
import type { PlanIntakeForm, PlanJobState } from "../lib/planJobs";
import { generateForAthlete, loadAthleteEvidence, loadOrganizationPlayers } from "../lib/programBatch";
import type { AthleteLoad } from "../lib/programBatch";
import {
  BATCH_CONCURRENCY,
  DRILL_SHORT_LABELS,
  EQUIPMENT_OPTIONS,
  LEVEL_OPTIONS,
  MEASURED_DRILL_KEYS,
  describeBatch,
  isFullyTested,
  runBatch,
  selectable,
  sortRoster,
} from "../lib/programBatchLogic";
import type { LevelChoice } from "../lib/programBatchLogic";

const NO_TEAMS: TeamRow[] = [];
const NO_PLAYERS: PlayerRow[] = [];

type Roster =
  | { kind: "loading" }
  | { kind: "ready"; players: PlayerRow[] }
  | { kind: "error"; message: string };

type Evidence =
  | { kind: "loading" }
  | { kind: "ready"; load: AthleteLoad }
  | { kind: "error"; message: string };

const SETTING_LABELS: Record<PlanIntakeForm["setting"], string> = {
  solo: "Solo",
  partner: "With a partner",
  halfAndHalf: "Half and half",
};

const LEVEL_LABELS: Record<LevelChoice, string> = {
  auto: "Auto (from stats)",
  foundation: "Foundation",
  club: "Club",
  performance: "Performance",
};

const TERMINAL = new Set<PlanJobState["status"]>(["complete", "failed"]);

/** The club with `teams` documents is the batch's natural home; Vacaville first when present. */
function defaultOrganization(orgs: OrganizationRow[]): string {
  const club = orgs.find(org => org.schemaVersion === 2 && /vacaville/i.test(`${org.id} ${org.name}`))
    ?? orgs.find(org => org.schemaVersion === 2)
    ?? orgs[0];
  return club?.id ?? "";
}

export default function GeneratePrograms() {
  const [query] = useSearchParams();
  const initialSelection = useRef({ orgId: query.get("orgId") ?? "", ids: (query.get("players") ?? "").split(",").filter(Boolean) });
  const [orgs, setOrgs] = useState<OrganizationRow[] | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>(NO_TEAMS);
  const [orgId, setOrgId] = useState(initialSelection.current.orgId);
  const [roster, setRoster] = useState<Roster>({ kind: "loading" });
  const [evidence, setEvidence] = useState<Record<string, Evidence>>({});
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState("");
  const [intake, setIntake] = useState<PlanIntakeForm>(DEFAULT_INTAKE);
  const [level, setLevel] = useState<LevelChoice>("auto");
  const [jobs, setJobs] = useState<Record<string, PlanJobState>>({});
  const [running, setRunning] = useState(false);
  const evidenceRef = useRef<Record<string, Evidence>>({});
  const stops = useRef(new Map<string, () => void>());

  function setOneEvidence(id: string, value: Evidence) {
    evidenceRef.current = { ...evidenceRef.current, [id]: value };
    setEvidence(evidenceRef.current);
  }

  useEffect(() => {
    document.title = "Generate programs | PoseTek admin";
    let live = true;
    Promise.all([loadOrganizations(), loadTeams().catch(() => NO_TEAMS)])
      .then(([loadedOrgs, loadedTeams]) => {
        if (!live) return;
        setOrgs(loadedOrgs);
        setTeams(loadedTeams);
        setOrgId(current => current || defaultOrganization(loadedOrgs));
      })
      .catch(error => {
        if (live) setRoster({ kind: "error", message: error?.message || "Organizations could not be loaded." });
      });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (!orgId) return;
    let live = true;
    setRoster({ kind: "loading" });
    evidenceRef.current = {};
    setEvidence({});
    setSelected(new Set(initialSelection.current.orgId === orgId ? initialSelection.current.ids : []));
    setJobs({});
    loadOrganizationPlayers(orgId)
      .then(async players => {
        if (!live) return;
        setRoster({ kind: "ready", players });
        const pending: Record<string, Evidence> = {};
        players.forEach(player => { pending[player.id] = { kind: "loading" }; });
        evidenceRef.current = pending;
        setEvidence(pending);
        // Evidence fills in progressively; the roster is on screen already.
        await runBatch(players, 4, async player => {
          try {
            const load = await loadAthleteEvidence(player);
            if (live) setOneEvidence(player.id, { kind: "ready", load });
          } catch (error: any) {
            if (live) setOneEvidence(player.id, { kind: "error", message: error?.message || "Evidence could not be loaded." });
          }
        });
      })
      .catch(error => {
        if (live) setRoster({ kind: "error", message: error?.message || "The roster could not be loaded." });
      });
    return () => { live = false; };
  }, [orgId]);

  useEffect(() => () => {
    stops.current.forEach(stop => stop());
    stops.current.clear();
  }, []);

  const teamNames = useMemo(() => new Map(teams.map(team => [team.id, team.name])), [teams]);
  const players = useMemo(
    () => sortRoster(roster.kind === "ready" ? roster.players : NO_PLAYERS, teamNames),
    [roster, teamNames],
  );
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? players.filter(player => player.name.toLowerCase().includes(term)) : players;
  }, [players, search]);

  const readyIds = useMemo(
    () => players.filter(player => selectable(loadOf(evidence[player.id])?.evidence).ok).map(player => player.id),
    [players, evidence],
  );
  const fullyTestedIds = useMemo(
    () => readyIds.filter(id => isFullyTested(loadOf(evidence[id])?.reps ?? [])),
    [readyIds, evidence],
  );
  const loadingCount = players.filter(player => evidence[player.id]?.kind === "loading").length;

  const jobList = Object.values(jobs);
  const finished = jobList.filter(job => TERMINAL.has(job.status)).length;
  const failed = jobList.filter(job => job.status === "failed").length;
  const progress = jobList.length ? Math.round((finished / jobList.length) * 100) : 0;

  function toggle(id: string) {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setJob(id: string, state: PlanJobState) {
    setJobs(previous => ({ ...previous, [id]: state }));
  }

  function generateOne(id: string): Promise<void> {
    const player = players.find(entry => entry.id === id);
    const load = loadOf(evidenceRef.current[id]);
    if (!player || !load) {
      setJob(id, { jobId: null, status: "failed", message: "This athlete's evidence is not loaded." });
      return Promise.resolve();
    }
    stops.current.get(id)?.();
    return new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      generateForAthlete(player, load, intake, level, state => {
        setJob(id, state);
        if (state.status === "complete") {
          // The plan chip flips to the new plan once the doc is readable.
          loadAthleteEvidence(player).then(fresh => setOneEvidence(id, { kind: "ready", load: fresh })).catch(() => undefined);
        }
        if (TERMINAL.has(state.status)) finish();
      })
        .then(stop => { stops.current.set(id, stop); })
        .catch((error: any) => {
          setJob(id, { jobId: null, status: "failed", message: error?.message || "The job could not be submitted." });
          finish();
        });
    });
  }

  async function generate() {
    const ids = players.filter(player => selected.has(player.id)).map(player => player.id);
    if (!ids.length || running) return;
    const superseding = ids.filter(id => (loadOf(evidence[id])?.evidence.activePlanVersion ?? null) !== null).length;
    const lines = [
      `Generate ${ids.length} program${ids.length === 1 ? "" : "s"}?`,
      describeBatch(ids.length, intake),
    ];
    if (superseding) lines.push(`${superseding} athlete${superseding === 1 ? " has" : "s have"} an active plan that will be superseded.`);
    if (!window.confirm(lines.join("\n\n"))) return;
    setRunning(true);
    setJobs(previous => {
      const next = { ...previous };
      ids.forEach(id => { delete next[id]; });
      return next;
    });
    await runBatch(ids, BATCH_CONCURRENCY, generateOne);
    setRunning(false);
  }

  async function retry(id: string) {
    if (running) return;
    setRunning(true);
    await generateOne(id);
    setRunning(false);
  }

  function toggleEquipment(id: string) {
    setIntake(current => ({
      ...current,
      equipment: current.equipment.includes(id) ? current.equipment.filter(entry => entry !== id) : [...current.equipment, id],
    }));
  }

  const orgTeams = teams.filter(team => team.organizationId === orgId).length;

  return (
    <>
      <nav className="planner-switch" aria-label="Workout planner version"><span aria-current="page">Current planner</span><Link to={plannerLink(true, orgId, selected, initialSelection.current.orgId === orgId ? query.get("teamId") ?? "" : "")}>Personalized planner · Preview</Link></nav>
      <section className="admin-heading">
        <div>
          <p className="eyebrow">Generate programs</p>
          <h1>Training programs for a roster</h1>
          <p>
            Tick the athletes, set the shape, and the training engine builds each program the way the
            athlete page does: one job per athlete, using their recorded results, position and age.
          </p>
        </div>
        <div className="admin-heading-actions">
          <label className="admin-field">
            <span>Organization</span>
            <select value={orgId} disabled={!orgs || running} onChange={event => setOrgId(event.target.value)}>
              {!orgs && <option value="">Loading…</option>}
              {orgs?.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
            </select>
          </label>
        </div>
      </section>

      <section className="admin-card">
        <h3>Program shape</h3>
        <div className="admin-form">
          <div className="admin-field-row">
            <label className="admin-field">
              <span>Weeks</span>
              <select value={intake.horizonWeeks} disabled={running} onChange={event => setIntake({ ...intake, horizonWeeks: Number(event.target.value) })}>
                {HORIZON_WEEKS.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="admin-field">
              <span>Sessions per week</span>
              <select value={intake.sessionsPerWeek} disabled={running} onChange={event => setIntake({ ...intake, sessionsPerWeek: Number(event.target.value) })}>
                {SESSIONS_PER_WEEK.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="admin-field">
              <span>Minutes per session</span>
              <select value={intake.minutesPerSession} disabled={running} onChange={event => setIntake({ ...intake, minutesPerSession: Number(event.target.value) })}>
                {MINUTES_PER_SESSION.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label className="admin-field">
              <span>Training setting</span>
              <select value={intake.setting} disabled={running} onChange={event => setIntake({ ...intake, setting: event.target.value as PlanIntakeForm["setting"] })}>
                {SETTINGS.map(value => <option key={value} value={value}>{SETTING_LABELS[value]}</option>)}
              </select>
            </label>
            <label className="admin-field">
              <span>Level</span>
              <select value={level} disabled={running} onChange={event => setLevel(event.target.value as LevelChoice)}>
                {LEVEL_OPTIONS.map(value => <option key={value} value={value}>{LEVEL_LABELS[value]}</option>)}
              </select>
            </label>
          </div>
          <div className="admin-field">
            <span>Equipment the athletes have</span>
            <div className="admin-checks">
              {EQUIPMENT_OPTIONS.map(option => (
                <label key={option.id}>
                  <input type="checkbox" checked={intake.equipment.includes(option.id)} disabled={running} onChange={() => toggleEquipment(option.id)} />
                  {option.label}
                </label>
              ))}
            </div>
          </div>
          <p className="admin-note">
            {describeBatch(selected.size, intake)}{" "}
            {level === "auto" ? "Level is derived from each athlete's stats." : `Level is set to ${LEVEL_LABELS[level].toLowerCase()} for everyone.`}{" "}
            Each program takes seconds to a couple of minutes; an active plan is superseded, never edited.
          </p>
        </div>
      </section>

      <section className="admin-card">
        <div className="admin-heading" style={{ marginBottom: 8 }}>
          <div>
            <h3>Athletes</h3>
            <p>
              {roster.kind === "ready"
                ? `${players.length} athlete${players.length === 1 ? "" : "s"}${orgTeams ? ` across ${orgTeams} team${orgTeams === 1 ? "" : "s"}` : ""} · ${fullyTestedIds.length} fully tested${loadingCount ? ` · checking ${loadingCount} more…` : ""}`
                : "Loading the roster…"}
            </p>
          </div>
          <div className="admin-heading-actions">
            <button className="quiet-button small" type="button" disabled={running || !fullyTestedIds.length} onClick={() => setSelected(new Set(fullyTestedIds))}>
              <span className="material-symbols-outlined">task_alt</span>Fully tested ({fullyTestedIds.length})
            </button>
            <button className="quiet-button small" type="button" disabled={running || !readyIds.length} onClick={() => setSelected(new Set(readyIds))}>
              Everyone eligible ({readyIds.length})
            </button>
            <button className="quiet-button small" type="button" disabled={running || !selected.size} onClick={() => setSelected(new Set())}>
              Clear
            </button>
          </div>
        </div>

        <div className="admin-toolbar">
          <label className="search-field">
            <span className="material-symbols-outlined">search</span>
            <input
              type="search"
              placeholder="Filter athletes by name"
              autoComplete="off"
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </label>
        </div>

        {roster.kind === "loading" && <div className="portal-loading"><span className="spinner" /><p>Loading athletes…</p></div>}
        {roster.kind === "error" && <p className="form-message" role="alert">{roster.message}</p>}
        {roster.kind === "ready" && !players.length && (
          <p className="admin-empty">No athlete carries this organization's id. Legacy rosters are reached from Monitor accounts, one athlete at a time.</p>
        )}
        {roster.kind === "ready" && players.length > 0 && !visible.length && (
          <p className="admin-empty">No athlete matches that filter.</p>
        )}

        <div className="admin-rows">
          {visible.map(player => (
            <AthleteRow
              key={player.id}
              player={player}
              teamName={player.teamId ? teamNames.get(player.teamId) ?? null : null}
              evidence={evidence[player.id]}
              job={jobs[player.id]}
              checked={selected.has(player.id)}
              locked={running}
              onToggle={() => toggle(player.id)}
              onRetry={() => void retry(player.id)}
            />
          ))}
        </div>
      </section>

      <div className="admin-batch-bar">
        <div className="admin-batch-bar-copy">
          <strong>{selected.size} selected</strong>
          {jobList.length > 0 && (
            <span>
              {finished} of {jobList.length} finished{failed ? ` · ${failed} failed` : ""}
              {running ? ` · ${BATCH_CONCURRENCY} at a time` : ""}
            </span>
          )}
          {jobList.length > 0 && <div className="admin-progress"><span style={{ width: `${progress}%` }} /></div>}
        </div>
        <button className="primary-cta" type="button" disabled={!selected.size || running} onClick={() => void generate()}>
          <span className="material-symbols-outlined">auto_awesome</span>
          {running ? "Building…" : `Generate ${selected.size || ""} program${selected.size === 1 ? "" : "s"}`}
        </button>
      </div>
    </>
  );
}

function loadOf(entry: Evidence | undefined): AthleteLoad | null {
  return entry?.kind === "ready" ? entry.load : null;
}

function AthleteRow({ player, teamName, evidence, job, checked, locked, onToggle, onRetry }: {
  player: PlayerRow;
  teamName: string | null;
  evidence: Evidence | undefined;
  job: PlanJobState | undefined;
  checked: boolean;
  locked: boolean;
  onToggle: () => void;
  onRetry: () => void;
}) {
  const load = loadOf(evidence);
  const block = selectable(load?.evidence);
  const inputId = `batch-${player.id}`;
  const missing = load ? MEASURED_DRILL_KEYS.filter(key => !load.evidence.tested.includes(key)) : [];

  return (
    <div className={`admin-row admin-batch-row${checked ? " is-selected" : ""}`} title={block.ok ? undefined : block.reason}>
      <input id={inputId} type="checkbox" checked={checked} disabled={!block.ok || locked} onChange={onToggle} />
      <div className="admin-row-copy">
        <label htmlFor={inputId}><strong>{player.name}</strong></label>
        <div className="admin-row-meta">
          <span className="admin-chip">{teamName ?? "No team"}</span>
          {evidence?.kind === "loading" && <span className="admin-chip">Checking evidence…</span>}
          {evidence?.kind === "error" && <span className="admin-chip danger" title={evidence.message}>Evidence unavailable</span>}
          {load && (
            <>
              {load.evidence.position
                ? <span className="admin-chip">{load.evidence.position}</span>
                : <span className="admin-chip warn" title="The engine uses the position-neutral base.">No position</span>}
              {load.evidence.age === null
                ? <span className="admin-chip danger">No age</span>
                : <span className={`admin-chip${load.evidence.ageStale ? " warn" : ""}`} title={load.evidence.ageStale ? "Recorded more than a year ago." : undefined}>Age {load.evidence.age}{load.evidence.ageStale ? " · stale" : ""}</span>}
              <span
                className={`admin-chip${missing.length ? " warn" : " accent"}`}
                title={missing.length ? `Missing ${missing.map(key => DRILL_SHORT_LABELS[key]).join(", ")}` : `${load.evidence.repCount} reps across all six drills`}
              >
                {load.evidence.tested.length}/{MEASURED_DRILL_KEYS.length} tested
              </span>
              {load.evidence.activePlanVersion !== null && (
                <span className="admin-chip warn">v{load.evidence.activePlanVersion} plan active</span>
              )}
            </>
          )}
        </div>
        {job?.status === "failed" && <p className="admin-note form-message" role="alert">{job.message || "The plan could not be generated."}</p>}
      </div>
      <div className="admin-row-actions">
        {job && <JobChip job={job} />}
        {job?.status === "failed" && (
          <button className="quiet-button small" type="button" disabled={locked} onClick={onRetry}>Retry</button>
        )}
        <Link className="quiet-button small" to={`/admin/accounts/player/${player.id}`}>
          {job?.status === "complete" ? "Open plan" : "Open"}
        </Link>
      </div>
    </div>
  );
}

function JobChip({ job }: { job: PlanJobState }) {
  switch (job.status) {
    case "submitting":
    case "pending":
      return <span className="admin-chip">Queued</span>;
    case "running":
      return <span className="admin-chip accent">Building…</span>;
    case "complete":
      return <span className="admin-chip accent">Plan ready</span>;
    case "failed":
      return <span className="admin-chip danger">Failed</span>;
    default:
      return null;
  }
}
