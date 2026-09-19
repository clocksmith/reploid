import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { diagnosticModel as model, diagnosticPolicy as policy } from '../fixtures/diagnostic-model.js';

test('browser uses the public diagnostic strategy and preserves authorization', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async ({ model, policy }) => {
    const { createDiagnosticInvestigation } = await import('/vendor/reploid/agent/diagnostic-strategy.js');
    const { resolveConfig } = await import('/vendor/reploid/config/index.js');
    const authorizations = [];
    const session = createDiagnosticInvestigation({ model, policy,
      config: resolveConfig({ overrides: { tools: { allowed: ['MeasureDiagnostic'] } } }),
      ports: { instanceId: 'browser-diagnostic', authorize: request => { authorizations.push(request.action); return true; },
        executeTool: async (_, { actionId }) => ({ outcomeId: actionId === 'reference' ? 'match' : 'recovers', evidenceId: actionId }) }
    });
    const state = await session.run();
    const checkpoint = session.checkpoint();
    await session.close();
    return { state, checkpoint, authorizations };
  }, { model, policy });
  expect(result.state.recommendation).toEqual({ decisionId: 'memory', expectedUtility: 1 });
  expect(result.authorizations).toEqual(['agent.execute', 'tool.execute', 'tool.execute']);
  expect(result.checkpoint.state.spent).toBeCloseTo(0.11);
});

test('Verification Worker accepts diagnostic implementations without executing candidates', async ({ page }) => {
  const paths = ['belief-planner.js', 'diagnostic-strategy.js'];
  const snapshot = Object.fromEntries(await Promise.all(paths.map(async name => [
    `/core/${name}`, await readFile(`packages/reploid/src/agent/${name}`, 'utf8')
  ])));
  await page.goto('/');
  const result = await page.evaluate(snapshot => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Verification timed out')); }, 10000);
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
    worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
    worker.postMessage({ type: 'VERIFY', snapshot });
  }), snapshot);
  expect(result.errors).toEqual([]);
  expect(result.passed).toBe(true);
  expect(result.details.filesAnalyzed).toBe(2);
});
