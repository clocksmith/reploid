import { test, expect } from '@playwright/test';

// The Computers and Settings drawers of the React product over an injected session: no peer, model or GPU.
async function networkFixture(page) {
  await page.evaluate(async () => {
    const { mountPoolday } = await import('/ui/react/app.js');
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    const root = document.createElement('div'); document.body.replaceChildren(root);
    let state = { models: [{ id: 'qwen', name: 'Qwen 3.5 0.8B', localCached: true }], defaultModel: { id: 'qwen' }, threads: [], runningIds: [], network: {
      sharing: true, computeEnabled: true, contribution: { modelId: 'qwen', phase: 'ready', partition: true },
      limits: { maxInboundJobs: 2, maxOutputTokens: 1024 },
      files: { sharing: false }, consumer: { peerId: 'local', connectionState: 'connected',
        peers: [{ peerId: 'remote-a' }, { peerId: 'remote-b' }, { peerId: 'requester' }] },
      partitionPeers: [0, 1].map(index => ({ transportId: index ? 'remote-b' : 'remote-a', available: true,
        description: { offer: { id: 'qwen' }, index, phase: 'ready' } }))
    } };
    const listeners = new Set(), listener = state => listeners.forEach(fn => fn(state));
    const session = { getState: () => state, subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
      async connect() { state.network.paused = false; state.network.consumer.connectionState = 'connected'; listener(state); },
      async disconnect() { state.network.paused = true; state.network.consumer.connectionState = 'disconnected'; state.network.sharing = false; state.network.files.sharing = false; listener(state); },
      // As the host: turning compute on reconnects a deliberately disconnected tab, and serves the downloaded model.
      async setComputeContribution(enabled) {
        if (enabled && state.network.paused) await session.connect();
        state.network.computeEnabled = enabled; state.network.sharing = enabled; listener(state);
      },
      async setFileSharing(enabled, model, approved) {
        if (enabled && !approved) throw Error('Approve file distribution separately from compute');
        state.network.files = { sharing: enabled, model: { id: 'qwen', name: 'Qwen 3.5 0.8B' } }; listener(state);
      }
    };
    globalThis.networkFixture = { state, session, notify: () => listener(state) };
    mountPoolday(root, { host: { chat: session, close: async () => {} } });
  });
  await page.locator('[data-chat-rail-toolbar] [data-inspector-section="participants"]').click();
  await page.locator('[data-production-device]').getByText('Contribute this computer').click();
}
const computeSwitch = page => page.locator('[data-production-device] [data-toggle-contribution]');
const filesSwitch = page => page.locator('[data-toggle-file-contribution] [role=switch]');
const connectionSwitch = page => page.locator('[data-mesh-connect] [role=switch]');

for (const theme of ['light', 'dark']) for (const width of [1440, 390, 320]) {
  test(`network contribution and peers, ${theme} ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(theme => localStorage.setItem('reploid.appearance.v1', theme), theme);
    await page.goto('/network?room=reploid-default&reploidBootRetry=2026091901');
    await expect(page.locator('[data-chat-workspace]')).toBeVisible();
    await networkFixture(page);
    await expect(page.locator('[data-tab-sharing-summary]')).toHaveText('Qwen 3.5 0.8B · partition compute');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('network.png'), fullPage: true });
    const compute = computeSwitch(page), files = filesSwitch(page), connection = connectionSwitch(page);
    await expect(compute).toHaveAttribute('aria-checked', 'true');
    await compute.click();
    await expect(page.locator('[data-tab-sharing-summary]')).toBeHidden();
    await expect(compute).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('[data-production-device]')).toContainText('Not sharing');
    await compute.click();
    await expect(page.locator('[data-production-device]')).toContainText('Ready');
    await page.locator('[data-chat-rail-toolbar] [data-inspector-section=settings]').click();
    await expect(files).toHaveAttribute('aria-checked', 'false');
    await files.click();
    await expect(files).toHaveAttribute('aria-checked', 'true');
    await page.locator('[data-chat-rail-toolbar] [data-inspector-section=participants]').click();
    await compute.click();
    await expect(files).toHaveAttribute('aria-checked', 'true');
    await connection.click();
    await expect(connection).toHaveAttribute('aria-checked', 'false');
    await expect(files).toHaveAttribute('aria-checked', 'false');
    // One explicit compute switch reconnects a deliberately disconnected tab.
    await compute.click();
    await expect(connection).toHaveAttribute('aria-checked', 'true');
    await expect(compute).toHaveAttribute('aria-checked', 'true');
    await expect(files).toHaveAttribute('aria-checked', 'false');
    expect(errors).toEqual([]);
  });
}

test('Changes keeps old failures in cards and opens detail only on selection', async ({ page }, info) => {
  await page.goto('/improve?room=reploid-default');
  await expect(page.locator('.changes-workspace')).toBeVisible();
  await page.evaluate(async () => {
    const { renderImproveSurface, bindWorkSurface } = await import('/ui/pool-home/work.js');
    const root = document.querySelector('.pool-route-content'); root.innerHTML = renderImproveSurface();
    const records = [{ id: 'a', goal: 'Review the formatter', modelName: 'Qwen 3.5 0.8B', status: 'failed', createdAt: Date.now(),
      error: 'The contributor disconnected.', events: [], artifacts: [], output: '' }];
    const listeners = new Set(), listener = state => listeners.forEach(fn => fn(state)); const state = { records, selectedId: 'a', runningIds: [], peerModels: [], models: [], available: true, activity: 'Idle' };
    const app = { getState: () => state, getDraft: () => null, subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); }, select(id) { state.selectedId = id; listener(state); } };
    bindWorkSurface(root, app, { evolution: { list: async () => [], describe: async () => [] } });
  });
  await expect(page.locator('[data-change-inspection]')).toBeHidden();
  await expect(page.locator('.change-card')).toHaveCount(1);
  await expect(page.locator('.change-card')).toContainText('The contributor disconnected.');
  await page.screenshot({ path: info.outputPath('changes.png'), fullPage: true });
  await page.locator('[data-work-select]').click();
  await expect(page.locator('[data-change-inspection]')).toBeVisible();
  await expect(page.locator('[data-work-result-error]')).toHaveText('The contributor disconnected.');
});

test('failed sharing stays off and remains visible during peer updates', async ({ page }) => {
  await page.goto('/network'); await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  await networkFixture(page);
  await page.evaluate(() => {
    Object.assign(networkFixture.state.network, { sharing: false, computeEnabled: false });
    networkFixture.session.setComputeContribution = async () => { throw Error('GPU memory unavailable'); };
    networkFixture.notify();
  });
  const compute = computeSwitch(page);
  await compute.click();
  await expect(page.locator('[data-inspector-pane="participants"] [data-network-message]')).toBeVisible();
  await expect(page.locator('[data-inspector-pane="participants"] [data-network-message]')).toHaveText('GPU memory unavailable');
  await page.evaluate(() => networkFixture.notify());
  await expect(compute).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('[data-inspector-pane="participants"] [data-network-message]')).toHaveText('GPU memory unavailable');
  expect(await page.evaluate(() => networkFixture.state.network.files.sharing)).toBe(false);
});
