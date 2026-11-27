import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { readServedText } from '../helpers/served-browser-files.js';

// The local document journey runs on the React /examples page (tests/unit/poolday-react-examples.test.tsx).

test('changed Reploid modules pass the actual Verification Worker', async ({ page }, testInfo) => {
  const paths = ['config/doppler-local-models.js', 'pool/model-contract.js', 'pool/operation-model.js', 'pool/local-pack-executor.js',
    'pool/doppler-runtime.js', 'pool/evidence-normalization.js', 'pool/model-artifacts.js', 'pool/capsule-artifact-cache.js',
    'infrastructure/capsule-artifact-storage.js',
    'infrastructure/doppler-runtime-service.js', 'config/doppler-generation-contract.js',
    'pool/pack-operation-policy.js', 'pool/pack-operation.js',
    'pool/document-search.js', 'pool/document-answer.js', 'pool/pack-release-policy.js', 'infrastructure/pack-release-storage.js',
    'pool/pack-operation-adapters.js'];
  const snapshot = Object.fromEntries(await Promise.all(paths.map(async (path) => [
    `/${path}`, await readServedText(path)
  ])));
  for (const path of ['unit/pool-document-search.test.js', 'unit/pool-pack-operation.test.js', 'unit/pool-home-nav.test.js', 'e2e/document-search.spec.js', 'fixtures/document-packs.js', 'fixtures/doppler-pack-handoff.js',
    'fixtures/doppler-installed-generation.js', 'fixtures/peer-pack-operation.js', 'integration/doppler-installed-generation.test.js']) {
    snapshot[`/testing/${path}`] = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  }
  snapshot['/testing/scripts/sync-doppler-generation-contract.js'] = await readFile(
    new URL('../../scripts/sync-doppler-generation-contract.js', import.meta.url), 'utf8');
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

test('release checkpoints survive reopening and reject rollback, forks, and stale concurrent writers', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { openPackReleaseCheckpoints } = await import('/infrastructure/pack-release-storage.js');
    const name = `release-checkpoint-test-${crypto.randomUUID()}`;
    const key = `sha256:${'a'.repeat(64)}`;
    const first = { sequence: 1, digest: `sha256:${'b'.repeat(64)}` };
    const next = { sequence: 2, digest: `sha256:${'c'.repeat(64)}` };
    const store = await openPackReleaseCheckpoints({ name });
    const empty = await store.read(key);
    await store.advance(key, empty, first);
    store.close();
    const reopened = await openPackReleaseCheckpoints({ name });
    const saved = await reopened.read(key);
    const contender = await openPackReleaseCheckpoints({ name });
    await reopened.advance(key, saved, next);
    const failures = [];
    for (const [prior, proposed] of [[saved, { sequence: 2, digest: `sha256:${'d'.repeat(64)}` }],
      [next, first], [next, { ...next, digest: `sha256:${'d'.repeat(64)}` }]]) {
      try { await contender.advance(key, prior, proposed); }
      catch (error) { failures.push(error.message); }
    }
    const idempotent = await contender.advance(key, saved, next);
    const final = await reopened.read(key);
    reopened.close(); contender.close();
    return { empty, saved, final, idempotent, failures };
  });
  expect(result.empty).toEqual({ sequence: 0, digest: null });
  expect(result.saved.sequence).toBe(1);
  expect(result.final).toEqual(result.idempotent);
  expect(result.final.sequence).toBe(2);
  expect(result.failures).toHaveLength(3);
  expect(result.failures[0]).toContain('changed during verification');
  expect(result.failures.slice(1).every(message => message.includes('rollback or fork'))).toBe(true);
});
