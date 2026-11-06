import { test, expect } from '@playwright/test';

for (const [width, height] of [[1280, 720], [390, 844], [320, 740]]) {
  test(`workspace history and reachable model controls at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const input = page.locator('[data-composer-input]');
    await expect(input).toBeVisible();
    await input.fill('Keep my draft');
    await page.evaluate(() => { window.originalComposer = document.querySelector('[data-composer-input]'); });
    for (const [view, name] of [['threads', 'Threads'], ['computers', 'Computers'], ['settings', 'Settings']]) {
      const link = page.getByRole('link', { name: new RegExp(`^${name}(?::|$)`) });
      await link.click();
      await expect(page).toHaveURL(new RegExp(`view=${view}`));
      await expect(link).toHaveAttribute('aria-current', 'page');
      await expect(page.locator('dialog[open]')).toHaveCount(0);
    }
    await page.goBack();
    await expect(page.locator('[data-inspector-pane="participants"]')).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-threads-dialog]')).toBeVisible();
    await page.goBack();
    await expect(input).toBeVisible();
    await expect(input).toHaveValue('Keep my draft');
    expect(await page.evaluate(() => window.originalComposer === document.querySelector('[data-composer-input]'))).toBe(true);
    await page.locator('[data-open-model]').click();
    const picker = page.locator('[data-model-picker]');
    for (const selector of ['[data-execution-choice="auto"]', '[data-execution-choice="local"]', '[data-execution-choice="network"]', '[data-model-picker-close]', '[data-change-model]']) {
      const control = picker.locator(selector);
      await expect(control).toBeInViewport({ ratio: 1 });
      const box = await control.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await expect(picker).not.toContainText('No adapters for this model yet');
    await expect(picker.locator('[data-model-providers] a')).toHaveText('Prepare or serve an adapter');
    await page.screenshot({ path: info.outputPath(`picker-${width}.png`), animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await picker.locator('[data-model-picker-close]').click();
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.reload();
    await expect(page.locator('[data-inspector-pane="settings"]')).toBeVisible();
  });
}

test('changed workspace modules pass the Verification Worker', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  const result = await page.evaluate(async () => {
    const modules = ['conversation-workspace', 'network-inspector', 'workspace-navigation', 'model-providers', 'model-adapters', 'index'];
    const snapshot = Object.fromEntries(await Promise.all(modules.map(async name => {
      const path = '/ui/pool-home/' + name + '.js';
      return [path, await (await fetch(path)).text()];
    })));
    return new Promise((resolve, reject) => {
      const worker = new Worker('/core/verification-worker.js');
      const timer = setTimeout(() => { worker.terminate(); reject(Error('Verification timeout')); }, 15000);
      worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
      worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(Error(event.message)); };
      worker.postMessage({ type: 'VERIFY', snapshot });
    });
  });
  expect(result.passed, JSON.stringify(result)).toBe(true);
});
