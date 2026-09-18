import { createContext } from 'react';

export const PLAYER_TABS = [
  { view: 'home', label: 'Profile', icon: 'person.fill' },
  { view: 'aiCoach', label: 'AI Coach', icon: 'brain.head.profile' },
  { view: 'drills', label: 'Drills', icon: 'list.bullet' },
  { view: 'training', label: 'Training', icon: 'calendar.badge.clock' },
  { view: 'feed', label: 'Feed', icon: 'feed' },
] as const;

export const PlayerNavigation = createContext<{ feedUrl: string | null; athleteSearch: string | null }>({ feedUrl: null, athleteSearch: null });

/** Preserve the original athlete target, including the implicit signed-in self.
 * Adding its resolved ID later would change the workspace identity and lose drafts.
 */
export function athleteTabUrl(view: string, preview: boolean, playerId: string | null, savedSearch: string | null) {
  const target = new URLSearchParams(savedSearch ?? '');
  ['drill', 'session', 'rep'].forEach(key => target.delete(key));
  target.set('view', view);
  if (preview) target.set('preview', '1');
  else if (savedSearch === null && playerId) target.set('player', playerId);
  return `/athlete?${target}`;
}
