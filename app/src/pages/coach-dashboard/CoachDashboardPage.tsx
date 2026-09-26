/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { auth } from '../../lib/firebase';
import { athleteSummary, summarySort } from './lib/logic';
import { loadAthleteBundle, loadCoachContext } from './lib/data';
import type { CoachContext } from './lib/data';
import { PREVIEW_BUNDLES, PREVIEW_PLAYERS } from './lib/preview';
import { athleteLoadFailure, coachPath, createDashboardGuard, loadRosterStates } from './lib/workspace';
import type { AthleteLoad, TeamScope } from './lib/workspace';
import Overview from './views/Overview';
import AthleteDetail from './views/AthleteDetail';
import { dashboardPlayerQuery, insightsLink } from '../insights/lib/navigation';
import '../../styles/pose-portal.css';
import './coach-dashboard.scss';

export default function CoachDashboardPage() {
  const navigate = useNavigate(), [query, setQuery] = useSearchParams();
  const preview = import.meta.env.DEV && query.get('preview') === '1';
  const orgId = query.get('orgId') || undefined, teamId = query.get('teamId') || query.get('team');
  const selectedId = query.get('athlete');
  const [uid, setUid] = useState('');
  const [context, setContext] = useState<CoachContext | null>(null);
  const [loads, setLoads] = useState<Record<string, AthleteLoad>>({});
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0), [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const [guard] = useState(() => createDashboardGuard(() => auth.currentUser?.uid));
  const scope: TeamScope | null = context?.organizationId && context.teamId
    ? { orgId: context.organizationId, teamId: context.teamId } : null;

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [selectedId, teamId]);

  const clear = useCallback(() => {
    guard.cancel(); setContext(null); setLoads({}); setRefreshedAt(null); setLoading(true); setError('');
  }, [guard]);
  const refresh = useCallback(() => { clear(); setRefreshKey(value => value + 1); }, [clear]);

  useEffect(() => {
    document.title = 'My team | PoseTek';
    if (preview) return;
    return auth.onAuthStateChanged(user => {
      clear(); setUid(user?.uid || ''); setRefreshKey(value => value + 1);
      if (!user) navigate('/signin', { replace: true });
    });
  }, [preview, clear, navigate]);

  useEffect(() => {
    clear();
    if (preview) {
      setContext({ coachDoc: null, orgLabel: 'Sample team', players: [...PREVIEW_PLAYERS] });
      setLoads(Object.fromEntries(Object.entries(PREVIEW_BUNDLES).map(([id, bundle]) => [id, { kind: 'ready', bundle }])));
      setLoading(false); setRefreshedAt(new Date()); return;
    }
    if (!uid) return;
    const isCurrent = guard.begin(uid);
    void (async () => {
      try {
        const current = await loadCoachContext({ uid }, teamId, orgId);
        if (!isCurrent()) return;
        setContext(current);
        const result = await loadRosterStates(current.players.map(player => player.id), loadAthleteBundle);
        if (!isCurrent()) return;
        setLoads(result); setRefreshedAt(new Date());
      } catch (failure) {
        if (!isCurrent()) return;
        setContext(null); setLoads({});
        setError(failure instanceof Error ? failure.message : 'Your team could not be loaded.');
      } finally { if (isCurrent()) setLoading(false); }
    })();
    return () => guard.cancel();
  }, [uid, orgId, teamId, preview, refreshKey, clear, guard]);

  async function reloadAthlete(playerId: string) {
    if (preview || !context?.players.some(player => player.id === playerId) || auth.currentUser?.uid !== uid) return;
    const isCurrent = guard.player(uid, playerId);
    setLoads(previous => ({ ...previous, [playerId]: { kind: 'loading' } }));
    try {
      // Retry after edits or failures rechecks current canonical team access.
      const current = await loadCoachContext({ uid }, scope?.teamId || null, scope?.orgId);
      if (!isCurrent()) return;
      if (!current.players.some(player => player.id === playerId)) { refresh(); return; }
      const bundle = await loadAthleteBundle(playerId);
      if (isCurrent()) setLoads(previous => ({ ...previous, [playerId]: { kind: 'ready', bundle } }));
    } catch (failure) {
      if (isCurrent()) setLoads(previous => ({ ...previous, [playerId]: { kind: 'error', message: athleteLoadFailure(failure) } }));
    }
  }

  const summaries = useMemo(() => summarySort((context?.players || []).flatMap(player => {
    const state = loads[player.id];
    if (state?.kind !== 'ready') return [];
    const bundle = state.bundle;
    return [athleteSummary(player, bundle.reps, bundle.plans, bundle.logs, bundle.provisionalEstimates, bundle.allResultReps)];
  })), [context, loads]);

  function prescribe(ids: string[]) {
    if (preview || loading || auth.currentUser?.uid !== uid) return;
    const allowed = ids.filter(id => loads[id]?.kind === 'ready' && context?.players.some(player => player.id === id));
    if (allowed.length) navigate(coachPath('/programs', scope, allowed));
  }
  function selectAthlete(id: string | null) { setQuery(dashboardPlayerQuery(query.toString(), scope, id)); }
  function selectTeam(id: string) {
    if (!context?.organizationId || !context.teams?.some(team => team.id === id)) return;
    const next = new URLSearchParams({ orgId: context.organizationId, teamId: id });
    clear(); setQuery(next);
  }
  const selected = summaries.find(summary => summary.athlete.id === selectedId);
  const selectedPlayer = context?.players.find(player => player.id === selectedId);
  const unavailable = selectedPlayer && loads[selectedPlayer.id];
  const backPath = coachPath('/dashboard', scope);

  return <div className="pt-pose portal-body pt-coachdash">
    <header className="portal-header">
      <Link className="portal-brand" to={backPath} aria-label="PoseTek team dashboard"><span className="portal-brand-mark">P</span><span>POSETEK</span></Link>
      <nav className="coachdash-nav" aria-label="Coach workspace">
        <Link className="quiet-button" to={coachPath('/organization', scope)}>My teams</Link>
        <Link className="quiet-button" to={coachPath('/roster', scope)}>Roster</Link>
        {scope && !preview && <Link className="quiet-button" to={insightsLink(scope, 'dashboard')}>Team Insights</Link>}
      </nav>
      {!preview && <button className="quiet-button coachdash-signout" type="button" onClick={() => {
        clear(); void auth.signOut().then(() => navigate('/signin')).catch(() => { setLoading(false); setError('Sign out failed. Try again.'); });
      }}>Sign out</button>}
    </header>
    <main className="coachdash-shell">
      {preview && <p className="coachdash-notice">Preview · fictional athletes. No account or workout changes are saved.</p>}
      <section className="coachdash-toolbar" aria-label="Team and freshness">
        {context?.teams && <label>My team<select value={context.teamId || ''} disabled={loading} onChange={event => selectTeam(event.target.value)}>
          <option value="" disabled>Choose an assigned team</option>{context.teams.map(team => <option value={team.id} key={team.id}>{team.name}</option>)}
        </select></label>}
        <p className="coachdash-sub">{refreshedAt ? `Checked ${refreshedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · Refresh for latest activity` : 'Current team access is checked when loading.'}</p>
        <button type="button" className="quiet-button" disabled={loading} onClick={refresh}>Refresh team</button>
      </section>
      {loading ? <div className="portal-loading" role="status"><span className="spinner" /><p>Loading your team and player history…</p></div>
        : error ? <section className="error-card" role="alert"><h1>Team unavailable</h1><p>{error}</p><Link className="quiet-button" to="/organization">Open my teams</Link></section>
        : context?.teams && !context.teamId ? <section className="empty-card"><h1>Choose your team</h1><p>{context.teams.length ? 'Select one of your assigned teams above to review its players and training.' : 'No teams are assigned to this account. Ask your organization manager to review your access.'}</p></section>
        : <>
          {context?.limited && <p role="status" className="coachdash-notice">The roster service reached its limit. Team totals may be incomplete; contact PoseTek to review coverage.</p>}
          {selected ? <AthleteDetail key={selected.athlete.id} summary={selected} job={null} preview={preview}
            onBack={() => selectAthlete(null)} onCreatePlan={() => prescribe([selected.athlete.id])}
            onPlanChanged={() => reloadAthlete(selected.athlete.id)} onPreviewEdit={(planId, weeks) => {
              setLoads(previous => {
                const state = previous[selected.athlete.id]; if (state?.kind !== 'ready') return previous;
                return { ...previous, [selected.athlete.id]: { kind: 'ready', bundle: { ...state.bundle,
                  plans: state.bundle.plans.map(plan => plan.id === planId ? { ...plan, weeks } : plan) } } };
              });
            }} />
            : selectedPlayer ? <section className="error-card"><button className="quiet-button" onClick={() => selectAthlete(null)}>Back to team</button>
              <h1>{selectedPlayer.firstName} {selectedPlayer.lastName}</h1><p role="status">{unavailable?.kind === 'error' ? unavailable.message : 'Loading player history…'}</p>
              <button className="quiet-button" disabled={unavailable?.kind === 'loading'} onClick={() => void reloadAthlete(selectedPlayer.id)}>Retry player history</button></section>
            : <><p className="coachdash-scope-note">Your assigned players only · Prescribe a reviewed plan, follow their workouts, then review progress.</p>
              {selectedId && <p role="status" className="coachdash-notice">That player is not in the selected team. Choose a current roster member.</p>}
              <Overview orgLabel={context?.orgLabel || 'My team'} summaries={summaries} players={context?.players || []} loads={loads}
                limited={context?.limited} preview={preview} onSelect={selectAthlete} onRetry={id => void reloadAthlete(id)} onPrescribe={prescribe} />
            </>}
        </>}
    </main>
  </div>;
}
