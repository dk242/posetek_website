// Adopt a verified modern production application's complete Netlify file inventory.
// Run only after inspecting the intended deploy and exporting listSiteFiles via CLI.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, isAbsolute, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const deploymentId = process.argv[2];
if (!/^[a-f0-9]{24}$/.test(deploymentId || '')) throw new Error('Pass the reviewed Netlify deployment ID');
const inventoryPath = resolve(root, process.argv[3] || '.netlify/current-production-files.json');
const inventory = JSON.parse(await readFile(inventoryPath, 'utf8'));
const siteId = 'b1ccf990-286c-4367-bb67-ca0d9ea2a020';
if (!Array.isArray(inventory) || inventory.length < 2 || inventory.some(file => file.deploy_id !== deploymentId || file.site_id !== siteId)) {
  throw new Error('Inventory must belong entirely to the reviewed PoseTek deploy');
}
const previousPath = join(root, 'deployment/homepage-baseline.json');
const previous = JSON.parse(await readFile(previousPath, 'utf8'));
const previousFiles = new Map(previous.files.map(file => [file.path, file]));
// Netlify CLI regenerates its protected /netlify.toml artifact for every deploy.
// Preserve user-serving application files here; audit effective config separately.
const platformConfig = inventory.find(file => file.path === '/netlify.toml');
const files = inventory.filter(file => file.path !== '/index.html' && file.path !== '/netlify.toml' && !file.path.startsWith('/marketing/assets/')
  && file.path !== '/coaches' && !file.path.startsWith('/coaches/'))
  .map(file => {
    const previousFile = previousFiles.get(file.path);
    return { path: file.path, sha: file.sha, size: file.size,
      ...(previousFile?.sha === file.sha && previousFile.localPath ? { localPath: previousFile.localPath } : {}) };
  }).sort((a, b) => a.path.localeCompare(b.path));
if (new Set(files.map(file => file.path)).size !== files.length) throw new Error('Duplicate inventory paths');
if (!files.some(file => file.path === '/application.html') || !files.some(file => file.path === '/marketing/home-navigation.js')) {
  throw new Error('Expected the modern application entry and navigation bridge');
}
const url = `https://${deploymentId}--posetek.netlify.app`;
const cache = join(root, 'app/node_modules/.cache/homepage-baseline', deploymentId);
const sha1 = bytes => createHash('sha1').update(bytes).digest('hex');
const matches = (bytes, file) => bytes?.length === file.size && sha1(bytes) === file.sha;
function contained(directory, path) {
  if (!path.startsWith('/') || path.includes('\\')) throw new Error('Invalid inventory path');
  const target = resolve(directory, '.' + path), rel = relative(directory, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Path outside target directory');
  return target;
}
async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
const appEntry = files.find(file => file.path === '/application.html');
if (!matches(await get('https://posetek.net/application.html'), appEntry)) throw new Error('Live application changed since inventory export');
let cursor = 0;
const failures = [];
await Promise.all(Array.from({ length: 6 }, async () => {
  while (cursor < files.length) {
    const file = files[cursor++];
    try {
      const target = contained(cache, file.path);
      let bytes;
      try { bytes = await readFile(target); } catch { /* not cached */ }
      const old = previousFiles.get(file.path);
      if (!matches(bytes, file) && old?.localPath) {
        try {
          const local = await readFile(contained(root, '/' + old.localPath));
          const normalized = Buffer.from(local.toString('utf8').replace(/\r\n/g, '\n'));
          if (matches(local, file)) bytes = local;
          else if (matches(normalized, file)) bytes = normalized;
          if (matches(bytes, file)) file.localPath = old.localPath;
        } catch { /* pinned download remains required */ }
      }
      if (!matches(bytes, file)) bytes = await get(new URL(file.path, url));
      if (!matches(bytes, file)) throw new Error(`Checksum mismatch: ${file.path}`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    } catch (error) { failures.push(String(error.message)); }
  }
}));
if (failures.length) throw new Error(JSON.stringify({ failures }, null, 2));
if (!matches(await get('https://posetek.net/application.html'), appEntry)) throw new Error('Live application changed during capture');
const manifest = { deploymentId, sourceCommit: null, url, applicationPath: '/application.html',
  ...(platformConfig ? { platformConfig: { path: platformConfig.path, sha: platformConfig.sha, size: platformConfig.size,
    note: 'Protected Netlify CLI-generated metadata. Effective redirects and headers must be verified before release; this is not a served application asset.' } } : {}), files };
await writeFile(previousPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ deploymentId, inventoryFiles: inventory.length, preservedFiles: files.length,
  preservedBytes: files.reduce((sum, file) => sum + file.size, 0), applicationSha1: appEntry.sha, excluded: ['/', '/index.html', '/coaches/*', '/marketing/assets/*', '/netlify.toml (CLI-generated metadata)'] }, null, 2));
