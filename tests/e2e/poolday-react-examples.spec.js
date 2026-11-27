// The Examples route (/examples) on the React product: the protein-sequence form's local validation and consent,
// the workflow switch, and the local document search over injected model outputs. Ported from the /examples parts of
// pool-prismatic-ui.spec.js and document-search.spec.js, which address the retired vanilla markup. Fixtures prove
// interaction, privacy and layout; they do not claim model execution or GPU qualification.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createDocumentPackFixture } from '../fixtures/document-packs.js';
import documentPolicy from '../../apps/poolday/pool/document-search-policy.json' with { type: 'json' };
import dopplerPackage from '../../shared/config/doppler-package.json' with { type: 'json' };

// The fixture runtime reports the pinned Doppler release, as the runtime service requires.
const RUNTIME = dopplerPackage.version;

const page$ = (page) => page.locator('[data-route-page-content="examples"]');

async function open(page, errors) {
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto('/examples?relay=local');
  await expect(page$(page)).toBeVisible({ timeout: 30000 });
}

test('shows the examples page with its brand, prism, experiments and an idle sequence form', async ({ page }) => {
  const errors = [];
  await open(page, errors);
  await expect(page$(page).getByRole('heading', { level: 1 })).toHaveText('Reploid');
  await expect(page$(page)).toContainText('Protein analysis and document search exercise specific model operations.');
  await expect(page.getByRole('heading', { name: 'Explore examples' })).toBeVisible();
  await expect(page$(page).getByRole('link', { name: 'Start with a goal instead' })).toHaveAttribute('href', '/');
  await expect(page.locator('[data-pool-prism]')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('[data-pool-experiments-footer] a')).toHaveText(['Zero', 'X']);
  await expect(page.locator('[data-pool-run-surface]')).toHaveAttribute('data-run-state', 'idle');
  await expect(page.locator('[data-pool-run-status]')).toHaveText('Ready');
  await expect(page.locator('[data-pool-run-output]')).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect(errors).toEqual([]);
});

test('validates the sequence locally, fills the example and asks for public consent before sending', async ({ page }) => {
  const errors = [];
  await open(page, errors);
  const input = page.getByRole('textbox', { name: 'Public protein sequence' });
  const count = page.locator('[data-pool-sequence-count]');
  const consent = page.getByRole('switch', { name: 'This input may be sent to selected peers' });
  await expect(input).toHaveValue('');
  await expect(consent).toHaveAttribute('aria-checked', 'false');
  const sample = await input.getAttribute('data-pool-suggested-prompt');
  expect(sample).toMatch(/^[A-Z]+$/);
  await page.getByRole('button', { name: 'Use example', exact: true }).click();
  await expect(input).toHaveValue(sample);
  await expect(input).toBeFocused();
  await expect(count).toHaveText(`${sample.length} / 1024`);
  await input.fill('MZ*');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(page$(page)).toContainText('non-canonical');
  await page.getByRole('button', { name: 'Run model', exact: true }).click();
  await expect(page.locator('[data-pool-run-surface]')).toHaveAttribute('data-run-state', 'idle');
  await input.fill('A'.repeat(1025));
  await expect(page$(page)).toContainText('This model accepts up to 1024 residues.');
  await input.fill('  M A\nG  ');
  await expect(count).toHaveText('3 / 1024');
  await expect(input).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page$(page)).toContainText('Whitespace is ignored.');
  // Without consent the run stops before any request leaves the page.
  await page.getByRole('button', { name: 'Run model', exact: true }).click();
  await expect(page.locator('[data-pool-run-surface]')).toHaveAttribute('data-run-state', 'error');
  await expect(page.locator('[data-pool-run-output]')).toContainText('Confirm that this protein sequence is public before sending it to selected contributors');
  await consent.click();
  await expect(page.locator('[data-pool-sequence-consent-saved]')).toHaveText('Saved');
  expect(await page.evaluate(() => localStorage.getItem('reploid.pool.sequence-public-consent.v1'))).toBe('true');
  await page.getByText('Options', { exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Two matching peers' })).toBeVisible();
  await expect(page$(page)).toContainText('Sequence embedding · 480 dimensions');
  expect(errors).toEqual([]);
});

const prismStats = (page) => page.evaluate(() => window.REPLOID_POOL_PRISM_STATS);
const unchangedFrames = async (page) => {
  const before = (await prismStats(page)).frames;
  await page.waitForTimeout(200);
  expect((await prismStats(page)).frames).toBe(before);
};

test('draws the prism light with WebGPU, rests when idle, yields to a run and holds still under reduced motion', async ({ page }) => {
  const errors = [];
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page, errors);
  await expect.poll(async () => { const stats = await prismStats(page); return { backend: stats?.backend, error: stats?.error }; }, { timeout: 15000 })
    .toEqual({ backend: 'webgpu', error: undefined });
  await expect(page.locator('[data-pool-prism]')).toHaveAttribute('data-prism-state', 'ready');
  await expect.poll(async () => (await prismStats(page)).suspended).toBe(true);
  await unchangedFrames(page);
  const initial = (await prismStats(page)).frames;
  await page.locator('[data-pool-prism]').hover({ position: { x: 40, y: 50 } });
  await expect.poll(async () => (await prismStats(page)).frames).toBeGreaterThan(initial);
  // A run in progress pauses the effect.
  await page.getByRole('textbox', { name: 'Public protein sequence' }).fill('MAG');
  await page.getByRole('switch', { name: 'This input may be sent to selected peers' }).click();
  await page.getByRole('button', { name: 'Run model', exact: true }).click();
  await expect(page.locator('[data-pool-run-surface]')).toHaveAttribute('data-run-state', /submitting|running/);
  await expect(page.locator('[data-pool-brand-status]')).not.toBeEmpty();
  await expect.poll(async () => (await prismStats(page)).suspended).toBe(true);
  await page.waitForTimeout(100);
  await unchangedFrames(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const stats = await prismStats(page);
  expect(Math.max(stats.width, stats.height)).toBeLessThanOrEqual(560);
  expect(stats.frameIntervalMs).toBeGreaterThanOrEqual(1000 / 30);
  expect(errors).toEqual([]);
});

for (const answerText of ['Apple trees grow fruit. [1]', documentPolicy.answerAbstention]) {
  test(`local document search keeps files private and shows evidence with ${answerText === documentPolicy.answerAbstention ? 'abstention' : 'citations'}`, async ({ page }, testInfo) => {
    const fixture = await createDocumentPackFixture({ schema: 'doppler.capsule/v3', runtimeVersion: RUNTIME });
    const fixtureSource = (await readFile(new URL('../fixtures/document-packs.js', import.meta.url), 'utf8'))
      .replaceAll('../../self/', '/').replaceAll('../../shared/', '/');
    await page.route('**/__fixtures__/document-packs.js', (route) => route.fulfill({ contentType: 'text/javascript', body: fixtureSource }));
    await page.route('**/__fixtures__/doppler.js', (route) => route.fulfill({ contentType: 'text/javascript', body: `
      import { createDocumentPackFixture } from '/__fixtures__/document-packs.js';
      const fixture = await createDocumentPackFixture({ answerText: ${JSON.stringify(answerText)}, schema: 'doppler.capsule/v3', runtimeVersion: ${JSON.stringify(RUNTIME)} });
      export const DOPPLER_VERSION = ${JSON.stringify(RUNTIME)};
      export const openCapsule = fixture.service.openCapsule;
    ` }));
    // The entry page resolves its own Doppler module URL at boot; the fixture module must survive that assignment.
    await page.addInitScript(() => Object.defineProperty(window, 'REPLOID_DOPPLER_MODULE_URL', { configurable: true, get: () => '/__fixtures__/doppler.js', set() {} }));
    const leaks = [];
    page.on('request', (request) => { if (request.postData()?.includes('PRIVATE_APPLE_CORPUS')) leaks.push(request.url()); });
    const errors = [];
    await open(page, errors);
    await page.getByRole('radio', { name: 'Document search' }).check();
    await expect(page.locator('[data-pool-home-ask-form]')).toHaveCount(0);
    await expect(page.locator('[data-document-submit]')).toBeDisabled();
    await expect(page.locator('[data-document-setup]')).toHaveAttribute('open', '');
    await expect(page.locator('[data-document-status]')).toHaveText('Choose models to start.');
    await expect(page.locator('[data-document-model-status]')).toHaveText('No models selected');
    await page.locator('[data-document-models]').setInputFiles({ name: 'models.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture.configuration)) });
    await page.locator('[data-document-configure]').click();
    await expect(page.locator('[data-document-status]')).toHaveText('Confirm you trust the model publishers first');
    await page.locator('[data-document-trust]').click();
    await page.locator('[data-document-configure]').click();
    await expect(page.locator('[data-document-model-status]')).toHaveText('Models selected');
    await expect(page.locator('[data-document-setup]')).not.toHaveAttribute('open', '');
    await expect(page.locator('[data-document-status]')).toHaveText('Add documents to start.');
    await page.locator('[data-document-files]').setInputFiles([
      { name: 'fruit.md', mimeType: 'text/plain', buffer: Buffer.from('PRIVATE_APPLE_CORPUS grows apples. <script>window.documentLeaked=true</script>') },
      { name: 'sea.txt', mimeType: 'text/plain', buffer: Buffer.from('Whales live in the sea.') }
    ]);
    await expect(page.locator('[data-document-corpus]')).toContainText('fruit.md');
    await page.locator('[data-document-query]').fill('apple');
    await page.locator('[data-document-submit]').click();
    const results = page.locator('[data-document-results] [data-document-result]');
    await expect(results).toHaveCount(2);
    await expect(results.first()).toContainText('fruit.md');
    expect(await page.evaluate(() => window.documentLeaked)).toBeUndefined();
    await page.locator('[data-document-rerank]').click();
    await page.locator('[data-document-answer]').click();
    await page.locator('[data-document-submit]').click();
    await expect(results.first()).toContainText('sea.txt');
    await expect(page.locator('[data-document-answer-output]')).toContainText(answerText);
    await expect(page.locator('[data-document-evidence]')).toBeVisible();
    expect(leaks).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('documents-desktop.png'), fullPage: true });
    // Switching to sequences and back keeps the search.
    await page.getByRole('radio', { name: 'Protein sequences' }).check();
    await expect(page.locator('[data-pool-home-ask-form]')).toBeVisible();
    await expect(page.locator('[data-document-search]')).toHaveCount(0);
    await page.getByRole('radio', { name: 'Document search' }).check();
    await expect(results).toHaveCount(2);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('[data-document-submit]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('documents-mobile.png'), fullPage: true });
    await page.locator('[data-document-clear]').click();
    await expect(results).toHaveCount(0);
    await expect(page.locator('[data-document-query]')).toHaveValue('');
    await expect(page.locator('[data-document-submit]')).toBeDisabled();
    expect(errors).toEqual([]);
  });
}
