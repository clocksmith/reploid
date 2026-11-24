import { test, expect } from '@playwright/test';

for (const [width, height] of [[1440, 900], [1280, 720], [390, 844], [320, 740]]) {
  test(`workspace history, stable four-place shell and five core jobs at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const input = page.locator('[data-composer-input]');
    await expect(input).toBeVisible();

    // Stable destination bar: Chats, Conversation details, Computers, Settings (all icon + label, no shift).
    const toolbar = page.locator('[data-chat-rail-toolbar]');
    const initialPositions = await toolbar.locator('[data-workspace-view]').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { view: node.dataset.workspaceView, x: rect.x, y: rect.y, width: rect.width, height: rect.height, hasIcon: !!node.querySelector('svg') };
    }));
    expect(initialPositions.map(item => item.view)).toEqual(['threads', 'conversation', 'computers', 'settings']);
    for (const item of initialPositions) {
      expect(item.hasIcon).toBe(true);
      expect(item.width).toBeGreaterThanOrEqual(44);
      expect(item.height).toBeGreaterThanOrEqual(44);
      expect(item.y).toBe(initialPositions[0].y);
    }

    // Composer row: Attach (icon-only), Answer on · model, and Send on one aligned row; no ? help icon.
    await expect(page.locator('[data-open-control-help]')).toHaveCount(0);
    const composerRow = await Promise.all(['.chat-file-label', '[data-open-model]', '[data-composer-send]'].map(sel => page.locator(sel).boundingBox()));
    expect(Math.abs(composerRow[0].y - composerRow[1].y)).toBeLessThanOrEqual(2);
    expect(Math.abs(composerRow[1].y - composerRow[2].y)).toBeLessThanOrEqual(2);

    await input.fill('Keep my draft');
    await page.evaluate(() => { window.originalComposer = document.querySelector('[data-composer-input]'); });

    // 1. Open a chat (Chats drawer) & 5. Close without losing the draft.
    const chatsLink = toolbar.getByRole('link', { name: 'Chats', exact: true });
    await chatsLink.click();
    await expect(page).toHaveURL(/view=threads/);
    await expect(page.locator('[data-threads-dialog]')).toBeVisible();
    await expect(page.locator('[data-new-thread]')).toBeVisible();
    await expect(page.locator('[data-threads-dialog] [data-conversation-download]')).toHaveCount(0);
    await expect(page.locator('[data-threads-dialog] [data-context-controls]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-threads-dialog]')).toBeHidden();
    await expect(input).toHaveValue('Keep my draft');

    // Navigate all right-hand inspector panes (Conversation details, Computers, Settings) and verify shared header, padding, Close and Escape.
    for (const [view, name, pane, title] of [
      ['conversation', 'Conversation details', 'conversation', 'Conversation details'],
      ['computers', 'Computers', 'participants', 'Computers'],
      ['settings', 'Settings', 'settings', 'Settings']
    ]) {
      const link = toolbar.getByRole('link', { name, exact: true });
      await link.click();
      await expect(page).toHaveURL(new RegExp(`view=${view}`));
      await expect(link).toHaveAttribute('aria-current', 'page');
      await expect(link).not.toHaveAttribute('aria-pressed');
      await expect(page.locator('#network-inspector-title')).toHaveText(title);
      await expect(page.locator(`[data-inspector-pane="${pane}"]`)).toBeVisible();
      await expect(page.locator('[data-chat-inspector-slot]')).not.toHaveAttribute('data-drawer-moving');
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      if (width <= 760) {
        const slotBox = await page.locator('[data-chat-inspector-slot]').boundingBox();
        expect(slotBox.x).toBeLessThanOrEqual(16);
        expect(width - (slotBox.x + slotBox.width)).toBeLessThanOrEqual(16);
      }
    }

    // 4. Find file sharing directly in Settings (never redirecting to Computers).
    await expect(page.locator('[data-inspector-pane="settings"] [data-toggle-file-contribution]')).toBeVisible();
    await expect(page.locator('[data-manage-file-sharing]')).toHaveCount(0);
    await expect(page.locator('[data-inspector-pane="participants"] [data-toggle-file-contribution]')).toHaveCount(0);

    // 3. Pair a computer under Computers (Connect a desktop + Forget computer action).
    await toolbar.getByRole('link', { name: 'Computers', exact: true }).click();
    const pairing = page.locator('[data-owner-pairing]');
    await expect(pairing).toBeVisible();
    await pairing.locator(':scope > summary').click();
    await expect(pairing.locator('input[name="link"]')).toBeVisible();
    await expect(pairing.locator('[data-owner-pairing-unpair]')).toHaveText('Forget computer');

    // Verify disclosures use chevron (never '+' or '−') and toolbar never shifted.
    const disclosureMarker = await pairing.locator(':scope > summary').evaluate(node => getComputedStyle(node, '::after').content);
    expect(disclosureMarker).not.toContain('+');
    expect(disclosureMarker).not.toContain('−');
    const afterPositions = await toolbar.locator('[data-workspace-view]').evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { view: node.dataset.workspaceView, x: rect.x, y: rect.y };
    }));
    for (let i = 0; i < initialPositions.length; i++) {
      expect(Math.abs(afterPositions[i].x - initialPositions[i].x)).toBeLessThanOrEqual(0.5);
      expect(afterPositions[i].y).toBe(initialPositions[i].y);
    }

    // Close inspector with icon-only Close button without losing draft.
    await page.locator('[data-close-inspector]').click();
    await expect(page.locator('[data-contextual-inspector]')).toBeHidden();
    await expect(input).toHaveValue('Keep my draft');
    expect(await page.evaluate(() => window.originalComposer === document.querySelector('[data-composer-input]'))).toBe(true);

    // 2. Pick where it runs (Answer on sheet) and close without losing draft.
    await page.locator('[data-open-model]').click();
    const picker = page.locator('[data-model-picker]');
    for (const selector of ['[data-execution-choice="local"]', '[data-execution-choice="network"]', '[data-model-picker-close]', '[data-change-model]']) {
      const control = picker.locator(selector);
      await expect(control).toBeInViewport({ ratio: 1 });
      const box = await control.boundingBox();
      expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
    await picker.locator('[data-model-details] > summary').click();
    await expect(picker).not.toContainText('No adapters for this model yet');
    await expect(picker.locator('[data-model-providers] a')).toHaveText('Prepare or serve an adapter');
    await page.screenshot({ path: info.outputPath(`picker-${width}.png`), animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await picker.locator('[data-model-picker-close]').click();
    await expect(input).toHaveValue('Keep my draft');

    await toolbar.getByRole('link', { name: 'Settings', exact: true }).click();
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
