import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { auth, cloud, db } from '../../../lib/firebase';
import { visibleAttempts } from '../../../lib/result-values';
import { parseProvisionalEstimates } from '../../../lib/provisional-estimates';
import { DRILLS, drillByKey } from '../lib/drills';
import { accepted, allStatsReps, fullName, normalizeRep } from '../lib/metrics';
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
import { PlayerNavigation, PLAYER_TABS } from './player-navigation';
import { NativeIcon, NativePlayerTabs, PlayerBrand } from './native-ui';
import PlayerDrillMenu from './PlayerDrillMenu';
import './native-tokens.css';

export { PLAYER_TABS } from './player-navigation';
export function playerRoute(search: string) {
  const p = new URLSearchParams(search), raw = p.get('view') || (p.has('drill') ? 'drills' : 'home');
  const view = raw === 'profile' ? 'home' : raw === 'leaderboards' || PLAYER_TABS.some(t => t.view === raw) ? raw : 'home';
  const drill = view === 'drills' && DRILLS.some(d => d.key === p.get('drill')) ? p.get('drill')! : null;
  return { view, drill, session: drill ? p.get('session') : null, rep: drill ? p.get('rep') : null };
}
export default function PlayerExperience({ ctx, initialReps }: { ctx: PortalContext; initialReps: Record<string, Row[]> }) {
  const location = useLocation(), navigate = useNavigate(), route = playerRoute(location.search);
  const workspace = useContext(PlayerNavigation);
  const shell = useRef<HTMLDivElement>(null);
  const preview = ctx.access === 'preview';
  const [reps, setReps] = useState(initialReps), [athlete, setAthlete] = useState(ctx.athlete), [dataset, setDataset] = useState(defaultDataset);
  const [provisionalEstimates, setProvisionalEstimates] = useState(ctx.provisionalEstimates || []);
  const [visited, setVisited] = useState(new Set([route.view])), [request, setRequest] = useState<Row | null>(null), [refreshError, setRefreshError] = useState('');
  useLayoutEffect(() => {
    const element = shell.current; if (!element) return;
    const measure = () => {
      const header = element.querySelector('.player-header'), nav = element.querySelector('.native-player-tabs');
      const viewport = window.visualViewport, height = viewport?.height || window.innerHeight;
      const headerBottom = header?.getBoundingClientRect().bottom || 64, navHeight = nav?.getBoundingClientRect().height || 80;
      const note = element.querySelector('.player-preview-note')?.getBoundingClientRect().height || 0;
      const error = element.querySelector(':scope > .player-main > .player-error')?.getBoundingClientRect().height || 0;
      element.style.setProperty('--player-viewport-height', `${height}px`);
      element.style.setProperty('--player-header-bottom', `${headerBottom}px`);
      element.style.setProperty('--player-nav-height', `${navHeight}px`);
      element.style.setProperty('--player-content-height', `${Math.max(0, height - headerBottom - navHeight - note - error - 28)}px`);
      element.style.setProperty('--player-keyboard-offset', `${Math.max(0, window.innerHeight - height - (viewport?.offsetTop || 0))}px`);
    };
    const observer = new ResizeObserver(measure);
    for (const target of element.querySelectorAll('.player-header,.native-player-tabs,.player-preview-note,:scope > .player-main > .player-error')) observer.observe(target);
    measure(); window.addEventListener('resize', measure); window.visualViewport?.addEventListener('resize', measure); window.visualViewport?.addEventListener('scroll', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('scroll', measure); };
  }, [route.view, refreshError]);
  useEffect(() => () => { window.dispatchEvent(new Event('posetek:player-route-leave')); }, [location.key]);
  useEffect(() => { setVisited(old => new Set([...old, route.view])); }, [route.view]);
  useEffect(() => {
    if (route.view !== 'feed') return;
    navigate(workspace.feedUrl || (preview ? '/feed?preview=1' : '/feed'), { replace: true });
  }, [route.view, workspace.feedUrl, preview, navigate]);
  useEffect(() => {
    if (preview) return;
    const player = db.collection('players').doc(ctx.playerId!);
    let alive = true, refreshVersion = 0;
    const stopPlayer = player.onSnapshot(d => { if (d.exists) setAthlete({ ...d.data(), id: d.id }); }, e => setRefreshError(e.message));
    const stopReps = player.collection('reps').onSnapshot(() => {
      const version = ++refreshVersion;
      void cloud.httpsCallable('getAthleteEffectiveResults')({ playerId: ctx.playerId }).then(response => {
        if (!alive || version !== refreshVersion) return;
        const payload = response.data as Row;
        const rows = visibleAttempts((payload.reps || []).map(normalizeRep));
        setReps(old => Object.fromEntries(DRILLS.map(d => [d.key, d.key === 'freeRecord' ? old.freeRecord : rows.filter(r => accepted(r, d))])));
        setProvisionalEstimates(parseProvisionalEstimates(payload.provisionalEstimates));
        setRefreshError('');
      }).catch(e => { if (alive && version === refreshVersion) { setProvisionalEstimates([]); setRefreshError(e.message); } });
    }, e => setRefreshError(e.message));
    const stopBenchmarks = db.collection('benchmarks').doc('d1').onSnapshot(d => {
      const value = d.data();
      if (value?.schemaVersion === 1 && value.tier === 'd1' && value.cells && Number.isInteger(value.generation)) setDataset(old => value.generation > old.generation ? value : old);
    }, () => { /* bundled generation remains valid offline */ });
    return () => { alive = false; ++refreshVersion; stopPlayer(); stopReps(); stopBenchmarks(); };
  }, [ctx.playerId, preview]);
  const all = useMemo(() => allStatsReps(reps), [reps]);
  const profile = useMemo(() => playerProfile(all, athlete, dataset), [all, athlete, dataset]);
  const playerCtx = useMemo(() => ({ ...ctx, athlete, provisionalEstimates, allStatsReps: () => all, allResultReps: () => Object.values(reps).flat() }), [ctx, athlete, all, reps, provisionalEstimates]);
  const go = (view: string, drill?: string, session?: string, rep?: string) => {
    window.dispatchEvent(new Event('posetek:player-route-leave'));
    if (view === 'feed') { navigate(workspace.feedUrl || (preview ? '/feed?preview=1' : '/feed')); return; }
    const params = new URLSearchParams(location.search);
    params.set('view', view); ['drill', 'session', 'rep'].forEach(k => params.delete(k));
    if (drill) params.set('drill', drill); if (session) params.set('session', session); if (rep) params.set('rep', rep);
    navigate({ pathname: location.pathname, search: params.toString() });
    window.scrollTo({ top: 0 });
  };
  const activeDrill = route.drill ? drillByKey(route.drill) : null;
  return <div ref={shell} className="pt-pose pt-player" data-player-view={route.view}>
    <header className="player-header"><button className="player-brand-button" onClick={() => go('home')} aria-label="PoseTek profile"><PlayerBrand /></button>{!preview && <button className="player-header-action" onClick={() => { window.dispatchEvent(new Event('posetek:player-route-leave')); void auth.signOut(); }}><NativeIcon name="logout" size={14} /><span>Sign out</span></button>}<button className="player-header-action" onClick={() => go('home')} aria-label="Home"><NativeIcon name="home" size={14} /></button></header>
    <main className="player-main" data-view={route.view}>
      {preview && <p className="player-preview-note">Local preview · sample data · no account changes</p>}
      {refreshError && <p className="player-error" role="status">Could not refresh your latest results: {refreshError}</p>}
      {route.view === 'home' && <PlayerProfile ctx={playerCtx} profile={profile} onDrills={rep => go('drills', 'shooting', rep ? rep.sessionFolder || `session${rep.sessionNumber}` : undefined, rep?.id)} />}
      {visited.has('aiCoach') && <div className="player-tab-panel" hidden={route.view !== 'aiCoach'}><CoachChat playerId={ctx.playerId!} playerName={fullName(athlete)} preview={preview} onHandoff={r => { setRequest(r); go('training'); }} /></div>}
      {route.view === 'drills' && !activeDrill && <PlayerDrillMenu onSelect={key => go('drills', key)} />}
      {route.view === 'drills' && activeDrill && <section className="player-drills">
        {!route.session && <button className="native-drill-back" onClick={() => go('drills')}><NativeIcon name="chevron-left" size={16} />Back to Drills</button>}
        {route.session ? <SessionView drill={activeDrill} folder={route.session} selectedId={route.rep} reps={reps[activeDrill.key] || []} access={ctx.access} playerId={ctx.playerId} shareToken={null} onBack={() => go('drills', activeDrill.key)} onSelectRep={id => go('drills', activeDrill.key, route.session!, String(id))} /> : <DrillDashboard playerMode playerId={ctx.playerId} preview={preview} drill={activeDrill} reps={reps[activeDrill.key] || []} athlete={athlete} onOpenRep={(folder, id) => go('drills', activeDrill.key, folder, String(id))} />}
        {route.session && <p className="muted-copy">Record and process new drills in the PoseTek app. Video appears here when it was saved to the cloud.</p>}
      </section>}
      {visited.has('training') && <div className="player-tab-panel" hidden={route.view !== 'training'}><PlayerTraining ctx={playerCtx} statsProfile={intakeSnapshot(profile)} request={route.view === 'training' ? request : null} onAcknowledge={() => setRequest(null)} /></div>}
      {route.view === 'leaderboards' && <><button className="text-button" onClick={() => go('home')}>← Your profile</button><PlayerLeaderboards playerId={ctx.playerId!} preview={preview} reps={all} athlete={athlete} dataset={dataset} /></>}
    </main>
    <NativePlayerTabs active={route.view} onSelect={view => go(view)} />
  </div>;
}
