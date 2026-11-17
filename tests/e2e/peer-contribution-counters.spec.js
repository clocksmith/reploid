import { test, expect } from '@playwright/test';
import { readServedText, readServedHarnessFile } from '../helpers/served-browser-files.js';

// Presentation contract only: use the served UI without discovery or model startup.
test.beforeEach(async ({ page }) => {
  await page.route('http://127.0.0.1:5198/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') {
      const manifest = JSON.parse(await readServedText('styles/poolday/layers.json'));
      const layers = [manifest.tokens, ...manifest.primitives, ...manifest.compositions];
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html class="pool-page"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + layers.map(file => `<link rel="stylesheet" href="/styles/poolday/${file}">`).join('')
        + '<main class="pool-home"><div class="pool-route-content"></div></main>' });
    }
    const body = await readServedHarnessFile('/self' + pathname);
    return body ? route.fulfill({ contentType: pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.json') ? 'application/json' : 'text/javascript', body }) : route.abort();
  });
});

for (const width of [1440, 390]) test(`peer contribution counters retain scope and unknowns at ${width}px`, async ({ page }, info) => {
  test.setTimeout(45000);
  await page.setViewportSize({ width, height: 900 });
  await page.goto('http://127.0.0.1:5198/');
  await page.evaluate(async () => {
    const { bindNetworkControls, renderConnectionControl, renderSharingControls } = await import('/ui/pool-home/network-controls.js');
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
  await expect(row.locator('[data-computer-usage]')).toBeHidden();
  await row.locator('summary').first().click();
  await expect(row.locator('[data-computer-input-tokens]')).toHaveText('128');
  await expect(row.locator('[data-computer-output-tokens]')).toHaveText('0');
  await page.locator('[data-computer-usage-help] > summary').click();
  await expect(page.locator('[data-computer-usage-scope]')).toBeVisible();
  await expect(page.locator('[data-computer-usage-scope]')).toContainText('not total traffic or lifetime usage');
  await expect(row.locator('[data-computer-served-receipts]')).toHaveText('1');
  await expect(row.locator('[data-computer-consumed-receipts]')).toHaveText('2');
  await page.evaluate(() => { window.counterFixture.state.network.consumer.peers[0].contribution.providedOutputTokens = 4; window.counterFixture.notify(); });
  await expect(row.locator('[data-computer-output-tokens]')).toHaveText('4');
  await expect(page.locator('[data-computer-usage-scope]')).toBeVisible();
  expect(await row.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('peer-counters.png'), fullPage: true });
  await page.evaluate(() => { delete window.counterFixture.state.network.consumer.peers[0].contribution; window.counterFixture.notify(); });
  await expect(row.locator('[data-computer-input-tokens]')).toHaveText('Not reported');
  await expect(row.locator('[data-computer-output-tokens]')).toHaveText('Not reported');
});
