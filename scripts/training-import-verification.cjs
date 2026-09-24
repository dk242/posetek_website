'use strict';
const assert = require('node:assert/strict');
const {decode} = require('./training-cloud.cjs');
const unpack = doc => decode({mapValue:{fields:doc.fields || {}}});
const withoutTimestamps = row => Object.fromEntries(Object.entries(row).filter(([key])=>!['createdAt','updatedAt'].includes(key)));

async function verifyImported(c, receipt, manifest, ledger) {
  assert.equal(receipt.productionBatchId, manifest.productionBatchId);
  assert.equal(receipt.count, 80);
  assert.equal(receipt.mapping.length, 80);
  assert.equal(new Set(receipt.mapping.map(m=>m.drillId)).size, 80);
  assert.equal(new Set(receipt.mapping.map(m=>m.manifestId)).size, 80);
  const [catalog,authors] = await Promise.all([c.list('drillCatalog'),c.list('drillCatalogAuthoring')]);
  const byName = new Map(catalog.map(d=>[d.name,d]));
  const byId = new Map(catalog.map(d=>[d.name.split('/').pop(),d]));
  const authorById = new Map(authors.map(d=>[d.name.split('/').pop(),d]));
  const batch = rows => rows.filter(d=>unpack(d).productionBatchId===manifest.productionBatchId);
  assert.equal(batch(catalog).length, 80, 'The imported batch must have all 80 catalog drafts.');
  assert.equal(batch(authors).length, 80, 'The imported batch must have all 80 authoring records.');
  for(const mapping of receipt.mapping) {
    const row=manifest.drills.find(r=>r.manifestId===mapping.manifestId);
    assert.ok(row, `Unknown manifest mapping ${mapping.manifestId}.`);
    assert.equal(mapping.name,row.drill.name);assert.equal(mapping.filmingWeek,row.filmingWeek);assert.equal(mapping.category,row.category);
    const drill=byId.get(mapping.drillId),author=authorById.get(mapping.drillId);
    assert.ok(drill, `Missing imported draft ${mapping.drillId}.`);
    assert.ok(author, `Missing authoring record ${mapping.drillId}.`);
    const expectedDrill={...row.drill,drillId:mapping.drillId,productionBatchId:manifest.productionBatchId,catalogVersion:receipt.catalogVersionAfter,updatedBy:'operator:whole-body-import'};
    const expectedAuthor={...row.authoring,drillId:mapping.drillId,manifestSha256:receipt.manifestSha256};
    assert.deepEqual(withoutTimestamps(unpack(drill)),expectedDrill, `Imported content differs: ${mapping.drillId}.`);
    assert.deepEqual(withoutTimestamps(unpack(author)),expectedAuthor, `Imported authoring differs: ${mapping.drillId}.`);
  }
  if(ledger) {
    assert.equal(ledger.receipt?.manifestSha256,receipt.manifestSha256,'The preservation ledger belongs to a different manifest.');
    assert.deepEqual(ledger.receipt?.mapping,receipt.mapping,'The preservation ledger has a different ID mapping.');
    assert.equal(ledger.receipt?.catalogVersionAfter,receipt.catalogVersionAfter,'The preservation ledger has a different catalog revision.');
    assert.equal(ledger.existing?.length,receipt.existingCount,'The preservation ledger is incomplete.');
    for(const old of ledger.existing) assert.deepEqual(byName.get(old.name),old,'An existing catalog document changed since the import preflight. No existing record is repaired or overwritten.');
  }
  return {receipt,existingDocumentsUnchanged:ledger?true:null,preservationCheck:ledger?'matched-saved-preflight':'unavailable-no-saved-preflight',added:80,authors:80,at:new Date().toISOString()};
}
module.exports={verifyImported};
