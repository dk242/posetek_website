import { describe, expect, it } from 'vitest';
import { EngagementClock, appendInterval, featureForLocation, validSavedBatch } from './clock';

describe('estimated engagement clock', () => {
  it('clips ordinary use at two minutes and restarts only on interaction', () => {
    const c = new EngagementClock(0, 1000000); c.configure(true, 'results');
    let total = 0;
    for (let i = 1; i <= 180; i++) { for (const r of c.sample(i * 1000, 1000000 + i * 1000)) total += r.endedAtMillis - r.startedAtMillis; }
    expect(total).toBe(120000);
    c.interact(180000); expect(c.sample(181000, 1181000)).toEqual([{ startedAtMillis: 1180000, endedAtMillis: 1181000, feature: 'results' }]);
  });
  it('drops suspension, wall-clock jumps and hidden time', () => {
    const c = new EngagementClock(0, 1000000); c.configure(true, 'overview');
    expect(c.sample(60000, 1060000)).toEqual([]);
    expect(c.sample(61000, 9999999)).toEqual([]);
    c.configure(false, 'overview'); expect(c.sample(62000, 10000999)).toEqual([]);
    c.configure(true, null); expect(c.sample(63000, 10001999)).toEqual([]);
  });
  it('foreground progressing workouts or videos can extend use; expired signals cannot', () => {
    const c = new EngagementClock(0, 0); c.configure(true, 'training');
    c.sample(200000, 200000); c.progress('workout', 200000);
    expect(c.sample(201000, 201000)[0]?.feature).toBe('workout');
    c.stopProgress(); expect(c.sample(202000, 202000)).toEqual([]);
    c.progress('video', 202000); c.configure(false, 'training'); expect(c.sample(203000, 203000)).toEqual([]);
  });
  it('keeps workout priority over video regardless of signal order and partitions expired tails', () => {
    const c = new EngagementClock(0, 0); c.configure(true, 'training');
    c.progress('workout', 0); c.progress('video', 500);
    expect(c.sample(2500, 2500)).toEqual([
      { startedAtMillis: 0, endedAtMillis: 1500, feature: 'workout' },
      { startedAtMillis: 1500, endedAtMillis: 2000, feature: 'video' },
      { startedAtMillis: 2000, endedAtMillis: 2500, feature: 'training' },
    ]);
    c.progress('video', 2500); c.progress('workout', 2500); c.stopProgress('workout');
    expect(c.sample(3000, 3000)).toEqual([{ startedAtMillis: 2500, endedAtMillis: 3000, feature: 'video' }]);
  });
  it('stops an idle passive interval exactly at its deadline without filling the gap', () => {
    const c = new EngagementClock(0, 0); c.configure(true, 'training'); c.sample(200000, 200000);
    c.progress('video', 200000);
    expect(c.sample(202000, 202000)).toEqual([{ startedAtMillis: 200000, endedAtMillis: 201500, feature: 'video' }]);
  });
  it('merges adjacent like features into bounded intervals', () => {
    let rows = [{ startedAtMillis: 0, endedAtMillis: 30000, feature: 'results' as const }];
    rows = appendInterval(rows, { startedAtMillis: 30000, endedAtMillis: 60000, feature: 'results' }) as typeof rows;
    expect(rows).toHaveLength(1);
    expect(appendInterval(rows, { startedAtMillis: 60000, endedAtMillis: 61000, feature: 'results' })).toHaveLength(2);
  });
  it('accepts bounded immutable retry batches and discards expired or altered cached evidence', () => {
    const b = { schemaVersion: 1, sessionId: '00000000-0000-4000-8000-000000000001', sequence: 0, platform: 'web', build: 'web-1', intervals: [{ startedAtMillis: 1000, endedAtMillis: 2000, feature: 'results' }] };
    expect(validSavedBatch(b, 3000)).toBe(true);
    expect(validSavedBatch(b, 72 * 3600000 + 3000)).toBe(false);
    expect(validSavedBatch({ ...b, intervals: [{ ...b.intervals[0], feature: 'private URL' }] }, 3000)).toBe(false);
    expect(validSavedBatch({ ...b, playerId: 'never-submit-selected-athlete' }, 3000)).toBe(false);
    expect(validSavedBatch({ ...b, intervals: [{ ...b.intervals[0], url: '/private' }] }, 3000)).toBe(false);
  });
  it('maps only allowlisted authenticated features and excludes previews and staff pages', () => {
    expect(featureForLocation('/athlete', '?drill=sprint&player=private')).toBe('results');
    expect(featureForLocation('/athlete', '?preview=1')).toBeNull();
    expect(featureForLocation('/athlete', '?share=token')).toBeNull();
    expect(featureForLocation('/admin/accounts', '')).toBeNull();
    expect(featureForLocation('/dashboard', '')).toBeNull();
    expect(featureForLocation('/feed', '')).toBe('feed');
  });
});
