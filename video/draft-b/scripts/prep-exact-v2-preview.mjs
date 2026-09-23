// Offline, anonymous allowlist for the only private pose used by the six-test grid.
// Original editions and ProductPose.tsx remain unchanged.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bytes=await fs.readFile(path.join(root,'public/product/poses.json'));
const source=JSON.parse(bytes);
const candidates=source.records.filter(r=>r.key==='guy-jump'&&r.kind==='jump');
assert.equal(candidates.length,1,'Expected the previously verified single vertical-jump record');
const sourceRecord=candidates[0];
assert(sourceRecord.fps>0&&sourceRecord.width===720&&sourceRecord.height===1280,'Review source orientation/timing before changing the preview');
assert(sourceRecord.frames.length>0&&sourceRecord.frames.every(frame=>Array.isArray(frame)),'Source frame indices must be preserved');
const fields=['kind','fps','frames','ground','width','height'];
const record={key:'example-jump',...Object.fromEntries(fields.map(k=>[k,sourceRecord[k]]))};
const payload={version:1,records:[record],provenance:{sourceSha256:createHash('sha256').update(bytes).digest('hex'),note:'One anonymous recorded vertical-jump preview. Original points, confidence, null masks and frame timing preserved.'}};
assert.deepEqual(record.frames,sourceRecord.frames);
const serialized=JSON.stringify(payload)+'\n';
assert(!/\b(Guy|Maurizio|Dylan|Niall)\b|storageFolder|playerDocId|repId|downloadTokens/i.test(serialized),'Private data in preview payload');
const output=path.join(root,'public/investor-exact-v2/preview-poses.json');
await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,serialized);
console.log(JSON.stringify({output:path.relative(root,output),records:1,frames:record.frames.length,fps:record.fps,dimensions:[record.width,record.height],sha256:createHash('sha256').update(serialized).digest('hex')},null,2));
