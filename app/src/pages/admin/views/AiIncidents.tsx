// AI incidents — "admins can find an incident in under two minutes from a
// player name and a rough local time, or in one lookup from a reference code
// the athlete quotes" (AI_OBSERVABILITY_AND_IMPROVEMENT_PLAN §2, §3.4).
//
// The DrillLibrary shape: one bounded read (newest 500), filters and a
// group-by breakdown client-side, a row per incident, and a drawer with the
// gateway and phone halves side by side plus the triage form. Every string a
// client or a model could have influenced is rendered as a JSX text node —
// never innerHTML — which is what AiIncidents.test.tsx pins.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PLAYER_INDEX_LIMIT, loadPlayer, loadPlayerIndex } from "../lib/accounts";
import { accountPlayerPath } from "../lib/accountHierarchy";
import {
  ALLOWANCE_FIELD_ORDER,
  CLIENT_FIELD_ORDER,
  EMPTY_FILTERS,
  GROUP_LABELS,
  GROUP_MODES,
  INCIDENT_LIMIT,
  STUCK_JOB_LIMIT,
  STUCK_JOB_MINUTES,
  TRIAGE_FIX_REF_MAX,
  TRIAGE_LABELS,
  TRIAGE_NOTE_MAX,
  TRIAGE_REPLAY_NOTE_MAX,
  TRIAGE_STATES,
  applyFilters,
  countable,
  draftOf,
  facetValues,
  fieldRows,
  groupBreakdown,
  loadIncident,
  loadIncidents,
  loadJob,
  loadStuckJobs,
  loggingLink,
  pacificShort,
  pacificTime,
  readError,
  saveTriage,
  traceLink,
  triageProblem,
  whenOf,
} from "../lib/aiIncidents";
import type {
  AiIncident, GroupMode, IncidentFilters, JobSummary, PlayerNames, TriageDraft, TriageState,
} from "../lib/aiIncidents";
import "../ai-incidents.scss";

const NO_INCIDENTS: AiIncident[] = [];
const NAME_LOOKUP_LIMIT = 100;

type Load =
  | { kind: "loading" }
  | { kind: "ready"; incidents: AiIncident[] }
  | { kind: "error"; message: string };

export default function AiIncidents() {
  const [query, setQuery] = useSearchParams();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [indexNames, setIndexNames] = useState<PlayerNames>(new Map());
  const [indexState, setIndexState] = useState<{ truncated: boolean; error: string } | null>(null);
  const [lookedUp, setLookedUp] = useState<PlayerNames>(new Map());
  const [filters, setFilters] = useState<IncidentFilters>(() => ({ ...EMPTY_FILTERS, search: query.get("q") ?? "" }));
  const [group, setGroup] = useState<GroupMode>("code");
  const [deepLinked, setDeepLinked] = useState<{ id: string; incident: AiIncident | null } | null>(null);
  const selectedId = query.get("incident") ?? "";
  const searchParam = query.get("q");

  const read = useCallback(() => loadIncidents()
    .then(incidents => setLoad({ kind: "ready", incidents }))
    .catch(error => setLoad({ kind: "error", message: readError(error, "The incident log") })), []);
  function refresh() {
    setLoad({ kind: "loading" });
    void read();
  }

  useEffect(() => {
    document.title = "AI incidents | PoseTek admin";
    void read();
    loadPlayerIndex()
      .then(index => {
        setIndexNames(new Map(index.players.map(player => [player.id, player.name])));
        setIndexState({ truncated: index.truncated, error: "" });
      })
      .catch(error => setIndexState({ truncated: false, error: error?.message || "The player index could not be loaded." }));
  }, [read]);

  // A PlayerDetail link (`?q=<playerId>`) arriving while the page is open
  // replaces the search — adjusted during render, React's pattern for state
  // that follows a changed input.
  const [appliedSearch, setAppliedSearch] = useState(searchParam);
  if (searchParam !== appliedSearch) {
    setAppliedSearch(searchParam);
    if (searchParam !== null) setFilters(current => ({ ...current, search: searchParam }));
  }

  const incidents = load.kind === "ready" ? load.incidents : NO_INCIDENTS;

  // Athletes on an incident but outside the bounded index are named one by
  // one — the §3.4 per-row fallback — so name search still finds them.
  useEffect(() => {
    if (load.kind !== "ready" || !indexState) return;
    const missing = [...new Set(incidents.map(incident => incident.playerId))]
      .filter(id => id && !indexNames.has(id) && !lookedUp.has(id)).slice(0, NAME_LOOKUP_LIMIT);
    if (!missing.length) return;
    let live = true;
    void Promise.all(missing.map(id => loadPlayer(id).then(player => [id, player?.name ?? ""] as const).catch(() => [id, ""] as const)))
      .then(found => { if (live) setLookedUp(current => new Map([...current, ...found])); });
    return () => { live = false; };
  }, [load.kind, incidents, indexNames, indexState, lookedUp]);

  const names = useMemo<PlayerNames>(() => {
    const merged = new Map(indexNames);
    for (const [id, name] of lookedUp) if (name) merged.set(id, name);
    return merged;
  }, [indexNames, lookedUp]);

  const all = useMemo(() => countable(incidents), [incidents]);
  const shown = useMemo(() => applyFilters(all, filters, names), [all, filters, names]);
  const breakdown = useMemo(() => groupBreakdown(shown, group), [shown, group]);
  const facets = useMemo(() => ({
    capability: facetValues(all, "capability"), code: facetValues(all, "code"),
    kind: facetValues(all, "kind"), source: facetValues(all, "source"),
  }), [all]);

  // A deep link to an incident outside the loaded window is read on its own.
  const loaded = selectedId ? incidents.find(incident => incident.id === selectedId) ?? null : null;
  useEffect(() => {
    if (!selectedId || load.kind !== "ready" || loaded) return;
    let live = true;
    loadIncident(selectedId)
      .then(incident => { if (live) setDeepLinked({ id: selectedId, incident }); })
      .catch(() => { if (live) setDeepLinked({ id: selectedId, incident: null }); });
    return () => { live = false; };
  }, [selectedId, load.kind, loaded]);
  const lookup = deepLinked?.id === selectedId ? deepLinked : null;
  const selected = loaded ?? lookup?.incident ?? null;

  function setFilter<K extends keyof IncidentFilters>(key: K, value: IncidentFilters[K]) {
    setFilters(current => ({ ...current, [key]: value }));
  }
  function withIncident(id: string | null): string {
    const next = new URLSearchParams(query);
    if (id) next.set("incident", id); else next.delete("incident");
    return next.toString() ? `?${next}` : "";
  }
  function close() {
    const next = new URLSearchParams(query);
    next.delete("incident");
    setQuery(next);
  }
  function onSaved(updated: AiIncident) {
    setLoad(current => current.kind === "ready"
      ? { kind: "ready", incidents: current.incidents.map(incident => (incident.id === updated.id ? updated : incident)) }
      : current);
    setDeepLinked(current => (current?.id === updated.id ? { id: updated.id, incident: updated } : current));
  }
  function applyBar(value: string) {
    if (!value) return;
    if (group === "day") setFilters(current => ({ ...current, from: value, to: value }));
    else if (group === "code" || group === "capability" || group === "kind" || group === "source") setFilter(group, value);
  }

  const hiddenTests = filters.test === "athletes" ? all.filter(incident => incident.isTest).length : 0;
  const filtering = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS);

  return (
    <div className="ai-incidents">
      <section className="admin-heading">
        <div>
          <p className="eyebrow">AI incidents</p>
          <h1>{load.kind === "ready" ? `${shown.length} of ${all.length} incidents` : "AI incidents"}</h1>
          <p>
            Every AI failure, refusal and degradation the gateway, the failed-job projection or the phone recorded,
            newest first (the latest {INCIDENT_LIMIT}). All times are Pacific.
          </p>
        </div>
        <div className="admin-heading-actions">
          <button className="quiet-button" type="button" onClick={refresh}>
            <span className="material-symbols-outlined" aria-hidden="true">refresh</span>Refresh
          </button>
        </div>
      </section>

      <div className="admin-toolbar ai-toolbar">
        <label className="search-field">
          <span className="material-symbols-outlined" aria-hidden="true">search</span>
          <span className="admin-sr-only">Search incidents</span>
          <input
            type="search"
            placeholder="Athlete name, ref code, requestId, jobId, conversationId, playerId or uid"
            autoComplete="off"
            value={filters.search}
            onChange={event => setFilter("search", event.target.value)}
          />
        </label>
        <FacetSelect label="Capability" value={filters.capability} options={facets.capability} onChange={value => setFilter("capability", value)} />
        <FacetSelect label="Code" value={filters.code} options={facets.code} onChange={value => setFilter("code", value)} />
        <FacetSelect label="Kind" value={filters.kind} options={facets.kind} onChange={value => setFilter("kind", value)} />
        <FacetSelect label="Source" value={filters.source} options={facets.source} onChange={value => setFilter("source", value)} />
        <select aria-label="Test traffic" value={filters.test} onChange={event => setFilter("test", event.target.value as IncidentFilters["test"])}>
          <option value="athletes">Athletes only (hide test)</option>
          <option value="all">Athletes and test</option>
          <option value="test">Test traffic only</option>
        </select>
        <select aria-label="Triage state" value={filters.triage} onChange={event => setFilter("triage", event.target.value)}>
          <option value="">Any triage state</option>
          {TRIAGE_STATES.map(state => <option key={state} value={state}>{TRIAGE_LABELS[state]}</option>)}
        </select>
        <label className="ai-date">
          <span>From (Pacific)</span>
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={event => setFilter("from", event.target.value)} />
        </label>
        <label className="ai-date">
          <span>To (Pacific)</span>
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={event => setFilter("to", event.target.value)} />
        </label>
        {filtering && <button className="quiet-button small" type="button" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>}
      </div>

      <p className="admin-note">
        Names come from the same player index Monitor accounts searches: a bounded read of {PLAYER_INDEX_LIMIT + 1} documents
        that covers the first {PLAYER_INDEX_LIMIT} athletes. An athlete on an incident but outside it is looked up by id,
        so searching their name still works once their row has loaded.
        {indexState?.truncated ? ` The index is full right now, so ${PLAYER_INDEX_LIMIT} is not every athlete.` : ""}
        {indexState?.error ? ` The index did not load (${indexState.error}); rows show player ids.` : ""}
        {hiddenTests > 0 ? ` ${hiddenTests} test-labelled ${hiddenTests === 1 ? "incident is" : "incidents are"} hidden.` : ""}
      </p>

      {load.kind === "loading" && <div className="portal-loading"><span className="spinner" /><p>Loading incidents…</p></div>}
      {load.kind === "error" && <div><p className="form-message" role="alert">{load.message}</p>
        <button className="quiet-button" type="button" onClick={refresh}>Try again</button></div>}

      {load.kind === "ready" && <>
        <Breakdown rows={breakdown} group={group} onGroup={setGroup} onPick={applyBar} />
        <div className="admin-rows">
          {shown.length === 0 && <p className="admin-empty">{all.length ? "No incidents match these filters." : "No incidents recorded yet."}</p>}
          {shown.map(incident => (
            <IncidentRow key={incident.id} incident={incident} name={names.get(incident.playerId)} to={withIncident(incident.id)} />
          ))}
        </div>
        <StuckJobs names={names} />
      </>}

      {selectedId && load.kind === "ready" && (
        selected
          ? <IncidentDrawer incident={selected} name={names.get(selected.playerId)}
              halves={incidents.filter(incident => incident.foldedInto === selected.id)} onClose={close} onSaved={onSaved} />
          : <DrawerFrame title="Incident" onClose={close}>
              <p className="admin-note">{lookup ? `No incident with the id ${selectedId}.` : `Looking up ${selectedId}…`}</p>
            </DrawerFrame>
      )}
    </div>
  );
}

function FacetSelect({ label, value, options, onChange }: {
  label: string; value: string; options: { value: string; count: number }[]; onChange: (value: string) => void;
}) {
  return (
    <select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
      <option value="">Any {label.toLowerCase()}</option>
      {options.map(option => <option key={option.value} value={option.value}>{option.value} ({option.count})</option>)}
      {value && !options.some(option => option.value === value) && <option value={value}>{value}</option>}
    </select>
  );
}

// MARK: - Breakdown

function Breakdown({ rows, group, onGroup, onPick }: {
  rows: ReturnType<typeof groupBreakdown>; group: GroupMode; onGroup: (mode: GroupMode) => void; onPick: (value: string) => void;
}) {
  const max = rows.length ? Math.max(...rows.map(row => row.count)) : 1;
  return (
    <section className="admin-card ai-breakdown">
      <div className="ai-breakdown-head">
        <h2>Breakdown</h2>
        <label>
          <span>Group by</span>
          <select aria-label="Group by" value={group} onChange={event => onGroup(event.target.value as GroupMode)}>
            {GROUP_MODES.map(mode => <option key={mode} value={mode}>{GROUP_LABELS[mode]}</option>)}
          </select>
        </label>
      </div>
      {!rows.length && <p className="admin-empty">Nothing to summarize.</p>}
      <div className="ai-bars">
        {rows.slice(0, 24).map(row => {
          const body = <>
            <span className="ai-bar-label">{row.label}</span>
            <span className="ai-bar-track"><span className="ai-bar-fill" style={{ width: `${Math.max(2, (row.count / max) * 100)}%` }} /></span>
            <span className="ai-bar-count">{row.count}</span>
          </>;
          return row.value
            ? <button key={row.label} type="button" className="ai-bar" title="Filter to this" onClick={() => onPick(row.value)}>{body}</button>
            : <div key={row.label} className="ai-bar">{body}</div>;
        })}
      </div>
      {rows.length > 24 && <p className="admin-note">{rows.length - 24} smaller groups not shown.</p>}
    </section>
  );
}

// MARK: - Rows

const KIND_CHIP: Record<string, string> = { failure: "danger", refusal: "warn", degraded: "accent" };

export function IncidentRow({ incident, name, to }: { incident: AiIncident; name?: string; to: string }) {
  return (
    <Link className="admin-row ai-incident-row" to={to}>
      <span className="ai-row-time">{pacificShort(whenOf(incident))}</span>
      <span className="admin-row-copy">
        <strong>{incident.code} <span className="ai-row-capability">· {incident.capability}</span></strong>
        <span className="admin-row-meta">
          <span className={`admin-chip ${KIND_CHIP[incident.kind] ?? ""}`}>{incident.kind}</span>
          <span>{name || incident.playerId || "no athlete"}</span>
          <span>stage {incident.stage}</span>
          {incident.message && <span className="ai-row-message">{incident.message}</span>}
        </span>
      </span>
      <span className="admin-row-actions">
        <span className="admin-chip">{incident.source}</span>
        {incident.hasClient && <span className="admin-chip accent">phone half</span>}
        {incident.foldRejected && <span className="admin-chip danger">fold rejected</span>}
        {incident.isTest && <span className="admin-chip">test</span>}
        {incident.backfill && <span className="admin-chip">backfill</span>}
        {incident.triage.state !== "new" && <span className={`admin-chip ${incident.triage.state === "fixed" ? "warn" : "accent"}`}>{TRIAGE_LABELS[incident.triage.state]}</span>}
        <span className="material-symbols-outlined" aria-hidden="true">chevron_right</span>
      </span>
    </Link>
  );
}

// MARK: - Drawer

function DrawerFrame({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = dialog.current?.parentElement;
    const siblings = container ? [...container.parentElement!.children].filter(child => child !== container && child instanceof HTMLElement) as HTMLElement[] : [];
    const prior = siblings.map(element => element.inert);
    siblings.forEach(element => { element.inert = true; });
    dialog.current?.querySelector<HTMLButtonElement>('button[aria-label="Close"]')?.focus();
    const focusable = () => [...(dialog.current?.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, [tabindex]') || [])]
      .filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && (element.tagName === "SUMMARY" || !element.closest('details:not([open])'))
        && !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close.current(); return; }
      if (event.key !== "Tab") return;
      const nodes = focusable(), first = nodes[0], last = nodes.at(-1);
      if (!first) { event.preventDefault(); dialog.current?.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const onFocus = (event: FocusEvent) => { if (event.target instanceof Node && !dialog.current?.contains(event.target)) focusable()[0]?.focus(); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocus);
      siblings.forEach((element, index) => { element.inert = prior[index]; });
      previous?.focus();
    };
  }, []);
  return (
    <div className="ai-drawer-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <aside ref={dialog} className="ai-drawer" role="dialog" aria-modal="true" aria-labelledby="ai-drawer-title" tabIndex={-1}>
        <header className="ai-drawer-head">
          <h2 id="ai-drawer-title">{title}</h2>
          <button className="icon-button" type="button" aria-label="Close" onClick={onClose}>
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </header>
        {children}
      </aside>
    </div>
  );
}

function Fields({ rows, empty }: { rows: [string, ReactNode][]; empty?: string }) {
  const present = rows.filter(([, value]) => value !== "" && value !== null && value !== undefined);
  if (!present.length) return empty ? <p className="admin-note">{empty}</p> : null;
  return (
    <dl className="ai-fields">
      {present.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
    </dl>
  );
}

const num = (value: number | null, unit = ""): string => (value === null ? "" : `${value}${unit}`);

export function IncidentDrawer({ incident, name, halves, onClose, onSaved }: {
  incident: AiIncident; name?: string; halves: AiIncident[]; onClose: () => void; onSaved: (incident: AiIncident) => void;
}) {
  const logs = loggingLink(incident);
  const trace = incident.traceRef ? traceLink(incident.traceRef) : null;
  const clientOnly = incident.source === "client";
  const clientRows = fieldRows(incident.client, CLIENT_FIELD_ORDER).filter(([key]) => key !== "breadcrumbTail");
  const breadcrumbs = typeof incident.client?.breadcrumbTail === "string" ? incident.client.breadcrumbTail : "";

  return (
    <DrawerFrame title={<>{incident.code} <span className="ai-row-capability">· {incident.capability}</span></>} onClose={onClose}>
      <div className="admin-row-meta ai-drawer-chips">
        <span className={`admin-chip ${KIND_CHIP[incident.kind] ?? ""}`}>{incident.kind}</span>
        {incident.severity && <span className="admin-chip">severity {incident.severity}</span>}
        <span className="admin-chip">{incident.source}</span>
        <span className="admin-chip">{incident.transport}</span>
        {incident.isTest && <span className="admin-chip">test</span>}
        {incident.backfill && <span className="admin-chip">backfill</span>}
        {incident.foldRejected && <span className="admin-chip danger">fold rejected: {incident.foldRejected}</span>}
        {incident.foldedInto && <span className="admin-chip accent">folded into {incident.foldedInto}</span>}
      </div>
      <p className="ai-drawer-when">{pacificTime(whenOf(incident))}{incident.createdAt && incident.occurredAt
        && Math.abs(incident.createdAt.valueOf() - incident.occurredAt.valueOf()) > 60_000
        ? ` · received ${pacificTime(incident.createdAt)}` : ""}</p>
      {incident.message && <blockquote className="ai-message">{incident.message}</blockquote>}

      <section className="ai-section">
        <h3>Athlete and ids</h3>
        <Fields rows={[
          ["athlete", incident.playerId
            ? <Link key="athlete" to={accountPlayerPath(incident.playerId)}>{name || incident.playerId}</Link> : "none recorded"],
          ["playerId", incident.playerId],
          ["uid", incident.requestedByUid],
          ["ref code", incident.requestId ? incident.requestId.slice(0, 8) : ""],
          ["requestId", incident.requestId && `${incident.requestId}${incident.requestIdSource ? ` (${incident.requestIdSource})` : ""}`],
          ["jobId", incident.jobId],
          ["conversationId", incident.conversationId],
          ["messageId", incident.messageId],
          ["draftId", incident.draftId],
          ["invocationId", incident.invocationId],
          ["incident", incident.id],
        ]} />
        <div className="ai-links">
          {logs
            ? <a className="quiet-button small" href={logs} target="_blank" rel="noreferrer noopener">
                <span className="material-symbols-outlined" aria-hidden="true">manage_search</span>Cloud Logging
              </a>
            : <span className="admin-note">No request or job id to search the logs by.</span>}
          {incident.playerId && <Link className="quiet-button small" to={accountPlayerPath(incident.playerId)}>
            <span className="material-symbols-outlined" aria-hidden="true">person</span>Athlete page
          </Link>}
        </div>
      </section>

      <div className="ai-halves">
        <section className="ai-section">
          <h3>Gateway half</h3>
          {clientOnly
            ? <p className="admin-note">{incident.requestId || incident.jobId
              ? "No gateway record is joined to this phone report yet. The request may never have reached the gateway, or the fold is still pending."
              : "Recorded by the phone alone: this failure never reached the gateway."}</p>
            : <Fields rows={[
              ["stage", incident.stage],
              ["http status", num(incident.httpStatus)],
              ["provider status", incident.providerStatus],
              ["provider", incident.provider],
              ["model", incident.model],
              ["provider calls", num(incident.providerCalls)],
              ["latency", num(incident.latencyMs, " ms")],
              ["message length", num(incident.messageLength, " chars")],
              ["gateway revision", incident.gatewayRevision],
              ["client version", incident.clientVersion],
              ["platform", incident.platform],
            ]} empty="The writer recorded no gateway detail." />}
        </section>
        <section className="ai-section">
          <h3>Phone half</h3>
          {clientRows.length
            ? <Fields rows={clientRows} />
            : <p className="admin-note">No phone half. The app records its side of a failure from the release that adds client reporting (plan Phase 3).</p>}
          {breadcrumbs && <details className="ai-breadcrumbs"><summary>Breadcrumb tail</summary><pre>{breadcrumbs}</pre></details>}
          {incident.userReport && <>
            <h4>Athlete's report{incident.userReport.submittedAt ? ` · ${pacificTime(incident.userReport.submittedAt)}` : ""}</h4>
            <blockquote className="ai-message">{incident.userReport.note || "(no note)"}</blockquote>
          </>}
          {(incident.clientIncidentIds.length > 0 || halves.length > 0) && <p className="admin-note">
            Phone documents folded in: {[...new Set([...incident.clientIncidentIds, ...halves.map(half => half.id)])].join(", ")}
          </p>}
        </section>
      </div>

      {(incident.allowance || incident.quota) && <section className="ai-section">
        <h3>Allowance at the refusal</h3>
        <Fields rows={[
          ...fieldRows(incident.allowance, ALLOWANCE_FIELD_ORDER).map(([key, value]) => [`allowance.${key}`, value] as [string, string]),
          ...fieldRows(incident.quota).map(([key, value]) => [`ledger pre-check.${key}`, value] as [string, string]),
        ]} />
      </section>}

      {incident.degraded.length > 0 && <section className="ai-section">
        <h3>Degraded signals</h3>
        <ul className="ai-list">{incident.degraded.map((entry, index) =>
          <li key={`${entry.signal}-${index}`}><strong>{entry.signal}</strong>{entry.detail ? ` — ${entry.detail}` : ""}</li>)}</ul>
      </section>}

      {incident.traceRef && <section className="ai-section">
        <h3>Trace</h3>
        <p className="ai-mono">{incident.traceRef}</p>
        {trace && <a className="quiet-button small" href={trace} target="_blank" rel="noreferrer noopener">
          <span className="material-symbols-outlined" aria-hidden="true">folder_open</span>Open in Cloud Storage
        </a>}
      </section>}

      {incident.jobId && <JobPanel jobId={incident.jobId} />}

      <TriageForm key={incident.id} incident={incident} onSaved={onSaved} />
    </DrawerFrame>
  );
}

function JobPanel({ jobId }: { jobId: string }) {
  const [state, setState] = useState<{ kind: "idle" } | { kind: "loading" } | { kind: "ready"; job: JobSummary | null } | { kind: "error"; message: string }>({ kind: "idle" });
  function open() {
    setState({ kind: "loading" });
    loadJob(jobId).then(job => setState({ kind: "ready", job }))
      .catch(error => setState({ kind: "error", message: readError(error, "The llmJobs document") }));
  }
  return (
    <section className="ai-section">
      <h3>The job</h3>
      {state.kind === "idle" && <button className="quiet-button small" type="button" onClick={open}>Open llmJobs/{jobId}</button>}
      {state.kind === "loading" && <p className="admin-note">Loading the job…</p>}
      {state.kind === "error" && <p className="form-message" role="alert">{state.message}</p>}
      {state.kind === "ready" && (state.job
        ? <Fields rows={[
          ["status", state.job.status],
          ["capability", state.job.capability],
          ["error code", state.job.errorCode],
          ["created", pacificTime(state.job.createdAt)],
          ["started", state.job.startedAt ? pacificTime(state.job.startedAt) : ""],
          ["completed", state.job.completedAt ? pacificTime(state.job.completedAt) : ""],
          ["client version", state.job.clientVersion],
          ["params (keys only)", state.job.paramKeys.join(", ")],
          ["result", state.job.hasResult ? "present" : "none"],
        ]} />
        : <p className="admin-note">No llmJobs document with that id.</p>)}
      {state.kind === "ready" && state.job && <p className="admin-note">Parameter values, the result and the error text are left out: they can hold athlete input or model output.</p>}
    </section>
  );
}

// MARK: - Triage

export function TriageForm({ incident, onSaved }: { incident: AiIncident; onSaved: (incident: AiIncident) => void }) {
  const [draft, setDraft] = useState<TriageDraft>(() => draftOf(incident.triage));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const problem = triageProblem(draft);
  const unchanged = JSON.stringify(draft) === JSON.stringify(draftOf(incident.triage));
  const edit = <K extends keyof TriageDraft>(key: K, value: TriageDraft[K]) => { setDraft(current => ({ ...current, [key]: value })); setMessage(null); };

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const triage = await saveTriage(incident.id, draft);
      setDraft(draftOf(triage));
      onSaved({ ...incident, triage });
      setMessage("Saved.");
    } catch (error: any) {
      setMessage(error?.code === "permission-denied"
        ? "The rules refused this triage update. Only a verified @posetek.net admin may write it, and only the triage fields."
        : error?.message || "Triage could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="ai-section ai-triage">
      <h3>Triage</h3>
      <p className="admin-note">
        new → fixed (needs the fix reference) → verified (needs the replay: the incident id the replayed scenario
        produced, or a dated "replay produced no incident"); won't fix goes to KNOWN_ISSUES.
      </p>
      <div className="admin-form">
        <div className="admin-field-row">
          <label className="admin-field">
            <span>State</span>
            <select value={draft.state} onChange={event => edit("state", event.target.value as TriageState)}>
              {TRIAGE_STATES.map(state => <option key={state} value={state}>{TRIAGE_LABELS[state]}</option>)}
            </select>
          </label>
          <label className="admin-field">
            <span>Owner</span>
            <input value={draft.owner} maxLength={120} onChange={event => edit("owner", event.target.value)} />
          </label>
        </div>
        <label className="admin-field">
          <span>Fix reference{draft.state === "fixed" ? " (required)" : ""} — commit, PR or config change</span>
          <input value={draft.fixRef} maxLength={TRIAGE_FIX_REF_MAX} aria-required={draft.state === "fixed"}
            onChange={event => edit("fixRef", event.target.value)} />
        </label>
        <label className="admin-field">
          <span>Replay note{draft.state === "verified" ? " (required)" : ""}</span>
          <textarea value={draft.replayNote} maxLength={TRIAGE_REPLAY_NOTE_MAX} aria-required={draft.state === "verified"}
            onChange={event => edit("replayNote", event.target.value)} />
        </label>
        <label className="admin-field">
          <span>Note</span>
          <textarea value={draft.note} maxLength={TRIAGE_NOTE_MAX} onChange={event => edit("note", event.target.value)} />
        </label>
        {problem && !unchanged && <p className="admin-note" role="status">{problem}</p>}
        {message && <p className="admin-note" role="status">{message}</p>}
        {incident.triage.updatedAt && <p className="admin-note">Last triaged {pacificTime(incident.triage.updatedAt)}{incident.triage.updatedBy ? ` by ${incident.triage.updatedBy}` : ""}.</p>}
        <div className="admin-form-actions">
          <button className="primary-cta" type="button" disabled={saving || unchanged || Boolean(problem)} onClick={save}>
            {saving ? "Saving…" : "Save triage"}
          </button>
        </div>
      </div>
    </section>
  );
}

// MARK: - Stuck jobs (§9: pending/running jobs that never fail, so no incident exists)

function StuckJobs({ names }: { names: PlayerNames }) {
  const [state, setState] = useState<{ kind: "idle" } | { kind: "loading" } | { kind: "ready"; jobs: JobSummary[]; truncated: boolean; at: number } | { kind: "error"; message: string }>({ kind: "idle" });
  function check() {
    setState({ kind: "loading" });
    const now = Date.now();
    loadStuckJobs(now).then(result => setState({ kind: "ready", ...result, at: now }))
      .catch(error => setState({ kind: "error", message: readError(error, "Pending and running jobs") }));
  }
  return (
    <section className="admin-card ai-stuck">
      <div className="ai-breakdown-head">
        <div>
          <h2>Stuck jobs</h2>
          <p className="admin-note">Jobs still pending or running {STUCK_JOB_MINUTES} minutes after they were created. They never fail, so they never become an incident.</p>
        </div>
        <button className="quiet-button small" type="button" onClick={check} disabled={state.kind === "loading"}>
          {state.kind === "ready" ? "Check again" : "Check now"}
        </button>
      </div>
      {state.kind === "loading" && <p className="admin-note">Reading pending and running jobs…</p>}
      {state.kind === "error" && <p className="form-message" role="alert">{state.message}</p>}
      {state.kind === "ready" && <>
        {!state.jobs.length && <p className="admin-empty">No stuck jobs as of {pacificTime(new Date(state.at))}.</p>}
        {state.truncated && <p className="admin-note">More than {STUCK_JOB_LIMIT} jobs are pending or running; only the newest {STUCK_JOB_LIMIT} were checked.</p>}
        <div className="admin-rows">
          {state.jobs.map(job => (
            <div className="admin-row" key={job.id}>
              <span className="admin-row-copy">
                <strong>{job.capability || "unknown capability"} <span className="ai-row-capability">· {job.status}</span></strong>
                <span className="admin-row-meta">
                  <span>created {pacificTime(job.createdAt)}</span>
                  {job.playerId && <Link to={accountPlayerPath(job.playerId)}>{names.get(job.playerId) || job.playerId}</Link>}
                  <span className="ai-mono">{job.id}</span>
                </span>
              </span>
            </div>
          ))}
        </div>
      </>}
    </section>
  );
}
