import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { dirname, resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const source = fileURLToPath(new URL('./', import.meta.url));
const app = '<!doctype html><html><head><script type="module" crossorigin src="/assets/current.js"></script></head><body>Current application</body></html>';
const bridgeBlock = '\n<!-- homepage-navigation:start -->\n<script src="/marketing/home-navigation.js" defer></script>\n<!-- homepage-navigation:end -->\n';
const applicationWithBridge = app.replace('</body>', bridgeBlock + '</body>');
const marketing = '<!doctype html><!-- posetek-marketing-entry --><script type="module" src="/marketing/assets/new.js"></script>';
const coaches = '<!doctype html><!-- posetek-coaches-entry --><title>PoseTek for coaches</title><meta name="description" content="Team-by-team support"><link rel="canonical" href="https://posetek.net/coaches"><script type="module" src="/marketing/assets/coaches.js"></script>';
const sha = bytes => createHash('sha1').update(bytes).digest('hex');

async function fixture(mode, options, run) {
  const directory = await mkdtemp(join(resolve(tmpdir()), 'posetek-production-baseline-'));
  const put = async (file, value) => { const target = join(directory, file); await mkdir(dirname(target), { recursive: true }); await writeFile(target, value); };
  try {
    const modern = mode === 'modern';
    const files = new Map([
      [modern ? '/application.html' : '/index.html', modern ? applicationWithBridge : app],
      ['/assets/current.js', '/* unchanged current application bundle */'],
      ['/bookperformancetest.html', '<!doctype html><form id="bookingForm"></form>'],
    ]);
    if (modern) files.set('/marketing/home-navigation.js', '// current published bridge\n');
    if (options.overlap) files.set(options.overlap, '// do not preserve this marketing file');
    const manifest = {
      deploymentId: 'test-pinned-deployment', url: 'https://pinned.example',
      ...(modern ? { applicationPath: '/application.html' } : {}),
      files: [...files].map(([path, bytes]) => ({ path, sha: sha(bytes), size: Buffer.byteLength(bytes) })),
    };
    await put('deployment/homepage-baseline.json', JSON.stringify(manifest));
    await put('deployment/home-navigation.js', '// local legacy-only bridge\n');
    await put('marketing-dist/index.html', marketing);
    await put('marketing-dist/coaches/index.html', options.missingMarker ? coaches.replace('<!-- posetek-coaches-entry -->', '') : coaches);
    await put('marketing-dist/assets/new.js', '/* new isolated homepage */');
    await put('marketing-dist/assets/coaches.js', '/* new isolated coaches page */');
    await put('app/node_modules/typescript/bin/tsc', '// build tool fixture\n');
    await put('app/node_modules/vite/bin/vite.js', '// build tool fixture\n');
    await put('netlify.toml', '[build]\npublish = "production-dist"\n[[redirects]]\n  from = "/coaches"\n  to = "/coaches/index.html"\n  status = 200\n[[redirects]]\n  from = "/coaches/"\n  to = "/coaches/index.html"\n  status = 200\n[[redirects]]\nfrom = "/*"\nto = "/application.html"\nstatus = 200\n');
    await put('production-dist/guard-sentinel.txt', 'unchanged until guard passes');
    await mkdir(join(directory, 'scripts'), { recursive: true });
    await copyFile(join(source, 'build-production.mjs'), join(directory, 'scripts/build-production.mjs'));
    await copyFile(join(source, 'test-production-entry.cjs'), join(directory, 'scripts/test-production-entry.cjs'));

    const responses = Object.fromEntries([...files].map(([path, bytes]) => ['https://pinned.example' + path, bytes]));
    responses['https://posetek.net/'] = marketing;
    responses['https://posetek.net/application.html'] = options.drift ? applicationWithBridge + '\nchanged' : applicationWithBridge;
    if (options.corrupt) responses['https://pinned.example/assets/current.js'] = 'corrupted bytes';
    await put('mock-fetch.mjs', `const responses = ${JSON.stringify(responses)};
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith('http://127.0.0.1:')) return originalFetch(input, init);
  if (!Object.hasOwn(responses, url)) throw new Error('Unexpected external request: ' + url);
  return new Response(responses[url], { status: 200 });
};\n`);
    const environment = { ...process.env, NODE_OPTIONS: '--import=' + pathToFileURL(join(directory, 'mock-fetch.mjs')).href };
    const execute = (script, args = []) => spawnSync(process.execPath, [join(directory, 'scripts', script), ...args], { cwd: directory, env: environment, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    await run({ directory, files, execute, build: execute('build-production.mjs') });
  } finally {
    // Only remove the exact temporary fixture allocated above.
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('posetek-production-baseline-'));
    await rm(directory, { recursive: true, force: true });
  }
}

test('modern baseline preserves the complete app and bridge without reinjection', async () => {
  await fixture('modern', {}, async ({ directory, files, execute, build }) => {
    assert.equal(build.status, 0, build.stderr);
    for (const [path, bytes] of files) assert.equal(await readFile(join(directory, 'production-dist', path.slice(1)), 'utf8'), bytes);
    assert.equal(await readFile(join(directory, 'production-dist/index.html'), 'utf8'), marketing);
    assert.equal(await readFile(join(directory, 'production-dist/coaches/index.html'), 'utf8'), coaches);
    const checks = execute('test-production-entry.cjs', ['--http-only']);
    assert.equal(checks.status, 0, checks.stderr);
  });
});

test('legacy baseline still remaps the app index and adds one navigation bridge', async () => {
  await fixture('legacy', {}, async ({ directory, execute, build }) => {
    assert.equal(build.status, 0, build.stderr);
    assert.equal(await readFile(join(directory, 'production-dist/application.html'), 'utf8'), applicationWithBridge);
    assert.equal(await readFile(join(directory, 'production-dist/marketing/home-navigation.js'), 'utf8'), '// local legacy-only bridge\n');
    const checks = execute('test-production-entry.cjs', ['--http-only']);
    assert.equal(checks.status, 0, checks.stderr);
  });
});

test('modern live-app drift stops before modifying the output', async () => {
  await fixture('modern', { drift: true }, async ({ directory, build }) => {
    assert.notEqual(build.status, 0);
    assert.match(build.stderr, /Production application changed/);
    assert.equal(await readFile(join(directory, 'production-dist/guard-sentinel.txt'), 'utf8'), 'unchanged until guard passes');
  });
});

test('preserved download hash mismatches remain fatal', async () => {
  await fixture('modern', { corrupt: true }, async ({ build }) => {
    assert.notEqual(build.status, 0);
    assert.match(build.stderr, /Baseline checksum mismatch: \/assets\/current.js/);
  });
});

for (const overlap of ['/marketing/assets/stale.js', '/coaches', '/coaches/index.html']) test(`modern preservation cannot overlap ${overlap}`, async () => {
  await fixture('modern', { overlap }, async ({ directory, build }) => {
    assert.notEqual(build.status, 0);
    assert.match(build.stderr, /Preservation baseline overlaps the marketing output/);
    assert.equal(await readFile(join(directory, 'production-dist/guard-sentinel.txt'), 'utf8'), 'unchanged until guard passes');
  });
});

test('coaches output requires its isolated entry marker', async () => {
  await fixture('modern', { missingMarker: true }, async ({ build }) => {
    assert.notEqual(build.status, 0);
    assert.match(build.stderr, /Missing coaches entry marker/);
  });
});
