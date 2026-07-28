/**
 * E2E Test: actual browser Doppler inference over the P2P room.
 */
import { test, expect } from '@playwright/test';

import { LAUNCH_MODEL, getEnabledPoolModelContract } from '../../self/pool/model-contract.js';

const BASE_URL = 'http://localhost:8000';
const ACTUAL_INFERENCE_TIMEOUT_MS = 300000;
const RELAY_MODE = process.env.REPLOID_E2E_RELAY_MODE === 'server' ? 'server' : 'local';
const RELAY_LABEL = RELAY_MODE === 'server' ? 'server relay' : 'local tab';
const TEXT_TOKEN_PATTERN = /[\p{L}\p{N}]/u;
const rawSha256 = (value) => String(value || '').replace(/^sha256:/, '');
const SEQUENCE_MODEL = getEnabledPoolModelContract('esm2-t12-35m-ur50d-f32-af32');

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

const createInferenceNodeContexts = async (browser) => {
  const providerContext = await browser.newContext();
  const requesterContext = RELAY_MODE === 'server'
    ? await browser.newContext()
    : providerContext;
  await installActualRuntimeConfig(providerContext);
  if (requesterContext !== providerContext) {
    await installActualRuntimeConfig(requesterContext);
  }
  return {
    providerContext,
    requesterContext,
    async close() {
      await requesterContext.close().catch(() => null);
      if (providerContext !== requesterContext) {
        await providerContext.close().catch(() => null);
      }
    }
  };
};

const createMultiProviderNodeContexts = async (browser, providerCount = 2) => {
  const sharedContext = RELAY_MODE === 'local' ? await browser.newContext() : null;
  const providerContexts = sharedContext
    ? Array.from({ length: providerCount }, () => sharedContext)
    : await Promise.all(Array.from({ length: providerCount }, () => browser.newContext()));
  const requesterContext = sharedContext || await browser.newContext();
  const uniqueContexts = [...new Set([...providerContexts, requesterContext])];
  await Promise.all(uniqueContexts.map(installActualRuntimeConfig));
  return {
    providerContexts,
    requesterContext,
    async close() {
      await Promise.all(uniqueContexts.map((context) => context.close().catch(() => null)));
    }
  };
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

const trackModelArtifactRequests = (page, model) => {
  const requests = [];
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes(model.modelId) && /(?:manifest\.json|tokenizer\.json|shard_\d+\.bin)(?:$|[?#])/i.test(url)) {
      requests.push(url);
    }
  });
  return requests;
};

const expectPinnedArtifactOrigin = (requests, model) => {
  const expectedBase = String(model.loadInput?.url || '').replace(/\/+$/, '');
  expect(expectedBase).toMatch(/^https:\/\/storage\.googleapis\.com\/reploid-model-artifacts\//);
  expect(requests.some((url) => url.startsWith(`${expectedBase}/`))).toBe(true);
  expect(requests.some((url) => url.includes('huggingface.co/'))).toBe(false);
};

const attachRelayReceipt = async (testInfo, lane, roomId, result = {}) => {
  const receipt = result.receiptRecord?.receipt
    || result.receiptPayload?.body?.receipt
    || result.receiptPayloads?.[0]?.body?.receipt
    || null;
  await testInfo.attach(`poolday-${RELAY_MODE}-${lane}-receipt.json`, {
    body: Buffer.from(JSON.stringify({
      schema: 'reploid.pool.browser_lane_receipt/v1',
      lane,
      relay: RELAY_MODE,
      roomId,
      baseUrl: testInfo.project.use.baseURL || null,
      modelId: receipt?.model?.id || receipt?.model?.modelId || result.assignment?.model?.modelId || null,
      artifactIdentity: receipt?.model?.artifactIdentity || null,
      providerId: result.assignment?.providerId || receipt?.providerId || null,
      requesterId: result.requesterAcceptance?.requesterId || result.assignment?.requesterId || null,
      transport: result.transport || null,
      receiptHash: result.receiptHash || null,
      agreementHash: result.agreement?.agreementHash || null,
      agreementAccepted: result.agreement?.accepted === true,
      requesterAccepted: result.requesterAcceptance?.accepted === true,
      requesterSignature: result.requesterAcceptance?.requesterSignature || null,
      sequenceResultHash: result.sequenceResultHash || null,
      completedAt: new Date().toISOString()
    }, null, 2)),
    contentType: 'application/json'
  });
};

const waitForActualResult = async ({
  page,
  resultId,
  isComplete,
  timeoutMs = ACTUAL_INFERENCE_TIMEOUT_MS
}) => {
  const deadline = Date.now() + timeoutMs;
  let snapshot = await readSnapshot(page, resultId);
  while (Date.now() < deadline) {
    const parsed = snapshot.parsed || {};
    const terminalError = parsed.status === 'error'
      || parsed.error
      || /^Error:/m.test(snapshot.raw)
      || /could not complete|failed:/i.test(snapshot.stream);
    if (terminalError) {
      throw new Error(snapshot.stream || snapshot.raw || parsed.reason || parsed.error);
    }
    if (isComplete(parsed)) return parsed;
    await page.waitForTimeout(1000);
    snapshot = await readSnapshot(page, resultId);
  }
  throw new Error(`Timed out waiting for ${resultId}.\n${stringifySnapshot(snapshot)}`);
};

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
    return await waitForActualResult({
      page,
      resultId: 'pool-run-result',
      isComplete: (parsed) => (
        parsed.transport === 'webrtc_peer_room'
        && parsed.receiptHash
        && typeof parsed.outputText === 'string'
      )
    });
  } catch (error) {
    const snapshot = await readSnapshot(page, 'pool-run-result');
    throw new Error(`Actual P2P inference did not complete.\n${stringifySnapshot(snapshot)}\n${error.message}`);
  }
};

test.describe('Run and Contribute actual browser inference', () => {
  test.skip(process.env.REPLOID_E2E_ACTUAL_INFERENCE !== '1', 'Set REPLOID_E2E_ACTUAL_INFERENCE=1 to run the real Doppler browser workload.');

  test('loads Doppler, generates in a provider tab, and returns a signed peer receipt', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(900000);
    const roomId = roomIdFor(testInfo);
    const nodes = await createInferenceNodeContexts(browser);
    try {
      const providerPage = await openPoolPage(nodes.providerContext, baseURL, '/compute', roomId, 'provider');
      const initialArtifactRequests = trackModelArtifactRequests(providerPage, LAUNCH_MODEL);
      let observeReloadRequests = false;
      let shardRequestsAfterReload = 0;
      providerPage.on('request', (request) => {
        if (observeReloadRequests && /\/shard_\d+\.bin(?:$|[?#])/i.test(request.url())) {
          shardRequestsAfterReload += 1;
        }
      });
      await expect(providerPage.locator('#pool-provider-model')).toHaveValue(LAUNCH_MODEL.modelId);
      const runPage = await openPoolPage(nodes.requesterContext, baseURL, '/ask', roomId, 'requester');
      await waitForProviderListening(providerPage);
      const firstProvider = (await readSnapshot(providerPage, 'pool-provider-result')).parsed;
      expectPinnedArtifactOrigin(initialArtifactRequests, LAUNCH_MODEL);
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
      expect(result.requesterAcceptance?.accepted).toBe(true);
      expect(result.requesterAcceptance?.requesterSignature).toBeTruthy();
      expect(result.requesterAcceptance?.requesterId).not.toBe(result.assignment?.providerId);
      await attachRelayReceipt(testInfo, 'text', roomId, result);

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
      await nodes.close();
    }
  });

  test('runs ESM-2 sequence inference between separate provider and requester nodes', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(600000);
    const roomId = roomIdFor(testInfo);
    const nodes = await createInferenceNodeContexts(browser);
    try {
      const providerPage = await openPoolPage(nodes.providerContext, baseURL, '/compute', roomId, 'sequence-provider');
      const artifactRequests = trackModelArtifactRequests(providerPage, SEQUENCE_MODEL);
      await providerPage.locator('#pool-provider-model').selectOption(SEQUENCE_MODEL.modelId);
      await expect(providerPage.locator('#pool-provider-model')).toHaveValue(SEQUENCE_MODEL.modelId);
      const requesterPage = await openPoolPage(nodes.requesterContext, baseURL, '/', roomId, 'sequence-requester');
      await waitForProviderListening(providerPage);
      expectPinnedArtifactOrigin(artifactRequests, SEQUENCE_MODEL);
      const provider = (await readSnapshot(providerPage, 'pool-provider-result')).parsed;
      await requesterPage.bringToFront();
      await requesterPage.locator('[data-pool-lane="sequence"]').click();
      await expect(requesterPage.locator('#pool-home-request-model')).toHaveValue(SEQUENCE_MODEL.modelId);
      await requesterPage.locator('#pool-home-ask-prompt').fill('MKTAYIAKQRQISFVKSHFSRQ');
      await requesterPage.locator('#pool-home-sequence-public').check();
      await requesterPage.locator('#pool-home-run-submit').click();

      try {
        await waitForActualResult({
          page: requesterPage,
          resultId: 'pool-home-run-result',
          isComplete: (parsed) => (
            parsed.transport === 'webrtc_peer_room'
            && Boolean(parsed.sequenceResultHash)
          )
        });
      } catch (error) {
        const providerSnapshot = await readSnapshot(providerPage, 'pool-provider-result');
        const requesterSnapshot = await readSnapshot(requesterPage, 'pool-home-run-result');
        throw new Error(
          `Actual ESM-2 cross-node inference did not complete.\n`
          + `provider=${stringifySnapshot(providerSnapshot)}\n`
          + `requester=${stringifySnapshot(requesterSnapshot)}\n`
          + error.message
        );
      }

      const result = (await readSnapshot(requesterPage, 'pool-home-run-result')).parsed;
      expect(result.transport).toBe('webrtc_peer_room');
      expect(result.outputKind).toBe('sequence.embedding.v1');
      expect(result.sequenceResultHash).toMatch(/^sha256:/);
      expect(result.embeddingDimensions).toBeGreaterThan(0);
      expect(result.receiptRecord?.receipt?.sequence?.sequenceLength).toBe(22);
      expect(JSON.stringify(result.receiptRecord?.receipt || {})).not.toContain('MKTAYIAKQRQISFVKSHFSRQ');
      expect(result.assignment?.providerId).toBe(provider.advert?.body?.providerId);
      expect(result.requesterAcceptance?.requesterId).not.toBe(result.assignment?.providerId);
      expect(result.requesterAcceptance?.accepted).toBe(true);
      expect(result.requesterAcceptance?.requesterSignature).toBeTruthy();
      await attachRelayReceipt(testInfo, 'protein', roomId, result);
    } finally {
      await nodes.close();
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
    test.setTimeout(1200000);
    test.skip(
      process.env.REPLOID_E2E_ACTUAL_MULTI_PROVIDER !== '1',
      'Set REPLOID_E2E_ACTUAL_MULTI_PROVIDER=1 to load independent Doppler runtimes in two provider tabs.'
    );
    const roomId = roomIdFor(testInfo);
    const nodes = await createMultiProviderNodeContexts(browser, 2);
    try {
      const firstProviderPage = await openPoolPage(nodes.providerContexts[0], baseURL, '/compute', roomId, 'provider-one');
      const secondProviderPage = await openPoolPage(nodes.providerContexts[1], baseURL, '/compute', roomId, 'provider-two');
      await waitForProviderListening(firstProviderPage);
      await waitForProviderListening(secondProviderPage);

      const firstProvider = (await readSnapshot(firstProviderPage, 'pool-provider-result')).parsed;
      const secondProvider = (await readSnapshot(secondProviderPage, 'pool-provider-result')).parsed;
      expect(firstProvider.identity?.roleId).toMatch(/^provider_/);
      expect(secondProvider.identity?.roleId).toMatch(/^provider_/);
      expect(secondProvider.identity?.roleId).not.toBe(firstProvider.identity?.roleId);

      const runPage = await openPoolPage(nodes.requesterContext, baseURL, '/ask', roomId, 'ring-requester');
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
      expect(result.requesterAcceptance?.accepted).toBe(true);
      await attachRelayReceipt(testInfo, 'text-ring-2', roomId, result);
    } finally {
      await nodes.close();
    }
  });
});
