import { test, expect } from '@playwright/test';

// Block real external traffic. The acquisition fixture supplies the model download.
async function localOnly(page, baseURL) {
  const origin = new URL(baseURL).origin;
  await page.addInitScript(() => localStorage.setItem('reploid.auto-download.v1', 'off'));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.routeWebSocket('**/*', socket => socket.close());
  await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
}

// The composer's "Answer on" sheet holds the Computer rows; each row applies on tap and the sheet stays open.
async function chooseComputer(page, choice) {
  await page.locator('[data-open-model]').click();
  await expect(page.locator('[data-picker-title]')).toHaveText('Answer on');
  await page.locator(`[data-execution-choice=${choice}]`).click();
  await expect(page.locator(`[data-execution-choice=${choice}]`)).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-model-picker-close]').click();
  await expect(page.locator('[data-model-picker]')).toBeHidden();
}

// More options opens the detailed policy dialog from that sheet; "any eligible computer" keeps automatic placement.
async function allowOpenNetwork(page) {
  await page.locator('[data-open-model]').click();
  await page.locator('[data-model-picker] [data-open-privacy]').click();
  await expect(page.locator('[data-model-picker]')).toBeHidden();
  const policy = page.locator('[data-privacy-dialog]');
  await expect(policy).toBeVisible();
  await policy.locator('[data-privacy-placement]').selectOption('network-allowed');
  await policy.locator('[data-privacy-recipient-mode]').selectOption('open');
  await policy.locator('[data-privacy-apply]').click();
  await expect(policy).toBeHidden();
}

test('fresh public route starts on this device, offers local recovery and reports interrupted discovery', async ({ page, baseURL }, info) => {
  await localOnly(page, baseURL);
  // A first visitor runs on this device until they choose a computer; discovery status follows that choice.
  const message = page.locator('[data-model-status]');
  await expect(page.locator('[data-prompt-disclosure]')).toHaveText('Inference stays on this device.');
  await expect(page.locator('[data-review-shared-model]')).toBeHidden();
  await expect(page.locator('[data-retry-connection]')).toBeHidden();
  const download = page.locator('[data-download-local]');
  if (await page.evaluate(() => !!navigator.gpu && !!navigator.storage?.getDirectory && !!navigator.locks)) {
    await expect(message).toContainText('Model unavailable here.');
    await expect(download).toBeVisible();
    await download.click();
    // The catalog's local, verified manifest supplies size without weight downloads.
    await expect(page.locator('[data-download-confirm]')).toBeEnabled();
    await expect(page.locator('[data-download-size]')).toContainText('MB download');
    await expect(page.locator('[data-download-confirm]')).toHaveText('Download model');
    await page.locator('[data-download-cancel]').click();
  } else await expect(message).toContainText(/WebGPU|storage|Web Locks/);
  await chooseComputer(page, 'network');
  await expect(message).toContainText('Connection interrupted.', { timeout: 12000 });
  await expect(page.locator('[data-review-shared-model]')).toBeHidden();
  await expect(page.locator('[data-retry-connection]')).toHaveText('Retry connection');
  await expect(download).toBeHidden();
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
    let state = { ...host.getState(), peerDiscoveryTimedOut: true, discoveryPhase: 'observed', localDownloadIssue: null,
      network: { consumer: { connectionState: 'connected', peers: [] } } };
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
    bindConversationWorkspace(root, api, { viewState: { chosenModel: model } });
    window.firstVisitor = {
      ready: () => typeof report === 'function',
      search() { state = { ...state, discoveryPhase: 'searching', peerDiscoveryTimedOut: false }; notify(); },
      alternate(reachable) {
        const alternative = { ...CANONICAL_CHAT_MODELS[1], availability: 'ready', networkAvailability: 'ready',
          providerIds: ['alternate-peer'], reachableProviderIds: reachable ? ['alternate-peer'] : [] };
        state = { ...state, models: [state.models[0], alternative] }; notify();
      },
      progress(totalBytes) { report({ stage: 'downloading', downloadedBytes: 30000000, totalBytes }); }, complete: () => complete(),
      peer() { state = { ...state, models: [{ ...state.models[0], availability: 'ready', networkAvailability: 'ready',
        providerIds: ['fixture-peer'], reachableProviderIds: ['fixture-peer'] }] }; notify(); }
    };
  }, theme);
}

test('queues Send while public computers are found and cancels back to an editable draft', async ({ page, baseURL }) => {
  await localOnly(page, baseURL); await installFixture(page, 'light');
  await page.evaluate(() => window.firstVisitor.search());
  const cancel = page.locator('[data-cancel-queued-send]'), send = page.locator('[data-composer-send]');
  const input = page.locator('[data-composer-input]'), status = page.locator('[data-model-status]');
  // Send itself queues; there is no separate opt-in button.
  await expect(page.locator('[data-queue-send]')).toBeHidden();
  await input.fill('Explain ocean tides.');
  // A first Send with no computer chosen asks where to run before anything can leave this device.
  await send.click();
  await expect(page.locator('[data-model-picker]')).toBeVisible();
  await expect(page.locator('[data-picker-title]')).toHaveText('Where should this run?');
  await expect(page.locator('[data-execution-choice=local]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-execution-choice=network]').click();
  await expect(page.locator('[data-execution-choice=network]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-model-picker-close]').click();
  await expect(status).toContainText('Finding computers');
  await expect(cancel).toBeHidden();
  await send.click();
  await expect(status).toContainText('Waiting for a computer running');
  await expect(cancel).toHaveText('Cancel');
  await cancel.click();
  await expect(cancel).toBeHidden();
  await expect(status).toContainText('Finding computers');
  await page.evaluate(() => window.firstVisitor.peer());
  await expect(page.locator('[data-prompt-disclosure]')).toHaveText('The answering computer can read your prompt.');
  await expect(input).toHaveValue('Explain ocean tides.');
  await expect(page.locator('[data-message-stream]')).toBeEmpty();
});

test('reviews a reachable alternate model before changing the public destination', async ({ page, baseURL }) => {
  await localOnly(page, baseURL); await installFixture(page, 'light');
  const status = page.locator('[data-model-status]'), review = page.locator('[data-review-shared-model]');
  const picker = page.locator('[data-model-picker]'), apply = page.locator('[data-change-model]');
  const source = page.locator('[data-composer-model-source]');
  await chooseComputer(page, 'network');
  await expect(status).toContainText('No eligible computer found');
  await page.evaluate(() => window.firstVisitor.alternate(false));
  await expect(review).toBeHidden();
  await page.evaluate(() => window.firstVisitor.alternate(true));
  await expect(review).toBeVisible();
  await review.click();
  await expect(picker).toBeVisible();
  await expect(source).toHaveText(' · Unavailable');
  await page.evaluate(() => window.firstVisitor.alternate(false));
  await expect(apply).toBeDisabled();
  await page.locator('[data-model-picker-close]').click();
  await page.evaluate(() => window.firstVisitor.alternate(true));
  await review.click(); await apply.click();
  await expect(picker).toBeHidden();
  await expect(source).toHaveText(' · Public network');
  await expect(page.locator('[data-prompt-disclosure]')).toHaveText('The answering computer can read your prompt.');
});

for (const [theme, width, height] of [['light', 1440, 1000], ['dark', 390, 844]]) {
  test(`${theme} ${width}px download, unknown total, cancellation and late peer controls`, async ({ page, baseURL }, info) => {
    await page.setViewportSize({ width, height }); await localOnly(page, baseURL); await installFixture(page, theme);
    // Automatic placement downloads to this device and still lets a late network peer answer.
    await allowOpenNetwork(page);
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
    await expect(page.locator('[data-acquisition-status]')).toContainText('Network model ready.');
    await expect(page.locator('[data-composer-send]')).toBeEnabled(); await expect(cancel).toBeVisible();
    await page.evaluate(() => window.firstVisitor.complete());
    await expect(cancel).toBeHidden();
    await page.screenshot({ path: info.outputPath('completed.png') });
    const dimensions = await page.locator('[data-composer-area]').boundingBox();
    expect(dimensions.x).toBeGreaterThanOrEqual(0); expect(dimensions.x + dimensions.width).toBeLessThanOrEqual(width + 1);
  });
}
