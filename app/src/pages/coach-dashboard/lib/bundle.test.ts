import { beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ config: {} as Record<string, unknown> | undefined, reads: [] as string[], failPersonal: false }));
vi.mock('../../../lib/firebase', () => {
  const ref = (path: string): any => ({
    collection: (name: string) => ref(`${path}/${name}`), doc: (id: string) => ref(`${path}/${id}`),
    get: async () => {
      f.reads.push(path);
      if (path === 'config/llm') return { data: () => f.config };
      if (path.endsWith('/personalWorkoutLogs')) {
        if (f.failPersonal) throw Object.assign(Error('denied'), { code: 'permission-denied' });
        return { docs: [{ id: 'personal', data: () => ({ workoutId: 'shared-id', source: 'wrong-stored-value' }) }] };
      }
      return { docs: path.endsWith('/workoutLogs') ? [{ id: 'assigned', data: () => ({ workoutId: 'shared-id', source: 'plan' }) }] : [] };
    },
  });
  return { auth: {}, db: { collection: (name: string) => ref(name) }, cloud: { httpsCallable: () => async () => ({ data: { reps: [] } }) } };
});
vi.mock('../../../lib/organization-data', () => ({ getClubContext: vi.fn() }));
vi.mock('../../../lib/identity', () => ({ findCoach: vi.fn() }));
vi.mock('../../athlete-portal/lib/loaders', () => ({ submitLlmJob: vi.fn() }));
import { loadAthleteBundle } from './data';

beforeEach(() => { f.config = {}; f.reads = []; f.failPersonal = false; });
describe('coach personal-session rollout reads', () => {
  it.each([undefined, {}, { personalWorkoutsEnabled: false }, { personalWorkoutsEnabled: 'true' }])('does not query new rules before the literal flag is enabled (%s)', async config => {
    f.config = config; const bundle = await loadAthleteBundle('player');
    expect(bundle.logs).toHaveLength(1); expect(f.reads).not.toContain('players/player/personalWorkoutLogs');
  });
  it('labels the source by its collection when enabled and preserves assigned sessions', async () => {
    f.config = { personalWorkoutsEnabled: true }; const bundle = await loadAthleteBundle('player');
    expect(bundle.logs.map(log => log.source)).toEqual(['plan', 'personal']);
  });
  it('does not show complete totals when enabled personal history is denied', async () => {
    f.config = { personalWorkoutsEnabled: true }; f.failPersonal = true;
    await expect(loadAthleteBundle('player')).rejects.toThrow('denied');
  });
});
