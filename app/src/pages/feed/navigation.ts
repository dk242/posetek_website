export type CommunityPanel = 'feed' | 'people' | 'settings' | 'moderation';

export function communityPanel(search: string): CommunityPanel {
  const params = new URLSearchParams(search), panel = params.get('panel');
  if (panel === 'feed' || panel === 'people' || panel === 'settings' || panel === 'moderation') return panel;
  return params.has('connect') ? 'people' : 'feed';
}

/** Keep aliases and viewer scope intact while changing a Community subview. */
export function communityPanelPath(pathname: string, search: string, panel: CommunityPanel) {
  const params = new URLSearchParams(search);
  if (panel === 'feed') {
    for (const key of ['panel', 'connect', 'activity']) params.delete(key);
  } else params.set('panel', panel);
  return `${pathname}${params.size ? `?${params}` : ''}`;
}

export function communityPersonPath(pathname: string, search: string, playerId: string) {
  const params = new URLSearchParams(search);
  params.set('connect', playerId);
  params.delete('panel');
  params.delete('activity');
  return `${pathname}?${params}`;
}
