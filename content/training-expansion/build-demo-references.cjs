// Reference links are private production metadata, separate from the imported manifest.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const DIR = __dirname;
function validateReferences(bundle, manifest, mapping) {
  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.productionBatchId, manifest.productionBatchId);
  assert.equal(bundle.references.length, 80);
  assert.equal(new Set(bundle.references.map(r => r.manifestId)).size, 80);
  for (const row of bundle.references) {
    const exercise = manifest.drills.find(d => d.manifestId === row.manifestId);
    const live = mapping.ids.find(d => d.manifestId === row.manifestId);
    assert.ok(exercise && live, `Unknown exercise ${row.manifestId}`);
    assert.equal(row.drillId, live.drillId); assert.equal(row.name, exercise.drill.name);
    assert.equal(row.filmingWeek, exercise.filmingWeek);
    assert.ok(Array.isArray(row.videos) && row.videos.length >= 1 && row.videos.length <= 3);
    assert.equal(new Set(row.videos.map(v => v.url)).size, row.videos.length);
    for (const video of row.videos) {
      for (const key of ['title', 'publisher', 'matchNotes', 'verification', 'checkedAt']) {
        assert.ok(typeof video[key] === 'string' && video[key].trim() && video[key].length <= 3000, `${row.manifestId}: ${key}`);
      }
      const url = new URL(video.url);
      assert.equal(url.protocol, 'https:'); assert.equal(url.username, ''); assert.equal(url.password, '');
      assert.ok(!/\/results\b|\/search\b/i.test(url.pathname), 'Link the actual demonstration, not search results.');
      assert.ok(['exact', 'component'].includes(video.matchType));
      assert.match(video.checkedAt, /^\d{4}-\d{2}-\d{2}$/);
    }
  }
  return bundle;
}
function build() {
  const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json')));
  const mapping = JSON.parse(fs.readFileSync(path.join(DIR, 'production-id-map.json')));
  const references = ['strength', 'iso-plyo', 'speed-ball'].flatMap(group => JSON.parse(fs.readFileSync(path.join(DIR, `demo-references-${group}.json`))).references)
    .map(row => ({ ...row, filmingWeek: manifest.drills.find(d => d.manifestId === row.manifestId)?.filmingWeek }))
    .sort((a, b) => a.manifestId.localeCompare(b.manifestId));
  const bundle = validateReferences({ schemaVersion: 1, productionBatchId: manifest.productionBatchId, purpose: 'External filming references; not athlete media or content approval.', references }, manifest, mapping);
  fs.writeFileSync(path.join(DIR, 'demo-references.json'), JSON.stringify(bundle, null, 2) + '\n');
  const md = ['# Demo references for filming', '', 'Open the corresponding draft in [PoseTek Admin → Drills](https://posetek.net/admin/drills) and choose **Production & evidence → Watch before filming**.', '',
    'These external videos help you prepare your original PoseTek demonstrations. Follow the PoseTek setup, loading and dose. A **component reference** shows one movement or a related variation; its notes explain what to change. The link checks describe the available verification and are not qualified technique approval.', '',
    'All 80 exercises remain drafts. Reference links do not fill the three required PoseTek video slots or change publication or athlete readiness.', ''];
  for (let week = 1; week <= 4; week++) {
    md.push(`## Week ${week} · 20 drills`, '');
    for (const row of references.filter(r => r.filmingWeek === week)) {
      md.push(`### ${row.drillId} · ${row.name}`, '');
      for (const v of row.videos) {
        md.push(`- [${v.title.replace(/[\[\]]/g, '')}](${v.url}) — ${v.publisher}. ${v.matchType === 'component' ? 'Component reference' : 'Movement reference'}.`, `  ${v.matchNotes}`, `  Check (${v.checkedAt}): ${v.verification}`, '');
      }
    }
  }
  fs.writeFileSync(path.join(DIR, 'DEMO_REFERENCES.md'), md.join('\n').trimEnd() + '\n');
  console.log(JSON.stringify({ drills: references.length, links: references.reduce((n, r) => n + r.videos.length, 0), weeks: [1, 2, 3, 4].map(w => references.filter(r => r.filmingWeek === w).length) }));
}
if (require.main === module) build();
module.exports = { validateReferences };
