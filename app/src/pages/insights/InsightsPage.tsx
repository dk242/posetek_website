import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { auth } from "../../lib/firebase";
import { clubCall, getClubContext } from "../../lib/organization-data";
import ExpandedReport from "./ExpandedReport";
import { assertReportScope, expandedFailureMessage, reportPayload, scopeFor } from "./lib/expanded";
import type { ExpandedInsights, InsightAccess, InsightChoices, InsightScope } from "./lib/expanded";
import { clearPlayerFilters, dateInZone, expandedQuery, expandedRequest, INSIGHT_VIEWS, shiftDate, TIMEZONES } from "./lib/expandedQuery";
import type { ExpandedRequest } from "./lib/expandedQuery";
import { createInsightsRequestGuard, insightsPlayerLink, insightsReturnLink, isInsightsStaff } from "./lib/navigation";
import "../../styles/pose-portal.css";
import "../../styles/admin-theme.scss";
import "./insights.scss";

const Preview = import.meta.env.DEV ? lazy(() => import("./InsightsPreview")) : null;

export default function InsightsPage() {
  const navigate = useNavigate(), location = useLocation();
  const preview = !!Preview && new URLSearchParams(location.search).get("preview") === "1";
  const [uid, setUid] = useState(auth.currentUser?.uid ?? "");
  useEffect(() => {
    if (preview) return;
    return auth.onAuthStateChanged(user => {
      setUid(user?.uid ?? "");
      if (!user) navigate(`/signin?returnTo=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    });
  }, [navigate, location.pathname, location.search, preview]);
  if (preview && Preview) return <Suspense fallback={<p>Loading synthetic preview…</p>}><Preview /></Suspense>;
  return uid ? <InsightsWorkspace key={JSON.stringify([uid, location.search])} uid={uid} /> : <p role="status">Checking your sign-in…</p>;
}

export function InsightTabs({ request, onChange }: { request: ExpandedRequest; onChange: (patch: Partial<ExpandedRequest>) => void }) {
  return <nav className="insights-tabs" aria-label="Insights views" role="tablist">{INSIGHT_VIEWS.map(view => <button key={view} type="button" role="tab" aria-selected={request.view === view} aria-controls="insights-report" id={`insights-tab-${view}`} onClick={() => onChange({ view })}>{view[0].toUpperCase() + view.slice(1)}</button>)}</nav>;
}

export function InsightsControls({ choices, request, scope, loading, hideScope = false, onChange, onRefresh }: {
  choices: InsightChoices;
  request: ExpandedRequest;
  scope: InsightScope;
  loading: boolean;
  hideScope?: boolean;
  onChange: (patch: Partial<ExpandedRequest>) => void;
  onRefresh: () => void;
}) {
  const orgId = scope.kind === "global" ? "" : scope.organizationId, teamId = scope.kind === "team" ? scope.teamId : "";
  const organization = choices.organizations.find(org => org.id === orgId);
  const [dates, setDates] = useState({ start: request.startDate, end: request.endDate });
  const [dateError, setDateError] = useState("");
  useEffect(() => setDates({ start: request.startDate, end: request.endDate }), [request.startDate, request.endDate]);
  const today = dateInZone(new Date(), request.timezone);
  const preset = request.startDate === shiftDate(request.endDate, 1 - request.weeks * 7) ? request.weeks : 0;

  return <section className="insights-controls" aria-label="Report scope and dates">
    <div className="insights-control-row">
      {!hideScope && <>
        <label>Organization<select value={orgId} onChange={event => onChange({ orgId: event.target.value || undefined, teamId: undefined, coachId: undefined, ...clearPlayerFilters() })}>{choices.global && <option value="">All organizations</option>}{choices.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>
        <label>Team<select value={teamId} disabled={!organization} onChange={event => onChange({ teamId: event.target.value || undefined, teamAssignment: "" })}><option value="">{organization?.role === "coach" ? "All assigned teams" : "All teams + unassigned"}</option>{organization?.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
      </>}
      <label>Timezone<select value={request.timezone} onChange={event => onChange({ timezone: event.target.value })}>{TIMEZONES.map(zone => <option key={zone} value={zone}>{zone.replace("America/", "").replaceAll("_", " ")}</option>)}</select></label>
      <fieldset className="insights-period-presets"><legend>Period</legend><div>{[4, 8, 12, 26].map(weeks => <button key={weeks} type="button" aria-pressed={preset === weeks} onClick={() => onChange({ weeks, startDate: shiftDate(today, 1 - weeks * 7), endDate: today })}>{weeks}w</button>)}</div></fieldset>
      <details className="insights-custom-period">
        <summary>Custom</summary>
        <form onSubmit={event => {
          event.preventDefault();
          if (!dates.start || !dates.end || dates.start > dates.end || dates.end > today || dates.start < shiftDate(dates.end, -365)) {
            setDateError("Choose a valid date range of up to one year ending today or earlier."); return;
          }
          setDateError(""); onChange({ startDate: dates.start, endDate: dates.end });
        }}>
          <label>From<input type="date" value={dates.start} max={dates.end} onChange={event => setDates(value => ({ ...value, start: event.target.value }))} /></label>
          <label>Through<input type="date" value={dates.end} min={dates.start} max={today} onChange={event => setDates(value => ({ ...value, end: event.target.value }))} /></label>
          <button className="quiet-button" type="submit">Apply dates</button>
          {dateError && <p className="insights-note" role="alert">{dateError}</p>}
        </form>
      </details>
      <button className="insights-refresh" type="button" disabled={loading} onClick={onRefresh} aria-label="Refresh Insights" title="Refresh Insights"><span className="material-symbols-outlined" aria-hidden="true">refresh</span></button>
    </div>
  </section>;
}

export function InsightsWorkspace({ uid, embedded = false }: { uid: string; embedded?: boolean }) {
  const [query, setQuery] = useSearchParams(), request = expandedRequest(query.toString());
  const [report, setReport] = useState<ExpandedInsights | null>(null), [choices, setChoices] = useState<InsightChoices | null>(null);
  const [scope, setScope] = useState<InsightScope | null>(null), [role, setRole] = useState<InsightAccess | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [accessDenied, setAccessDenied] = useState(false);
  const [retry, setRetry] = useState(0), [cursors, setCursors] = useState<string[]>([""]), [page, setPage] = useState(0);
  const guard = useRef(createInsightsRequestGuard(() => auth.currentUser?.uid)).current;
  const cursor = cursors[page];

  useEffect(() => {
    document.title = embedded ? "Admin overview | PoseTek" : "Insights | PoseTek";
    const isCurrent = guard.begin(uid);
    setReport(null); setError(""); setLoading(true); setAccessDenied(false);
    void (async () => {
      try {
        const context = await getClubContext(request.orgId);
        if (!isCurrent()) return;
        if (!isInsightsStaff(context.role)) { setAccessDenied(true); setChoices(null); setScope(null); return; }
        const access = context.role as InsightAccess;
        const canonical = context.organization?.schemaVersion === 2 ? context.organization : null;
        if (request.orgId && canonical?.id !== request.orgId) throw Object.assign(new Error("Organization access changed"), { code: "permission-denied" });
        const selected = scopeFor(request, access, request.orgId ? undefined : access === "admin" ? undefined : canonical?.id);
        setRole(access); setScope(selected);
        setChoices({ global: access === "admin", organizations: context.organizations.filter(org => org.schemaVersion === 2).map(org => ({ id: org.id, name: org.name, role: access, teams: context.teams.filter(team => team.organizationId === org.id).map(team => ({ id: team.id, name: team.name })) })) });
        if (selected.kind !== "global" && !request.orgId) {
          setQuery(expandedQuery(request, { orgId: selected.organizationId }), { replace: true }); return;
        }
        const result = await clubCall<ExpandedInsights>("getClubInsightsV2", reportPayload(request, selected, cursor));
        if (!isCurrent()) return;
        assertReportScope(result, selected, request);
        setChoices(result.choices); setScope(result.scope); setRole(result.scope.access); setReport(result);
      } catch (failure) {
        if (!isCurrent()) return;
        const code = String((failure as { code?: string })?.code || "").split("/").at(-1);
        if (["unauthenticated", "permission-denied", "not-found"].includes(code || "")) { setChoices(null); setScope(null); }
        setReport(null); setError(expandedFailureMessage(failure));
      } finally { if (isCurrent()) setLoading(false); }
    })();
    return () => guard.cancel();
  }, [uid, embedded, request.orgId, request.teamId, request.startDate, request.endDate, request.timezone, request.testingWindow, request.division, request.ageBand, request.testingStatus, request.workoutStatus, request.usageStatus, request.usagePlatform, request.usageFeature, request.teamAssignment, cursor, retry, guard, setQuery]);

  function change(patch: Partial<ExpandedRequest>) {
    const next = expandedQuery(request, patch);
    if (next.toString() === query.toString()) return;
    guard.cancel(); setReport(null); setLoading(true); setQuery(next);
  }
  function refresh() { guard.cancel(); setPage(0); setCursors([""]); setRetry(value => value + 1); }
  const current = { orgId: scope && scope.kind !== "global" ? scope.organizationId : undefined, teamId: scope?.kind === "team" ? scope.teamId : undefined, coachId: request.coachId };
  const back = insightsReturnLink(role || undefined, current, request.from);
  const content = <>
    <section className={`insights-heading${embedded ? " admin-overview-heading" : ""}`}>
      {!embedded && <p className="eyebrow">Insights</p>}
      <h1>{embedded ? "Overview" : report?.scope.label || (scope?.kind === "global" ? "All organizations" : "Team and player insights")}</h1>
      <p>{embedded && (report?.scope.label || (scope?.kind === "global" ? "All organizations · " : ""))} Understand your roster, successful testing, completed workouts and estimated active use.</p>
    </section>
    {choices && scope && <InsightsControls choices={choices} request={request} scope={scope} loading={loading} hideScope={embedded} onChange={change} onRefresh={refresh} />}
    <InsightTabs request={request} onChange={change} />
    {(request.view === "overview" || request.view === "testing") && <div className="insights-toolbar"><p className="insights-note">Testing coverage</p><div className="insights-toggle" aria-label="Testing coverage period"><button type="button" aria-pressed={request.testingWindow === "cumulative"} onClick={() => change({ testingWindow: "cumulative" })}>Through selected end</button><button type="button" aria-pressed={request.testingWindow === "period"} onClick={() => change({ testingWindow: "period" })}>Selected period only</button></div></div>}
    {error && <div className="insights-message error" role="alert"><p>{error}</p><button className="quiet-button" type="button" onClick={refresh}>Retry Insights</button></div>}
    {accessDenied && <section className="insights-card"><h2>Insights are for club staff</h2><p>Access requires a current manager or assigned coach membership.</p><Link className="quiet-button" to="/organization">Open organization</Link></section>}
    {loading && <p role="status">Loading complete Insights…</p>}
    {report && !loading && <div id="insights-report" role="tabpanel" aria-labelledby={`insights-tab-${request.view}`}><ExpandedReport data={report} request={request} onChange={change} adminOverview={embedded && role === "admin"} page={page} onPrevious={() => { guard.cancel(); setReport(null); setLoading(true); setPage(value => Math.max(0, value - 1)); }} onNext={() => { if (report.pagination.nextCursor) { guard.cancel(); setReport(null); setLoading(true); setCursors(values => [...values.slice(0, page + 1), report.pagination.nextCursor!]); setPage(value => value + 1); } }} playerLink={player => insightsPlayerLink(role || undefined, player.id, { orgId: player.organizationId, teamId: player.teamId || undefined, coachId: request.orgId === player.organizationId ? request.coachId : undefined })} /></div>}
  </>;

  if (embedded) return <div className="pt-insights admin-insights">{content}</div>;
  return <div className="pt-pose portal-body pt-insights">
    <header className="portal-header"><Link className="portal-brand" to={back}><span className="portal-brand-mark">P</span>POSETEK</Link><Link className="quiet-button" to={back}>{role === "admin" ? request.from === "organization" ? "Organizations" : "Accounts" : role === "coach" && request.from === "dashboard" ? "Team dashboard" : "Organization"}</Link><button className="quiet-button" onClick={() => { void auth.signOut().catch(() => setError("Sign out failed. Try again.")); }}>Sign out</button></header>
    <main className="insights-shell">{content}</main>
  </div>;
}
