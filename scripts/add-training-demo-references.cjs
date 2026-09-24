// Explicit, idempotent operator update of private filming metadata only.
const fs = require('node:fs'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { cloud, DOCUMENTS, decode, encode } = require('./training-cloud.cjs');
const { validateReferences } = require('../content/training-expansion/build-demo-references.cjs');
const DIR = '.netlify/demo-references-2026-09-22';
const JOURNAL = 'trainingImports/whole-body-demo-references-2026-09-22';
const unpack = d => decode({ mapValue: { fields: d.fields || {} } });
const fields = data => encode(data).mapValue.fields;
const id = d => d.name.split('/').pop();
const save = (name, value) => fs.writeFileSync(`${DIR}/${name}.json`, JSON.stringify(value, null, 2));
const read = name => JSON.parse(fs.readFileSync(`${DIR}/${name}.json`));
function patchesFor(bundle, authors, catalog, at) {
  return bundle.references.map(row => {
    const a = authors.find(d => id(d) === row.drillId), d = catalog.find(d => id(d) === row.drillId);
    assert.ok(a && d, `Missing live draft ${row.drillId}`);
    const author = unpack(a), drill = unpack(d);
    assert.equal(drill.name, row.name); assert.equal(drill.status, 'draft');
    assert.equal(drill.productionBatchId, bundle.productionBatchId);
    assert.equal(author.productionBatchId, bundle.productionBatchId);
    assert.ok(Number.isInteger(author.revision));
    assert.equal(author.demoReferences, undefined, `References already exist on ${row.drillId}; inspect before replacing.`);
    const patch = { demoReferences: row.videos, revision: author.revision + 1, updatedAt: at, updatedBy: 'operator:demo-reference-linking' };
    return { name: a.name, before: a, patch, write: { update: { name: a.name, fields: fields(patch) }, updateMask: { fieldPaths: Object.keys(patch) }, currentDocument: { updateTime: a.updateTime } } };
  });
}
async function verify(c, before, receipt) {
  const [catalog, authors, meta, config] = await Promise.all([c.list('drillCatalog'), c.list('drillCatalogAuthoring'), c.api(`${DOCUMENTS}/drillCatalogMeta/current`), c.api(`${DOCUMENTS}/config/llm`)]);
  const sorted = rows => [...rows].sort((a, b) => a.name.localeCompare(b.name));
  assert.deepEqual(sorted(catalog), sorted(before.catalog), 'Catalog or uploaded media changed; inspect before claiming preservation.');
  assert.deepEqual(meta, before.meta); assert.deepEqual(config, before.config);
  assert.equal(authors.length, before.authors.length);
  for (const previous of before.authors) {
    const current = authors.find(a => a.name === previous.name), change = before.patches.find(p => p.name === previous.name);
    assert.ok(current);
    if (change) assert.deepEqual(unpack(current), { ...unpack(previous), ...change.patch });
    else assert.deepEqual(current, previous);
  }
  const result = { status: 'verified', count: receipt.count, links: receipt.links, catalogRecordsPreserved: catalog.length, catalogVersion: unpack(meta).catalogVersion, privateAuthoringOnly: true, mediaUnchanged: true, reviewStatesPreserved: true, configurationPreserved: true, at: new Date().toISOString(), receipt };
  save('verified', result); console.log(JSON.stringify({ ...result, receipt: undefined }));
}
async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const bytes = fs.readFileSync('content/training-expansion/demo-references.json'), bundle = JSON.parse(bytes);
  validateReferences(bundle, JSON.parse(fs.readFileSync('content/training-expansion/manifest.json')), JSON.parse(fs.readFileSync('content/training-expansion/production-id-map.json')));
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex'), c = await cloud();
  let journal;
  try { journal = unpack(await c.api(`${DOCUMENTS}/${JOURNAL}`)); } catch (e) { if (!e.message.includes(': 404 ')) throw e; }
  if (journal) { assert.equal(journal.sha256, sha256); await verify(c, read('before'), journal); return; }
  const { transaction } = await c.api(`${DOCUMENTS}:beginTransaction`, 'POST', { options: { readWrite: {} } });
  const list = async collectionId => (await c.api(`${DOCUMENTS}:runQuery`, 'POST', { transaction, structuredQuery: { from: [{ collectionId }] } })).filter(r => r.document).map(r => r.document);
  const catalog = await list('drillCatalog'), authors = await list('drillCatalogAuthoring');
  const meta = await c.api(`${DOCUMENTS}/drillCatalogMeta/current?transaction=${encodeURIComponent(transaction)}`);
  const config = await c.api(`${DOCUMENTS}/config/llm?transaction=${encodeURIComponent(transaction)}`);
  const at = new Date().toISOString(), patches = patchesFor(bundle, authors, catalog, at);
  const receipt = { schemaVersion: 1, productionBatchId: bundle.productionBatchId, kind: 'external-demo-references', sha256, count: patches.length, links: bundle.references.reduce((n, r) => n + r.videos.length, 0), at };
  const before = { catalog, authors, meta, config, patches, receipt }; save('before', before);
  if (!process.argv.includes('--apply')) { await c.api(`${DOCUMENTS}:rollback`, 'POST', { transaction }); console.log(JSON.stringify({ status: 'preflight', ...receipt })); return; }
  const writes = [...patches.map(p => p.write), { update: { name: `${DOCUMENTS.replace('https://firestore.googleapis.com/v1/', '')}/${JOURNAL}`, fields: fields(receipt) }, currentDocument: { exists: false } }];
  save('committed', await c.api(`${DOCUMENTS}:commit`, 'POST', { transaction, writes }));
  await verify(c, before, receipt);
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { patchesFor };
