import { test, expect } from '@playwright/test';
import { readServedText } from '../helpers/served-browser-files.js';

// The React product over an injected session: no discovery, inference, model loading or GPU work. The bar, the
// drawers' geometry and keyboard access are workspace-navigation, poolday-layout-stability and chat-rails specs.
test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.locator('[data-chat-workspace]').waitFor();
  await page.evaluate(async () => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    const { mountPoolday } = await import('/ui/react/app.js');
    const root = document.createElement('div'); document.body.replaceChildren(root);
    const model = { id: 'qwen', name: 'Qwen 3.5 0.8B', availability: 'ready' };
    const thread = { id: 'thread', title: 'Jump into a useful conversation', model, permissions: { sharingScope: 'mesh' }, grants: [],
      messages: [{ id: 'question', role: 'user', content: 'Jump!' }, { id: 'response', role: 'assistant', attemptId: 'attempt', content: 'Ready for the challenge. Let’s go.' }],
      attempts: [{ id: 'attempt', status: 'completed', execution: { placement: 'two-device-layer-partition', participantA: 'participant-c', participantB: 'participant-a', requesterId: 'requester',
        stepSummary: { metrics: { localStepMs: { count: 4, total: 1000 }, remoteStepMs: { count: 4, total: 3000 } } } } }] };
    const listeners = new Set(), drafts = new Map();
    const state = window.railState = { participantId: 'requester', models: [model], defaultModel: model,
      threads: [thread, ...Array.from({ length: 12 }, (_, index) => ({ ...thread, id: 'old-' + index, title: 'Earlier conversation ' + (index + 1) }))],
      activeThread: thread, selectedId: thread.id, runningIds: [], network: {
        consumer: { peerId: 'requester-transport', connectionState: 'connected', peers: ['a', 'b', 'c', 'd'].map(id => ({ peerId: 'transport-' + id })) },
        partitionPeers: ['a', 'b', 'c', 'd'].map(id => ({ transportId: 'transport-' + id, participantId: 'participant-' + id, available: true, description: { index: id === 'a' ? 1 : 0, phase: 'ready', offer: model } }))
      } };
    // Each update is a new snapshot, as the host publishes them.
    const emit = window.emitRailState = () => { const next = structuredClone(state); listeners.forEach(listener => listener(next)); };
    const session = { getState: () => structuredClone(state), subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      saveDraft: (id, draft) => drafts.set(id, draft), getDraft: id => drafts.get(id),
      select(id) { state.selectedId = id; state.activeThread = state.threads.find(item => item.id === id) || null; emit(); },
      disconnect() { state.network.consumer.connectionState = 'disconnected'; emit(); }, connect() { state.network.consumer.connectionState = 'connected'; emit(); }
    };
    window.railSession = session;
    window.disposeRails = mountPoolday(root, { host: { chat: session, close: async () => {} } });
  });
});
const openComputers = page => page.locator('[data-chat-rail-toolbar] [data-inspector-section="participants"]').click();
// Connecting and idle computers fold under "Show others"; this journey follows one of them, so it stays unfolded.
const showQuiet = async page => {
  const toggle = page.locator('[data-quiet-computers]');
  if (await toggle.count() && await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
};
const update = async (page, fn, arg) => { await page.evaluate(fn, arg); await showQuiet(page); };

for (const theme of ['light', 'dark']) for (const width of [1440, 390, 320]) {
  test(`computer facts stay readable and IDs stay folded: ${theme}, ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(theme => {
      localStorage.setItem('reploid.appearance.v1', theme);
      const state = window.railState, key = 'peer:' + 'a'.repeat(24);
      state.network.partitionPeers = [];
      state.network.connections = [{ id: 'transport-a', attemptId: '0c0b796e-ad08-4c56-be9a-477fcf5087833:1:2', phase: 'connected', path: 'direct' }];
      state.network.consumer.peers = [
        { peerId: 'transport-a', participantId: key, identityVerified: true, model: 'qwen', readiness: 'ready',
          modelIdentity: 'sha256:' + 'a'.repeat(64), hardware: { vendor: 'apple', architecture: 'metal-3', device: 'apple-m3-pro' },
          contribution: { providedInputTokens: 128, providedOutputTokens: 0, receiptsServed: 1, receiptsConsumed: 2 } },
        { peerId: 'transport-b', model: 'qwen', readiness: 'ready' }
      ];
      window.emitRailState();
    }, theme);
    await openComputers(page);
    const row = page.locator('[data-computer-id="transport-a"]');
    const details = row.locator('[data-computer-details]');
    await expect(details.getByText('128', { exact: true })).toBeHidden();
    await details.locator(':scope > summary').click();
    await expect(details).toContainText('Direct');
    await expect(details).toContainText('Authenticated');
    await expect(details.getByText('128', { exact: true })).toBeVisible();
    await expect(details.getByText('sha256:' + 'a'.repeat(64))).toBeHidden();
    await expect(page.locator('[data-computer-usage-help]')).toHaveCount(1);
    await row.scrollIntoViewIfNeeded();
    await row.screenshot({ path: info.outputPath('computer-details.png') });
    const preferences = details.locator('[data-computer-preferences]');
    if (await preferences.count()) {
      await preferences.locator(':scope > summary').click();
      await row.locator('[data-computer-name-input] input, input[data-computer-name-input]').first().fill('Desk');
      await page.evaluate(() => { window.railState.network.consumer.peers[0].contribution.providedOutputTokens = 4; window.emitRailState(); });
      await expect(row.locator('[data-computer-name-input] input, input[data-computer-name-input]').first()).toHaveValue('Desk');
      await expect(details.getByText('4', { exact: true })).toBeVisible();
      await preferences.locator(':scope > summary').click();
    }
    expect(await row.evaluate(node => node.getBoundingClientRect().right <= innerWidth && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await details.locator('[data-computer-identifiers] > summary').click();
    await expect(details).toContainText('0c0b796e-ad08-4c56-be9a-477fcf5087833:1:2');
    await expect(details).toContainText('sha256:' + 'a'.repeat(64));
    expect(await row.evaluate(node => node.getBoundingClientRect().right <= innerWidth && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await row.screenshot({ path: info.outputPath('computer-identifiers.png') });
  });
}

for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
  test(`${theme} connection journey preserves pending, transfer, readiness and interruption at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await update(page, theme => {
      localStorage.setItem('reploid.appearance.v1', theme);
      const network = window.railState.network;
      network.partitionPeers = [];
      network.consumer.peers = [];
      network.consumer.connections = [{ id: 'transport-a', attemptId: 'connection-1', phase: 'preparing' }];
      window.emitRailState();
    }, theme);
    await page.locator('[data-composer-input]').fill('Keep the draft while computers connect.');
    await openComputers(page); await showQuiet(page);
    const row = page.locator('[data-insp-device-list] [data-computer-id]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Preparing connection');
    await expect(row).toContainText('Waiting for connection configuration');
    await expect(row).toBeInViewport();
    await page.screenshot({ path: info.outputPath('pending.png') });
    await update(page, () => { window.railState.network.consumer.connections[0].phase = 'awaiting-answer'; window.emitRailState(); });
    await expect(row).toContainText('Waiting for computer');
    await update(page, () => { window.railState.network.consumer.connections[0].phase = 'connected'; window.emitRailState(); });
    await expect(row).toContainText('Waiting for this computer to report its model status');
    await expect(page.locator('[data-peer-readiness]')).toContainText('0 computers ready');
    await update(page, () => {
      window.railState.network.consumer.peers = [{ peerId: 'transport-a', model: 'qwen', readiness: 'loading',
        preparation: { kind: 'receiving', receivedBytes: 25, totalBytes: 100 } }]; window.emitRailState();
    });
    await expect(row).toContainText('Receiving files');
    await expect(row.locator('progress')).toHaveAttribute('value', '25');
    await row.locator('summary').first().click();
    await update(page, () => { window.railState.network.consumer.peers[0].preparation.receivedBytes = 75; window.emitRailState(); });
    await expect(row.locator('progress')).toHaveAttribute('value', '75');
    await expect(row.locator('details').first()).toHaveAttribute('open', '');
    await page.screenshot({ path: info.outputPath('receiving.png') });
    await update(page, () => {
      window.railState.network.consumer.connections[0].authenticated = true;
      window.railState.network.consumer.peers[0].preparation = { kind: 'pipelines', prepared: 2, total: 4 };
      window.emitRailState();
    });
    await expect(row).toContainText(/Identity\s*Authenticated/);
    await expect(row).toContainText('Preparing GPU');
    await expect(row.locator('progress')).toHaveAttribute('value', '2');
    await update(page, () => { window.railState.network.consumer.peers[0].readiness = 'ready'; window.emitRailState(); });
    await expect(page.locator('[data-peer-readiness]')).toContainText('1 computer ready');
    await expect(row.locator('[data-computer-status]')).toHaveText('Ready');
    await page.screenshot({ path: info.outputPath('ready.png') });
    await update(page, () => { window.railState.network.consumer.peers[0].activity = { phase: 'executing' }; window.emitRailState(); });
    await expect(row.locator('[data-computer-status]')).toHaveText('Working');
    await update(page, () => { window.railState.network.consumer.peers[0].activity.phase = 'stopping'; window.emitRailState(); });
    await expect(row.locator('[data-computer-status]')).toHaveText('Stopping');
    await update(page, () => { window.railState.network.consumer.connections[0].phase = 'interrupted'; window.emitRailState(); });
    await expect(row).toContainText('Connection interrupted');
    await expect(page.locator('[data-peer-readiness]')).toContainText('0 computers ready');
    await page.screenshot({ path: info.outputPath('interrupted.png') });
    await expect(row.locator('[data-computer-status]')).not.toHaveText('Ready');
    await update(page, () => {
      window.railState.network.consumer.connections[0] = { id: 'transport-a', attemptId: 'connection-2', phase: 'connected' };
      window.railState.network.consumer.peers[0].attemptId = 'connection-1';
      window.emitRailState();
    });
    await expect(row).toContainText('Waiting for this computer to report its model status');
    await expect(row).toContainText(/Identity\s*Not observed/);
    await expect(page.locator('[data-peer-readiness]')).toContainText('0 computers ready');
    await update(page, () => {
      window.railState.network.consumer.connections = []; window.railState.network.consumer.peers = [];
      window.railState.network.consumer.connectionState = 'retrying';
      window.railState.network.connectionFailure = { peerId: 'transport-a', message: 'Connection timed out' };
      window.emitRailState();
    });
    await expect(row).toContainText('Connection failed');
    await expect(page.locator('[data-connection-detail]')).toContainText('Retrying');
    await page.screenshot({ path: info.outputPath('failed.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.locator('[data-close-inspector]:visible').click();
    await expect(page.locator('[data-composer-input]')).toHaveValue('Keep the draft while computers connect.');
  });
}

test('connection runtime passes the Verification Worker', async ({ page }, info) => {
  const files = ['host/work-swarm.js', 'vendor/reploid/transport/swarm.js', 'vendor/reploid/transport/room.js',
    'vendor/reploid/mesh/peer-generation.js', 'ui/pool-home/network-controls.js', 'host/decisions/computers.js',
    'ui/pool-home/computer-labels.js', 'ui/pool-home/shell-view.js', 'ui/pool-home/message-list.js',
    'providers/work-resident-provider.js', 'vendor/reploid/mesh/preparation-progress.js', 'vendor/reploid/mesh/peer-identity.js',
    'vendor/reploid/mesh/partitions/automatic-partitions.js', 'vendor/reploid/mesh/partitions/automatic-ordered-partitions.js',
    'vendor/reploid/retrieval/sources.js', 'vendor/reploid/retrieval/retrieval.js', 'vendor/reploid/chat/workspace.js',
    'host/chat-session.js', 'host/decisions/conversation-controller.js', 'ui/pool-home/web-search-settings.js'];
  const snapshot = Object.fromEntries(await Promise.all(files.map(async file => ['/' + file, await readServedText(file)])));
  const result = await page.evaluate(snapshot => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    worker.onerror = event => { worker.terminate(); reject(Error(event.message)); };
    worker.onmessage = event => { worker.terminate(); resolve(event.data); };
    worker.postMessage({ type: 'VERIFY', snapshot });
  }), snapshot);
  await info.attach('verification.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  expect(result.errors).toEqual([]); expect(result.passed).toBe(true);
});


for (const width of [1440, 390]) test(`system failure is separate from model output and controls align at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  await page.evaluate(() => {
    const thread = window.railState.activeThread;
    thread.messages[1].content = '';
    thread.attempts[0] = { id: 'attempt', status: 'failed', error: 'Could not retrieve sources: retrieval exceeded its time limit.',
      retrieval: { outcome: 'failed', limits: { timeoutMs: 10000 }, error: { code: 'timeout', stage: 'extraction' } } };
    window.emitRailState();
  });
  const row = page.locator('[data-message-role="assistant"]');
  await expect(row.locator('[data-system-status]')).toHaveText('System · Reading search results timed out after 10 seconds. No model answer was generated.');
  await expect(row.getByLabel('Model output')).toHaveCount(0);
  await expect(row.locator('[data-copy-message]')).toHaveCount(0);
  await expect(row.locator('[data-retry-attempt]')).toHaveText('Retry');
  const boxes = await row.evaluate(row => ({
    status: row.querySelector('[data-system-status]').getBoundingClientRect().toJSON(),
    details: row.querySelector('[data-execution-trigger]').getBoundingClientRect().toJSON(),
    retry: row.querySelector('[data-retry-attempt]').getBoundingClientRect().toJSON()
  }));
  expect(Math.abs(boxes.details.x - boxes.status.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(boxes.details.y - boxes.retry.y)).toBeLessThanOrEqual(1);
  expect(boxes.retry.x - boxes.details.right).toBeLessThanOrEqual(24);
  await page.screenshot({ path: info.outputPath('retrieval-failure.png') });
});

for (const width of [1440, 390]) test(`search progress, retry history and reviewed context remain clear at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  await page.evaluate(() => {
    const thread = window.railState.activeThread;
    thread.messages[1].content = '';
    thread.attempts[0] = { id: 'attempt', status: 'failed', error: 'Could not retrieve sources: the search provider failed.' };
    thread.messages.push({ id: 'retry-response', role: 'assistant', content: '', attemptId: 'retry' });
    thread.attempts.push({ id: 'retry', retryOf: 'attempt', status: 'queued', retrieval: { outcome: 'pending',
      progress: { stage: 'extraction', completed: 2, total: 5, available: 2 } } });
    window.emitRailState();
  });
  const row = page.locator('[data-message-role="assistant"]');
  await expect(row).toHaveCount(1);
  // Retrieval progress shows in the answer's loader while the retry is queued; the system line stays for outcomes.
  await expect(row.locator('[data-execution-trigger]')).toContainText('Reading search results · 2 of 5 pages');
  await expect(row.getByLabel('Model output')).toHaveCount(0);
  await row.locator('[data-previous-attempts] summary').click();
  await expect(row.locator('[data-previous-attempts]')).toContainText('the search provider failed');
  await page.screenshot({ path: info.outputPath('search-progress.png') });
  await page.evaluate(() => {
    const thread = window.railState.activeThread;
    thread.messages.at(-1).content = 'An answer from the available pages.';
    Object.assign(thread.attempts.at(-1), { status: 'completed', retrieval: { outcome: 'retrieved', partial: true,
      sources: [{ number: 1, title: 'Retrieved page', url: 'https://example.com/page' }] } });
    window.emitRailState();
  });
  await expect(row.locator('[data-system-status]')).toContainText('Using 1 retrieved source. Some pages were unavailable.');
  await expect(row.getByLabel('Model output')).toContainText('An answer from the available pages.');
  await expect(row.locator('[data-previous-attempts]')).toHaveAttribute('open', '');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('partial-search-answer.png') });
  // Search-backed answers run under Send without a per-answer dialog; the former query-review dialog is not rendered.
});
