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
  await expect(page.locator(`[data-execution-choice=${choice}] input`)).toBeChecked();
  await page.locator('[data-model-picker-close]').click();
  await expect(page.locator('[data-model-picker]')).toBeHidden();
}

// "Who can read it" is the composer's privacy chip; Standard with "Let it choose" keeps automatic placement.
async function allowOpenNetwork(page) {
  await page.locator('[data-composer-field] [data-open-privacy]').click();
  await expect(page.locator('[data-model-picker]')).toBeHidden();
  const policy = page.locator('[data-privacy-dialog]');
  await expect(policy).toBeVisible();
  await policy.locator('[data-privacy-route][value=auto]').check();
  await policy.locator('[data-privacy-apply]').click();
  await expect(policy).toBeHidden();
}

test('fresh public route stays on contributors, keeps quiet during interrupted discovery, and keeps this device a choice', async ({ page, baseURL }, info) => {
  await localOnly(page, baseURL);
  // The disconnected public route has no manual retry or error panel.
  const message = page.locator('[data-model-status]');
  await expect(page.locator('[data-open-model]')).toHaveAttribute('aria-label', /Contributors/);
  await expect(page.locator('[data-composer-input]')).toHaveAttribute('placeholder', 'Message…');
  await expect(page.locator('[data-retry-connection]')).toHaveCount(0);
  await expect(page.getByText('Connection interrupted.', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-review-shared-model]')).toBeHidden();
  const download = page.locator('[data-download-local]');
  await expect(download).toBeHidden();
  // This device stays one choice away, with its reviewed download.
  await chooseComputer(page, 'local');
  await expect(page.locator('[data-prompt-disclosure]')).toHaveCount(0);
  if (await page.evaluate(() => !!navigator.gpu && !!navigator.storage?.getDirectory && !!navigator.locks)) {
    await expect(message).toContainText('Model not downloaded yet.');
    await expect(download).toBeVisible();
    await download.click();
    // The catalog's local, verified manifest supplies size without weight downloads.
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
    const { mountPoolday } = await import('/ui/react/app.js');
    const { createChatSession, CANONICAL_CHAT_MODELS } = await import('/host/chat-session.js');
    const { createModelAcquisition } = await import('/host/model-acquisition.js');
    localStorage.setItem('reploid.appearance.v1', theme);
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
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    mountPoolday(root, { host: { chat: api, close: async () => {} }, viewState: { chosenModel: model } });
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
  // A first Send asks nothing (FIRST-02, docs/critical-user-journeys.md): while computers are being found it waits for one.
  // This fixture starts with a model already chosen, so the wait names it.
  await expect(status).toContainText('Finding computers');
  await expect(cancel).toBeHidden();
  await send.click();
  await expect(page.locator('[data-model-picker]')).toBeHidden();
  await expect(status).toContainText('Waiting for a computer running');
  await expect(cancel).toHaveText('Cancel');
  await cancel.click();
  await expect(cancel).toBeHidden();
  await expect(status).toContainText('Finding computers');
  await page.evaluate(() => window.firstVisitor.peer());
  await expect(page.locator('[data-prompt-disclosure]')).toHaveCount(0);
  await expect(input).toHaveValue('Explain ocean tides.');
  await expect(page.locator('[data-message-stream]')).toBeEmpty();
});

test('reviews a reachable alternate model before changing the public destination', async ({ page, baseURL }) => {
  await localOnly(page, baseURL); await installFixture(page, 'light');
  const status = page.locator('[data-model-status]'), review = page.locator('[data-review-shared-model]');
  const picker = page.locator('[data-model-picker]'), apply = page.locator('[data-change-model]');
  // The selector names the destination; availability is the separate dot.
  const source = page.locator('[data-composer-model-source]'), dot = page.locator('[data-composer-availability]');
  const alternateName = await page.evaluate(async () => {
    const { CANONICAL_CHAT_MODELS } = await import('/host/chat-session.js');
    const { modelVariantLabel } = await import('/ui/components/model-select.js');
    return modelVariantLabel(CANONICAL_CHAT_MODELS[1]);
  });
  await chooseComputer(page, 'network');
  await expect(status).toContainText('No eligible computer found');
  await page.evaluate(() => window.firstVisitor.alternate(false));
  await expect(review).toBeHidden();
  await page.evaluate(() => window.firstVisitor.alternate(true));
  await expect(review).toBeVisible();
  await review.click();
  await expect(picker).toBeVisible();
  await expect(source).toHaveCount(0);
  await expect(dot).toHaveCount(0);
  await page.evaluate(() => window.firstVisitor.alternate(false));
  await expect(apply).toBeDisabled();
  await page.locator('[data-model-picker-close]').click();
  await page.evaluate(() => window.firstVisitor.alternate(true));
  await review.click(); await apply.click();
  await expect(picker).toBeHidden();
  await expect(source).toHaveText('Contributors');
  await expect(dot).toHaveAttribute('data-availability', 'ready');
  await expect(page.locator('[data-composer-model-name]')).toHaveText(alternateName);
  await expect(page.locator('[data-prompt-disclosure]')).toHaveCount(0);
});

for (const [theme, width, height] of [['light', 1440, 1000], ['light', 390, 844], ['dark', 390, 844]]) {
  test(`${theme} ${width}px download, unknown total, cancellation and late peer controls`, async ({ page, baseURL }, info) => {
    await page.setViewportSize({ width, height }); await localOnly(page, baseURL); await installFixture(page, theme);
    // On automatic placement the download is optional inside Answer on; a late network peer can still answer.
    await allowOpenNetwork(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const download = page.locator('[data-model-picker] :is([data-optional-download], [data-answer-action="download"])');
    const cancel = page.locator('[data-cancel-download]');
    await expect(page.locator('[data-composer-area] [data-optional-download]')).toHaveCount(0);
    const picker = page.locator('[data-open-model]');
    const toolbar = page.locator('[data-composer-toolbar]');
    const privacy = toolbar.locator('[data-open-privacy]');
    const send = toolbar.locator('[data-composer-send]');
    await expect(privacy).not.toContainText('Standard');
    await expect(page.locator('[data-prompt-disclosure]')).toHaveCount(0);
    expect(Math.abs((await picker.boundingBox()).y - (await send.boundingBox()).y)).toBeLessThan(4);
    await page.screenshot({ path: info.outputPath('empty.png') });
    await picker.click(); await expect(download).toBeVisible();
    const startDownload = async () => {
      await download.click(); await expect(page.locator('[data-download-confirm]')).toBeEnabled();
      await page.locator('[data-download-confirm]').click();
      const closePicker = page.locator('[data-model-picker-close]');
      if (await closePicker.isVisible()) await closePicker.click();
      await expect(cancel).toBeVisible();
    };
    await startDownload();
    await expect.poll(() => page.evaluate(() => window.firstVisitor.ready())).toBe(true);
    await page.evaluate(() => window.firstVisitor.progress(null));
    await expect(page.locator('[data-acquisition-progress]')).not.toHaveAttribute('value');
    await expect(page.locator('[data-acquisition-status]')).not.toContainText('%');
    await page.evaluate(() => window.firstVisitor.progress(120000000));
    await expect(page.locator('[data-acquisition-status]')).toContainText('25%');
    await page.screenshot({ path: info.outputPath('downloading.png') });
    await cancel.click();
    await page.screenshot({ path: info.outputPath('interrupted.png') });
    await picker.click(); await expect(download).toBeVisible();
    await startDownload();
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
