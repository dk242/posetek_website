import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import './player.css';

export const PLAYER_TABS = [
  { view: 'home', label: 'Profile', icon: 'person' },
  { view: 'aiCoach', label: 'AI Coach', icon: 'auto_awesome' },
  { view: 'drills', label: 'Drills', icon: 'sports_soccer' },
  { view: 'training', label: 'Training', icon: 'fitness_center' },
  { view: 'feed', label: 'Community', icon: 'groups' },
  { view: 'leaderboards', label: 'Standings', icon: 'leaderboard' },
] as const;

/** Only social route context crosses from the player portal into Community. */
export function communityPath(search = '', pathname = '/feed') {
  const source = new URLSearchParams(search), next = new URLSearchParams();
  for (const key of ['preview', 'organizationId', 'viewAsPlayerId', 'activity', 'connect', 'panel']) {
    const value = source.get(key);
    if (value) next.set(key, value);
  }
  return `${pathname}${next.size ? `?${next}` : ''}`;
}

export function playerTabPath(view: string, search = '', pathname = '/athlete') {
  const fromCommunity = pathname === '/feed' || pathname === '/feed.html';
  if (view === 'feed') return communityPath(search, fromCommunity ? pathname : '/feed');
  // Admin athlete previews never become self-player navigation.
  if (fromCommunity && new URLSearchParams(search).has('viewAsPlayerId')) return communityPath(search, pathname);
  const params = fromCommunity ? new URLSearchParams() : new URLSearchParams(search);
  params.set('view', view);
  if (fromCommunity && new URLSearchParams(search).get('preview') === '1') params.set('preview', '1');
  for (const key of ['drill', 'session', 'rep']) params.delete(key);
  return `${fromCommunity ? '/athlete' : pathname}?${params}`;
}

type PlayerShellProps = {
  activeView: string;
  children: ReactNode;
  search?: string;
  pathname?: string;
  onNavigate?: (view: string) => void;
  onSignOut?: () => void;
  navigationDisabled?: boolean;
  className?: string;
  mainClassName?: string;
};

export default function PlayerShell({ activeView, children, search = '', pathname = '/athlete', onNavigate, onSignOut, navigationDisabled = false, className = '', mainClassName = '' }: PlayerShellProps) {
  const navigate = (event: MouseEvent<HTMLAnchorElement>, view: string) => {
    if (navigationDisabled) { event.preventDefault(); return; }
    if (onNavigate && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      event.preventDefault(); onNavigate(view);
    }
  };
  return <div className={`pt-pose pt-player${className ? ` ${className}` : ''}`}>
    <header className="player-header">
      <Link className="player-wordmark" to={playerTabPath('home', search, pathname)} aria-label="PoseTek profile" aria-disabled={navigationDisabled || undefined} onClick={event => navigate(event, 'home')}>POSETEK<span>●</span></Link>
      <span>{PLAYER_TABS.find(tab => tab.view === activeView)?.label}</span>
      {onSignOut && <button className="player-signout" onClick={onSignOut}>Sign out</button>}
    </header>
    <main className={`player-main${mainClassName ? ` ${mainClassName}` : ''}`}>{children}</main>
    <nav className="player-bottom-nav" aria-label="Player tabs">
      {PLAYER_TABS.map(tab => <Link key={tab.view} to={playerTabPath(tab.view, search, pathname)} aria-current={activeView === tab.view ? 'page' : undefined} aria-disabled={navigationDisabled || undefined} onClick={event => navigate(event, tab.view)}>
        <span className="material-symbols-outlined" aria-hidden="true">{tab.icon}</span><span>{tab.label}</span>
      </Link>)}
    </nav>
  </div>;
}
