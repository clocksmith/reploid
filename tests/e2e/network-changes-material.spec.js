import { test, expect } from '@playwright/test';

async function networkFixture(page) {
  await page.evaluate(async () => {
    const { renderNetworkSurface } = await import('/ui/pool-home/work.js');
    const { bindNetworkInspector } = await import('/ui/pool-home/network-inspector.js');
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    document.querySelector('[data-shell-inspector]')?.remove();
    const root = document.querySelector('.pool-route-content'); root.innerHTML = '<div>' + renderNetworkSurface() + '</div>';
    let state = { models: [{ id: 'qwen', name: 'Qwen 3.5 0.8B' }], defaultModel: { id: 'qwen' }, network: {
      sharing: true, contribution: { modelId: 'qwen', phase: 'ready', partition: true },
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
      async setSharing(enabled, model, approved) {
        if (enabled && !approved) throw Error('Approve public prompt execution before sharing');
        state.network.sharing = enabled; listener(state);
      }, async setFileSharing(enabled, model, approved) {
        if (enabled && !approved) throw Error('Approve file distribution separately from compute');
        state.network.files = { sharing: enabled, model: { id: 'qwen', name: 'Qwen 3.5 0.8B' } }; listener(state);
      }
    };
    globalThis.networkFixture = { state, session, notify: () => listener(state) };
    bindNetworkInspector(root, session).open('device');
  });
}

for (const theme of ['light', 'dark']) for (const width of [1440, 390, 320]) {
  test(`network contribution and peers, ${theme} ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/network?room=reploid-default&reploidBootRetry=2026091901');
    await expect(page.locator('[data-network-workspace]')).toBeVisible();
    await page.evaluate(theme => document.querySelector('.pool-home').dataset.poolTheme = theme, theme);
    await networkFixture(page);
    await expect(page.locator('[data-tab-sharing-summary]')).toHaveText('Qwen 3.5 0.8B · partition compute');
    await expect(page.locator('[data-insp-device-list] li')).toHaveCount(3);
    await expect(page.locator('[data-insp-device-list]')).toContainText('Partition 2 · ready');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('network.png'), fullPage: true });
    const compute = page.getByRole('switch', { name: 'Help answer requests', exact: true, includeHidden: true });
    const files = page.getByRole('switch', { name: 'Store and share model files', exact: true, includeHidden: true });
    const connection = page.getByRole('switch', { name: 'Connect to network', includeHidden: true });
    await expect(compute).toHaveAttribute('aria-checked', 'true');
    await compute.click();
    await expect(page.locator('[data-tab-sharing-summary]')).toHaveText('No models shared by this tab');
    await compute.click();
    await expect(page.locator('[data-contrib-label]')).toHaveText('Ready');
    await expect(files).toHaveAttribute('aria-checked', 'false');
    await files.click();
    await expect(files).toHaveAttribute('aria-checked', 'true');
    await compute.click();
    await expect(files).toHaveAttribute('aria-checked', 'true');
    await page.locator('[data-inspector-section=participants]').click();
    await connection.click();
    await expect(connection).toHaveAttribute('aria-checked', 'false');
    await expect(files).toHaveAttribute('aria-checked', 'false');
    await page.locator('[data-inspector-section=device]').click();
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
  await page.goto('/network'); await expect(page.locator('[data-network-workspace]')).toBeVisible();
  await networkFixture(page);
  await page.evaluate(() => {
    networkFixture.state.network.sharing = false;
    networkFixture.session.setSharing = async () => { throw Error('GPU memory unavailable'); };
    networkFixture.notify();
  });
  const compute = page.getByRole('switch', { name: 'Help answer requests', exact: true, includeHidden: true });
  await compute.click();
  await expect(page.locator('[data-network-message]')).toHaveText('GPU memory unavailable');
  await page.evaluate(() => networkFixture.notify());
  await expect(compute).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('[data-network-message]')).toHaveText('GPU memory unavailable');
  await expect(page.getByRole('switch', { name: 'Store and share model files', exact: true, includeHidden: true })).toHaveAttribute('aria-checked', 'false');
});
