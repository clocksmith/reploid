import { test, expect } from '@playwright/test';

// These specs exercise the manual size-and-consent path, so automatic download is off;
// tests/unit/first-visitor.test.js covers the automatic path.
async function localOnly(page) {
  await page.addInitScript(() => localStorage.setItem('reploid.auto-download.v1', 'off'));
  await page.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:8769' ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
}

test('fresh public route offers recovery after a bounded search with no peers', async ({ page }, info) => {
  await localOnly(page);
  await expect(page.locator('[data-acquisition-status]')).toBeVisible({ timeout: 12000 });
  const message = page.locator('[data-acquisition-status]');
  const download = page.locator('[data-download-local]');
  if (await page.evaluate(() => !!navigator.gpu && !!navigator.storage?.getDirectory && !!navigator.locks)) {
    await expect(download).toBeVisible(); await expect(message).toContainText('No usable network capacity');
    await download.click();
    await expect(page.locator('[data-download-confirm]')).toBeEnabled();
    await expect(page.locator('[data-download-size]')).toContainText('MB download');
    await expect(page.locator('[data-download-confirm]')).toHaveText('Download model');
    await page.locator('[data-download-cancel]').click();
  } else await expect(message).toContainText(/WebGPU|storage|Web Locks/);
  await page.screenshot({ path: info.outputPath('actual-empty-route.png') });
});

// Explicit acquisition/runtime fixtures exercise UI behavior without claiming model inference.
async function installFixture(page, theme) {
  await page.evaluate(async theme => {
    const { renderConversationWorkspace, bindConversationWorkspace } = await import('/ui/pool-home/conversation-workspace.js');
    const { renderNav } = await import('/ui/pool-home/shell-view.js');
    const { createChatSession, CANONICAL_CHAT_MODELS } = await import('/host/chat-session.js');
    const { createModelAcquisition } = await import('/host/model-acquisition.js');
    const original = document.querySelector('.pool-home'), root = original.cloneNode(false);
    root.dataset.poolTheme = theme;
    root.innerHTML = renderNav('home') + '<div class="pool-route-content">' + renderConversationWorkspace() + '</div>';
    document.body.replaceChildren(root);
    const model = CANONICAL_CHAT_MODELS[0], host = createChatSession({ storage: null, models: [model] });
    const listeners = new Set();
    let state = { ...host.getState(), peerDiscoveryTimedOut: true, localDownloadIssue: null,
      network: { connecting: true, consumer: { connectionState: 'retrying', peers: [] } } };
    const notify = () => listeners.forEach(listener => listener(state));
    let report, complete;
    const owner = createModelAcquisition({ capabilities: () => ({ gpu: true, storage: true, locks: navigator.locks }),
      load: async () => ({ ensureModelCachedSource: (_id, _base, progress, { signal }) => new Promise((resolve, reject) => {
        report = progress; complete = () => resolve({ manifest: { modelId: model.id }, manifestHash: model.identity.slice(7), storageContext: { close: async () => {} } });
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }) }), onChange: () => { state = { ...state, acquisition: owner.getState() }; notify(); } });
    const api = { ...host, getState: () => state, subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
      connect: async () => {}, getModelDownload: async id => ({ id, sizeBytes: 123000000 }),
      async downloadLocalModel() {
        report = null;
        await owner.start(model, true, 123000000);
        state = { ...state, models: [{ ...state.models[0], availability: 'cached', localCached: true }] }; notify();
      }, cancelModelDownload: () => owner.cancel() };
    bindConversationWorkspace(root, api);
    window.firstVisitor = {
      ready: () => typeof report === 'function',
      progress(totalBytes) { report({ stage: 'downloading', downloadedBytes: 30000000, totalBytes }); }, complete: () => complete(),
      peer() { state = { ...state, models: [{ ...state.models[0], availability: 'ready', networkAvailability: 'ready' }] }; notify(); }
    };
  }, theme);
}

for (const [theme, width, height] of [['light', 1440, 1000], ['dark', 390, 844]]) {
  test(`${theme} ${width}px download, unknown total, cancellation and late peer controls`, async ({ page }, info) => {
    await page.setViewportSize({ width, height }); await localOnly(page); await installFixture(page, theme);
    const download = page.locator('[data-download-local]'), cancel = page.locator('[data-cancel-download]');
    await expect(download).toBeVisible(); await page.screenshot({ path: info.outputPath('empty.png') });
    await download.click(); await expect(page.locator('[data-download-confirm]')).toBeEnabled();
    await page.locator('[data-download-confirm]').click(); await expect(cancel).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.firstVisitor.ready())).toBe(true);
    await page.evaluate(() => window.firstVisitor.progress(null));
    await expect(page.locator('[data-acquisition-progress]')).not.toHaveAttribute('value');
    await expect(page.locator('[data-acquisition-status]')).not.toContainText('%');
    await page.evaluate(() => window.firstVisitor.progress(120000000));
    await expect(page.locator('[data-acquisition-status]')).toContainText('25%');
    await page.screenshot({ path: info.outputPath('downloading.png') });
    await cancel.click(); await expect(download).toHaveText('Retry download');
    await page.screenshot({ path: info.outputPath('interrupted.png') });
    await download.click(); await expect(page.locator('[data-download-confirm]')).toBeEnabled();
    await page.locator('[data-download-confirm]').click(); await expect(cancel).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.firstVisitor.ready())).toBe(true);
    await page.evaluate(() => window.firstVisitor.peer());
    await expect(page.locator('[data-composer-send]')).toBeEnabled(); await expect(cancel).toBeVisible();
    await page.evaluate(() => window.firstVisitor.complete());
    await expect(cancel).toBeHidden();
    await page.screenshot({ path: info.outputPath('completed.png') });
    const dimensions = await page.locator('[data-composer-area]').boundingBox();
    expect(dimensions.x).toBeGreaterThanOrEqual(0); expect(dimensions.x + dimensions.width).toBeLessThanOrEqual(width + 1);
  });
}
