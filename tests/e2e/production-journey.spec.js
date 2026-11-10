import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readServedText } from '../helpers/served-browser-files.js';

for (const width of [1440, 390]) test(`production opens chat without prepared models at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto('/?instance=requester-journey&swarm=public');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  await expect(page.locator('[data-production-shared]')).toHaveCount(0);
  await expect(page.locator('[data-composer-field] [data-open-model]')).toBeVisible();
  await expect(page.locator('[data-composer-input]')).toBeVisible();
  await expect(page.locator('[data-production-surface]')).not.toBeVisible();
  await expect(page.locator('[data-contextual-inspector]')).not.toBeVisible();
  await page.screenshot({ path: info.outputPath(`production-${width}.png`), fullPage: true });
  await page.locator('[data-composer-input]').fill('Keep this draft while I view contributions');
  await page.evaluate(() => {
    window.history.pushState({}, '', '/network?instance=requester-journey&swarm=public');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page).toHaveURL(/\/network\?/);
  expect(new URL(page.url()).searchParams.get('instance')).toBe('requester-journey');
  await expect(page.locator('[data-composer-input]')).toHaveValue('Keep this draft while I view contributions');
  await page.locator('[data-workspace-view=computers]').click();
  await expect(page.locator('[data-production-device] > summary')).toBeVisible();
  await page.locator('[data-production-device] > summary').click();
  await expect(page.locator('[data-production-history]')).toBeVisible();
  await page.locator('[data-close-inspector]').click();
  await expect(page.locator('[data-production-surface]')).not.toBeVisible();
  await expect(page.locator('[data-composer-input]')).toHaveValue('Keep this draft while I view contributions');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  if (width < 760) {
    const tops = await page.locator('.chat-rail-toolbar .pool-button').evaluateAll(nodes => nodes
      .map(node => node.getBoundingClientRect()).filter(rect => rect.width && rect.height).map(rect => rect.top));
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: info.outputPath(`chat-${width}.png`), fullPage: true });
});

test('saved contributions remain available after reload without active sharing', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  // A controlled completed-record fixture, not a claim of physical inference.
  const name = await page.evaluate(async () => {
    const { createContributionHistory } = await import('/host/contribution-history.js');
    const { getCurrentReploidStorage } = await import('/instance.js');
    const { LOCAL_DOPPLER_MODELS } = await import('/config/doppler-local-models.js');
    const model = LOCAL_DOPPLER_MODELS[0];
    createContributionHistory({ storage: getCurrentReploidStorage() }).record({ modelId: model.id, modelIdentity: model.identity, outputTokens: null });
    return model.name;
  });
  await page.reload();
  await page.locator('[data-workspace-view=computers]').click();
  await page.locator('[data-production-device] > summary').click();
  await page.locator('[data-production-history] > summary').click();
  await expect(page.locator('[data-production-history-records]')).toContainText(name);
  await expect(page.locator('[data-production-history-records]')).toContainText('Token count unavailable');
  await expect(page.locator('[data-production-history-count]')).toHaveText('1');
});

// Controlled execution ports exercise real chat host/scheduler/permission code.
// These are deterministic UI contracts, not physical inference or peer evidence.
async function installExecutionFixture(page, mode) {
  await page.goto('/network');
  await expect(page.locator('[data-composer-input]')).toBeVisible();
  await page.evaluate(async mode => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    const { createChatSession, CANONICAL_CHAT_MODELS } = await import('/host/chat-session.js');
    const { renderConversationWorkspace, bindConversationWorkspace } = await import('/ui/pool-home/conversation-workspace.js');
    const model = CANONICAL_CHAT_MODELS[0], peer = 'peer:' + 'b'.repeat(24);
    const evidence = { opens: 0, disclosures: 0, model: model.id };
    const service = { async open() {
      evidence.opens++;
      return { loaded: true, modelId: model.id, manifestHash: model.identity.slice(7), resetGenerationState() {},
        async *stream() {
          yield { schema: 'doppler.generation-event/v1', type: 'text-delta', text: 'Controlled local answer' };
          yield { schema: 'doppler.generation-event/v1', type: 'complete', outputText: 'Controlled local answer' };
        } };
    }, async close() {} };
    const swarm = { getState: () => ({ sharing: false, consumer: { connectionState: 'connected', peers: mode === 'remote'
      ? [{ peerId: peer, model: model.id, modelIdentity: model.identity, readiness: 'ready', hasInference: true, availableSlots: 1 }] : [] } }),
      async connect() {}, hasProvider: () => mode === 'remote',
      async generate(messages, controls) {
        const preview = { id: crypto.randomUUID(), providerId: peer, recipientIdentity: peer, operation: 'generate', disclosure: 'public',
          modelId: controls.modelId, modelIdentity: controls.modelIdentity, adapterIdentities: [], input: messages, expiresAt: Date.now() + 10000 };
        if (!await controls.approve(preview)) throw Error('Declined');
        evidence.disclosures++; await controls.record({ stage: 'approved', preview });
        controls.onPartial('Controlled peer answer');
        return { model: controls.modelId, modelIdentity: controls.modelIdentity, adapterIdentities: [], provider: 'doppler', peerId: peer, content: 'Controlled peer answer' };
      } };
    const session = createChatSession({ storage: null, service, swarm, models: [model] });
    session.setCachedModels([model]);
    const root = document.createElement('main'); root.className = 'pool-home'; root.dataset.poolRouteId = 'network';
    root.innerHTML = '<nav class="pool-primary-nav"><button data-toggle-thread-rail>Threads</button></nav>' + renderConversationWorkspace();
    document.body.replaceChildren(root);
    const dispose = bindConversationWorkspace(root, session, { viewState: { executionLocation: mode === 'remote' ? 'network' : 'auto' } });
    window.executionFixture = { session, evidence, async close() { dispose(); await session.close(); } };
  }, mode);
}

test('a downloaded model prepares on Send without enabling contribution', async ({ page }) => {
  await installExecutionFixture(page, 'local');
  await page.locator('[data-composer-input]').fill('Use the downloaded model');
  await page.locator('[data-composer-send]').click();
  await expect(page.locator('[data-message-stream]')).toContainText('Controlled local answer');
  expect(await page.evaluate(() => ({ ...window.executionFixture.evidence,
    sharing: window.executionFixture.session.getState().network.sharing,
    placement: window.executionFixture.session.getState().activeThread.attempts.at(-1).execution.placement })))
    .toMatchObject({ opens: 1, disclosures: 0, sharing: false, placement: 'local-webgpu' });
  await page.evaluate(() => window.executionFixture.close());
});

test('network chat uses a permitted peer even with downloaded weights and respects opt-out', async ({ page }) => {
  await installExecutionFixture(page, 'remote');
  await page.evaluate(() => window.executionFixture.session.setRemoteAnswersEnabled(false));
  await page.locator('[data-composer-input]').fill('Use another contributor');
  await page.locator('[data-composer-send]').click();
  await expect(page.locator('[data-chat-error]')).toContainText('Network answers are off');
  expect(await page.evaluate(() => window.executionFixture.evidence.disclosures)).toBe(0);
  await page.evaluate(() => window.executionFixture.session.setRemoteAnswersEnabled(true));
  await page.locator('[data-composer-send]').click();
  await expect(page.locator('[data-message-stream]')).toContainText('Controlled peer answer');
  expect(await page.evaluate(() => ({ ...window.executionFixture.evidence,
    placement: window.executionFixture.session.getState().activeThread.attempts.at(-1).execution.placement })))
    .toMatchObject({ opens: 0, disclosures: 1, placement: 'peer-whole-request' });
  await page.evaluate(() => window.executionFixture.close());
});

test('changed runtime modules pass the Verification Worker sandbox', async ({ page }) => {
  const paths = ['ui/poolday-design/specimens.js', 'host/model-storage.js', 'host/work-model-files.js', 'host/chat-execution.js', 'host/chat-session.js', 'host/chat-view.js', 'vendor/reploid/chat/workspace.js', 'host/product-session.js',
    'infrastructure/model-storage-lock.js', 'providers/work-network-provider.js', 'providers/work-resident-provider.js', 'vendor/reploid/chat/scheduler.js',
    'ui/pool-home/network-controls.js', 'ui/pool-home/network-inspector.js', 'ui/pool-home/model-storage-view.js',
    ...['production', 'contribution-models', 'conversation-workspace', 'index', 'shell-view'].map(name => `ui/pool-home/${name}.js`)];
  const snapshot = Object.fromEntries(await Promise.all(paths.map(async path => ['/' + path, await readServedText(path)])));
  await page.goto('/');
  const result = await page.evaluate(snapshot => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    const timer = setTimeout(() => { worker.terminate(); reject(Error('Verification timed out')); }, 10000);
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
    worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(Error(event.message)); };
    worker.postMessage({ type: 'VERIFY', snapshot });
  }), snapshot);
  expect(result.errors).toEqual([]); expect(result.passed).toBe(true);
});

test('Settings measures browser model storage and removal uses the installed storage API', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  await page.locator('[data-workspace-view=settings]').click();
  await expect(page.locator('[data-model-storage]')).toBeVisible();
  await expect(page.locator('[data-storage-status]')).toHaveText('No model downloads stored.');
  // This isolated browser context contains only tiny test files, never user model weights.
  const proof = await page.evaluate(async () => {
    const { createModelStorage } = await import('/host/model-storage.js');
    const root = await navigator.storage.getDirectory();
    const models = await root.getDirectoryHandle('models', { create: true });
    for (const id of ['ui-storage-proof', 'unrelated-proof']) {
      const dir = await models.getDirectoryHandle(id, { create: true });
      const file = await dir.getFileHandle('shard_0.bin', { create: true });
      const writer = await file.createWritable(); await writer.write(new Uint8Array(37)); await writer.close();
    }
    const port = createModelStorage({ models: [{ id: 'ui-storage-proof', name: 'Fixture partial download' }], announce() {} });
    const before = await port.list(); await port.remove('ui-storage-proof');
    let removed = false; try { await models.getDirectoryHandle('ui-storage-proof'); } catch (error) { removed = error.name === 'NotFoundError'; }
    const kept = await (await (await models.getDirectoryHandle('unrelated-proof')).getFileHandle('shard_0.bin')).getFile();
    return { before, removed, retainedBytes: kept.size, after: await port.list() };
  });
  expect(proof).toEqual({ before: [{ id: 'ui-storage-proof', name: 'Fixture partial download', sizeBytes: 37 }], removed: true, retainedBytes: 37, after: [] });
});
