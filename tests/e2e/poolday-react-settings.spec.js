// Settings and Conversation details on the React product, against the real routes and,
// for recorded answers, a fixture host mounted through the React entry's mountPoolday. Ported from the
// Settings journeys of production-journey, chat-rails, workspace-navigation, poolday-layout-stability and
// chat-material. Fixtures prove interaction and layout; they do not claim model execution.
import { test, expect } from '@playwright/test';
import { privateRoom } from '../fixtures/current-contribution.js';

async function open(page, baseURL, view) {
  const origin = new URL(baseURL).origin;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('reploid.auto-download.v1', 'off'));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.goto(`${privateRoom('react-settings')}${view ? `&view=${view}` : ''}`);
  await expect(page.locator('[data-react-shell] [data-chat-workspace]')).toBeVisible({ timeout: 30000 });
}

/** Sample the element's box on every frame from the frame after its first paint. */
async function watchBox(locator) {
  await locator.evaluate(node => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
    const box = () => { const rect = node.getBoundingClientRect(); return [rect.x, rect.y, rect.width, rect.height]; };
    const watch = window.__poolBoxWatch = { first: box(), worst: 0, running: true };
    const tick = () => {
      if (!watch.running) return;
      watch.worst = Math.max(watch.worst, ...box().map((value, index) => Math.abs(value - watch.first[index])));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    resolve();
  }))));
}
const boxChange = page => page.evaluate(() => { const watch = window.__poolBoxWatch; watch.running = false; return watch.worst; });

/** Rows whose children leave the row's centre line by more than 1 px (poolday-layout-stability.spec.js). */
async function misalignedRows(root) {
  return root.evaluate(scope => {
    const centre = rect => (rect.top + rect.bottom) / 2;
    const visible = node => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden';
    const problems = [];
    for (const row of scope.querySelectorAll('.pool-option, .pool-toggle-row, .pool-action-row')) {
      if (!visible(row)) continue;
      const rect = row.getBoundingClientRect(), style = getComputedStyle(row);
      const middle = (rect.top + parseFloat(style.paddingTop) + rect.bottom - parseFloat(style.paddingBottom)) / 2;
      for (const child of row.children) {
        if (child.matches('input') || !visible(child)) continue;
        const offset = Math.abs(centre(child.getBoundingClientRect()) - middle);
        if (offset > 1) problems.push(`${row.textContent.trim().slice(0, 40)}: ${child.className || child.tagName} ${offset.toFixed(1)}px off centre`);
      }
    }
    return problems;
  });
}

for (const [theme, width, height] of [['light', 1440, 900], ['dark', 390, 844]]) {
  test(`${theme} ${width}px Settings: appearance, storage, sharing and advanced keep their box and the drawer`, async ({ page, baseURL }, info) => {
    await page.setViewportSize({ width, height });
    await open(page, baseURL, null);
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    const settings = page.locator('[data-workspace-view=settings]');
    await settings.click();
    await expect(page).toHaveURL(/view=settings/);
    await expect(settings).toHaveAttribute('aria-current', 'page');
    const pane = page.locator('[data-inspector-pane="settings"]');
    await expect(pane).toBeVisible();
    await expect(pane.getByRole('heading', { name: 'Settings', level: 2 })).toBeFocused();
    // Storage is measured when Settings opens.
    await expect(pane.locator('[data-storage-status]')).toHaveText('No model downloads stored. Choose a model in Answer on to download one.');
    // File sharing lives in Settings, never in Computers.
    await expect(pane.locator('[data-toggle-file-contribution]')).toBeVisible();
    await expect(page.locator('[data-inspector-pane="participants"] [data-toggle-file-contribution]')).toHaveCount(0);
    await watchBox(pane);
    await pane.locator('[data-pool-theme-choice=dark]').check();
    await expect(page.locator('[data-react-shell]')).toHaveAttribute('data-pool-theme', 'dark');
    await pane.locator('[data-pool-theme-choice=light]').check();
    await expect(page.locator('[data-react-shell]')).toHaveAttribute('data-pool-theme', 'light');
    expect(await page.evaluate(() => localStorage.getItem('reploid.appearance.v1'))).toBe('light');
    await pane.locator(`[data-pool-theme-choice=${theme}]`).check();
    await pane.locator('[data-model-sharing-limits] > summary').click();
    const bounded = pane.locator('input[data-file-mode=bounded-acquisition]');
    if (await bounded.isEnabled()) {
      await bounded.check();
      await expect(pane.locator('[data-file-download]')).toBeVisible();
    }
    await pane.locator('[data-settings-advanced] > summary').click();
    await pane.locator('[data-web-search-config] > summary').click();
    await expect(pane.locator('[data-web-search-url]')).toBeVisible();
    await page.waitForTimeout(500);
    expect(await boxChange(page)).toBe(0);
    expect(await misalignedRows(pane)).toEqual([]);
    // The drawer keeps the page gutter: 8 px on phones, 16 px wider.
    const gutter = width <= 760 ? 8 : 16, box = await pane.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(gutter);
    expect(box.x + box.width).toBeLessThanOrEqual(width - gutter);
    expect(box.y + box.height).toBeLessThanOrEqual(height - gutter);
    // App shortcuts sit under Advanced and lead to their routes.
    await expect(pane.locator('a[href="/examples"]')).toBeVisible();
    await expect(pane.locator('a[data-pool-nav-id=improve]')).toHaveAttribute('href', /^\/improve/);
    await page.screenshot({ path: info.outputPath('settings.png') });
    // Escape closes the drawer, a reload restores it from the address.
    await page.keyboard.press('Escape');
    await expect(pane).toBeHidden();
    await expect(settings).not.toHaveAttribute('aria-current');
    await settings.click();
    await page.reload();
    await expect(page.locator('[data-inspector-pane="settings"]')).toBeVisible({ timeout: 30000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}

test('Settings lists measured downloads from the installed storage API and removes one after confirmation', async ({ page, baseURL }) => {
  await open(page, baseURL, 'settings');
  const pane = page.locator('[data-inspector-pane="settings"]');
  await expect(pane.locator('[data-storage-status]')).toHaveText('No model downloads stored. Choose a model in Answer on to download one.');
  // This isolated browser context holds only tiny test files under a catalog model's directory, never model weights.
  const model = await page.evaluate(async () => {
    const { LOCAL_DOPPLER_MODELS } = await import('/config/doppler-local-models.js');
    const chosen = LOCAL_DOPPLER_MODELS.find(item => !item.partition && !item.adapters?.length);
    const root = await navigator.storage.getDirectory();
    const models = await root.getDirectoryHandle('models', { create: true });
    const dir = await models.getDirectoryHandle(chosen.id, { create: true });
    const file = await dir.getFileHandle('shard_0.bin', { create: true });
    const writer = await file.createWritable(); await writer.write(new Uint8Array(37)); await writer.close();
    return { id: chosen.id, name: chosen.name };
  });
  await pane.locator('[data-storage-refresh]').click();
  const row = pane.locator(`[data-stored-model="${model.id}"]`);
  await expect(row).toContainText(model.name);
  await expect(pane.locator('[data-storage-status]')).toHaveText('Measured stored files, including partial downloads. Shared files may count toward more than one model.');
  await row.getByRole('button', { name: 'Remove' }).click();
  const dialog = page.locator('dialog[open][data-storage-dialog]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-storage-remove-name]')).toHaveText(model.name);
  await dialog.getByRole('button', { name: 'Remove download' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(pane.locator('[data-storage-status]')).toHaveText('No model downloads stored. Choose a model in Answer on to download one.');
  const removed = await page.evaluate(async id => {
    const models = await (await navigator.storage.getDirectory()).getDirectoryHandle('models');
    try { await models.getDirectoryHandle(id); return false; } catch (error) { return error.name === 'NotFoundError'; }
  }, model.id);
  expect(removed).toBe(true);
});

/** A real chat session whose state carries one thread with two recorded answers, mounted through mountPoolday. */
async function mountRecordedConversation(page) {
  await page.evaluate(async () => {
    const { createChatSession } = await import('/host/chat-session.js');
    const { mountPoolday } = await import('/ui/react/app.js');
    const session = createChatSession({ storage: null, models: [] });
    const model = { id: 'fixture', name: 'Fixture model', identity: 'sha256:' + 'c'.repeat(64) };
    const attempt = (id, prompt, output, totalMs, createdAt) => ({ id, status: 'completed', createdAt, finishedAt: createdAt + totalMs,
      execution: { placement: 'local-webgpu', requesterId: 'requester', completion: { promptTokenCount: prompt, generatedTokenCount: output },
        timing: { generatedTokenCount: output, totalMs, firstTokenMs: 250, prefillMs: 200 } } });
    const thread = { id: 'thread-1', title: 'Recorded', model, createdAt: 1, permissions: { executionLocation: 'local', sharingScope: 'local' },
      messages: [{ id: 'u1', role: 'user', content: 'Hi' }, { id: 'r1', role: 'assistant', content: 'Hello.', attemptId: 'a1' }],
      attempts: [attempt('a1', 256, 768, 21700, 1000)], grants: [] };
    const base = session.getState();
    const listeners = new Set();
    let state = { ...base, threads: [thread], selectedId: thread.id, activeThread: thread, models: [{ ...model, contextLength: 4096 }] };
    const chat = { ...session, getState: () => state, subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); } };
    window.recorded = {
      addLaterAnswer() {
        const later = { ...thread, messages: [...thread.messages, { id: 'u2', role: 'user', content: 'More' }, { id: 'r2', role: 'assistant', content: 'Short.', attemptId: 'a2' }],
          attempts: [...thread.attempts, attempt('a2', 45, 123, 3000, 30000)] };
        state = { ...state, threads: [later], activeThread: later };
        for (const listener of listeners) listener(state);
      }
    };
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    mountPoolday(root, { host: { chat, close: async () => {} } });
  });
}

test('Conversation details shows the last answer and follows later answers', async ({ page, baseURL }) => {
  await open(page, baseURL, null);
  await mountRecordedConversation(page);
  await page.locator('[data-workspace-view=conversation]').click();
  const pane = page.locator('[data-inspector-pane="conversation"]');
  await expect(pane).toBeVisible();
  const detail = pane.locator('[data-inspector-context-detail]');
  await expect(detail).toContainText('Last answer used 1,024 tokens');
  await expect(pane.locator('[data-inspected-activity]')).toContainText('First token0.25 s');
  await expect(pane.locator('[data-inspected-activity]')).toContainText('768');
  await expect(pane.locator('[data-inspector-status]')).toHaveText('Complete');
  await pane.locator('[data-attempt-details] > summary').click();
  await expect(pane.locator('[data-ribbon-facts]')).toContainText('Requester / output recipient');
  await expect(pane.locator('[data-conversation-download]')).toBeVisible();
  await page.evaluate(() => window.recorded.addLaterAnswer());
  await expect(detail).toContainText('Last answer used 168 tokens');
  await expect(pane.locator('[data-inspected-activity]')).toContainText('123');
  await page.keyboard.press('Escape');
  await expect(pane).toBeHidden();
});
