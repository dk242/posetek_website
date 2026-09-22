"use strict";
// Compose this release from the captured live boundary, never deploy the
// repository's separate, not-yet-released native testing-session rules.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const BASE_COMMIT = 'e0eeac8613499f5402628f46b699d36de35f529b';
const LIVE_PATH = '.netlify/training-expansion/release/live-firestore.rules';
const OUTPUT_PATH = 'deployment/whole-body-firestore.rules';
const BASE_SHA256 = '06dfeabc4d2263f0379669179861e82e1d9165a7c1f13e83277819013173b0d0';
const normalize = text => text.replace(/\r\n/g, '\n');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function readBase() {
  const cached = process.env.TRAINING_BASE_RULES_PATH || '.netlify/training-expansion/release/source-base-firestore.rules';
  const base = normalize(fs.existsSync(cached) ? fs.readFileSync(cached, 'utf8')
    : cp.execFileSync('git', ['show', `${BASE_COMMIT}:firestore.rules`], {encoding: 'utf8'}));
  assert.equal(hash(base), BASE_SHA256, 'Pinned source baseline hash mismatch.');
  return base;
}

function exactlyOnce(text, value, label) {
  const at = text.indexOf(value);
  assert.ok(at >= 0 && text.indexOf(value, at + value.length) === -1, `${label} must occur exactly once; stop and review source drift.`);
  return at;
}

function sliceBetween(base, start, end, label) {
  const begin = exactlyOnce(base, start, label + ' start');
  const finish = exactlyOnce(base, end, label + ' end');
  assert.ok(finish > begin, `${label} is not ordered correctly.`);
  return base.slice(begin, finish);
}

function compose({ base, live, working }) {
  base = normalize(base); live = normalize(live); working = normalize(working);
  const blocks = [
    sliceBetween(base, '    function testingSignedIn() {\n', '    // Reviewed web plans use current authority,', 'native testing helpers'),
    sliceBetween(base, '    // Shared testing-session configuration is server-owned.', '    match /{root}/{doc=**} {', 'native testing collections'),
    sliceBetween(base, '    match /players/{pid}/sessions/{sessionId} {', '    match /players/{pid}/{sub}/{doc=**} {', 'native session links'),
  ];
  function removeUnreleased(text) {
    for (const [index, block] of blocks.entries()) {
      exactlyOnce(text, block, `Unreleased block ${index + 1}`);
      text = text.replace(block, '');
    }
    // These exclusion additions belong to the same unreleased native change.
    // Match only the complete existing list segments, preserving this release's
    // new authoring and start-authorization exclusions on the same lines.
    const rootTokens = ",'testingEvents','testingEventInvites'";
    exactlyOnce(text, rootTokens, 'native root exclusions');
    text = text.replace(rootTokens, '');
    const playerTokens = ",'recordingCounters','sessionRepLinks','sessions'";
    assert.equal(text.split(playerTokens).length - 1, 2, 'Expected exactly two native player exclusions.');
    return text.split(playerTokens).join('');
  }
  assert.equal(removeUnreleased(base), live, 'Captured live rules differ from the verified pre-training baseline. Stop and review release drift.');
  const candidate = removeUnreleased(working);
  for (const marker of ['function testingSignedIn', 'match /testingEvents/', 'match /testingEventInvites/', 'match /players/{pid}/sessions/']) {
    assert.equal(candidate.includes(marker), false, `Unreleased native marker remains: ${marker}`);
  }
  assert.ok(candidate.includes('match /drillCatalogAuthoring/'), 'Training authoring changes are missing.');
  assert.ok(candidate.includes('save_workout_edit'), 'Reviewed manual edit boundary is missing.');
  return { candidate, proof: { schemaVersion: 1, baseCommit: BASE_COMMIT,
    liveSha256: hash(live), baseSourceSha256: hash(base), workingSourceSha256: hash(working), candidateSha256: hash(candidate),
    composition: 'Current training source changes applied to captured live rules, excluding exact unchanged native testing blocks and their fallback exclusions.',
    unreleasedNativeBlocksExcluded: 3, baselineMatchesCapturedLive: true } };
}

function main() {
  const livePath = process.env.TRAINING_LIVE_RULES_PATH || LIVE_PATH;
  const outputPath = process.env.TRAINING_COMPOSED_RULES_PATH || OUTPUT_PATH;
  const sourcePath = process.env.TRAINING_SOURCE_RULES_PATH || 'firestore.rules';
  const base = readBase();
  const { candidate, proof } = compose({base, live: fs.readFileSync(livePath, 'utf8'), working: fs.readFileSync(sourcePath, 'utf8')});
  fs.mkdirSync(path.dirname(outputPath), {recursive: true});
  fs.writeFileSync(outputPath, candidate);
  const receipt = {...proof, livePath, sourcePath, outputPath};
  fs.writeFileSync(outputPath + '.composition.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
}
if (require.main === module) main();
module.exports = { compose, readBase, BASE_COMMIT, LIVE_PATH, OUTPUT_PATH };
