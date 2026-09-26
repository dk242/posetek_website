import { describe, expect, it } from 'vitest';
import { coachPath, createDashboardGuard, loadRosterStates, streamRosterStates } from './workspace';

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
  it('shows other rows before a slow athlete finishes and bounds large-roster reads to four', async () => {
    let release!: (value: { reps: never[]; plans: never[]; logs: never[] }) => void;
    const slow = new Promise<{ reps: never[]; plans: never[]; logs: never[] }>(done => { release = done; });
    const ids = Array.from({ length: 200 }, (_, index) => `athlete-${index}`);
    const shown: string[] = [];
    let active = 0, maxActive = 0;
    const done = streamRosterStates(ids, async id => {
      active++; maxActive = Math.max(maxActive, active);
      try { return id === 'athlete-0' ? await slow : { reps: [], plans: [], logs: [] }; }
      finally { active--; }
    }, id => { shown.push(id); });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(shown).toHaveLength(199);
    expect(shown).not.toContain('athlete-0');
    expect(maxActive).toBeGreaterThan(1);
    expect(maxActive).toBeLessThanOrEqual(4);
    release({ reps: [], plans: [], logs: [] });
    await done;
    expect(shown).toHaveLength(200);
  });
  it('retains the canonical team in roster, program and dashboard navigation', () => {
    const scope = { orgId: 'club', teamId: 'team-2' };
    expect(coachPath('/roster', scope)).toBe('/roster?orgId=club&teamId=team-2&team=team-2');
    expect(coachPath('/programs', scope, ['p1', 'p2'])).toBe('/programs?orgId=club&teamId=team-2&players=p1%2Cp2');
    expect(coachPath('/dashboard', scope)).toBe('/dashboard?orgId=club&teamId=team-2');
    expect(coachPath('/programs', null, ['legacy'])).toBe('/programs?players=legacy');
  });
});
