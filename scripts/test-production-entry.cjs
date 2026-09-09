// Check the unified production entry, deep links, assets, and signed-out UI.
// Authenticated editing/activation requires a separate authorized account pass.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const httpOnly = process.argv.includes('--http-only');
const root = path.resolve(__dirname, '..'), dist = path.join(root, 'dist');
const out = path.join(root, 'app/node_modules/.cache/planner-entry-tests');
const cases = ['/admin', '/admin/', '/admin/programs', '/admin/programs/personalized?orgId=club&players=p',
  '/admin/organizations', '/admin/accounts', '/admin/accounts/coach/c', '/admin/accounts/player/p',
  '/admin/accounts/player/p/plan/a/workout/w', '/admin/drills', '/admin/drills/d/edit',
  '/admin/analysis', '/admin/analysis/', '/admin/accounts/player/p/results',
  '/admin/accounts/player/p/results/kick', '/admin/accounts/player/p/results/kick/r',
  '/organization', '/athlete', '/administrator'];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const config = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
  assert.match(config, /publish = "dist"/);
  assert.ok(!config.includes('/personalized-app/'), 'Obsolete split-entry rewrite remains');
  let server, browser, base = process.argv.slice(2).find(arg => !arg.startsWith('--'));
  const results = [];
  try {
    if (!base) {
      server = http.createServer((req, res) => {
        const pathname = new URL(req.url, 'http://local').pathname;
        let file = path.resolve(dist, '.' + pathname);
        if (!file.startsWith(dist + path.sep) && file !== dist) { res.writeHead(400); res.end(); return; }
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(dist, 'index.html');
        res.setHeader('Content-Type', { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' }[path.extname(file)] || 'application/octet-stream');
        res.end(fs.readFileSync(file));
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      base = 'http://127.0.0.1:' + server.address().port;
    }
    let entry;
    for (const route of cases) {
      const response = await fetch(base + route), html = await response.text();
      assert.equal(response.status, 200, route);
      const script = html.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1];
      assert.ok(script?.startsWith('/assets/'), 'Unified entry missing: ' + route);
      entry ??= script;
      assert.equal(script, entry, 'Different app served: ' + route);
      assert.ok(!html.includes('personalized-planner-entry:start'));
    }
    let assets = 0;
    for (const file of fs.readdirSync(path.join(dist, 'assets')).filter(file => /\.(js|css)$/.test(file))) {
      const response = await fetch(base + '/assets/' + file);
      assert.equal(response.status, 200, file);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(dist, 'assets', file)), 'Asset mismatch: ' + file);
      assets++;
    }
    if (!httpOnly) {
    const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || require.resolve('playwright', { paths: [path.resolve(__dirname, '../app')] }));
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const width of [1440, 820, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const errors = [], failures = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 400) failures.push(response.url()); });
      for (const route of ['/admin/programs/personalized', '/admin/analysis', '/admin/accounts/player/p/results/kick/r']) {
        await page.goto(base + route, { waitUntil: 'networkidle' });
        await page.getByText('Sign in with your PoseTek account', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Overflow: ' + width + route);
        await page.locator('.portal-brand').click();
        await page.waitForURL('**/admin');
        await page.goBack({ waitUntil: 'networkidle' });
        assert.equal(new URL(page.url()).pathname, route);
      }
      await page.screenshot({ path: path.join(out, 'unified-admin-' + width + '.png'), fullPage: true });
      assert.deepEqual(errors, []); assert.deepEqual(failures, []);
      results.push({ width, signInGates: 3, history: true, overflow: false, errors, failures });
      await page.close();
    }
    }
    const report = { base, routes: cases.length, assets, results, browserChecks: httpOnly ? 'not exercised' : 'passed', authenticatedWorkflows: 'not exercised' };
    fs.writeFileSync(path.join(out, 'production-entry-test-report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally { await browser?.close(); server?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
