import { test, expect } from '@playwright/test';

test('merged mutable modules pass the browser Verification Worker', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const files = [
      'core/agent-context.js', 'core/agent-loop.js', 'core/persona-manager.js',
      'core/run-replay-bundle.js', 'core/zero-prompt.js',
      'ui/zero/index.js', 'ui/zero/trace-view.js', 'ui/boot-home/index.js',
      'ui/boot-wizard/state.js', 'ui/shared/reploid-contract.js',
      'pool/policy-router.js', 'pool/policy-validation.js', 'pool/provider-client.js',
      'pool/peer-room.js', 'pool/config-contract.js',
      'vendor/reploid/agent/response-parser.js', 'vendor/reploid/artifacts/job-journal.js',
      'vendor/reploid/mesh/jobs/requester.js'
    ];
    const snapshot = {};
    for (const file of files) {
      const response = await fetch(`/${file}`);
      if (!response.ok) throw new Error(`Module unavailable: ${file}`);
      snapshot[`/${file}`] = await response.text();
    }
    return new Promise((resolve, reject) => {
      const worker = new Worker('/core/verification-worker.js');
      const timer = setTimeout(() => { worker.terminate(); reject(new Error('Verification timed out')); }, 10000);
      worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
      worker.onerror = error => { clearTimeout(timer); worker.terminate(); reject(new Error(error.message)); };
      worker.postMessage({ type: 'VERIFY', snapshot });
    });
  });
  expect(result.passed, JSON.stringify(result.errors)).toBe(true);
});
