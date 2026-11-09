import { chromium, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const base = 'https://replo.id';
const out = 'artifacts/chat-controls-20261109';
const receipt = { url: base, checkedAt: new Date().toISOString(), deploymentCommit: process.argv[2] || '8138cf464', assets: [], views: [] };
const expected = JSON.parse(await readFile('apps/poolday/config/browser-bundle-manifest.json', 'utf8')).bundleHash;
const response = await fetch(base + '/config/browser-bundle-manifest.json', { signal: AbortSignal.timeout(15000) });
assert.equal(response.status, 200);
receipt.bundleHash = (await response.json()).bundleHash;
assert.equal(receipt.bundleHash, expected);
for (const [url, local] of [
  ['ui/pool-home/app.bundle.js', 'apps/poolday/ui/pool-home/app.bundle.js'],
  ['ui/components/control-help.js', 'apps/poolday/ui/components/control-help.js'],
  ['styles/poolday/compositions/conversation.css', 'apps/poolday/styles/poolday/compositions/conversation.css'],
  ['styles/poolday/primitives/surfaces.css', 'apps/poolday/styles/poolday/primitives/surfaces.css'],
  ['vendor/reploid/chat/workspace.js', 'shared/vendor/reploid/chat/workspace.js']
]) {
  const res = await fetch(base + '/' + url, { signal: AbortSignal.timeout(15000) }); assert.equal(res.status, 200);
  const remote = Buffer.from(await res.arrayBuffer()), original = await readFile(local);
  assert.deepEqual(remote, original);
  receipt.assets.push({ path: url, sha256: createHash('sha256').update(remote).digest('hex'), bytes: remote.length });
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  receipt.browser = browser.version();
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1440, height: 844 }, hasTouch: mobile, isMobile: mobile });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-chat-workspace]')).toBeVisible();
    const opener = page.locator('[data-open-model]');
    await expect(opener).toBeEnabled();
    const initialModel = await page.locator('[data-model-digest]').textContent();
    const interact = async locator => mobile ? locator.tap() : locator.click();
    if (!mobile) {
      await opener.focus();
      await expect(page.getByRole('tooltip')).toContainText('Choose model');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('tooltip')).toBeHidden();
    }
    await interact(opener);
    await expect(page.locator('[data-model-picker]')).toBeVisible();
    await expect(page.locator('[data-model-details]')).not.toHaveAttribute('open');
    await expect(page.locator('[data-model-picker-close]')).toBeInViewport();
    const models = await page.locator('.chat-model-choice').allTextContents();
    // Allow the first backdrop composition to settle before retaining the screenshot.
    await page.waitForTimeout(1200);
    const settledModels = await page.locator('.chat-model-choice').allTextContents();
    const pickerSelection = await page.locator('[data-next-model]').inputValue();
    assert.equal(pickerSelection, await page.locator('[data-active-model-select]').inputValue());
    await page.screenshot({ path: `${out}/live-${mobile ? 'phone' : 'desktop'}-picker.png`, fullPage: true });
    await interact(page.locator('[data-model-picker] [data-open-control-help]'));
    await expect(page.locator('[data-control-help]')).toBeVisible();
    await interact(page.locator('[data-close-control-help]'));
    await interact(page.locator('[data-model-picker-close]'));
    await expect(opener).toBeFocused();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 1); assert.deepEqual(errors, []);
    receipt.views.push({ viewport: mobile ? '390x844 with touch emulation' : '1440x844 desktop', initialModel, pickerRows: models.map(x => x.trim()), settledModels: settledModels.map(x => x.trim()), pickerSelection, modelLabel: await page.locator('[data-model-digest]').textContent(), overflow, pageErrors: errors, passed: true });
    await context.close();
  }
} finally { await browser.close(); }
await writeFile(`${out}/live.json`, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ bundleHash: receipt.bundleHash, assets: receipt.assets.length, views: receipt.views.map(x => ({ viewport: x.viewport, passed: x.passed, modelLabel: x.modelLabel })), browser: receipt.browser }));
