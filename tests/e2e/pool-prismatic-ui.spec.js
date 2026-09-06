import { test, expect } from '@playwright/test';

const gpuReady = (page) => expect.poll(async () => page.evaluate(() => ({
  backend: window.REPLOID_POOL_PRISM_STATS?.backend,
  error: window.REPLOID_POOL_PRISM_STATS?.error
})), { timeout: 15000 }).toEqual({ backend: 'webgpu', error: undefined });

const frameCount = (page) => page.evaluate(() => window.REPLOID_POOL_PRISM_STATS.frames);
const settle = (page) => expect.poll(async () => page.evaluate(() => window.REPLOID_POOL_PRISM_STATS.suspended)).toBe(true);
const unchangedFrames = async (page) => {
  const before = await frameCount(page);
  await page.waitForTimeout(200);
  expect(await frameCount(page)).toBe(before);
};

const capturePrismDevice = async (page) => page.addInitScript(() => {
  const request = GPUAdapter.prototype.requestDevice;
  GPUAdapter.prototype.requestDevice = async function (descriptor) {
    const device = await request.call(this, descriptor);
    if (descriptor?.label === 'Poolday decorative prism') window.__prismTestDevice = device;
    return device;
  };
});

test('validates input locally and preserves the navigation nodes and sequence draft', async ({ page }) => {
  await page.goto('/');
  const input = page.getByRole('textbox', { name: 'Public protein sequence' });
  await input.fill('MZ*');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#pool-sequence-feedback')).toContainText('non-canonical');
  await page.getByRole('button', { name: 'Run model', exact: true }).click();
  await expect(page.locator('[data-pool-run-surface]')).toHaveAttribute('data-run-state', 'idle');
  await input.fill('A'.repeat(1025));
  await expect(page.locator('#pool-sequence-feedback')).toContainText('up to 1024');
  await input.fill('  M A\nG  ');
  await expect(page.locator('#pool-sequence-count')).toHaveText('3 / 1024');
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  const nav = await page.locator('.pool-primary-nav').elementHandle();
  await page.getByRole('link', { name: 'Recent jobs', exact: true }).click();
  expect(await nav.evaluate((node) => node === document.querySelector('.pool-primary-nav'))).toBe(true);
  await expect(page.getByRole('link', { name: 'Recent jobs', exact: true })).toBeFocused();
  await page.getByRole('link', { name: 'Run a model', exact: true }).click();
  await expect(input).toHaveValue('  M A\nG  ');
  await expect(page.locator('#pool-sequence-count')).toHaveText('3 / 1024');
  await page.locator('.pool-home-request-details > summary').click();
  await expect(page.locator('[data-pool-pack-summary]')).toBeVisible();
});

test('keeps the mobile action, navigation labels, and details usable without WebGPU', async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.pool-prism-still')).toBeVisible();
  await expect(page.locator('.pool-prism-canvas')).toBeHidden();
  const links = page.locator('.pool-primary-nav .pool-nav-link');
  await expect(links).toHaveText(['Run a model', 'Share compute', 'Recent jobs']);
  for (const link of await links.all()) expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44);
  const button = page.getByRole('button', { name: 'Run model', exact: true });
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport();
  const buttonBox = await button.boundingBox();
  const formBox = await page.locator('#pool-home-ask-form').boundingBox();
  expect(buttonBox.x + buttonBox.width).toBeLessThan(formBox.x + formBox.width);
  expect(buttonBox.x).toBeGreaterThan(formBox.x);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('poolday-mobile.png'), fullPage: true });
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(page.locator('.pool-prism')).toBeHidden();
  await expect(button).toBeVisible();
});

test('renders the compute effect, rests when idle, and yields during work and reduced motion', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await gpuReady(page);
  await settle(page);
  await unchangedFrames(page);
  const initial = await frameCount(page);
  await page.locator('.pool-prism').hover({ position: { x: 80, y: 100 } });
  await expect.poll(() => frameCount(page)).toBeGreaterThan(initial);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('reploid:pool-run-visual-state', { detail: { state: 'running' } })));
  await settle(page);
  await page.waitForTimeout(100);
  await unchangedFrames(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('reploid:pool-run-visual-state', { detail: { state: 'idle' } })));
  await expect.poll(() => frameCount(page)).toBeGreaterThan(initial + 1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await settle(page);
  await unchangedFrames(page);
  const reduced = await frameCount(page);
  await page.locator('.pool-prism').hover({ position: { x: 160, y: 140 } });
  expect(await frameCount(page)).toBe(reduced);
  const stats = await page.evaluate(() => window.REPLOID_POOL_PRISM_STATS);
  expect(Math.max(stats.width, stats.height)).toBeLessThanOrEqual(560);
  expect(stats.frameIntervalMs).toBeGreaterThanOrEqual(1000 / 30);
  await testInfo.attach('prism-render-stats', { body: JSON.stringify(stats, null, 2), contentType: 'application/json' });
  await page.screenshot({ path: testInfo.outputPath('poolday-desktop.png'), fullPage: true });
  expect(pageErrors).toEqual([]);
});

test('returns to the static artwork after device loss and releases its device on navigation', async ({ page }) => {
  await capturePrismDevice(page);
  await page.goto('/');
  await gpuReady(page);
  await page.evaluate(() => window.__prismTestDevice.destroy());
  await expect(page.locator('.pool-prism')).toHaveAttribute('data-prism-state', 'static');
  await expect(page.locator('.pool-prism-still')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Run model', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: 'Recent jobs', exact: true }).click();
  await page.getByRole('link', { name: 'Run a model', exact: true }).click();
  await gpuReady(page);
  await page.evaluate(() => {
    window.__prismTestLost = false;
    window.__prismTestDevice.lost.then(() => { window.__prismTestLost = true; });
  });
  await page.getByRole('link', { name: 'Share compute', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__prismTestLost)).toBe(true);
  await expect(page.locator('[data-pool-prism]')).toHaveCount(0);
});

test('cleans up a device that arrives after its route has been removed', async ({ page }) => {
  await page.addInitScript(() => {
    const request = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (descriptor) {
      const device = await request.call(this, descriptor);
      if (descriptor?.label === 'Poolday decorative prism') {
        window.__prismLateDeviceLost = false;
        device.lost.then(() => { window.__prismLateDeviceLost = true; });
        await new Promise((resolve) => { window.__releasePrismDevice = resolve; });
      }
      return device;
    };
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => typeof window.__releasePrismDevice)).toBe('function');
  await page.getByRole('link', { name: 'Recent jobs', exact: true }).click();
  await page.evaluate(() => window.__releasePrismDevice());
  await expect.poll(() => page.evaluate(() => window.__prismLateDeviceLost)).toBe(true);
  await expect(page.locator('[data-pool-prism]')).toHaveCount(0);
});

test('passes changed browser modules through the Verification Worker sandbox', async ({ page }) => {
  await page.goto('/');
  const paths = ['/ui/pool-home/prism.js', '/ui/pool-home/index.js', '/ui/pool-home/view.js', '/ui/pool-home/controls.js', '/ui/pool-home/document-search.js', '/ui/zero/index.js'];
  const result = await page.evaluate(async (paths) => {
    const snapshot = Object.fromEntries(await Promise.all(paths.map(async (path) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`Could not read ${path}`);
      return [path, await response.text()];
    })));
    return new Promise((resolve, reject) => {
      const worker = new Worker('/core/verification-worker.js');
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Verification Worker timeout')); }, 10000);
      worker.onmessage = ({ data }) => { clearTimeout(timer); worker.terminate(); resolve(data); };
      worker.onerror = (event) => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
      worker.postMessage({ type: 'VERIFY', snapshot, options: { quickMode: true } });
    });
  }, paths);
  expect(result).toMatchObject({ passed: true, errors: [], details: { filesAnalyzed: paths.length } });
});


test('shares clear task controls and accessible model setup across public routes', async ({ page }, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'gpu', { value: undefined }));
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const choices = page.locator('[data-pool-workflow]');
    await expect(choices).toHaveText(['Protein sequences', 'Document search']);
    const documents = page.locator('[data-pool-workflow="documents"]');
    await documents.focus();
    await page.keyboard.press('Enter');
    await expect(documents).toBeFocused();
    await expect(documents).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-document-setup]')).toHaveAttribute('open', '');
    await expect(page.locator('[data-document-models]')).toBeVisible();
    await expect(page.locator('[data-document-submit]')).toBeDisabled();
    await expect(page.locator('[data-document-status]')).toHaveText('Choose models to start.');
    await expect(page.locator('[data-document-search]')).not.toContainText(/\bPacks?\b|provenance/i);
    const card = await page.locator('[data-document-search]').evaluate(node => ({
      background: getComputedStyle(node).backgroundColor,
      shadow: getComputedStyle(node).boxShadow
    }));
    expect(card.shadow).not.toBe('none');
    await expect(page.locator('[data-document-search]')).toHaveClass(/pool-task-card/);
    await page.screenshot({ path: testInfo.outputPath(`models-setup-${width}.png`), fullPage: true });
    await page.getByRole('link', { name: 'Share compute', exact: true }).click();
    const share = page.getByRole('button', { name: 'Start sharing', exact: true });
    await expect(share).toHaveClass(/pool-primary-action/);
    await expect(page.locator('#pool-provider-model option:checked')).toHaveText('ESM-2 35M (Protein)');
    await page.keyboard.press('Tab');
    for (const summary of await page.locator('.pool-advanced > summary:visible').all()) {
      expect((await summary.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await summary.focus();
      await expect(summary).toBeFocused();
      expect(await summary.evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
    }
    expect((await share.boundingBox()).height).toBeGreaterThanOrEqual(48);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`sharing-${width}.png`), fullPage: true });
  }
});
