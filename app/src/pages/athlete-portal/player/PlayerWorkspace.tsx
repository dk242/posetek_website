import { Activity, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Route, Routes, useLocation, type Location } from 'react-router-dom';
import { auth } from '../../../lib/firebase';
import { PlayerNavigation } from './player-navigation';

const AthletePortalPage = lazy(() => import('../AthletePortalPage'));
const FeedPage = lazy(() => import('../../feed/FeedPage'));
const athletePaths = new Set(['/athlete', '/profile.html']);
export const playerPaths = new Set([...athletePaths, '/feed', '/feed.html']);
export function normalizedPlayerPath(path: string) { return path.replace(/\/+$/, '').toLowerCase(); }

export function playerWorkspaceScope(search: string) {
  const p = new URLSearchParams(search);
  return p.get('preview') === '1' ? 'preview' : JSON.stringify([p.get('player'), p.get('share')]);
}
export function feedWorkspaceScope(search: string) {
  const p = new URLSearchParams(search);
  return JSON.stringify([p.get('organizationId'), p.get('viewAsPlayerId')]);
}

/** Both route families keep their state, while Activity stops hidden subscriptions.
 * Frozen route locations prevent feed query strings from changing a paused workout.
 * Auth identity and explicit athlete targets are separate isolation boundaries.
 */
export default function PlayerWorkspace() {
  const location = useLocation();
  const [uid, setUid] = useState(auth.currentUser?.uid || 'signed-out');
  useEffect(() => auth.onAuthStateChanged(user => setUid(user?.uid || 'signed-out')), []);
  return <WorkspaceSession key={`${uid}:${new URLSearchParams(location.search).get('preview') === '1'}`} location={location} />;
}

function WorkspaceSession({ location }: { location: Location }) {
  const isAthlete = athletePaths.has(normalizedPlayerPath(location.pathname));
  const [athleteLocation, setAthleteLocation] = useState<Location | null>(isAthlete ? location : null);
  const [feedLocation, setFeedLocation] = useState<Location | null>(!isAthlete ? location : null);
  const positions = useRef({ athlete: 0, feed: 0 });
  const active = isAthlete ? 'athlete' : 'feed';
  if (isAthlete && athleteLocation !== location) setAthleteLocation(location);
  if (!isAthlete && feedLocation !== location) setFeedLocation(location);
  useLayoutEffect(() => {
    window.scrollTo({ top: positions.current[active], behavior: 'instant' });
    return () => {
      positions.current[active] = window.scrollY;
      window.dispatchEvent(new Event('posetek:player-route-leave'));
    };
  }, [active]);
  return <PlayerNavigation value={{ feedUrl: feedLocation ? feedLocation.pathname + feedLocation.search : null, athleteSearch: athleteLocation?.search ?? null }}>
    {athleteLocation && <Activity mode={isAthlete ? 'visible' : 'hidden'}>
      <Routes location={athleteLocation}>
        <Route path="*" element={<AthletePortalPage key={playerWorkspaceScope(athleteLocation.search)} />} />
      </Routes>
    </Activity>}
    {feedLocation && <Activity mode={!isAthlete ? 'visible' : 'hidden'}>
      <Routes location={feedLocation}><Route path="*" element={<FeedPage key={feedWorkspaceScope(feedLocation.search)} />} /></Routes>
    </Activity>}
  </PlayerNavigation>;
}
