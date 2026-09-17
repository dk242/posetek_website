const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FakeFirestore, HttpsError } = require('../functions/test-support/fake-firestore');
const { validateManifest, run } = require('./insights-reporting-backfill.cjs');
const manifest = { schemaVersion: 1, project: 'kickai-69dd0', sourceSha256: 'a'.repeat(64), auditDate: '2026-09-16',
  players: [{ id: 'synthetic', organizationId: 'club', teamId: 'team', include: true, division: 'girls' }] };
function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'insights-metadata-test-'));
  const db = new FakeFirestore({ 'players/synthetic': { organizationId: 'club', teamId: 'team', firstName: 'Example' },
    'players/synthetic/reps/original': { velocity: 12, createdAt: 'original' } });
  const options = { db, HttpsError, manifest, receiptPath: path.join(directory, 'receipt.json') };
  return { db, options, clean: () => fs.rmSync(directory, { recursive: true, force: true }) };
}
test('metadata import is dry-run, bounded, replay-safe and rollback leaves source records untouched', async () => {
  const { db, options, clean } = setup();
  try {
    const original = db.snapshot('players/synthetic/reps/original');
    await run({ ...options, mode: 'dry-run' }); assert.equal(db.snapshot('players/synthetic/insightMetadata/reporting'), undefined);
    await run({ ...options, mode: 'apply' }); const applied = db.snapshot('players/synthetic/insightMetadata/reporting');
    await run({ ...options, mode: 'apply' }); assert.deepEqual(db.snapshot('players/synthetic/insightMetadata/reporting'), applied);
    await run({ ...options, mode: 'verify' }); await run({ ...options, mode: 'rollback' });
    assert.equal(db.snapshot('players/synthetic/insightMetadata/reporting'), undefined);
    assert.deepEqual(db.snapshot('players/synthetic/reps/original'), original);
    assert.equal(db.snapshot('players/synthetic').firstName, 'Example');
  } finally { clean(); }
});
test('changed ownership or destination metadata stops apply; newer metadata stops rollback', async () => {
  for (const changed of ['ownership', 'metadata']) {
    const { db, options, clean } = setup();
    try {
      await run({ ...options, mode: 'dry-run' });
      if (changed === 'ownership') await db.doc('players/synthetic').update({ teamId: 'other' });
      else await db.doc('players/synthetic/insightMetadata/reporting').set({ division: 'boys' });
      await assert.rejects(run({ ...options, mode: 'apply' }), /changed/);
    } finally { clean(); }
  }
  const { db, options, clean } = setup();
  try {
    await run({ ...options, mode: 'dry-run' }); await run({ ...options, mode: 'apply' });
    await db.doc('players/synthetic/insightMetadata/reporting').update({ division: 'boys' });
    await assert.rejects(run({ ...options, mode: 'rollback' }), /Newer reporting/);
  } finally { clean(); }
});
test('unknown division, duplicate identities and oversized import are refused', () => {
  assert.throws(() => validateManifest({ ...manifest, players: [...manifest.players, ...manifest.players] }), /Duplicate/);
  assert.throws(() => validateManifest({ ...manifest, players: [{ ...manifest.players[0], division: 'inferred' }] }), /Invalid reporting/);
  assert.throws(() => validateManifest({ ...manifest, players: [] }), /bound/);
});
