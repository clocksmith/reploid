import { test, expect } from '@playwright/test';

async function networkFixture(page) {
  await page.evaluate(async () => {
    const { renderNetworkSurface } = await import('/ui/pool-home/work.js');
    const { bindNetworkControls } = await import('/ui/pool-home/network-controls.js');
    const root = document.querySelector('.pool-route-content'); root.innerHTML = renderNetworkSurface();
    let state = { models: [{ id: 'qwen', name: 'Qwen 3.5 0.8B' }], defaultModel: { id: 'qwen' }, network: {
      sharing: true, contribution: { modelId: 'qwen', phase: 'ready', partition: true },
      limits: { maxInboundJobs: 2, maxOutputTokens: 1024 },
      files: { sharing: false }, consumer: { peerId: 'local', connectionState: 'connected',
        peers: [{ peerId: 'remote-a' }, { peerId: 'remote-b' }, { peerId: 'requester' }] },
      partitionPeers: [0, 1].map(index => ({ transportId: index ? 'remote-b' : 'remote-a', available: true,
        description: { offer: { id: 'qwen' }, index, phase: 'ready' } }))
    } };
    let listener;
    const session = { getState: () => state, subscribe(fn) { listener = fn; fn(state); return () => {}; },
      async setSharing(enabled, model, approved) {
        if (enabled && !approved) throw Error('Approve public prompt execution before sharing');
        state.network.sharing = enabled; listener(state);
      }, async setFileSharing(enabled, model, approved) {
        if (enabled && !approved) throw Error('Approve file distribution separately from compute');
        state.network.files = { sharing: enabled, model: { id: 'qwen', name: 'Qwen 3.5 0.8B' } }; listener(state);
      }
    };
    bindNetworkControls(root, session);
  });
}

for (const theme of ['light', 'dark']) for (const width of [1440, 390, 320]) {
  test(`network contribution and peers, ${theme} ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/network?room=reploid-default&reploidBootRetry=2026091901');
    await expect(page.locator('[data-network-workspace]')).toBeVisible();
    await page.getByRole('button', { name: theme === 'light' ? 'Light' : 'Dark', exact: true }).click();
    await networkFixture(page);
    await expect(page.locator('[data-tab-sharing-summary]')).toHaveText('Qwen 3.5 0.8B · partition compute');
    await expect(page.locator('[data-insp-device-list] li')).toHaveCount(3);
    await expect(page.locator('[data-insp-device-list]')).toContainText('Partition 2 · ready');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('network.png'), fullPage: true });
    await page.locator('summary').filter({ hasText: /^Compute/ }).click();
    await page.locator('[data-toggle-contribution]').click();
    await expect(page.locator('[data-tab-sharing-summary]')).toHaveText('No models shared by this tab');
    await page.locator('[data-toggle-contribution]').click();
    await expect(page.locator('[data-network-message]')).toHaveText('Approve public prompt execution before sharing');
    await page.locator('[data-contribution-consent]').check();
    await page.locator('[data-toggle-contribution]').click();
    await expect(page.locator('[data-contrib-label]')).toHaveText('Ready');
    await page.locator('summary').filter({ hasText: /^Model files/ }).click();
    await page.locator('[data-toggle-file-contribution]').click();
    await expect(page.locator('[data-network-message]')).toHaveText('Approve file distribution separately from compute');
    await page.locator('[data-file-contribution-consent]').check();
    await page.locator('[data-toggle-file-contribution]').click();
    await expect(page.locator('[data-file-contribution-label]')).toHaveText('Sharing');
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
    let listener; const state = { records, selectedId: 'a', runningIds: [], peerModels: [], models: [], available: true, activity: 'Idle' };
    const app = { getState: () => state, getDraft: () => null, subscribe(fn) { listener = fn; fn(state); return () => {}; }, select(id) { state.selectedId = id; listener(state); } };
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
