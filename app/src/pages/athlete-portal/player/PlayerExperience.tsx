import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { auth, db } from '../../../lib/firebase';
import { DRILLS, drillByKey } from '../lib/drills';
import { accepted, allStatsReps, normalizeRep } from '../lib/metrics';
import type { PortalContext } from '../views/shared';
import DrillDashboard from '../views/DrillDashboard';
import SessionView from '../views/SessionView';
import PlayerProfile from './PlayerProfile';
import PlayerTraining from './PlayerTraining';
import PlayerLeaderboards from './PlayerLeaderboards';
import CoachChat from './CoachChat';
import { defaultDataset, intakeSnapshot, playerProfile } from './scoring';
import type { Row } from './execution';
import './player.css';

export const PLAYER_TABS = [
  { view: 'home', label: 'Profile', icon: 'person' }, { view: 'aiCoach', label: 'AI Coach', icon: 'forum' },
  { view: 'drills', label: 'Drills', icon: 'sports_soccer' }, { view: 'training', label: 'Training', icon: 'fitness_center' },
  { view: 'leaderboards', label: 'Leaderboards', icon: 'leaderboard' },
];
export function playerRoute(search: string) {
  const p = new URLSearchParams(search), raw = p.has('drill') ? 'drills' : p.get('view') || 'home';
  return { view: raw === 'profile' ? 'home' : PLAYER_TABS.some(t => t.view === raw) ? raw : 'home',
    drill: DRILLS.some(d => d.key === p.get('drill')) ? p.get('drill')! : 'shooting', session: p.get('session'), rep: p.get('rep') };
}
export default function PlayerExperience({ ctx, initialReps }: { ctx: PortalContext; initialReps: Record<string, Row[]> }) {
  const location = useLocation(), navigate = useNavigate(), route = playerRoute(location.search);
  const preview = ctx.access === 'preview';
  const [reps, setReps] = useState(initialReps), [athlete, setAthlete] = useState(ctx.athlete), [dataset, setDataset] = useState(defaultDataset);
  const [visited, setVisited] = useState(new Set([route.view])), [request, setRequest] = useState<Row | null>(null), [refreshError, setRefreshError] = useState('');
  useEffect(() => { setVisited(old => new Set([...old, route.view])); }, [route.view]);
  useEffect(() => {
    if (preview) return;
    const player = db.collection('players').doc(ctx.playerId!);
    const stopPlayer = player.onSnapshot(d => { if (d.exists) setAthlete({ ...d.data(), id: d.id }); }, e => setRefreshError(e.message));
    const stopReps = player.collection('reps').onSnapshot(s => {
      const rows = s.docs.map(normalizeRep);
      setReps(old => Object.fromEntries(DRILLS.map(d => [d.key, d.key === 'freeRecord' ? old.freeRecord : rows.filter(r => accepted(r, d))])));
      setRefreshError('');
    }, e => setRefreshError(e.message));
    const stopBenchmarks = db.collection('benchmarks').doc('d1').onSnapshot(d => {
      const value = d.data();
      if (value?.schemaVersion === 1 && value.tier === 'd1' && value.cells && Number.isInteger(value.generation)) setDataset(old => value.generation > old.generation ? value : old);
    }, () => { /* bundled generation remains valid offline */ });
    return () => { stopPlayer(); stopReps(); stopBenchmarks(); };
  }, [ctx.playerId, preview]);
  const all = useMemo(() => allStatsReps(reps), [reps]);
  const profile = useMemo(() => playerProfile(all, athlete, dataset), [all, athlete, dataset]);
  const playerCtx = useMemo(() => ({ ...ctx, athlete, allStatsReps: () => all }), [ctx, athlete, all]);
  const go = (view: string, drill?: string, session?: string, rep?: string) => {
    const params = new URLSearchParams(location.search);
    params.set('view', view); ['drill', 'session', 'rep'].forEach(k => params.delete(k));
    if (drill) params.set('drill', drill); if (session) params.set('session', session); if (rep) params.set('rep', rep);
    navigate({ pathname: location.pathname, search: params.toString() });
    window.scrollTo({ top: 0 });
  };
  const activeDrill = drillByKey(route.drill);
  return <div className="pt-pose pt-player">
    <header className="player-header"><button className="player-wordmark" onClick={() => go('home')} aria-label="PoseTek profile">POSETEK<span>●</span></button><span>{PLAYER_TABS.find(t => t.view === route.view)?.label}</span>{!preview && <button className="player-signout" onClick={() => { void auth.signOut(); }}>Sign out</button>}</header>
    <main className="player-main">
      {preview && <p className="player-preview-note">Local preview · sample data · no account changes</p>}
      {refreshError && <p className="player-error" role="status">Could not refresh your latest results: {refreshError}</p>}
      {route.view === 'home' && <PlayerProfile ctx={playerCtx} profile={profile} onDrills={rep => go('drills', 'shooting', rep ? rep.sessionFolder || `session${rep.sessionNumber}` : undefined, rep?.id)} />}
      {visited.has('aiCoach') && <div hidden={route.view !== 'aiCoach'}><h1>Your AI Coach</h1><CoachChat playerId={ctx.playerId!} preview={preview} onHandoff={r => { setRequest(r); go('training'); }} /></div>}
      {route.view === 'drills' && <section className="player-drills"><p className="eyebrow">Your measured progress</p><h1>Drills</h1><p>Revisit your sessions, see your progress, and watch saved videos.</p><nav className="player-week-rail" aria-label="Drill results">{DRILLS.map(d => <button key={d.key} aria-pressed={d.key === route.drill} onClick={() => go('drills', d.key)}>{d.short || d.label}<small>{reps[d.key]?.length || 0} reps</small></button>)}</nav>
        {route.session ? <SessionView drill={activeDrill} folder={route.session} selectedId={route.rep} reps={reps[activeDrill.key] || []} access={ctx.access} playerId={ctx.playerId} shareToken={null} onBack={() => go('drills', route.drill)} onSelectRep={id => go('drills', route.drill, route.session!, String(id))} /> : <DrillDashboard drill={activeDrill} reps={reps[activeDrill.key] || []} athlete={athlete} onOpenRep={(folder, id) => go('drills', route.drill, folder, String(id))} />}
        <p className="muted-copy">Record and process new drills in the PoseTek app. Video appears here when it was saved to the cloud.</p>
      </section>}
      {visited.has('training') && <div hidden={route.view !== 'training'}><PlayerTraining ctx={playerCtx} statsProfile={intakeSnapshot(profile)} request={route.view === 'training' ? request : null} onAcknowledge={() => setRequest(null)} /></div>}
      {route.view === 'leaderboards' && <PlayerLeaderboards playerId={ctx.playerId!} preview={preview} reps={all} athlete={athlete} dataset={dataset} />}
    </main>
    <nav className="player-bottom-nav" aria-label="Player tabs">{PLAYER_TABS.map(t => <button key={t.view} aria-current={route.view === t.view ? 'page' : undefined} onClick={() => go(t.view, t.view === 'drills' ? route.drill : undefined)}><span className="material-symbols-outlined" aria-hidden="true">{t.icon}</span><span>{t.label}</span></button>)}</nav>
  </div>;
}
