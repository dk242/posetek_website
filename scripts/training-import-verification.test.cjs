'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {verifyImported}=require('./training-import-verification.cjs');
const {encode}=require('./training-cloud.cjs');
const manifest=require('../content/training-expansion/manifest.json');
const document=(collection,id,row)=>({name:`projects/test/databases/(default)/documents/${collection}/${id}`,fields:encode(row).mapValue.fields,createTime:'2026-09-22T00:00:00Z',updateTime:'2026-09-22T00:00:00Z'});
function fixture(){
  const receipt={productionBatchId:manifest.productionBatchId,count:80,manifestSha256:'test-hash',catalogVersionAfter:'1.0.91',existingCount:1,mapping:manifest.drills.map(r=>({manifestId:r.manifestId,drillId:r.proposedDrillId,name:r.drill.name,filmingWeek:r.filmingWeek,category:r.category}))};
  const existing=[document('drillCatalog','OLD-1',{name:'Existing catalog row'})];
  const catalog=[...existing,...manifest.drills.map((r,i)=>document('drillCatalog',receipt.mapping[i].drillId,{...r.drill,drillId:receipt.mapping[i].drillId,productionBatchId:manifest.productionBatchId,catalogVersion:receipt.catalogVersionAfter,updatedBy:'operator:whole-body-import',createdAt:'time',updatedAt:'time'}))];
  const authors=manifest.drills.map((r,i)=>document('drillCatalogAuthoring',receipt.mapping[i].drillId,{...r.authoring,drillId:receipt.mapping[i].drillId,manifestSha256:receipt.manifestSha256,createdAt:'time',updatedAt:'time'}));
  return {receipt,ledger:{receipt,existing},catalog,authors,c:{list:async name=>name==='drillCatalog'?catalog:authors}};
}
test('retry verifies every mapped content and authoring record and preservation ledger',async()=>{
  const f=fixture();const result=await verifyImported(f.c,f.receipt,manifest,f.ledger);
  assert.equal(result.added,80);assert.equal(result.authors,80);assert.equal(result.existingDocumentsUnchanged,true);
});
test('retry refuses a missing draft or modified authoring record',async()=>{
  const f=fixture();f.catalog.pop();await assert.rejects(verifyImported(f.c,f.receipt,manifest,f.ledger),/80 catalog drafts/);
  const g=fixture();g.authors[0].fields.reviewStatus={stringValue:'approved'};await assert.rejects(verifyImported(g.c,g.receipt,manifest,g.ledger),/Imported authoring differs/);
});
test('retry refuses changed prior catalog content without overwriting it',async()=>{
  const f=fixture();f.catalog[0]=document('drillCatalog','OLD-1',{name:'A concurrent edit'});
  await assert.rejects(verifyImported(f.c,f.receipt,manifest,f.ledger),/existing catalog document changed/);
  assert.equal(f.catalog[0].fields.name.stringValue,'A concurrent edit');
});
test('absent local preservation ledger is reported without inventing preservation proof',async()=>{
  const f=fixture();const result=await verifyImported(f.c,f.receipt,manifest,null);
  assert.equal(result.existingDocumentsUnchanged,null);assert.equal(result.preservationCheck,'unavailable-no-saved-preflight');
});
