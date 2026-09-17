const { test } = require('node:test');
const assert = require('node:assert/strict');
const { FakeFirestore, FakeTimestamp: Timestamp, HttpsError } = require('./test-support/fake-firestore');
const { createInsightUsage, readPlayerUsage, rangesUnion, subtractRanges } = require('./insight-usage');
const NOW = Date.UTC(2026, 8, 17, 12), DAY = 86400000;
const seed = { 'insightSettings/usage': { enabled: true }, 'players/athlete': { authenticationUID: 'auth', organizationId: 'club' } };
const batch = (extra = {}) => ({ schemaVersion: 1, sessionId: '00000000-0000-4000-8000-000000000001', sequence: 0, platform: 'web', build: 'web-1',
  intervals: [{ startedAtMillis: NOW - 60000, endedAtMillis: NOW - 30000, feature: 'results' }], ...extra });
function setup(extra = {}) { const db = new FakeFirestore({ ...seed, ...extra }); return { db, ...createInsightUsage({ db, HttpsError, Timestamp, now: () => NOW }) }; }

test('overlap unions and exclusion retain disjoint active intervals', () => {
  assert.deepEqual(rangesUnion([[10, 20], [0, 15], [20, 30], [50, 60]]), [[0, 30], [50, 60]]);
  assert.deepEqual(subtractRanges([[0, 30]], [[5, 10], [20, 40]]), [[0, 5], [10, 20]]);
});
test('atomic replay accepts identical evidence once and rejects changed sequences', async () => {
  const s = setup();
  const results = await Promise.all([s.recordInsightUsage(batch(), { uid: 'auth' }), s.recordInsightUsage(batch(), { uid: 'auth' })]);
  assert.equal(results.filter(r => r.duplicate).length, 1);
  await assert.rejects(s.recordInsightUsage(batch({ build: 'other' }), { uid: 'auth' }), { code: 'already-exists' });
  const r = await readPlayerUsage(s.db, 'athlete', NOW - DAY, NOW, 'UTC');
  assert.equal(r.totalMillis, 30000); assert.equal(r.featureMillis.results, 30000); assert.equal(r.collected, true);
});
test('quarter-hour summaries preserve exact cross-device and feature unions', async () => {
  const s = setup();
  await s.recordInsightUsage(batch(), { uid: 'auth' });
  await s.recordInsightUsage(batch({ sessionId: '00000000-0000-4000-8000-000000000002', platform: 'ios', intervals: [{ startedAtMillis: NOW - 45000, endedAtMillis: NOW - 15000, feature: 'workout' }] }), { uid: 'auth' });
  const r = await readPlayerUsage(s.db, 'athlete', NOW - 15 * 60000, NOW, 'UTC');
  assert.equal(r.complete, true); assert.equal(r.totalMillis, 45000); assert.equal(r.webMillis, 30000); assert.equal(r.iosMillis, 30000); assert.equal(r.overlapMillis, 15000);
  assert.equal(Object.values(r.featureMillis).reduce((a, b) => a + b, 0), r.totalMillis);
  assert.equal(r.featureMillis.workout, 30000);
  const partial = await readPlayerUsage(s.db, 'athlete', NOW - 55000, NOW - 20000, 'UTC');
  assert.equal(partial.complete, false); assert.equal(partial.totalMillis, 0);
});
test('usage follows canonical self only, never selected player or coach accounts', async () => {
  for (const extra of [{ 'coaches/auth': { userUID: 'auth' } }, { 'coaches/legacy': { userUID: 'auth' } }, { 'organizations/club/members/auth': { role: 'manager' } }, { 'players/duplicate': { userUID: 'auth' } }, { 'players/athlete': { authenticationUID: 'auth', userUID: 'other' } }]) {
    const s = setup(extra); await assert.rejects(s.recordInsightUsage(batch(), { uid: 'auth' }), { code: 'permission-denied' });
    assert.equal([...s.db.docs.keys()].filter(k => k.startsWith('insightUsage')).length, 0);
  }
  await assert.rejects(setup().recordInsightUsage(batch({ playerId: 'athlete' }), { uid: 'auth' }), { code: 'invalid-argument' });
  await assert.rejects(setup().recordInsightUsage(batch(), { uid: 'auth', isAnonymous: true }), { code: 'unauthenticated' });
  await assert.rejects(setup().recordInsightUsage(batch(), { uid: 'auth', email: 'admin@posetek.net', emailVerified: true }), { code: 'permission-denied' });
});
test('disabled collection makes no usage writes; missing historical collection is not zero usage', async () => {
  const s = setup({ 'insightSettings/usage': { enabled: false } });
  assert.deepEqual(await s.recordInsightUsage(batch(), { uid: 'auth' }), { accepted: false, reason: 'disabled' });
  assert.equal((await readPlayerUsage(s.db, 'athlete', NOW - DAY, NOW)).collected, false);
});
test('dates before collection and platform installation remain not collected', async () => {
  const s = setup(); await s.recordInsightUsage(batch(), { uid: 'auth' });
  const historic = await readPlayerUsage(s.db, 'athlete', NOW - DAY, NOW - 60000);
  assert.equal(historic.collected, false); assert.equal(historic.webCollected, false); assert.equal(historic.iosCollected, false);
  const current = await readPlayerUsage(s.db, 'athlete', NOW - DAY, NOW);
  assert.equal(current.webCollected, true); assert.equal(current.iosCollected, false);
});
test('invalid interval ranges, unknown fields/features/policies and excessive payloads are rejected', async () => {
  const s = setup();
  for (const extra of [{ schemaVersion: 2 }, { platform: 'android' }, { sequence: -1 }, { sessionId: '../a' }, { build: 'private url/' }, { dailyLimitPolicy: 'unlimited' }, { intervals: [] }, { intervals: Array.from({ length: 61 }, () => batch().intervals[0]) },
    ...[{ startedAtMillis: NOW - 3 * DAY - 1 }, { endedAtMillis: NOW + 60001 }, { endedAtMillis: NOW + 1 }, { endedAtMillis: NOW - 60000 }, { feature: 'private text' }, { url: '/athlete?player=private' }].map(patch => ({ intervals: [{ ...batch().intervals[0], ...patch }] }))]) {
    await assert.rejects(s.recordInsightUsage(batch(extra), { uid: 'auth' }), { code: 'invalid-argument' });
  }
});
test('offline and midnight intervals aggregate into local dates and retain expiry fields', async () => {
  const s = setup(); const midnight = Date.UTC(2026, 8, 17, 7);
  await s.recordInsightUsage(batch({ intervals: [{ startedAtMillis: midnight - 15000, endedAtMillis: midnight + 15000, feature: 'video' }] }), { uid: 'auth' });
  const r = await readPlayerUsage(s.db, 'athlete', NOW - DAY, NOW, 'America/Los_Angeles');
  assert.deepEqual(r.days.map(d => [d.date, d.activeMillis]), [['2026-09-16', 15000], ['2026-09-17', 15000]]);
  assert.equal(r.activeDays, 2); assert.equal(r.returning, true);
  const raw = [...s.db.docs.entries()].find(([k]) => k.startsWith('insightUsageIntervals/'))[1];
  assert.equal(raw.expiresAt.toMillis(), NOW + 90 * DAY);
});
test('burst limits are bounded while duplicate acknowledgements remain available', async () => {
  const s = setup(); for (let i = 0; i < 12; i++) await s.recordInsightUsage(batch({ sequence: i }), { uid: 'auth' });
  assert.equal((await s.recordInsightUsage(batch(), { uid: 'auth' })).duplicate, true);
  await assert.rejects(s.recordInsightUsage(batch({ sequence: 12 }), { uid: 'auth' }), { code: 'resource-exhausted' });
});

test('exact detail expires after 90 days while aggregate-only summaries retain 24 months', async () => {
  const s = setup(); await s.recordInsightUsage(batch(), { uid: 'auth' });
  const dayKey = 'insightUsageDays/athlete/insightUsageDaily/2026-09-17';
  const detailKey = 'insightUsageDays/athlete/insightUsageDetailDays/2026-09-17';
  const summary = s.db.snapshot(dayKey), detail = s.db.snapshot(detailKey);
  assert.equal(detail.expiresAt.toMillis(), Date.UTC(2026, 8, 17) + 90 * DAY);
  assert.equal(summary.expiresAt.toMillis(), Date.UTC(2028, 8, 17));
  assert.deepEqual(Object.keys(summary).sort(), ['binMinutes', 'bins', 'expiresAt', 'schemaVersion', 'updatedAtMillis']);
  assert.equal(summary.schemaVersion, 2); assert.equal(summary.binMinutes, 15);
  assert.equal(summary.bins.length, 1); assert.equal(summary.bins[0].index, 47);
  assert.deepEqual(Object.keys(summary.bins[0]).sort(), ['featureMillis', 'index', 'iosMillis', 'overlapMillis', 'totalMillis', 'webMillis']);
  const stored = JSON.stringify(summary);
  for (const prohibited of ['startedAtMillis', 'endedAtMillis', 'channels', 'sessionId', 'intervals', 'sequence']) assert.equal(stored.includes(prohibited), false);
  assert.equal(Array.isArray(detail.channels.web_results), true);
  const before = await readPlayerUsage(s.db, 'athlete', NOW - DAY, NOW, 'UTC');
  s.db.docs.delete(detailKey);
  for (const key of [...s.db.docs.keys()]) if (key.startsWith('insightUsageIntervals/')) s.db.docs.delete(key);
  const after = await readPlayerUsage(s.db, 'athlete', NOW - DAY, NOW, 'UTC');
  assert.deepEqual(after, before); assert.equal(after.totalMillis, 30000);
  assert.equal(s.db.queries.some(q => q.path.includes('insightUsageDetailDays')), false);
});

test('UTC bins report exact local-day totals in whole-hour and quarter-hour time zones', async () => {
  const s = setup(), midnightNepal = Date.UTC(2026, 8, 16, 18, 15);
  await s.recordInsightUsage(batch({ intervals: [{ startedAtMillis: midnightNepal - 10000, endedAtMillis: midnightNepal + 20000, feature: 'results' }] }), { uid: 'auth' });
  await s.recordInsightUsage(batch({ sequence: 1, platform: 'ios', intervals: [{ startedAtMillis: midnightNepal - 5000, endedAtMillis: midnightNepal + 10000, feature: 'workout' }] }), { uid: 'auth' });
  const nepal = await readPlayerUsage(s.db, 'athlete', NOW - DAY, NOW, 'Asia/Kathmandu');
  assert.equal(nepal.complete, true); assert.equal(nepal.totalMillis, 30000); assert.equal(nepal.overlapMillis, 15000);
  assert.deepEqual(nepal.days.map(d => [d.date, d.activeMillis]), [['2026-09-16', 10000], ['2026-09-17', 20000]]);
  for (const zone of ['America/Los_Angeles', 'America/Denver', 'America/Chicago', 'America/New_York', 'UTC']) {
    const r = await readPlayerUsage(s.db, 'athlete', NOW - DAY, NOW, zone);
    assert.equal(r.complete, true); assert.equal(r.totalMillis, 30000); assert.equal(r.overlapMillis, 15000);
    assert.deepEqual(r.days.map(d => [d.date, d.activeMillis]), [['2026-09-16', 30000]]);
  }
});

test('DST transitions preserve durations and local dates without a 24-hour-day assumption', async () => {
  const clock = Date.UTC(2026, 2, 9, 12), transition = Date.UTC(2026, 2, 8, 10);
  const db = new FakeFirestore(seed), api = createInsightUsage({ db, HttpsError, Timestamp, now: () => clock });
  await api.recordInsightUsage(batch({ intervals: [{ startedAtMillis: transition - 15000, endedAtMillis: transition + 15000, feature: 'video' }] }), { uid: 'auth' });
  const r = await readPlayerUsage(db, 'athlete', Date.UTC(2026, 2, 8, 8), Date.UTC(2026, 2, 9, 7), 'America/Los_Angeles');
  assert.equal(r.complete, true); assert.equal(r.totalMillis, 30000); assert.deepEqual(r.days.map(d => [d.date, d.activeMillis]), [['2026-03-08', 30000]]);
});

test('today includes a terminal bin only when server-clamped evidence predates the report cutoff', async () => {
  const clock = NOW + 7 * 60000, db = new FakeFirestore(seed), api = createInsightUsage({ db, HttpsError, Timestamp, now: () => clock });
  await api.recordInsightUsage(batch({ intervals: [{ startedAtMillis: clock - 30000, endedAtMillis: clock + 15000, feature: 'training' }] }), { uid: 'auth' });
  const r = await readPlayerUsage(db, 'athlete', NOW, clock, 'UTC');
  assert.equal(r.complete, true); assert.equal(r.totalMillis, 30000);
  // A snapshot received after a prior query's cutoff cannot be prorated safely.
  const raced = await readPlayerUsage(db, 'athlete', NOW, clock - 1, 'UTC');
  assert.equal(raced.complete, false); assert.equal(raced.totalMillis, 0);
});

test('overlapping later uploads recompute aggregate bins from detail rather than adding totals', async () => {
  const s = setup(); await s.recordInsightUsage(batch(), { uid: 'auth' });
  await s.recordInsightUsage(batch({ sequence: 1, intervals: [{ startedAtMillis: NOW - 45000, endedAtMillis: NOW - 15000, feature: 'video' }] }), { uid: 'auth' });
  const r = await readPlayerUsage(s.db, 'athlete', NOW - DAY, NOW, 'UTC');
  assert.equal(r.totalMillis, 45000); assert.equal(r.featureMillis.results, 15000); assert.equal(r.featureMillis.video, 30000);
  assert.equal(r.latestAtMillis, NOW); // Observation freshness, not an inferred last activity endpoint.
});

test('legacy exact summaries are converted without dropping previous activity', async () => {
  const s = setup({ 'insightUsageDays/athlete/insightUsageDaily/2026-09-17': {
    schemaVersion: 1, channels: { web_results: [{ start: NOW - 90000, end: NOW - 60000 }] }, updatedAtMillis: NOW - 60000,
    expiresAt: Timestamp.fromMillis(Date.UTC(2028, 8, 17)),
  } });
  await s.recordInsightUsage(batch(), { uid: 'auth' });
  const summary = s.db.snapshot('insightUsageDays/athlete/insightUsageDaily/2026-09-17');
  assert.equal(summary.schemaVersion, 2); assert.equal(Object.hasOwn(summary, 'channels'), false);
  assert.equal((await readPlayerUsage(s.db, 'athlete', NOW - DAY, NOW, 'UTC')).totalMillis, 60000);
});

test('missing recent detail cannot silently replace an existing aggregate and lose overlap', async () => {
  const s = setup(); await s.recordInsightUsage(batch(), { uid: 'auth' });
  s.db.docs.delete('insightUsageDays/athlete/insightUsageDetailDays/2026-09-17');
  const before = JSON.stringify([...s.db.docs]);
  await assert.rejects(s.recordInsightUsage(batch({ sequence: 1 }), { uid: 'auth' }), { code: 'failed-precondition' });
  assert.equal(JSON.stringify([...s.db.docs]), before);
  assert.equal((await s.recordInsightUsage(batch(), { uid: 'auth' })).duplicate, true);
});

test('expired summaries are excluded and malformed aggregate bins cannot become complete reports', async () => {
  const s = setup(); await s.recordInsightUsage(batch(), { uid: 'auth' });
  const key = 'insightUsageDays/athlete/insightUsageDaily/2026-09-17', original = s.db.snapshot(key);
  s.db.docs.set(key, { ...original, expiresAt: Timestamp.fromMillis(Date.now() - 1) });
  const expired = await readPlayerUsage(s.db, 'athlete', NOW - DAY, NOW, 'UTC');
  assert.equal(expired.totalMillis, 0); assert.equal(expired.activeDays, 0);
  s.db.docs.set(key, { ...original, bins: [{ ...original.bins[0], overlapMillis: 1 }] });
  const malformed = await readPlayerUsage(s.db, 'athlete', NOW - DAY, NOW, 'UTC');
  assert.equal(malformed.complete, false); assert.equal(malformed.totalMillis, 0);
});
