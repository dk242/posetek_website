// Run after `npm --prefix app run build:marketing`, `node scripts/capture-deployed-reference.mjs`,
// `node scripts/serve-homepage-preview.mjs`, and `npm --prefix app run dev -- --port 4175`.
// Chrome is used only against local preview/dev servers; Auth HTTP writes are blocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '../app/node_modules/playwright/index.mjs';

const executablePath = process.env.POSETEK_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
const marketing = process.env.POSETEK_MARKETING_URL || 'http://127.0.0.1:4174';
const application = process.env.POSETEK_APP_URL || 'http://127.0.0.1:4175';

for (const width of [390, 1440]) {
  test(`booking and hero interactions at ${width}px`, async () => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    try {
      await page.goto(marketing + '/bookPerformanceTest.html');
      assert.equal(await page.locator('h1').innerText(), 'Ask about a performance test');
      assert.equal(await page.locator('a[href^="mailto:"]').getAttribute('href'), 'mailto:dylank@posetek.net?subject=PoseTek%20performance%20test%20enquiry');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: marketing });
      await page.locator('#copy-email').click();
      await page.locator('#copy-status').getByText('Email address copied.').waitFor();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'dylank@posetek.net');
      await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('blocked')) } }));
      await page.locator('#copy-email').click();
      await page.locator('#copy-status').getByText('Select the email address above to copy it.').waitFor();
      for (const alias of ['/bookperformancetest', '/bookperformancetest.html']) {
        await page.goto(marketing + alias);
        assert.equal(await page.locator('h1').innerText(), 'Ask about a performance test');
      }
      await page.goto(marketing + '/');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0);
      assert.ok((await page.locator('a[href="/bookPerformanceTest.html"]').count()) >= 2);
      await page.getByRole('button', { name: 'Pause animation' }).click();
      assert.equal(await page.getByRole('button', { name: 'Play animation' }).getAttribute('aria-pressed'), 'true');
      await page.locator('.hero-pose-choices button').first().click();
      assert.equal(await page.locator('.hero-pose-viewer').getAttribute('data-rotating'), 'false');
    } finally { await page.close(); }
  });
}

test('keyboard dialogs keep focus and Escape closes the active layer', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // Block every Auth write. The tests only exercise local modal interactions.
  await page.route(/identitytoolkit\.googleapis\.com/, route => route.abort());
  try {
    await page.goto(application + '/signin');
    await page.getByText('Forgot password?', { exact: true }).click();
    await page.locator('#forgotPasswordModal.active .auth-modal:focus').waitFor();
    assert.equal(await page.locator('#forgotPasswordModal [role="dialog"][aria-modal="true"]').count(), 1);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'closeForgotModal');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'forgotConfirmBtn');
    await page.locator('#forgotEmailInput').fill('synthetic@example.invalid');
    await page.locator('#forgotEmailInput').press('Enter');
    assert.equal(await page.locator('#forgotPasswordModal').getAttribute('class'), 'modal-overlay');
    await page.getByText('Forgot password?', { exact: true }).click();
    await page.locator('#forgotPasswordModal.active .auth-modal:focus').waitFor();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#forgotPasswordModal').getAttribute('class'), 'modal-overlay');

    await page.locator('.account-entry-legacy summary').click();
    await page.getByRole('button', { name: 'Organization-code signup' }).click();
    await page.locator('#firstName').fill('Synthetic');
    await page.locator('#lastName').fill('Tester');
    await page.locator('#signupEmail').fill('synthetic@example.invalid');
    await page.locator('#signupPassword').fill('FakePass123');
    await page.locator('#confirmPassword').fill('FakePass123');
    await page.locator('#userType').selectOption('coach');
    await page.locator('#orgSignupSubmit').click();
    await page.locator('#coachOrgModal.active .auth-modal:focus').waitFor();
    assert.equal(await page.locator('#coachOrgModal [role="dialog"][aria-modal="true"]').count(), 1);
    await page.locator('#coachCreateOrgBtn').click();
    await page.locator('#coachOrgInput').press('Enter');
    assert.match(await page.locator('#coachOrgInputError').innerText(), /Enter|name/i);
    assert.equal(await page.locator('#coachOrgModal').getAttribute('class'), 'modal-overlay active');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#coachOrgModal').getAttribute('class'), 'modal-overlay');
    assert.equal(await page.locator('#signupModal').getAttribute('class'), 'modal-overlay active');
  } finally { await page.close(); }
});

test.after(async () => browser.close());
