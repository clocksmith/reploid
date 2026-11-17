import { test, expect } from '@playwright/test';

for (const width of [1440, 390]) test(`peer contribution counters retain scope and unknowns at ${width}px`, async ({ page }, info) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/?view=computers', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await expect(page.locator('[data-network-workspace]')).toBeAttached();
  await page.evaluate(async () => {
    const { bindNetworkControls, renderConnectionControl, renderSharingControls } = await import('/ui/pool-home/network-controls.js');
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    const root = document.querySelector('.pool-route-content');
    root.innerHTML = renderConnectionControl() + renderSharingControls()
      + '<ul data-insp-device-list></ul><span data-network-message></span><button data-mesh-invite hidden></button>';
    const state = { models: [], network: { consumer: { peers: [{ peerId: 'remote', model: 'Reported model', readiness: 'ready',
      contribution: { providedInputTokens: 128, providedOutputTokens: 0, receiptsServed: 1, receiptsConsumed: 2 } }] } } };
    let update;
    bindNetworkControls(root, { getState: () => state, subscribe(fn) { update = fn; fn(state); return () => {}; } });
    window.counterFixture = { state, notify: () => update(state) };
  });
  const row = page.locator('[data-computer-id="remote"]');
  await expect(row.locator('[data-computer-usage]')).toHaveText('Peer-reported eligible tokens provided: 128 input · 0 output');
  await row.locator('summary').first().click();
  await expect(row.locator('[data-computer-usage-scope]')).toBeVisible();
  await expect(row.locator('[data-computer-usage-scope]')).toContainText('not total traffic or lifetime usage');
  await expect(row.locator('[data-computer-receipts]')).toContainText('Eligible served receipts: 1 · Consumed receipts: 2');
  await page.evaluate(() => { window.counterFixture.state.network.consumer.peers[0].contribution.providedOutputTokens = 4; window.counterFixture.notify(); });
  await expect(row.locator('[data-computer-usage]')).toContainText('4 output');
  await expect(row.locator('[data-computer-usage-scope]')).toBeVisible();
  expect(await row.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('peer-counters.png'), fullPage: true });
  await page.evaluate(() => { delete window.counterFixture.state.network.consumer.peers[0].contribution; window.counterFixture.notify(); });
  await expect(row.locator('[data-computer-usage]')).toContainText('Unknown input · Unknown output');
});
