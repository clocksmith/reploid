import { test, expect } from '@playwright/test';
import * as installed from 'doppler-gpu/partitions';
import { DOPPLER_PARTITIONS_MODULE_URL } from '../../self/config/doppler-local-models.js';

test('host retires acquired storage when partition admission fails before GPU loading', async ({ page }, testInfo) => {
  await page.route('**/partition-import-probe', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Partition opening cleanup</title>',
  }));
  // Exercise actual plan/factory/host contracts without allocating a GPU device.
  await page.route(`**${DOPPLER_PARTITIONS_MODULE_URL}`, route => route.fulfill({
    contentType: 'application/javascript', body: `
      export * from '${DOPPLER_PARTITIONS_MODULE_URL}?opening-contract';
      export async function configureDeviceMemoryBudget() {}
    `,
  }));
  await page.goto('/partition-import-probe');
  const observations = await page.evaluate(async () => {
    const { loadWorkPartition } = await import('/host/work-partitions.js');
    const results = [];
    for (const boundary of ['plan', 'factory', 'resident', 'cancelled-acquisition']) {
      const controller = new AbortController();
      let closed = 0;
      const files = { async preparePartitionSource() {
        if (boundary === 'cancelled-acquisition') controller.abort(new Error('contribution stopped'));
        return { manifest: { modelId: 'delivery-contract', architecture: {
          numLayers: 4, hiddenSize: 2, vocabSize: 8,
        }, inference: { session: { compute: { defaults: { activationDtype: 'f32' } } } } },
        storage: { async close() { closed++; } } };
      } };
      const selected = { id: 'delivery-contract', partitionSplitLayer: boundary === 'plan' ? 0 : 2,
        identity: boundary === 'factory' ? 'invalid' : 'sha256:' + 'a'.repeat(64) };
      try {
        await loadWorkPartition(files, selected, boundary === 'resident' ? 2 : 0,
          { signal: controller.signal, participantId: 'delivery-contributor' });
        results.push({ boundary, closed, rejected: false });
      } catch (error) { results.push({ boundary, closed, rejected: true, message: error.message }); }
    }
    return results;
  });
  for (const result of observations) expect(result).toMatchObject({ closed: 1, rejected: true });
  expect(observations[3].message).toBe('contribution stopped');
  await testInfo.attach('partition-opening-cleanup.json', { contentType: 'application/json',
    body: JSON.stringify({ scope: 'browser host admission and storage cleanup; GPU memory configuration stubbed; no inference',
      observations }, null, 2) });
});

test('two local tabs import the pinned partition contract independently', async ({ context }, testInfo) => {
  await context.route('**/partition-import-probe', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><title>Partition contract delivery</title>',
  }));
  const tabs = await Promise.all([context.newPage(), context.newPage()]);
  try {
    const results = await Promise.all(tabs.map(async page => {
      await page.goto('/partition-import-probe');
      return page.evaluate(async moduleUrl => {
        const runtime = await import(moduleUrl);
        const plan = runtime.createLayerPartitionPlan({ modelId: 'delivery-contract',
          numLayers: 4, hiddenSize: 2, vocabSize: 8, splitLayer: 2, activationDtype: 'f32' });
        const frame = runtime.serializeActivationFrame({ shape: [1, 1, 2], dtype: 'f32',
          data: new Float32Array([1, 2]), step: 0, seqOffset: 0 });
        return { exports: Object.keys(runtime).sort(), plan,
          values: [...runtime.deserializeActivationFrame(frame).tensorData] };
      }, DOPPLER_PARTITIONS_MODULE_URL);
    }));
    for (const result of results) {
      expect(result.exports).toEqual(Object.keys(installed).sort());
      expect(result.plan).toEqual(installed.createLayerPartitionPlan({ modelId: 'delivery-contract',
        numLayers: 4, hiddenSize: 2, vocabSize: 8, splitLayer: 2, activationDtype: 'f32' }));
      expect(result.values).toEqual([1, 2]);
    }
    await testInfo.attach('partition-delivery.json', { contentType: 'application/json',
      body: JSON.stringify({ scope: 'two-tab package delivery only; no inference or transport execution',
        moduleUrl: DOPPLER_PARTITIONS_MODULE_URL, results }, null, 2) });
  } finally { await Promise.all(tabs.map(page => page.close())); }
});
