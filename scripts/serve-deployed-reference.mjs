// Local read-only preview of the pinned compiled public reference.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../.netlify/deployed-reference/6aa9b6f0d8faf6177db8fd97/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const filePath = pathname === '/' ? '/index.html'
      : /^\/bookperformancetest\/?$/i.test(pathname) ? '/bookPerformanceTest.html' : pathname;
    let target = resolve(root, '.' + filePath);
    const rel = relative(root, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) { res.writeHead(400); res.end(); return; }
    try { if (!(await stat(target)).isFile()) throw new Error('not file'); }
    catch { if (extname(pathname)) { res.writeHead(404); res.end(); return; } target = resolve(root, 'application.html'); }
    const bytes = await readFile(target);
    res.writeHead(200, { 'Content-Type': types[extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch { res.writeHead(400); res.end(); }
});
server.listen(4173, '127.0.0.1', () => console.log('Deployed PoseTek reference: http://127.0.0.1:4173'));
