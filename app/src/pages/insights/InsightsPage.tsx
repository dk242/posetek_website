import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { auth } from "../../lib/firebase";
import { clubCall, getClubContext } from "../../lib/organization-data";
import type { ClubContext } from "../../lib/organization-data";
import InsightsReport from "./InsightsReport";
import type { ClubInsights } from "./lib/insights";
import "../../styles/pose-portal.css";
import "./insights.scss";

const WEEK_OPTIONS = [4, 8, 12, 26];

export default function InsightsPage() {
  const navigate = useNavigate();
  const [context, setContext] = useState<ClubContext | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [weeks, setWeeks] = useState(8);
  const [insights, setInsights] = useState<ClubInsights | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const generation = useRef(0);

  const loadContext = useCallback(async (id?: string) => {
    const request = ++generation.current;
    setError(""); setLoading(false);
    try {
      const result = await getClubContext(id);
      if (request !== generation.current) return;
      setContext(result); setInsights(null);
      setOrganizationId(result.organization?.id || "");
      setTeamId(current => result.teams.some(team => team.id === current) ? current : result.teams[0]?.id || "");
      setReloadKey(key => key + 1);
    } catch (failure) {
      if (request === generation.current) setError(failure instanceof Error ? failure.message : "Your organization could not be loaded.");
    }
  }, []);

  useEffect(() => {
    document.title = "Insights | PoseTek";
    const stop = auth.onAuthStateChanged(user => {
      ++generation.current;
      setContext(null); setOrganizationId(""); setTeamId(""); setInsights(null);
      if (!user) { navigate(`/signin?returnTo=${encodeURIComponent("/insights")}`, { replace: true }); return; }
      void loadContext();
    });
    return () => { ++generation.current; stop(); };
  }, [navigate, loadContext]);

  const staff = context?.role === "admin" || context?.role === "manager" || context?.role === "coach";

  useEffect(() => {
    if (!staff || !organizationId || !teamId) return;
    const request = ++generation.current;
    setLoading(true); setError("");
    clubCall<ClubInsights>("getClubInsights", { organizationId, teamId, weeks })
      .then(result => { if (request === generation.current) setInsights(result); })
      .catch(failure => { if (request === generation.current) { setInsights(null); setError(failure instanceof Error ? failure.message : "Insights could not be loaded."); } })
      .finally(() => { if (request === generation.current) setLoading(false); });
  }, [staff, organizationId, teamId, weeks, reloadKey]);

  return <div className="pt-pose portal-body pt-insights">
    <header className="portal-header">
      <Link className="portal-brand" to="/organization"><span className="portal-brand-mark">P</span>POSETEK</Link>
      <Link className="quiet-button" to="/organization">Organization</Link>
      <button className="quiet-button" onClick={() => { void auth.signOut().then(() => navigate("/signin")); }}>Sign out</button>
    </header>
    <main className="insights-shell">
      <section className="insights-heading">
        <p className="eyebrow">Team insights</p>
        <h1>{insights?.teamName || context?.organization?.name || "Insights"}</h1>
        <p>Who is recording, how often, and whether each player’s best results are moving the right way.</p>
      </section>

      {error && <p className="insights-message error" role="alert">{error}</p>}
      {!context && !error && <p role="status">Loading…</p>}
      {context && !staff && <section className="insights-card"><h2>Insights are for club staff</h2><p>Ask your club manager for coach access, or open your own results in your athlete profile.</p><Link className="primary-cta" to="/athlete">Open athlete profile</Link></section>}

      {staff && <section className="insights-card insights-filters">
        {(context.role === "admin" || context.organizations.length > 1) && <label>Organization<select value={organizationId} onChange={event => void loadContext(event.target.value || undefined)}><option value="">Choose an organization</option>{context.organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select></label>}
        <label>Team<select value={teamId} disabled={!context.teams.length} onChange={event => setTeamId(event.target.value)}>{context.teams.length ? context.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>) : <option value="">No teams</option>}</select></label>
        <label>Period<select value={weeks} onChange={event => setWeeks(Number(event.target.value))}>{WEEK_OPTIONS.map(count => <option key={count} value={count}>Last {count} weeks</option>)}</select></label>
        <button type="button" className="quiet-button" disabled={loading} onClick={() => void loadContext(organizationId || undefined)}>Refresh</button>
      </section>}

      {staff && organizationId && !context.teams.length && <p className="insights-note">This organization has no teams you can view yet.</p>}
      {loading && <p role="status">Loading insights…</p>}
      {insights && !loading && <InsightsReport key={`${insights.teamId}:${insights.weeks.length}`} insights={insights} />}
    </main>
  </div>;
}
