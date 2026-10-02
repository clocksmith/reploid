import { test, expect, chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { measureStandaloneDenial, routeDiagnosticModel } from '../fixtures/capacity-observer.js';

test('the unchanged whole model is rejected by each executor allocation ceiling', async ({ browser }, info) => {
  const directory = process.env.DOPPLER_CHAT_MODEL_DIR;
  test.skip(!directory, 'Exact catalog model bytes required');
  test.setTimeout(300000);
  const model = JSON.parse(await readFile('self/config/chat-models.json', 'utf8'))[0];
  const remote = process.env.REPLOID_EXECUTOR_WS ? await chromium.connect(process.env.REPLOID_EXECUTOR_WS) : null;
  const denials = [];
  try {
    for (const [index, host] of [browser, remote || browser].entries()) {
      const context = await host.newContext();
      try {
        await routeDiagnosticModel(context, model, directory);
        const page = await context.newPage();
        // An inert hosted document avoids contributing or joining discovery.
        await page.goto('/config/partition-policy.json');
        const denial = await measureStandaloneDenial(page, model);
        expect(denial.error).toContain('GPU memory budget exceeded');
        expect(denial.memory.rejected).toBeGreaterThan(0);
        expect(denial.memory.peakBytes).toBeLessThanOrEqual(denial.maxGpuBufferBytes);
        denials.push({ host: index === 1 && remote ? 'linux-128' : 'mac', ...denial });
        await writeFile(info.outputPath(`denial-${index}.json`), JSON.stringify(denials.at(-1), null, 2));
      } finally { await context.close(); }
    }
    await info.attach('standalone-denials.json', { contentType: 'application/json', body: JSON.stringify(denials) });
  } finally { await remote?.close(); }
});
