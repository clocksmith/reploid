import { test, expect } from '@playwright/test';
import * as installed from 'doppler-gpu/partitions';
import { DOPPLER_PARTITIONS_MODULE_URL } from '../../self/config/doppler-local-models.js';

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
