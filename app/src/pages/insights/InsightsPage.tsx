import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { auth } from "../../lib/firebase";
import { clubCall, getClubContext } from "../../lib/organization-data";
import InsightsReport from "./InsightsReport";
import type { ClubInsights } from "./lib/insights";
import { createInsightsRequestGuard, INSIGHTS_WEEK_OPTIONS, insightsAccessFailure, insightsFailureMessage, insightsLink, insightsPlayerLink, insightsRequest, insightsReturnLink, isInsightsStaff, loadInsightsScope } from "./lib/navigation";
import "../../styles/pose-portal.css";
import "./insights.scss";

export default function InsightsPage() {
  const navigate = useNavigate(), location = useLocation();
  const [uid, setUid] = useState(auth.currentUser?.uid ?? "");
  useEffect(() => auth.onAuthStateChanged(user => {
    setUid(user?.uid ?? "");
    if (!user) navigate(`/signin?returnTo=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
  }), [navigate, location.pathname, location.search]);
  return uid ? <InsightsWorkspace key={JSON.stringify([uid, location.search])} uid={uid} /> : <p role="status">Checking your sign-in…</p>;
}

function InsightsWorkspace({ uid }: { uid: string }) {
  const location = useLocation(), [query, setQuery] = useSearchParams();
  const request = insightsRequest(query.toString());
  const [scope, setScope] = useState<Awaited<ReturnType<typeof loadInsightsScope>> | null>(null);
  const [insights, setInsights] = useState<ClubInsights | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const guard = useRef(createInsightsRequestGuard(() => auth.currentUser?.uid)).current;
  const context = scope?.context;
  const staff = context && isInsightsStaff(context.role);
  const current = { orgId: scope?.orgId || undefined, teamId: scope?.teamId || undefined,
    coachId: request.orgId === scope?.orgId ? request.coachId : undefined };
  const back = insightsReturnLink(context?.role, current, request.from);
  const notice = location.state?.insightsTeamUnavailable === true
    ? "The requested team is no longer available. Showing a current team you can access." : "";

  useEffect(() => {
    document.title = "Team Insights | PoseTek";
    const isCurrent = guard.begin(uid);
    setScope(null); setInsights(null); setError(""); setLoading(true);
    void (async () => {
      let reportStarted = false;
      try {
        const resolved = await loadInsightsScope(request, getClubContext);
        if (!isCurrent()) return;
        if (isInsightsStaff(resolved.context.role) && (resolved.orgId !== (request.orgId || "") || resolved.teamId !== (request.teamId || ""))) {
          const href = insightsLink({ orgId: resolved.orgId || undefined, teamId: resolved.teamId || undefined,
            coachId: resolved.orgId === request.orgId ? request.coachId : undefined }, request.from, request.weeks);
          setQuery(href.split("?")[1], { replace: true, state: { insightsTeamUnavailable: !!resolved.notice } });
          return;
        }
        setScope(resolved);
        if (!isInsightsStaff(resolved.context.role) || !resolved.orgId || !resolved.teamId) return;
        reportStarted = true;
        const result = await clubCall<ClubInsights>("getClubInsights", { organizationId: resolved.orgId, teamId: resolved.teamId, weeks: request.weeks });
        if (!isCurrent()) return;
        if (result.organizationId !== resolved.orgId || result.teamId !== resolved.teamId) throw Object.assign(new Error("Report scope changed"), { code: "failed-precondition" });
        setInsights(result);
      } catch (failure) {
        if (isCurrent()) {
          if (!reportStarted || insightsAccessFailure(failure)) setScope(null);
          setInsights(null); setError(insightsFailureMessage(failure, reportStarted));
        }
      } finally { if (isCurrent()) setLoading(false); }
    })();
    return () => guard.cancel();
  }, [uid, request.orgId, request.teamId, request.coachId, request.from, request.weeks, retry, guard, setQuery]);

  function choose(orgId: string, teamId: string, weeks = request.weeks) {
    guard.cancel(); setScope(null); setInsights(null); setLoading(true);
    const href = insightsLink({ orgId: orgId || undefined, teamId: teamId || undefined,
      coachId: orgId === current.orgId ? current.coachId : undefined }, request.from, weeks);
    setQuery(href.split("?")[1], { state: null });
  }
  const weekOptions = [...new Set([...INSIGHTS_WEEK_OPTIONS, request.weeks])].sort((a, b) => a - b);

  return <div className="pt-pose portal-body pt-insights">
    <header className="portal-header">
      <Link className="portal-brand" to={back}><span className="portal-brand-mark">P</span>POSETEK</Link>
      <Link className="quiet-button" to={back}>{context?.role === "admin" ? request.from === "organization" ? "Organizations" : "Accounts" : context?.role === "coach" && request.from === "dashboard" ? "Team dashboard" : "Organization"}</Link>
      <button className="quiet-button" onClick={() => { void auth.signOut().catch(failure => setError(failure.message || "Sign out failed. Try again.")); }}>Sign out</button>
    </header>
    <main className="insights-shell">
      <section className="insights-heading"><p className="eyebrow">Team Insights</p><h1>{insights?.teamName || context?.organization?.name || "Team Insights"}</h1>
        <p>Review recording activity and weekly best metrics for your current team.</p></section>
      {error && <div className="insights-message error" role="alert"><p>{error}</p><button className="quiet-button" onClick={() => setRetry(value => value + 1)}>Retry Team Insights</button></div>}
      {notice && !error && <p className="insights-note" role="status">{notice}</p>}
      {context && !staff && <section className="insights-card"><h2>Team Insights are for club staff</h2><p>Access requires a current club manager or assigned coach membership.</p>
        <Link className="quiet-button" to="/organization">Open organization</Link>{context.role === "player" ? <Link className="primary-cta" to="/athlete">Open your athlete profile</Link> : <Link className="quiet-button" to="/roster?userType=coach">Independent coach roster</Link>}</section>}
      {staff && scope && <section className="insights-card insights-filters">
        {(context.role === "admin" || context.organizations.length > 1) && <label>Organization<select value={scope.orgId} onChange={event => choose(event.target.value, "")}><option value="">Choose an organization</option>{context.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
        <label>Team<select value={scope.teamId} disabled={!context.teams.length} onChange={event => choose(scope.orgId, event.target.value)}>{context.teams.length ? context.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>) : <option value="">No accessible teams</option>}</select></label>
        <label>Period<select value={request.weeks} onChange={event => choose(scope.orgId, scope.teamId, Number(event.target.value))}>{weekOptions.map(count => <option key={count} value={count}>Last {count} weeks</option>)}</select></label>
        <button type="button" className="quiet-button" disabled={loading} onClick={() => setRetry(value => value + 1)}>Refresh</button>
      </section>}
      {staff && scope?.limited && <p className="insights-note" role="status">The organization service reached a display limit. Some organizations, teams or players may be unavailable in this selector.</p>}
      {staff && !context.teams.length && <p className="insights-note">No current teams are available to this account in this organization.</p>}
      {loading && <p role="status">Loading Team Insights…</p>}
      {insights && !loading && <InsightsReport key={`${insights.teamId}:${insights.generatedAtMillis}`} insights={insights}
        playerLink={id => insightsPlayerLink(context?.role, id, current)} />}
    </main>
  </div>;
}
