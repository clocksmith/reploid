/**
 * E2E Test: actual browser Doppler inference over the P2P room.
 */
import { test, expect } from '@playwright/test';

import { LAUNCH_MODEL, getEnabledPoolModelContract } from '../../self/pool/model-contract.js';

const BASE_URL = 'http://localhost:8000';
const ACTUAL_INFERENCE_TIMEOUT_MS = 300000;
const RELAY_MODE = process.env.REPLOID_E2E_RELAY_MODE === 'server' ? 'server' : 'local';
const RELAY_LABEL = RELAY_MODE === 'server' ? 'server relay' : 'local tab';
const FORCE_TURN = process.env.REPLOID_E2E_FORCE_TURN === '1';
const rawSha256 = (value) => String(value || '').replace(/^sha256:/, '');
const SEQUENCE_MODEL = getEnabledPoolModelContract('esm2-t12-35m-ur50d-f32-af32');
const PUBLIC_PROTEIN_SEQUENCE = 'MKTAYIAKQRQISFVKSHFSRQ';
const SECOND_PUBLIC_PROTEIN_SEQUENCE = 'ACDEFGHIKLMNPQRSTVWY';

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
  await context.addInitScript((forceTurn) => {
    window.REPLOID_POOL_DISCOVERY_WINDOW_MS = 30000;
    window.REPLOID_POOL_RECEIPT_WINDOW_MS = 300000;
    window.REPLOID_POOL_MAX_OUTPUT_TOKENS = 2;
    window.REPLOID_POOL_STRICT_ARTIFACT_PREFLIGHT = false;
    window.REPLOID_POOL_FORCE_RELAY = forceTurn;
  }, FORCE_TURN);
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
    console.log(`[${label}:pageerror] ${error.stack || error.message}`);
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
      transportDiagnostics: result.transportDiagnostics || null,
      relayMetrics: result.relayMetrics || null,
      embeddingDimensions: result.embeddingDimensions || receipt?.sequence?.embeddingDim || null,
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

const expectForcedTurnTransport = (result) => {
  if (!FORCE_TURN) return;
  expect(result.transportDiagnostics?.length || 0).toBeGreaterThan(0);
  for (const diagnostics of result.transportDiagnostics) {
    expect(diagnostics).toMatchObject({
      state: 'connected',
      iceTransportPolicy: 'relay',
      turnConfigured: true,
      localIceCandidateTypes: ['relay'],
      remoteIceCandidateTypes: ['relay']
    });
  }
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

const runActualSequence = async (page, sequence, policyId = 'fastest_receipt') => {
  await expect(page.locator('#pool-run-submit')).toBeVisible();
  if (policyId !== 'fastest_receipt') {
    const advanced = page.locator('details.pool-advanced').first();
    if (!(await advanced.evaluate((element) => element.open))) await advanced.locator('summary').click();
    await expect(page.locator('#pool-run-policy')).toBeVisible();
    await page.locator('#pool-run-policy').selectOption(policyId);
  }
  const publicSequence = page.locator('#pool-run-sequence-public');
  if (!(await publicSequence.isChecked())) await publicSequence.check();
  await page.locator('#pool-run-prompt').fill(sequence);
  await page.locator('#pool-run-submit').click();
  try {
    return await waitForActualResult({
      page,
      resultId: 'pool-run-result',
      isComplete: (parsed) => (
        parsed.transport === 'webrtc_peer_room'
        && parsed.receiptHash
        && typeof parsed.sequenceResultHash === 'string'
      )
    });
  } catch (error) {
    const snapshot = await readSnapshot(page, 'pool-run-result');
    throw new Error(`Actual P2P inference did not complete.\n${stringifySnapshot(snapshot)}\n${error.message}`);
  }
};

test.describe('Run and Contribute actual browser inference', () => {
  test.skip(process.env.REPLOID_E2E_ACTUAL_INFERENCE !== '1', 'Set REPLOID_E2E_ACTUAL_INFERENCE=1 to run the real Doppler browser workload.');

  test('loads ESM-2, embeds a public protein sequence, and returns a signed peer receipt', async ({ browser, baseURL }, testInfo) => {
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

      const result = await runActualSequence(runPage, PUBLIC_PROTEIN_SEQUENCE);

      expect(result.transport).toBe('webrtc_peer_room');
      expectForcedTurnTransport(result);
      expect(result.outputKind).toBe('sequence.embedding.v1');
      expect(result.sequenceResultHash).toMatch(/^sha256:/);
      expect(result.embeddingDimensions).toBe(480);
      expect(result.receiptHash).toMatch(/^sha256:/);
      expect(result.receiptRecord?.receipt?.model?.id || result.receiptRecord?.receipt?.model?.modelId).toBe(LAUNCH_MODEL.modelId);
      expect(result.receiptPayloads).toHaveLength(1);
      expect(result.agreement.accepted).toBe(true);
      expect(result.requesterAcceptance?.accepted).toBe(true);
      expect(result.requesterAcceptance?.requesterSignature).toBeTruthy();
      expect(result.requesterAcceptance?.requesterId).not.toBe(result.assignment?.providerId);
      await expect(runPage.locator('#pool-run-result-embedding-outcome')).toBeVisible();
      await expect(runPage.locator('#pool-run-result-embedding-outcome')).toContainText('480 dimensions');
      await expect(runPage.locator('[data-pool-copy-embedding]')).toBeEnabled();
      const contributorEvidence = runPage.locator('details.pool-contributor-details');
      await expect(contributorEvidence).toBeVisible();
      await contributorEvidence.locator(':scope > summary').click();
      await expect(contributorEvidence).toHaveJSProperty('open', true);
      await testInfo.attach(`poolday-${RELAY_MODE}-protein-requester-journey.png`, {
        body: await runPage.screenshot({ fullPage: true }),
        contentType: 'image/png'
      });
      await attachRelayReceipt(testInfo, 'protein', roomId, result);

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
      await requesterPage.locator('#pool-home-ask-prompt').fill(PUBLIC_PROTEIN_SEQUENCE);
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
      expectForcedTurnTransport(result);
      expect(result.outputKind).toBe('sequence.embedding.v1');
      expect(result.sequenceResultHash).toMatch(/^sha256:/);
      expect(result.embeddingDimensions).toBeGreaterThan(0);
      expect(result.receiptRecord?.receipt?.sequence?.sequenceLength).toBe(22);
      expect(JSON.stringify(result.receiptRecord?.receipt || {})).not.toContain(PUBLIC_PROTEIN_SEQUENCE);
      expect(result.assignment?.providerId).toBe(provider.advert?.body?.providerId);
      expect(result.requesterAcceptance?.requesterId).not.toBe(result.assignment?.providerId);
      expect(result.requesterAcceptance?.accepted).toBe(true);
      expect(result.requesterAcceptance?.requesterSignature).toBeTruthy();
      await attachRelayReceipt(testInfo, 'protein', roomId, result);
    } finally {
      await nodes.close();
    }
  });

  test('queues two public protein sequences through one loaded provider', async ({ browser, baseURL }, testInfo) => {
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
        runActualSequence(firstRunPage, PUBLIC_PROTEIN_SEQUENCE),
        runActualSequence(secondRunPage, SECOND_PUBLIC_PROTEIN_SEQUENCE)
      ]);

      for (const result of [first, second]) {
        expect(result.transport).toBe('webrtc_peer_room');
        expect(result.outputKind).toBe('sequence.embedding.v1');
        expect(result.sequenceResultHash).toMatch(/^sha256:/);
        expect(result.embeddingDimensions).toBeGreaterThan(0);
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

  test('loads two independent ESM-2 provider tabs and settles a real ring quorum', async ({ browser, baseURL }, testInfo) => {
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
      const result = await runActualSequence(
        runPage,
        PUBLIC_PROTEIN_SEQUENCE,
        'ring_quorum_receipt'
      );

      expect(result.transport).toBe('webrtc_peer_room');
      expectForcedTurnTransport(result);
      expect(result.outputKind).toBe('sequence.embedding.v1');
      expect(result.sequenceResultHash).toMatch(/^sha256:/);
      expect(result.agreement?.accepted).toBe(true);
      expect(result.assignments).toHaveLength(2);
      expect(result.receiptPayloads).toHaveLength(2);
      expect(new Set(result.assignments.map((assignment) => assignment.providerId)).size).toBe(2);
      expect(result.receiptHashes?.length || 0).toBeGreaterThanOrEqual(
        result.agreement?.requiredAgreement || 2
      );
      expect(result.requesterAcceptance?.accepted).toBe(true);
      await attachRelayReceipt(testInfo, 'protein-ring-2', roomId, result);
    } finally {
      await nodes.close();
    }
  });
});
