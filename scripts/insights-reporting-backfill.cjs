"use strict";
// Private manifest import. Only explicit reporting metadata is written; source
// profiles, measurements, workouts and timestamps are never modified.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createInsightsV2 } = require('../functions/insights-v2');
const { playerSegment } = require('../functions/athlete-storage-paths');
const ROOT = path.resolve(__dirname, '..');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const sha = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
function requireThat(value, message) { if (!value) throw new Error(message); }
function privatePath(value) {
  const resolved = path.resolve(ROOT, value), relative = path.relative(path.join(ROOT, '.netlify'), resolved);
  requireThat(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Use a private ignored .netlify path');
  execFileSync('git', ['check-ignore', '--quiet', '--', resolved], { cwd: ROOT }); return resolved;
}
function validateManifest(manifest) {
  requireThat(manifest.schemaVersion === 1 && manifest.project === 'kickai-69dd0' && /^[a-f0-9]{64}$/.test(manifest.sourceSha256), 'Invalid reporting source');
  requireThat(Array.isArray(manifest.players) && manifest.players.length > 0 && manifest.players.length <= 200, 'Invalid roster bound');
  requireThat(new Set(manifest.players.map(p => p.id)).size === manifest.players.length, 'Duplicate reporting identities');
  for (const p of manifest.players) requireThat(playerSegment(p.id) && playerSegment(p.organizationId) && (p.teamId === null || playerSegment(p.teamId))
    && typeof p.include === 'boolean' && ['boys', 'girls', 'unknown'].includes(p.division), 'Invalid reporting row');
  return manifest;
}
function reportingFor(manifest, p) {
  return { schemaVersion: 1, include: p.include, division: p.division,
    provenance: { source: 'verified-testing-roster', sourceSha256: manifest.sourceSha256, auditDate: manifest.auditDate } };
}
async function run({ db, bucket, HttpsError, manifest, mode, receiptPath }) {
  validateManifest(manifest);
  const digest = sha(manifest), refs = manifest.players.map(p => db.collection('players').doc(p.id));
  const reportingRefs = refs.map(r => r.collection('insightMetadata').doc('reporting'));
  const read = () => JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  const write = data => { fs.mkdirSync(path.dirname(receiptPath), { recursive: true }); fs.writeFileSync(receiptPath, JSON.stringify(data, null, 2)); };
  const time = snap => snap.updateTime ? `${snap.updateTime.seconds}:${snap.updateTime.nanoseconds}` : null;
  if (mode === 'dry-run') {
    requireThat(!fs.existsSync(receiptPath), 'Use a new receipt path');
    const players = await Promise.all(refs.map(r => r.get())), before = await Promise.all(reportingRefs.map(r => r.get()));
    players.forEach((p, i) => requireThat(p.exists && p.data().organizationId === manifest.players[i].organizationId && (p.data().teamId || null) === manifest.players[i].teamId, 'Canonical roster changed'));
    const receipt = { schemaVersion: 1, manifestSha256: digest, state: 'prepared', preparedAt: new Date().toISOString(),
      before: before.map((d, i) => ({ id: refs[i].id, exists: d.exists, data: d.data() || null, updateTime: time(d), profileUpdateTime: time(players[i]) })),
      desired: manifest.players.map(p => ({ id: p.id, data: reportingFor(manifest, p) })) };
    write(receipt); return { prepared: true, rows: manifest.players.length, included: manifest.players.filter(p => p.include).length, remoteMutations: 0 };
  }
  const receipt = read(); requireThat(receipt.manifestSha256 === digest, 'Manifest changed since preparation');
  if (mode === 'apply' && receipt.state === 'prepared') {
    await db.runTransaction(async tx => {
      const players = await Promise.all(refs.map(r => tx.get(r))), current = await Promise.all(reportingRefs.map(r => tx.get(r)));
      for (let i = 0; i < refs.length; i++) {
        requireThat(players[i].exists && time(players[i]) === receipt.before[i].profileUpdateTime && players[i].data().organizationId === manifest.players[i].organizationId && (players[i].data().teamId || null) === manifest.players[i].teamId, 'Player changed since dry-run');
        requireThat(current[i].exists === receipt.before[i].exists && time(current[i]) === receipt.before[i].updateTime && sha(current[i].data() || null) === sha(receipt.before[i].data), 'Reporting metadata changed since dry-run');
      }
      receipt.desired.forEach((row, i) => tx.set(reportingRefs[i], row.data));
    });
    receipt.state = 'applied'; receipt.appliedAt = new Date().toISOString(); write(receipt);
  }
  if (mode === 'rollback') {
    requireThat(receipt.state === 'applied' || receipt.state === 'verified', 'Receipt is not applied');
    await db.runTransaction(async tx => {
      const current = await Promise.all(reportingRefs.map(r => tx.get(r)));
      current.forEach((doc, i) => requireThat(doc.exists && sha(doc.data()) === sha(receipt.desired[i].data), 'Newer reporting metadata prevents rollback'));
      receipt.before.forEach((row, i) => row.exists ? tx.set(reportingRefs[i], row.data) : tx.delete(reportingRefs[i]));
    });
    receipt.state = 'rolled-back'; write(receipt); return { rolledBack: true, rows: refs.length };
  }
  requireThat(['applied', 'verified'].includes(receipt.state), 'Apply the reviewed metadata before verifying/rebuilding');
  const current = await Promise.all(reportingRefs.map(r => r.get()));
  current.forEach((doc, i) => requireThat(doc.exists && sha(doc.data()) === sha(receipt.desired[i].data), 'Reporting verification differs'));
  receipt.state = 'verified'; receipt.verifiedAt = new Date().toISOString(); write(receipt);
  if (mode === 'rebuild') {
    const insights = createInsightsV2({ db, bucket, HttpsError });
    for (const p of manifest.players) if (p.include) { await insights.invalidateInsightPlayer(p.id); await insights.rebuildInsightPlayer(p.id); }
    receipt.rebuiltAt = new Date().toISOString(); write(receipt);
  }
  return { verified: true, rows: refs.length, included: manifest.players.filter(p => p.include).length, rebuilt: mode === 'rebuild' };
}
if (require.main === module) (async () => {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, arg, i, all) => i % 2 === 0 ? [...pairs, [arg.replace(/^--/, ''), all[i + 1]]] : pairs, []));
  requireThat(['dry-run', 'apply', 'verify', 'rollback', 'rebuild'].includes(args.mode), 'Choose a supported mode');
  const manifestPath = privatePath(args.manifest), receiptPath = privatePath(args.receipt), credential = privatePath(args['credential-file']);
  const { Firestore } = require('../functions/node_modules/@google-cloud/firestore');
  const { Storage } = require('../functions/node_modules/@google-cloud/storage');
  const { GoogleAuth, OAuth2Client } = require('../functions/node_modules/google-auth-library');
  const session = JSON.parse(fs.readFileSync(credential, 'utf8')); requireThat(session.expires_at > Date.now() + 60000, 'Renew owner session');
  const client = new OAuth2Client(); client.setCredentials({ access_token: session.access_token, expiry_date: session.expires_at });
  const googleAuth = new GoogleAuth({ projectId: 'kickai-69dd0', authClient: client });
  const db = new Firestore({ projectId: 'kickai-69dd0', auth: googleAuth });
  const storage = new Storage({ projectId: 'kickai-69dd0', authClient: googleAuth });
  class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
  const result = await run({ db, bucket: storage.bucket('kickai-69dd0.firebasestorage.app'), HttpsError,
    manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')), mode: args.mode, receiptPath });
  console.log(JSON.stringify(result)); await db.terminate();
})().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { validateManifest, reportingFor, run };
