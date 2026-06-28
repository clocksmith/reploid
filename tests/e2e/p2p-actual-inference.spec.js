/**
 * E2E Test: actual browser Doppler inference over the P2P room.
 */
import { test, expect } from '@playwright/test';

import { LAUNCH_MODEL } from '../../self/pool/model-contract.js';

const BASE_URL = 'http://localhost:8000';
const ACTUAL_INFERENCE_TIMEOUT_MS = 300000;

const roomIdFor = (testInfo) => (
  `actual-inference-${testInfo.workerIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
);

const routeUrl = (baseURL, route, roomId) => {
  const url = new URL(route, baseURL || BASE_URL);
  url.searchParams.set('room', roomId);
  return url.toString();
};

const installActualRuntimeConfig = async (context) => {
  await context.addInitScript(() => {
    window.REPLOID_POOL_DISCOVERY_WINDOW_MS = 300000;
    window.REPLOID_POOL_RECEIPT_WINDOW_MS = 300000;
    window.REPLOID_POOL_MAX_OUTPUT_TOKENS = 1;
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
  await expect(page.locator('[data-pool-relay-mode]')).toHaveText('local');
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
    stream: document.getElementById(`${id}-stream`)?.textContent || '',
    raw
  };
}, resultId).then((snapshot) => ({
  ...snapshot,
  parsed: parseJson(snapshot.raw)
}));

const stringifySnapshot = (snapshot) => JSON.stringify(snapshot, null, 2);

const waitForProviderListening = async (page) => {
  await expect(page.locator('#pool-provider-worker-start')).toBeVisible();
  await page.locator('#pool-provider-worker-start').click();
  try {
    await expect.poll(async () => {
      const snapshot = await readSnapshot(page, 'pool-provider-result');
      const parsed = snapshot.parsed || {};
      if (parsed.status === 'error' || parsed.error) return `error:${parsed.reason || parsed.error}`;
      if (snapshot.providerStatus === 'NODE // SPAWNED' && parsed.runner === 'peer_room_listening') return 'ready';
      return parsed.runner || parsed.status || snapshot.providerStatus || 'waiting';
    }, {
      timeout: ACTUAL_INFERENCE_TIMEOUT_MS,
      intervals: [1000, 2500, 5000]
    }).toBe('ready');
  } catch (error) {
    const snapshot = await readSnapshot(page, 'pool-provider-result');
    throw new Error(`Actual Doppler provider did not start.\n${stringifySnapshot(snapshot)}\n${error.message}`);
  }
};

const runActualPrompt = async (page, prompt) => {
  await expect(page.locator('#pool-run-submit')).toBeVisible();
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

test.describe('Run and Mesh actual browser inference', () => {
  test.skip(process.env.REPLOID_E2E_ACTUAL_INFERENCE !== '1', 'Set REPLOID_E2E_ACTUAL_INFERENCE=1 to run the real Doppler browser workload.');

  test('loads Doppler, generates in a provider tab, and returns a signed peer receipt', async ({ browser, baseURL }, testInfo) => {
    const roomId = roomIdFor(testInfo);
    const context = await browser.newContext();
    await installActualRuntimeConfig(context);
    try {
      const providerPage = await openPoolPage(context, baseURL, '/mesh', roomId, 'provider');
      await expect(providerPage.locator('#pool-provider-model')).toHaveValue(LAUNCH_MODEL.modelId);
      await waitForProviderListening(providerPage);

      const runPage = await openPoolPage(context, baseURL, '/run', roomId, 'requester');
      const result = await runActualPrompt(runPage, 'Reply with exactly OK.');

      expect(result.transport).toBe('webrtc_peer_room');
      expect(result.outputText.length).toBeGreaterThan(0);
      expect(result.receiptHash).toMatch(/^sha256:/);
      expect(result.receiptRecord?.receipt?.model?.id || result.receiptRecord?.receipt?.model?.modelId).toBe(LAUNCH_MODEL.modelId);
      expect(result.receiptPayloads).toHaveLength(1);
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
      const providerPage = await openPoolPage(context, baseURL, '/mesh', roomId, 'provider');
      await expect(providerPage.locator('#pool-provider-model')).toHaveValue(LAUNCH_MODEL.modelId);
      await waitForProviderListening(providerPage);

      const firstRunPage = await openPoolPage(context, baseURL, '/run', roomId, 'requester-one');
      const secondRunPage = await openPoolPage(context, baseURL, '/run', roomId, 'requester-two');
      const [first, second] = await Promise.all([
        runActualPrompt(firstRunPage, 'Reply with exactly A.'),
        runActualPrompt(secondRunPage, 'Reply with exactly B.')
      ]);

      for (const result of [first, second]) {
        expect(result.transport).toBe('webrtc_peer_room');
        expect(result.outputText.length).toBeGreaterThan(0);
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
});
