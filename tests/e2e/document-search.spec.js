import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createDocumentPackFixture } from '../fixtures/document-packs.js';

// Real browser/UI and public operation consumer; injected model outputs, not GPU qualification.
test('local document journey preserves protein UI, privacy, evidence, and experiment links', async ({ page }, testInfo) => {
  const fixture = await createDocumentPackFixture();
  const fixtureSource = (await readFile(new URL('../fixtures/document-packs.js', import.meta.url), 'utf8'))
    .replaceAll('../../self/', '/');
  await page.route('**/__fixtures__/document-packs.js', (route) => route.fulfill({ contentType: 'text/javascript', body: fixtureSource }));
  await page.route('**/__fixtures__/doppler.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `
    import { createDocumentPackFixture } from '/__fixtures__/document-packs.js';
    const fixture = await createDocumentPackFixture();
    export const DOPPLER_VERSION = '0.5.1';
    export const dr = { open() { throw new Error('Legacy model opening is forbidden in this test'); },
      openPack: fixture.service.openPack };
  ` }));
  await page.addInitScript(() => { window.REPLOID_DOPPLER_MODULE_URL = '/__fixtures__/doppler.js'; });
  const leaks = [];
  page.on('request', (request) => {
    if (request.postData()?.includes('PRIVATE_APPLE_CORPUS')) leaks.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('#pool-home-ask-form')).toBeVisible();
  await expect(page.locator('.pool-primary-nav .pool-nav-link')).toHaveCount(3);
  await expect(page.locator('.pool-experiments-footer a')).toHaveText(['Zero', 'X']);
  await page.locator('[data-pool-workflow="documents"]').click();
  await page.evaluate(async () => {
    const { refreshParticipationControls } = await import('/ui/pool-home/controls.js');
    await refreshParticipationControls();
  });
  await expect(page.locator('#pool-home-ask-form')).toBeHidden();
  await expect(page.locator('[data-document-submit]')).toBeDisabled();
  await page.locator('[data-document-search] summary').first().click();
  await page.locator('[data-document-models]').setInputFiles({ name: 'models.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture.configuration)) });
  await page.locator('[data-document-configure]').click();
  await expect(page.locator('[data-document-status]')).toHaveText('Confirm publisher trust first');
  await page.locator('[data-document-trust]').check();
  await page.locator('[data-document-configure]').click();
  await expect(page.locator('[data-document-model-status]')).toHaveText('Packs selected');
  await page.locator('[data-document-files]').setInputFiles([
    { name: 'fruit.md', mimeType: 'text/plain', buffer: Buffer.from('PRIVATE_APPLE_CORPUS grows apples. <script>window.documentLeaked=true</script>') },
    { name: 'sea.txt', mimeType: 'text/plain', buffer: Buffer.from('Whales live in the sea.') }
  ]);
  await expect(page.locator('[data-document-corpus]')).toContainText('fruit.md');
  await page.locator('[data-document-query]').fill('apple');
  await page.locator('[data-document-submit]').click();
  await expect(page.locator('[data-document-results] li')).toHaveCount(2);
  await expect(page.locator('[data-document-results] li').first()).toContainText('fruit.md');
  expect(await page.evaluate(() => window.documentLeaked)).toBeUndefined();
  await page.locator('[data-document-rerank]').check();
  await page.locator('[data-document-submit]').click();
  await expect(page.locator('[data-document-results] li').first()).toContainText('sea.txt');
  expect(leaks).toEqual([]);
  await page.getByRole('link', { name: 'Recent jobs', exact: true }).click();
  await expect(page.locator('[data-document-history] li')).toHaveCount(2);
  await page.getByRole('link', { name: 'Run a model', exact: true }).click();
  await page.locator('[data-pool-workflow="documents"]').click();
  await expect(page.locator('#pool-home-ask-form')).toBeHidden();
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const element of document.querySelectorAll('*')) if (element.scrollTop) element.scrollTop = 0;
  });
  await expect(page.locator('.pool-primary-brand')).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('documents-desktop.png') });
  await page.locator('[data-document-evidence]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-document-evidence]')).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('documents-results-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.locator('#pool-home-ask-form')).toBeHidden();
  await expect(page.locator('[data-document-submit]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('documents-mobile.png') });
  await page.locator('.pool-experiments-footer').scrollIntoViewIfNeeded();
  await expect(page.locator('.pool-experiments-footer')).toBeInViewport();
  await page.locator('[data-document-evidence]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-document-results] li').last()).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('documents-results-mobile.png') });
  await page.locator('[data-pool-workflow="sequence"]').click();
  await expect(page.locator('#pool-home-ask-form')).toBeVisible();
  await expect(page.locator('[data-document-search]')).toBeHidden();
  await page.locator('[data-pool-workflow="documents"]').click();
  await expect(page.locator('#pool-home-ask-form')).toBeHidden();
  await page.locator('[data-document-clear]').click();
  await expect(page.locator('[data-document-results] li')).toHaveCount(0);
  await expect(page.locator('[data-document-query]')).toHaveValue('');
  await expect(page.locator('[data-document-submit]')).toBeDisabled();
});

test('changed Reploid modules pass the actual Verification Worker', async ({ page }, testInfo) => {
  const paths = ['pool/model-contract.js', 'pool/operation-model.js', 'pool/local-pack-executor.js',
    'pool/document-search.js', 'pool/pack-operation-adapters.js', 'ui/pool-home/document-search.js', 'ui/pool-home/index.js', 'ui/pool-home/view.js', 'ui/pool-home/controls.js'];
  const snapshot = Object.fromEntries(await Promise.all(paths.map(async (path) => [
    `/${path}`, await readFile(new URL(`../../self/${path}`, import.meta.url), 'utf8')
  ])));
  for (const path of ['unit/pool-document-search.test.js', 'unit/pool-pack-operation.test.js', 'unit/pool-home-nav.test.js', 'unit/pool-home-record.test.js', 'e2e/document-search.spec.js', 'fixtures/document-packs.js', 'fixtures/doppler-pack-handoff.js']) {
    snapshot[`/testing/${path}`] = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  }
  await page.goto('/');
  const report = await page.evaluate((snapshot) => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Verification Worker timed out')); }, 30000);
    worker.onerror = (error) => { clearTimeout(timeout); worker.terminate(); reject(new Error(error.message)); };
    worker.onmessage = ({ data }) => { clearTimeout(timeout); worker.terminate(); resolve(data); };
    worker.postMessage({ type: 'VERIFY', snapshot, options: {} });
  }), snapshot);
  await testInfo.attach('verification-worker.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  expect(report.passed, JSON.stringify(report.errors)).toBe(true);
});
