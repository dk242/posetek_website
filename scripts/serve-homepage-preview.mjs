// Local review only: updated marketing output + the pinned current public app.
// This deliberately does not modify or bypass the production build guard.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const marketing = fileURLToPath(new URL('../marketing-dist/', import.meta.url));
const reference = fileURLToPath(new URL('../.netlify/deployed-reference/6aa9b6f0d8faf6177db8fd97/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };

await stat(resolve(marketing, 'index.html')).catch(() => { throw new Error('Build the homepage first: npm --prefix app run build:marketing'); });
await stat(resolve(reference, 'application.html')).catch(() => { throw new Error('Capture the public reference first: node scripts/capture-deployed-reference.mjs'); });

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let root = reference;
    let filePath = pathname;
    if (pathname === '/' || pathname === '/index.html' || pathname === '/marketing/' || pathname === '/marketing/index.html') {
      root = marketing;
      filePath = '/index.html';
    } else if (pathname.startsWith('/marketing/assets/')) {
      root = marketing;
      filePath = pathname.slice('/marketing'.length);
    } else if (/^\/bookperformancetest\/?$/i.test(pathname)) {
      filePath = '/bookPerformanceTest.html';
    }
    let target = resolve(root, '.' + filePath);
    const rel = relative(root, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel === 'reference-manifest.json') { res.writeHead(400); res.end(); return; }
    try { if (!(await stat(target)).isFile()) throw new Error('not file'); }
    catch {
      if (extname(pathname) || root === marketing) { res.writeHead(404); res.end(); return; }
      target = resolve(reference, 'application.html');
    }
    const bytes = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(400); res.end(); }
});
server.listen(4174, '127.0.0.1', () => console.log('Updated PoseTek homepage: http://127.0.0.1:4174 (local review only)'));
