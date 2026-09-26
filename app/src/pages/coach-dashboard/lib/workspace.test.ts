import { describe, expect, it } from 'vitest';
import { coachPath, createDashboardGuard, loadRosterStates } from './workspace';

describe('coach workspace response isolation', () => {
  it('rejects responses from old teams, newer retries, and changed accounts', () => {
    let uid: string | undefined = 'coach';
    const guard = createDashboardGuard(() => uid), initial = guard.begin('coach');
    const first = guard.player('coach', 'one'), second = guard.player('coach', 'one'), other = guard.player('coach', 'two');
    expect(first()).toBe(false); expect(second()).toBe(true); expect(other()).toBe(true);
    guard.begin('coach'); expect(initial()).toBe(false); expect(second()).toBe(false); expect(other()).toBe(false);
    const next = guard.player('coach', 'one'); uid = 'different'; expect(next()).toBe(false);
    uid = 'coach'; guard.cancel(); expect(next()).toBe(false);
  });
  it('rejects a late successful player read after sign-out', async () => {
    let uid: string | undefined = 'coach'; const guard = createDashboardGuard(() => uid); guard.begin(uid);
    const current = guard.player(uid, 'one');
    const read = Promise.resolve({ plans: ['private'] });
    uid = undefined;
    const saved = await read.then(value => current() ? value : null);
    expect(saved).toBeNull();
  });
  it('represents failed histories separately from confirmed empty histories', async () => {
    const empty = { reps: [], plans: [], logs: [] };
    const result = await loadRosterStates(['empty', 'failed'], async id => { if (id === 'failed') throw Error('offline'); return empty; });
    expect(result.empty).toEqual({ kind: 'ready', bundle: empty });
    expect(result.failed.kind).toBe('error'); expect(result.failed).not.toHaveProperty('bundle');
    expect((await loadRosterStates(['failed'], async () => empty)).failed.kind).toBe('ready');
  });
  it('retains the canonical team in roster, program and dashboard navigation', () => {
    const scope = { orgId: 'club', teamId: 'team-2' };
    expect(coachPath('/roster', scope)).toBe('/roster?orgId=club&teamId=team-2&team=team-2');
    expect(coachPath('/programs', scope, ['p1', 'p2'])).toBe('/programs?orgId=club&teamId=team-2&players=p1%2Cp2');
    expect(coachPath('/dashboard', scope)).toBe('/dashboard?orgId=club&teamId=team-2');
    expect(coachPath('/programs', null, ['legacy'])).toBe('/programs?players=legacy');
  });
});
