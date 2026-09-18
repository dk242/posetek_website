import { createContext } from 'react';

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
