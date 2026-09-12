// Production HTTP smoke check; deliberately does not claim browser interaction.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] || 'http://127.0.0.1:4173';
const url = new URL(base);
assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname), 'This test is only for localhost.');
const routes = ['home', 'training', 'aiCoach', 'leaderboards', 'drills'].map(view => `/athlete?preview=1&view=${view}`);
routes.push('/athlete?preview=1&drill=sprint&session=session1', '/admin', '/organization', '/coach-dashboard');
const expectedEntry = await readFile(resolve(root, 'dist/index.html'), 'utf8');
for (const route of routes) {
  const response = await fetch(base + route);
  assert.equal(response.status, 200, route);
  assert.equal(await response.text(), expectedEntry, `Built SPA entry mismatch: ${route}`);
}
const assets = (await readdir(resolve(root, 'dist/assets'))).filter(file => /\.(js|css)$/.test(file));
for (const file of assets) {
  const response = await fetch(`${base}/assets/${file}`);
  assert.equal(response.status, 200, file);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(resolve(root, 'dist/assets', file)), `Asset mismatch: ${file}`);
}
console.log(JSON.stringify({ base, routes: routes.length, assets: assets.length, http: 'passed', browserInteraction: 'not exercised', authenticatedWorkflows: 'not exercised' }, null, 2));
