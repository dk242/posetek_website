'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {compose, readBase, LIVE_PATH} = require('./compose-training-rules.cjs');
const base = readBase();
const live = fs.readFileSync(LIVE_PATH, 'utf8');
const working = fs.readFileSync('firestore.rules', 'utf8');
test('composition preserves training changes and excludes the unreleased native blocks', () => {
  const result = compose({base, live, working});
  assert.ok(result.candidate.includes('match /drillCatalogAuthoring/'));
  assert.ok(result.candidate.includes('trainingEditCapability'));
  assert.equal(result.candidate.includes('testingEventOperator'), false);
  assert.equal(result.candidate.includes("'sessionRepLinks'"), false);
  assert.equal(result.proof.baselineMatchesCapturedLive, true);
  assert.deepEqual(compose({base, live, working}), result);
});
test('composition rejects live baseline drift', () => {
  assert.throws(() => compose({base, live: live + '\n// unreviewed live change\n', working}), /Captured live rules differ/);
});
test('composition rejects changes to excluded native blocks', () => {
  assert.throws(() => compose({base, live, working: working.replace('function testingSignedIn()', 'function testingSignedInChanged()')}), /Unreleased block 1/);
});
test('composition preserves a later training-only source change', () => {
  const changed = working.replace('match /drillCatalogAuthoring/', '// later training boundary\nmatch /drillCatalogAuthoring/');
  assert.ok(compose({base, live, working: changed}).candidate.includes('// later training boundary'));
});
