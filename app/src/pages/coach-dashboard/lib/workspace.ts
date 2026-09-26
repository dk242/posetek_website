import type { AthleteBundle } from './data';

export type AthleteLoad = { kind: 'ready'; bundle: AthleteBundle } | { kind: 'loading' } | { kind: 'error'; message: string };
export type TeamScope = { orgId: string; teamId: string };

/** Team changes, sign-out, and newer retries invalidate every older response. */
export function createDashboardGuard(currentUid: () => string | undefined) {
  let generation = 0;
  const players = new Map<string, number>();
  return {
    cancel() { generation++; players.clear(); },
    begin(uid: string) {
      const token = ++generation; players.clear();
      return () => token === generation && currentUid() === uid;
    },
    player(uid: string, id: string) {
      const scope = generation, token = (players.get(id) || 0) + 1;
      players.set(id, token);
      return () => scope === generation && players.get(id) === token && currentUid() === uid;
    },
  };
}

export function coachPath(path: string, scope: TeamScope | null, playerIds: string[] = []) {
  const query = new URLSearchParams(scope || {});
  if (scope && path === '/roster') query.set('team', scope.teamId);
  if (playerIds.length) query.set('players', playerIds.join(','));
  return path + (query.size ? `?${query}` : '');
}

export function athleteLoadFailure(error: unknown): string {
  const code = String((error as { code?: string })?.code || '').split('/').at(-1);
  return ['permission-denied', 'unauthenticated', 'not-found'].includes(code || '')
    ? 'Access changed. Refresh your team to check the current roster.'
    : 'Player history could not be loaded. Retry to check their plan and activity.';
}

/** Keep incomplete evidence explicit, with bounded parallel reads at roster scale. */
export async function loadRosterStates(ids: string[], load: (id: string) => Promise<AthleteBundle>) {
  const result: Record<string, AthleteLoad> = {};
  await streamRosterStates(ids, load, (id, state) => { result[id] = state; });
  return result;
}

/** Report each completed athlete without waiting for the slowest read. */
export async function streamRosterStates(ids: string[], load: (id: string) => Promise<AthleteBundle>, onState: (id: string, state: AthleteLoad) => void) {
  const result: Record<string, AthleteLoad> = {};
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, ids.length) }, async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try { result[id] = { kind: 'ready', bundle: await load(id) }; }
      catch (error) { result[id] = { kind: 'error', message: athleteLoadFailure(error) }; }
      onState(id, result[id]);
    }
  }));
  return result;
}
