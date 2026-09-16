// Read-only capture of a pinned public deployment for local review.
// This never deploys, changes the release baseline, or replaces editable source.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const deploymentId = '6aa9b6f0d8faf6177db8fd97';
const origin = `https://${deploymentId}--posetek.netlify.app`;
const output = resolve(root, '.netlify/deployed-reference', deploymentId);
const queue = ['/index.html', '/application.html', '/bookPerformanceTest.html'];
const seen = new Set(queue);
const manifest = { deploymentId, origin, capturedAt: new Date().toISOString(),
  scope: 'Public homepage and application entry with statically discoverable same-origin assets; compiled output, not original source.',
  files: [], failures: [] };
let totalBytes = 0;

async function fetchPublic(pathname) {
  let url = new URL(pathname, origin);
  for (let attempt = 0; attempt < 5; attempt++) {
    if (url.origin !== origin) throw new Error('Redirect left pinned deployment');
    const response = await fetch(url, { signal: AbortSignal.timeout(30000), redirect: 'manual' });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      url = new URL(response.headers.get('location'), url);
      continue;
    }
    return response;
  }
  throw new Error('Too many redirects');
}

function enqueue(value, parent) {
  if (!value || value.startsWith('data:')) return;
  // Vite preload tables contain paths relative to the configured build base,
  // while direct imports use ./chunk.js relative to the current module.
  if (value.startsWith('assets/') && parent.includes('/assets/')) {
    value = parent.slice(0, parent.indexOf('/assets/') + 1) + value;
  }
  let url;
  try { url = new URL(value, origin + parent); } catch { return; }
  if (url.origin !== origin || !/\.(?:m?js|css|wasm|json|svg|png|jpe?g|webp|ico|woff2?)$/i.test(url.pathname)) return;
  if (url.pathname.includes('..') || seen.has(url.pathname)) return;
  if (seen.size >= 500) throw new Error('Asset count exceeded review limit');
  seen.add(url.pathname);
  queue.push(url.pathname);
}

await mkdir(output, { recursive: true });
while (queue.length) {
  const batch = queue.splice(0, 6);
  await Promise.all(batch.map(async pathname => {
    try {
      const response = await fetchPublic(pathname);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || '';
      if (!pathname.endsWith('.html') && contentType.includes('text/html')) throw new Error('HTML fallback instead of asset');
      totalBytes += bytes.length;
      if (totalBytes > 150 * 1024 * 1024) throw new Error('Review size limit exceeded');
      const target = resolve(output, '.' + decodeURIComponent(pathname));
      const rel = relative(output, target);
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid output path');
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
      manifest.files.push({ path: pathname, size: bytes.length, contentType,
        sha256: createHash('sha256').update(bytes).digest('hex') });
      if (/\.(?:html|m?js|css)$/.test(pathname)) {
        const text = bytes.toString('utf8');
        const strings = /["'`]((?:\.?\.?\/)?(?:[\w.%@+-]+\/)*[\w.%@+-]+\.(?:m?js|css|wasm|json|svg|png|jpe?g|webp|ico|woff2?)(?:\?[^"'`\s]*)?)["'`]/g;
        for (const match of text.matchAll(strings)) {
          // Plain filenames in application strings often name private runtime
          // artifacts, not deployment assets. Capture only built bundle names.
          if (/-[\w-]{8,}\.(?:m?js|css|wasm|json|svg|png|jpe?g|webp|ico|woff2?)(?:\?|$)/.test(match[1])) enqueue(match[1], pathname);
        }
        for (const match of text.matchAll(/(?:src|href)=["']([^"']+)["']/g)) enqueue(match[1], pathname);
        for (const match of text.matchAll(/url\(\s*["']?([^\s)"']+)["']?\s*\)/g)) enqueue(match[1], pathname);
      }
    } catch (error) { manifest.failures.push({ path: pathname, error: error.message }); }
  }));
}
manifest.files.sort((a, b) => a.path.localeCompare(b.path));
manifest.totalBytes = totalBytes;
await writeFile(resolve(output, 'reference-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify({ output, deploymentId, files: manifest.files.length,
  bytes: totalBytes, failures: manifest.failures }, null, 2));
if (manifest.failures.length) process.exitCode = 1;
