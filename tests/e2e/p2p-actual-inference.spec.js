/**
 * E2E Test: actual browser Doppler inference over the P2P room.
 */
import { test, expect } from '@playwright/test';

import { LAUNCH_MODEL } from '../../self/pool/model-contract.js';

const BASE_URL = 'http://localhost:8000';
const ACTUAL_INFERENCE_TIMEOUT_MS = 300000;
const RELAY_MODE = 'local';
const RELAY_LABEL = 'local tab';
const TEXT_TOKEN_PATTERN = /[\p{L}\p{N}]/u;
const rawSha256 = (value) => String(value || '').replace(/^sha256:/, '');

const roomIdFor = (testInfo) => (
  `actual-inference-${testInfo.workerIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
);

const routeUrl = (baseURL, route, roomId) => {
  const url = new URL(route, baseURL || BASE_URL);
  url.searchParams.set('room', roomId);
  url.searchParams.set('relay', RELAY_MODE);
  return url.toString();
};

const installActualRuntimeConfig = async (context) => {
  await context.addInitScript(() => {
    window.REPLOID_POOL_DISCOVERY_WINDOW_MS = 30000;
    window.REPLOID_POOL_RECEIPT_WINDOW_MS = 300000;
    window.REPLOID_POOL_MAX_OUTPUT_TOKENS = 2;
    window.REPLOID_POOL_STRICT_ARTIFACT_PREFLIGHT = false;
  });
};

const wireDiagnostics = (page, label) => {
  page.on('console', (message) => {
    const text = message.text();
    if (/doppler|webgpu|model|manifest|pool|peer|error|failed/i.test(text)) {
      console.log(`[${label}:console:${message.type()}] ${text}`);
    }
  });
  page.on('pageerror', (error) => {
    console.log(`[${label}:pageerror] ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (/doppler|models|esm\.sh|webgpu/i.test(url)) {
      console.log(`[${label}:requestfailed] ${request.method()} ${url} ${request.failure()?.errorText || ''}`);
    }
  });
};

const openPoolPage = async (context, baseURL, route, roomId, label) => {
  const page = await context.newPage();
  wireDiagnostics(page, label);
  await page.goto(routeUrl(baseURL, route, roomId), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.pool-home');
  await expect(page.locator('[data-pool-room-id]')).toHaveText(roomId);
  await expect(page.locator('[data-pool-relay-mode]')).toHaveText(RELAY_LABEL);
  await expect.poll(() => page.evaluate(() => (
    new URL(window.location.href).searchParams.get('relay')
  ))).toBe(RELAY_MODE);
  return page;
};

const parseJson = (text) => {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return null;
  }
};

const readSnapshot = async (page, resultId) => page.evaluate((id) => {
  const raw = document.getElementById(`${id}-raw`)?.textContent || '';
  return {
    url: window.location.href,
    providerStatus: document.querySelector('[data-pool-provider-status]')?.textContent?.trim() || null,
    providerState: document.querySelector('[data-pool-provider-status]')?.dataset?.providerState || null,
    stream: document.getElementById(`${id}-stream`)?.textContent || '',
    raw
  };
}, resultId).then((snapshot) => ({
  ...snapshot,
  parsed: parseJson(snapshot.raw)
}));

const stringifySnapshot = (snapshot) => JSON.stringify(snapshot, null, 2);

const waitForProviderListening = async (page) => {
  const toggle = page.locator('#pool-provider-worker-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('data-contribution-action', 'start');
  await toggle.click();
  try {
    await expect.poll(async () => {
      const snapshot = await readSnapshot(page, 'pool-provider-result');
      const parsed = snapshot.parsed || {};
      if (parsed.status === 'error' || parsed.error) return `error:${parsed.reason || parsed.error}`;
      if (snapshot.providerState === 'online' && parsed.runner === 'peer_room_listening') return 'ready';
      return parsed.runner || parsed.status || snapshot.providerState || snapshot.providerStatus || 'waiting';
    }, {
      timeout: ACTUAL_INFERENCE_TIMEOUT_MS,
      intervals: [1000, 2500, 5000]
    }).toBe('ready');
  } catch (error) {
    const snapshot = await readSnapshot(page, 'pool-provider-result');
    throw new Error(`Actual Doppler provider did not start.\n${stringifySnapshot(snapshot)}\n${error.message}`);
  }
};

const waitForRestoredProviderListening = async (page) => {
  await expect.poll(async () => {
    const snapshot = await readSnapshot(page, 'pool-provider-result');
    const parsed = snapshot.parsed || {};
    if (parsed.status === 'error' || parsed.error) return `error:${parsed.reason || parsed.error}`;
    if (snapshot.providerState === 'online' && parsed.runner === 'peer_room_listening') return 'ready';
    return parsed.runner || parsed.status || snapshot.providerState || snapshot.providerStatus || 'waiting';
  }, {
    timeout: ACTUAL_INFERENCE_TIMEOUT_MS,
    intervals: [1000, 2500, 5000]
  }).toBe('ready');
};

const runActualPrompt = async (page, prompt, policyId = 'fastest_receipt') => {
  await expect(page.locator('#pool-run-submit')).toBeVisible();
  if (policyId !== 'fastest_receipt') {
    const advanced = page.locator('details.pool-advanced').first();
    if (!(await advanced.evaluate((element) => element.open))) await advanced.locator('summary').click();
    await expect(page.locator('#pool-run-policy')).toBeVisible();
    await page.locator('#pool-run-policy').selectOption(policyId);
  }
  await page.locator('#pool-run-prompt').fill(prompt);
  await page.locator('#pool-run-submit').click();
  try {
    await expect.poll(async () => {
      const snapshot = await readSnapshot(page, 'pool-run-result');
      const parsed = snapshot.parsed || {};
      if (parsed.status === 'error' || parsed.error) return `error:${parsed.reason || parsed.error}`;
      if (parsed.transport === 'webrtc_peer_room' && parsed.receiptHash && typeof parsed.outputText === 'string') return 'complete';
      return parsed.status || parsed.transport || snapshot.stream || 'waiting';
    }, {
      timeout: ACTUAL_INFERENCE_TIMEOUT_MS,
      intervals: [1000, 2500, 5000]
    }).toBe('complete');
  } catch (error) {
    const snapshot = await readSnapshot(page, 'pool-run-result');
    throw new Error(`Actual P2P inference did not complete.\n${stringifySnapshot(snapshot)}\n${error.message}`);
  }
  return (await readSnapshot(page, 'pool-run-result')).parsed;
};

test.describe('Run and Contribute actual browser inference', () => {
  test.skip(process.env.REPLOID_E2E_ACTUAL_INFERENCE !== '1', 'Set REPLOID_E2E_ACTUAL_INFERENCE=1 to run the real Doppler browser workload.');

  test('loads Doppler, generates in a provider tab, and returns a signed peer receipt', async ({ browser, baseURL }, testInfo) => {
    const roomId = roomIdFor(testInfo);
    const context = await browser.newContext();
    await installActualRuntimeConfig(context);
    try {
      const providerPage = await openPoolPage(context, baseURL, '/compute', roomId, 'provider');
      let observeReloadRequests = false;
      let shardRequestsAfterReload = 0;
      providerPage.on('request', (request) => {
        if (observeReloadRequests && /\/shard_\d+\.bin(?:$|[?#])/i.test(request.url())) {
          shardRequestsAfterReload += 1;
        }
      });
      await expect(providerPage.locator('#pool-provider-model')).toHaveValue(LAUNCH_MODEL.modelId);
      const runPage = await openPoolPage(context, baseURL, '/ask', roomId, 'requester');
      await waitForProviderListening(providerPage);
      const firstProvider = (await readSnapshot(providerPage, 'pool-provider-result')).parsed;
      expect(firstProvider.runtime?.persistentCache).toMatchObject({
        backend: 'opfs'
      });
      expect(firstProvider.runtime?.persistentCache?.manifestHash).toBe(rawSha256(LAUNCH_MODEL.manifestHash));

      const result = await runActualPrompt(runPage, 'The color of the sky is');

      expect(result.transport).toBe('webrtc_peer_room');
      expect(result.outputText.trim().length).toBeGreaterThan(0);
      expect(result.outputText).toMatch(TEXT_TOKEN_PATTERN);
      expect(result.receiptHash).toMatch(/^sha256:/);
      expect(result.receiptRecord?.receipt?.model?.id || result.receiptRecord?.receipt?.model?.modelId).toBe(LAUNCH_MODEL.modelId);
      expect(result.receiptPayloads).toHaveLength(1);
      expect(result.agreement.accepted).toBe(true);

      observeReloadRequests = true;
      await providerPage.reload({ waitUntil: 'domcontentloaded' });
      await providerPage.waitForSelector('.pool-home');
      await waitForRestoredProviderListening(providerPage);
      const restoredProvider = (await readSnapshot(providerPage, 'pool-provider-result')).parsed;
      expect(restoredProvider.identity?.roleId).toBe(firstProvider.identity?.roleId);
      expect(restoredProvider.runtime?.persistentCache).toMatchObject({
        backend: 'opfs',
        fromCache: true
      });
      expect(restoredProvider.runtime?.persistentCache?.manifestHash).toBe(rawSha256(LAUNCH_MODEL.manifestHash));
      expect(shardRequestsAfterReload).toBe(0);
    } finally {
      await context.close().catch(() => null);
    }
  });

  test('downloads ESM-2 as an optional local fallback and completes the preserved sequence request', async ({ browser, baseURL }, testInfo) => {
    const roomId = roomIdFor(testInfo);
    const context = await browser.newContext();
    await installActualRuntimeConfig(context);
    try {
      const page = await openPoolPage(context, baseURL, '/', roomId, 'sequence-local-fallback');
      await page.evaluate(() => {
        window.REPLOID_POOL_DISCOVERY_WINDOW_MS = 250;
        window.REPLOID_POOL_RECEIPT_WINDOW_MS = 300000;
      });
      await page.locator('[data-pool-lane="sequence"]').click();
      await expect(page.locator('#pool-home-request-model')).toHaveValue('esm2-t12-35m-ur50d-f32-af32');
      await page.locator('#pool-home-ask-prompt').fill('MKTAYIAKQRQISFVKSHFSRQ');
      await page.locator('#pool-home-sequence-public').check();
      await page.locator('#pool-home-run-submit').click();
      await expect(page.locator('[data-pool-run-recovery-action="offer_local_provider"]')).toBeVisible();
      await page.locator('[data-pool-run-recovery-action="offer_local_provider"]').click();
      await expect(page.locator('[data-pool-run-recovery-action="confirm_local_provider"]')).toBeVisible();
      await page.locator('[data-pool-run-recovery-action="confirm_local_provider"]').click();

      try {
        await expect.poll(async () => {
          const snapshot = await readSnapshot(page, 'pool-home-run-result');
          const parsed = snapshot.parsed || {};
          if (/^Error:/m.test(snapshot.raw) || /could not complete|failed:/i.test(snapshot.stream)) {
            return `error:${snapshot.stream || snapshot.raw}`;
          }
          if (parsed.status === 'error' || parsed.error) return `error:${parsed.reason || parsed.error}`;
          if (parsed.transport === 'webrtc_peer_room' && parsed.sequenceResultHash) return 'complete';
          return parsed.status || parsed.transport || snapshot.stream || 'waiting';
        }, {
          timeout: ACTUAL_INFERENCE_TIMEOUT_MS,
          intervals: [1000, 2500, 5000]
        }).toBe('complete');
      } catch (error) {
        const snapshot = await readSnapshot(page, 'pool-home-run-result');
        throw new Error(`Actual ESM-2 local fallback did not complete.\n${stringifySnapshot(snapshot)}\n${error.message}`);
      }

      const result = (await readSnapshot(page, 'pool-home-run-result')).parsed;
      expect(result.outputKind).toBe('sequence.embedding.v1');
      expect(result.sequenceResultHash).toMatch(/^sha256:/);
      expect(result.embeddingDimensions).toBeGreaterThan(0);
      expect(result.receiptRecord?.receipt?.sequence?.sequenceLength).toBe(22);
      expect(JSON.stringify(result.receiptRecord?.receipt || {})).not.toContain('MKTAYIAKQRQISFVKSHFSRQ');
    } finally {
      await context.close().catch(() => null);
    }
  });

  test('gates or completes Gemma optional local fallback from the browser capability contract', async ({ browser, baseURL }, testInfo) => {
    const roomId = roomIdFor(testInfo);
    const context = await browser.newContext();
    await installActualRuntimeConfig(context);
    try {
      const page = await openPoolPage(context, baseURL, '/', roomId, 'gemma-local-fallback');
      await page.evaluate(() => {
        window.REPLOID_POOL_DISCOVERY_WINDOW_MS = 250;
        window.REPLOID_POOL_RECEIPT_WINDOW_MS = 300000;
        const modelSelect = document.getElementById('pool-home-request-model');
        modelSelect.value = 'gemma-3-270m-it-q4k-ehf16-af32';
        modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
      });
      const supportsShaderF16 = await page.evaluate(async () => {
        const adapter = await navigator.gpu?.requestAdapter?.({ powerPreference: 'high-performance' });
        return adapter?.features?.has?.('shader-f16') === true;
      });
      await expect(page.locator('#pool-home-request-model')).toHaveValue('gemma-3-270m-it-q4k-ehf16-af32');
      await page.locator('#pool-home-ask-prompt').fill('Reply with one color word.');
      await page.locator('#pool-home-run-submit').click();
      await expect(page.locator('[data-pool-run-recovery-action="offer_local_provider"]')).toBeVisible();
      await page.locator('[data-pool-run-recovery-action="offer_local_provider"]').click();
      await expect(page.locator('[data-pool-run-recovery-action="confirm_local_provider"]')).toBeVisible();
      await page.locator('[data-pool-run-recovery-action="confirm_local_provider"]').click();

      if (!supportsShaderF16) {
        await expect(page.locator('#pool-home-run-result-stream')).toContainText(
          'requires WebGPU feature(s): shader-f16',
          { timeout: 10000 }
        );
        await expect(page.locator('#pool-home-run-result-raw')).toContainText(
          'Code: device_capability_model_ineligible'
        );
        return;
      }

      try {
        await expect.poll(async () => {
          const snapshot = await readSnapshot(page, 'pool-home-run-result');
          const parsed = snapshot.parsed || {};
          if (/^Error:/m.test(snapshot.raw) || /could not complete|failed:/i.test(snapshot.stream)) {
            return `error:${snapshot.stream || snapshot.raw}`;
          }
          if (parsed.status === 'error' || parsed.error) return `error:${parsed.reason || parsed.error}`;
          if (parsed.transport === 'webrtc_peer_room' && parsed.receiptHash && typeof parsed.outputText === 'string') {
            return 'complete';
          }
          return parsed.status || parsed.transport || snapshot.stream || 'waiting';
        }, {
          timeout: ACTUAL_INFERENCE_TIMEOUT_MS,
          intervals: [1000, 2500, 5000]
        }).toBe('complete');
      } catch (error) {
        const snapshot = await readSnapshot(page, 'pool-home-run-result');
        throw new Error(`Actual Gemma local fallback did not complete.\n${stringifySnapshot(snapshot)}\n${error.message}`);
      }

      const result = (await readSnapshot(page, 'pool-home-run-result')).parsed;
      expect(result.outputText.trim()).toMatch(TEXT_TOKEN_PATTERN);
      expect(result.receiptHash).toMatch(/^sha256:/);
      expect(result.receiptRecord?.receipt?.model?.id || result.receiptRecord?.receipt?.model?.modelId).toBe(
        'gemma-3-270m-it-q4k-ehf16-af32'
      );
      expect(result.agreement.accepted).toBe(true);
    } finally {
      await context.close().catch(() => null);
    }
  });

  test('queues two actual requester tabs through one loaded provider', async ({ browser, baseURL }, testInfo) => {
    const roomId = roomIdFor(testInfo);
    const context = await browser.newContext();
    await installActualRuntimeConfig(context);
    try {
      const providerPage = await openPoolPage(context, baseURL, '/compute', roomId, 'provider');
      await expect(providerPage.locator('#pool-provider-model')).toHaveValue(LAUNCH_MODEL.modelId);
      const firstRunPage = await openPoolPage(context, baseURL, '/ask', roomId, 'requester-one');
      const secondRunPage = await openPoolPage(context, baseURL, '/ask', roomId, 'requester-two');
      await waitForProviderListening(providerPage);
      const [first, second] = await Promise.all([
        runActualPrompt(firstRunPage, 'Reply with exactly A.'),
        runActualPrompt(secondRunPage, 'Reply with exactly B.')
      ]);

      for (const result of [first, second]) {
        expect(result.transport).toBe('webrtc_peer_room');
        expect(result.outputText.trim().length).toBeGreaterThan(0);
        expect(result.outputText).toMatch(TEXT_TOKEN_PATTERN);
        expect(result.receiptHash).toMatch(/^sha256:/);
        expect(result.receiptRecord?.receipt?.model?.id || result.receiptRecord?.receipt?.model?.modelId).toBe(LAUNCH_MODEL.modelId);
        expect(result.receiptPayloads).toHaveLength(1);
        expect(result.agreement.accepted).toBe(true);
      }
      expect(first.assignment.providerId).toBe(second.assignment.providerId);
      expect(first.receiptHash).not.toBe(second.receiptHash);
    } finally {
      await context.close().catch(() => null);
    }
  });

  test('loads two independent Doppler provider tabs and settles a real ring quorum', async ({ browser, baseURL }, testInfo) => {
    test.skip(
      process.env.REPLOID_E2E_ACTUAL_MULTI_PROVIDER !== '1',
      'Set REPLOID_E2E_ACTUAL_MULTI_PROVIDER=1 to load independent Doppler runtimes in two provider tabs.'
    );
    const roomId = roomIdFor(testInfo);
    const context = await browser.newContext();
    await installActualRuntimeConfig(context);
    try {
      const firstProviderPage = await openPoolPage(context, baseURL, '/compute', roomId, 'provider-one');
      const secondProviderPage = await openPoolPage(context, baseURL, '/compute', roomId, 'provider-two');
      await waitForProviderListening(firstProviderPage);
      await waitForProviderListening(secondProviderPage);

      const firstProvider = (await readSnapshot(firstProviderPage, 'pool-provider-result')).parsed;
      const secondProvider = (await readSnapshot(secondProviderPage, 'pool-provider-result')).parsed;
      expect(firstProvider.identity?.roleId).toMatch(/^provider_/);
      expect(secondProvider.identity?.roleId).toMatch(/^provider_/);
      expect(secondProvider.identity?.roleId).not.toBe(firstProvider.identity?.roleId);

      const runPage = await openPoolPage(context, baseURL, '/ask', roomId, 'ring-requester');
      const result = await runActualPrompt(
        runPage,
        'Reply with exactly the word blue.',
        'ring_quorum_receipt'
      );

      expect(result.transport).toBe('webrtc_peer_room');
      expect(result.outputText.trim().length).toBeGreaterThan(0);
      expect(result.agreement?.accepted).toBe(true);
      expect(result.assignments).toHaveLength(2);
      expect(result.receiptPayloads).toHaveLength(2);
      expect(new Set(result.assignments.map((assignment) => assignment.providerId)).size).toBe(2);
      expect(result.receiptHashes?.length || 0).toBeGreaterThanOrEqual(
        result.agreement?.requiredAgreement || 2
      );
    } finally {
      await context.close().catch(() => null);
    }
  });
});
