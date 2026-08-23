/**
 * E2E Test: actual browser Doppler inference over the P2P room.
 */
import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';

import {
  LAUNCH_MODEL,
  exactModelContractKey,
  getEnabledPoolModelContract
} from '../../self/pool/model-contract.js';
import { BROWSER_RUNTIME_CONFIG } from '../../self/pool/config.js';
import {
  buildBrowserQualificationCheckEvidence,
  buildBrowserQualificationObservation,
  recordBrowserQualificationCheck
} from '../../self/pool/browser-qualification.js';
import { buildModelArtifactUrls } from '../../self/pool/model-artifacts.js';

const BASE_URL = 'http://localhost:8000';
const ACTUAL_INFERENCE_TIMEOUT_MS = 300000;
const RELAY_MODE = process.env.REPLOID_E2E_RELAY_MODE === 'server' ? 'server' : 'local';
const RELAY_LABEL = RELAY_MODE === 'server' ? 'server relay' : 'local tab';
const FORCE_TURN = process.env.REPLOID_E2E_FORCE_TURN === '1';
const STRICT_ARTIFACT_PREFLIGHT = process.env.REPLOID_E2E_STRICT_ARTIFACT_PREFLIGHT === '1';
const rawSha256 = (value) => String(value || '').replace(/^sha256:/, '');
const SEQUENCE_MODEL = getEnabledPoolModelContract('esm2-t12-35m-ur50d-f32-af32');
const PUBLIC_PROTEIN_SEQUENCE = 'MKTAYIAKQRQISFVKSHFSRQ';
const SECOND_PUBLIC_PROTEIN_SEQUENCE = 'ACDEFGHIKLMNPQRSTVWY';
const LONG_PUBLIC_PROTEIN_SEQUENCE = 'ACDEFGHIKLMNPQRSTVWY'.repeat(50);
const MAX_PUBLIC_PROTEIN_SEQUENCE = `${'ACDEFGHIKLMNPQRSTVWY'.repeat(51)}ACDE`;
const browserQualificationHash = (value) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const isSha256 = (value) => /^sha256:[a-f0-9]{64}$/.test(String(value || ''));

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
  await context.addInitScript(({ forceTurn, strictArtifactPreflight }) => {
    window.REPLOID_POOL_DISCOVERY_WINDOW_MS = 30000;
    window.REPLOID_POOL_RECEIPT_WINDOW_MS = 300000;
    window.REPLOID_POOL_QUEUE_WINDOW_MS = 300000;
    window.REPLOID_POOL_MAX_OUTPUT_TOKENS = 2;
    window.REPLOID_POOL_STRICT_ARTIFACT_PREFLIGHT = strictArtifactPreflight;
    window.REPLOID_POOL_FORCE_RELAY = forceTurn;
  }, { forceTurn: FORCE_TURN, strictArtifactPreflight: STRICT_ARTIFACT_PREFLIGHT });
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
  await page.waitForSelector('.pool-home', { timeout: 45000 });
  await expect(page.locator('code[data-pool-room-id]')).toHaveText(roomId);
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
  const pendingResponses = new Set();
  Object.defineProperty(requests, 'failures', {
    value: [],
    enumerable: false
  });
  Object.defineProperty(requests, 'responses', {
    value: [],
    enumerable: false
  });
  Object.defineProperty(requests, 'waitForResponses', {
    value: async () => Promise.all([...pendingResponses]),
    enumerable: false
  });
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes(model.modelId) && /(?:manifest\.json|tokenizer\.json|shard_\d+\.bin)(?:$|[?#])/i.test(url)) {
      requests.push(url);
    }
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (url.includes(model.modelId) && /(?:manifest\.json|tokenizer\.json|shard_\d+\.bin)(?:$|[?#])/i.test(url)) {
      requests.failures.push({
        url,
        error: request.failure()?.errorText || 'unknown browser request failure'
      });
    }
  });
  page.on('response', (response) => {
    const url = response.url();
    if (!url.includes(model.modelId) || !/(?:manifest\.json|tokenizer\.json|shard_\d+\.bin)(?:$|[?#])/i.test(url)) return;
    const observation = response.allHeaders().then((headers) => {
      requests.responses.push({
        url,
        status: response.status(),
        headers
      });
    });
    pendingResponses.add(observation);
    void observation.finally(() => pendingResponses.delete(observation));
  });
  return requests;
};

const expectPinnedArtifactOrigin = async (requests, model, browserOrigin = BASE_URL) => {
  await requests.waitForResponses?.();
  const expectedBase = String(model.loadInput?.url || '').replace(/\/+$/, '');
  const expectedOrigin = new URL(browserOrigin).origin;
  expect(expectedBase).toMatch(/^https:\/\/storage\.googleapis\.com\/reploid-model-artifacts\//);
  expect(requests.some((url) => url.startsWith(`${expectedBase}/`))).toBe(true);
  expect(requests.some((url) => url.includes('huggingface.co/'))).toBe(false);
  const responses = requests.responses.filter((response) => response.url.startsWith(`${expectedBase}/`));
  expect(responses.length).toBeGreaterThan(0);
  for (const response of responses) {
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    expect(response.headers['access-control-allow-origin']).toBe(expectedOrigin);
    expect(response.headers.etag).toBeTruthy();
    expect(response.headers['cache-control']).toContain('immutable');
  }
};

const browserQualificationReleaseIdentity = () => ({
  sourceRevision: process.env.REPLOID_BROWSER_QUALIFICATION_SOURCE_REVISION || null,
  sourceTreeHash: process.env.REPLOID_BROWSER_QUALIFICATION_SOURCE_TREE_HASH || null,
  browserBundleHash: process.env.REPLOID_BROWSER_QUALIFICATION_BUNDLE_HASH || null,
  sourceDirty: process.env.REPLOID_BROWSER_QUALIFICATION_SOURCE_DIRTY !== 'false'
});

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
      release: browserQualificationReleaseIdentity(),
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

const attachIncompleteBrowserQualificationObservation = async (testInfo, {
  model,
  providerPage,
  artifactRequests,
  firstProvider,
  restoredProvider,
  result
} = {}) => {
  await artifactRequests.waitForResponses?.();
  const browserIdentity = await providerPage?.evaluate(() => navigator.userAgent).catch(() => null)
    || process.env.REPLOID_BROWSER_QUALIFICATION_BROWSER
    || 'unrecorded-browser';
  const observedBrowserVersion = String(browserIdentity)
    .match(/(?:HeadlessChrome|Chrome|Chromium)\/([0-9.]+)/)?.[1]
    || 'unrecorded';
  const gpuIdentity = firstProvider?.capabilityProfile?.deviceInfo?.adapterInfo
    || firstProvider?.runtime?.device?.adapterInfo
    || firstProvider?.runtime?.profile?.device?.adapterInfo
    || 'unrecorded-gpu';
  const policyHash = result?.assignment?.policyConfigHash || result?.assignment?.generationConfigHash || null;
  let observation = buildBrowserQualificationObservation({
    model,
    exactModelContractKey: exactModelContractKey(model),
    release: browserQualificationReleaseIdentity(),
    browser: {
      family: 'Chromium',
      version: String(process.env.REPLOID_BROWSER_QUALIFICATION_BROWSER_VERSION || observedBrowserVersion),
      userAgentHash: browserQualificationHash(browserIdentity)
    },
    gpu: { adapterIdentity: typeof gpuIdentity === 'string' ? gpuIdentity : JSON.stringify(gpuIdentity) },
    policyHash,
    outputHash: result?.sequenceResultHash || null,
    receiptHash: result?.receiptHash || null,
    artifacts: {
      manifestHash: model.manifestHash,
      tokenizerHash: model.tokenizerHash,
      shardSetHash: model.artifactIdentity?.shardSetHash || null
    },
    independentReproductions: []
  });
  const artifactEvidenceHash = browserQualificationHash({
    modelId: model.modelId,
    manifestHash: model.manifestHash,
    tokenizerHash: model.tokenizerHash,
    shardSetHash: model.artifactIdentity?.shardSetHash || null,
    artifactRequests: [...artifactRequests],
    artifactResponses: artifactRequests.responses
  });
  // A release smoke run is still useful when promotion-grade release hashes
  // were not supplied, but it must remain an incomplete observation. Passing
  // checks are only legal when every evidence binding can identify the exact
  // deployed release, model, policy, output, and receipt.
  const hasHashAddressedBindings = Boolean(observation.release?.sourceRevision)
    && isSha256(observation.release?.sourceTreeHash)
    && isSha256(observation.release?.browserBundleHash)
    && observation.release?.sourceDirty === false
    && isSha256(observation.identity?.modelHash)
    && isSha256(observation.artifacts?.manifestHash)
    && isSha256(observation.artifacts?.tokenizerHash)
    && isSha256(observation.artifacts?.shardSetHash)
    && isSha256(observation.browser?.userAgentHash)
    && isSha256(observation.policyHash)
    && isSha256(observation.outputHash)
    && isSha256(observation.receiptHash);
  const hasObservedBindings = isSha256(observation.identity?.modelHash)
    && isSha256(observation.artifacts?.manifestHash)
    && isSha256(observation.artifacts?.tokenizerHash)
    && isSha256(observation.artifacts?.shardSetHash)
    && isSha256(observation.browser?.userAgentHash)
    && Boolean(observation.gpu?.adapterIdentity)
    && isSha256(observation.policyHash)
    && isSha256(observation.outputHash)
    && isSha256(observation.receiptHash);
  const recordCheck = (check, executedSuccessfully, facts) => {
    if (!executedSuccessfully || !hasObservedBindings) return;
    observation = recordBrowserQualificationCheck(observation, {
      check,
      status: hasHashAddressedBindings ? 'passed' : 'observed',
      evidence: buildBrowserQualificationCheckEvidence(observation, {
        check,
        browserRunId: `${testInfo.project.name}:${testInfo.workerIndex}:${testInfo.testId}`,
        observedAt: new Date().toISOString(),
        resultHash: browserQualificationHash(facts),
        artifactHash: artifactEvidenceHash
      })
    });
  };
  const expectedArtifactBase = String(model.loadInput?.url || '').replace(/\/+$/, '');
  const browserOrigin = new URL(providerPage.url()).origin;
  const deliveredResponses = artifactRequests.responses.filter((response) => response.url.startsWith(`${expectedArtifactBase}/`));
  recordCheck('immutableArtifactDelivery', deliveredResponses.length > 0 && deliveredResponses.every((response) => (
    response.status >= 200
    && response.status < 300
    && response.headers['access-control-allow-origin'] === browserOrigin
    && String(response.headers['cache-control'] || '').includes('immutable')
    && Boolean(response.headers.etag)
  )), { requests: [...artifactRequests], responses: deliveredResponses });
  recordCheck('completeHashVerification', STRICT_ARTIFACT_PREFLIGHT === true, firstProvider?.runtime?.persistentCache || null);
  recordCheck('webGpuExecution', firstProvider?.capabilityProfile?.deviceInfo?.hasWebGPU === true, firstProvider?.capabilityProfile?.deviceInfo || null);
  recordCheck('opfsPersistence', firstProvider?.runtime?.persistentCache?.backend === 'opfs', firstProvider?.runtime?.persistentCache || null);
  recordCheck('opfsRestoration', restoredProvider?.runtime?.persistentCache?.fromCache === true, restoredProvider?.runtime?.persistentCache || null);
  recordCheck('receiptIntegrity', result?.agreement?.accepted === true && result?.requesterAcceptance?.accepted === true, {
    receiptHash: result?.receiptHash,
    agreement: result?.agreement,
    requesterAcceptance: result?.requesterAcceptance
  });
  await testInfo.attach('poolday-browser-qualification-observation.incomplete.json', {
    body: Buffer.from(JSON.stringify(observation, null, 2)),
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

const waitForProviderListening = async (page, artifactRequests = null) => {
  const toggle = page.locator('#pool-provider-worker-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('data-contribution-action', 'start');
  await toggle.click();
  try {
    const deadline = Date.now() + ACTUAL_INFERENCE_TIMEOUT_MS;
    let snapshot = await readSnapshot(page, 'pool-provider-result');
    while (Date.now() < deadline) {
      const artifactFailure = artifactRequests?.failures?.[0];
      if (artifactFailure) {
        throw new Error(`Model artifact delivery failed: ${artifactFailure.url} (${artifactFailure.error})`);
      }
      snapshot = await readSnapshot(page, 'pool-provider-result');
      const parsed = snapshot.parsed || {};
      if (parsed.status === 'error' || parsed.error) {
        throw new Error(parsed.reason || parsed.error || 'provider entered an error state');
      }
      if (snapshot.providerState === 'online' && parsed.runner === 'peer_room_listening') return;
      await page.waitForTimeout(1000);
      snapshot = await readSnapshot(page, 'pool-provider-result');
    }
    throw new Error(`Timed out waiting for provider startup.\n${stringifySnapshot(snapshot)}`);
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

const submitActualSequence = async (page, sequence, policyId = 'fastest_receipt', {
  publishResearch = policyId === 'ring_quorum_receipt'
} = {}) => {
  await expect(page.locator('#pool-run-submit')).toBeVisible();
  const policy = page.locator('#pool-run-policy');
  const advanced = policy.locator('xpath=ancestor::details[1]');
  if (!(await advanced.evaluate((element) => element.open))) await advanced.locator('summary').click();
  await expect(policy).toBeVisible();
  await policy.selectOption(policyId);
  await expect(policy).toHaveValue(policyId);
  const publicSequence = page.locator('#pool-run-sequence-public');
  if (!(await publicSequence.isChecked())) await publicSequence.check();
  const publicEvidence = page.locator('#pool-run-research-public');
  if (publishResearch && !(await publicEvidence.isChecked())) await publicEvidence.check();
  if (!publishResearch && await publicEvidence.isChecked()) await publicEvidence.uncheck();
  await page.locator('#pool-run-intent-kind').selectOption('question');
  await page.locator('#pool-run-intent-label').fill('Public ESM-2 qualification sequence');
  await page.locator('#pool-run-intent-text').fill('Produce receipt-backed embedding evidence for the declared public protein sequence.');
  await page.locator('#pool-run-prompt').fill(sequence);
  await page.locator('#pool-run-submit').click();
};

const runActualSequence = async (page, sequence, policyId = 'fastest_receipt', options = {}) => {
  await submitActualSequence(page, sequence, policyId, options);
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

const corruptCachedModelShard = async (page, model) => page.evaluate(async ({ modelId, storageModuleUrl }) => {
  const resolvedStorageModuleUrl = window.REPLOID_DOPPLER_STORAGE_MODULE_URL || storageModuleUrl;
  const storage = await import(resolvedStorageModuleUrl);
  await storage.openModelStore(modelId);
  const manifestText = await storage.loadManifestFromStore();
  const manifest = JSON.parse(manifestText);
  const shard = manifest.shards?.[0];
  if (!shard?.filename || !shard?.hash || !manifest.hashAlgorithm) {
    throw new Error('Qualification corruption probe requires a manifest-declared shard digest.');
  }
  const original = new Uint8Array(await storage.loadFileFromStore(shard.filename));
  if (original.byteLength < 1) throw new Error('Qualification corruption probe found an empty shard.');
  const mutated = original.slice();
  mutated[0] ^= 1;
  const originalHash = await storage.computeHash(original, manifest.hashAlgorithm);
  const mutatedHash = await storage.computeHash(mutated, manifest.hashAlgorithm);
  await storage.saveAuxFile(shard.filename, mutated);
  return {
    storageModuleUrl: resolvedStorageModuleUrl,
    path: shard.filename,
    bytes: original.byteLength,
    hashAlgorithm: manifest.hashAlgorithm,
    expectedHash: shard.hash,
    originalHash,
    mutatedHash
  };
}, {
  modelId: model.modelId,
  storageModuleUrl: BROWSER_RUNTIME_CONFIG.dopplerStorageModuleUrl
});

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
      await waitForProviderListening(providerPage, initialArtifactRequests);
      const firstProvider = (await readSnapshot(providerPage, 'pool-provider-result')).parsed;
      await expectPinnedArtifactOrigin(initialArtifactRequests, LAUNCH_MODEL, providerPage.url());
      expect(firstProvider.runtime?.persistentCache).toMatchObject({
        backend: 'opfs'
      });
      expect(firstProvider.runtime?.cachePreflight).toMatchObject({
        schema: 'reploid.pool.model_cache_integrity/v1',
        modelId: LAUNCH_MODEL.modelId,
        status: 'not_cached',
        valid: null,
        invalidated: false
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
      expect(result.researchSubmissionHash).toBeUndefined();
      expect(result.researchResultHash).toBeUndefined();
      expect(result.embeddingPublicationConsent).not.toBe(true);
      expect(result.requesterAcceptance?.requesterSignature).toBeTruthy();
      expect(result.requesterAcceptance?.requesterId).not.toBe(result.assignment?.providerId);
      await expect(runPage.locator('#pool-run-result-embedding-outcome')).toBeVisible();
      await expect(runPage.locator('#pool-run-result-embedding-outcome')).toContainText('480 dimensions');
      await expect(runPage.locator('[data-pool-copy-embedding]')).toBeDisabled();
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
      expect(restoredProvider.runtime?.cachePreflight).toMatchObject({
        schema: 'reploid.pool.model_cache_integrity/v1',
        modelId: LAUNCH_MODEL.modelId,
        status: 'verified',
        valid: true,
        invalidated: false,
        files: expect.arrayContaining([
          expect.objectContaining({ kind: 'shard', path: 'shard_00000.bin', valid: true }),
          expect.objectContaining({ kind: 'shard', path: 'shard_00001.bin', valid: true }),
          expect.objectContaining({ kind: 'tokenizer', path: 'tokenizer.json', valid: true })
        ]),
        reasons: []
      });
      expect(shardRequestsAfterReload).toBe(0);
      await attachIncompleteBrowserQualificationObservation(testInfo, {
        model: LAUNCH_MODEL,
        providerPage,
        artifactRequests: initialArtifactRequests,
        firstProvider,
        restoredProvider,
        result
      });
    } finally {
      await nodes.close();
    }
  });

  test('preserves an actual ESM-2 request for explicit recovery after requester reload', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(900000);
    const roomId = roomIdFor(testInfo);
    const nodes = await createInferenceNodeContexts(browser);
    try {
      const providerPage = await openPoolPage(nodes.providerContext, baseURL, '/compute', roomId, 'interruption-provider');
      const artifactRequests = trackModelArtifactRequests(providerPage, LAUNCH_MODEL);
      const requesterPage = await openPoolPage(nodes.requesterContext, baseURL, '/ask', roomId, 'interruption-requester');
      await waitForProviderListening(providerPage, artifactRequests);

      await submitActualSequence(requesterPage, LONG_PUBLIC_PROTEIN_SEQUENCE);
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveText('Computing', {
        timeout: 30000
      });
      const requestStatusBeforeReload = await requesterPage.locator('[data-pool-run-status]').textContent();
      expect(requestStatusBeforeReload).not.toBe('Ready');

      await requesterPage.reload({ waitUntil: 'domcontentloaded' });
      await requesterPage.waitForSelector('.pool-home');
      await expect(requesterPage.locator('[data-pool-run-status]')).toHaveText('Previous request needs a decision');
      await expect(requesterPage.locator('#pool-run-result-raw')).toContainText('Code: peer_request_interrupted');
      await expect(requesterPage.locator('#pool-run-result-recovery')).toContainText('has not been resumed or sent again');
      await expect(requesterPage.locator('#pool-run-prompt')).toHaveValue(LONG_PUBLIC_PROTEIN_SEQUENCE);
      await requesterPage.waitForTimeout(1000);
      await expect(requesterPage.locator('[data-pool-run-status]')).toHaveText('Previous request needs a decision');
      const providerStatusAfterReload = await providerPage.locator('[data-pool-provider-status]').textContent();

      await requesterPage.locator('[data-pool-run-recovery-action="discard_interrupted_request"]').click();
      await expect(requesterPage.locator('[data-pool-run-status]')).toHaveText('Ready for a new request');
      await expect(requesterPage.locator('[data-pool-run-output]')).toBeHidden();
      await testInfo.attach('poolday-actual-interruption-recovery-observation.json', {
        body: Buffer.from(JSON.stringify({
          schema: 'poolday.actual_browser_interruption_observation/v1',
          status: 'observed',
          qualificationEligible: false,
          release: browserQualificationReleaseIdentity(),
          roomId,
          modelId: LAUNCH_MODEL.modelId,
          modelHash: LAUNCH_MODEL.modelHash,
          manifestHash: LAUNCH_MODEL.manifestHash,
          sequenceLength: LONG_PUBLIC_PROTEIN_SEQUENCE.length,
          executionStartObserved: true,
          providerStatusBeforeReload: 'Computing',
          providerStatusAfterReload,
          requestStatusBeforeReload,
          recoveryCode: 'peer_request_interrupted',
          automaticRetry: false,
          userDecisionRequired: true,
          userDecision: 'discarded',
          lateResultPublishedInReloadedPage: false,
          claimBoundary: 'Actual ESM-2 provider execution had started before requester reload. The reloaded page required an explicit retry or discard decision, did not retry automatically, and did not publish a late result before discard. This dirty local observation is not a clean-release browser qualification check.'
        }, null, 2)),
        contentType: 'application/json'
      });
    } finally {
      await nodes.close();
    }
  });

  test('creates a new actual ESM-2 request after explicit interruption retry', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(1800000);
    const roomId = roomIdFor(testInfo);
    const nodes = await createInferenceNodeContexts(browser);
    try {
      await Promise.all([...new Set([nodes.providerContext, nodes.requesterContext])].map((context) => (
        context.addInitScript(() => {
          window.REPLOID_POOL_RECEIPT_WINDOW_MS = 600000;
          window.REPLOID_POOL_QUEUE_WINDOW_MS = 600000;
        })
      )));
      const providerPage = await openPoolPage(nodes.providerContext, baseURL, '/compute', roomId, 'interruption-retry-provider');
      const artifactRequests = trackModelArtifactRequests(providerPage, LAUNCH_MODEL);
      const requesterPage = await openPoolPage(nodes.requesterContext, baseURL, '/ask', roomId, 'interruption-retry-requester');
      await waitForProviderListening(providerPage, artifactRequests);

      await submitActualSequence(requesterPage, MAX_PUBLIC_PROTEIN_SEQUENCE);
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveText('Computing', {
        timeout: 30000
      });
      const interruptedProviderEvent = (await readSnapshot(providerPage, 'pool-provider-result')).parsed;
      const interruptedAssignmentId = interruptedProviderEvent?.assignment?.assignmentId || null;
      expect(interruptedAssignmentId).toBeTruthy();

      await requesterPage.reload({ waitUntil: 'domcontentloaded' });
      await requesterPage.waitForSelector('.pool-home');
      await expect(requesterPage.locator('[data-pool-run-status]')).toHaveText('Previous request needs a decision');
      await expect(requesterPage.locator('#pool-run-result-raw')).toContainText('Code: peer_request_interrupted');
      await expect(requesterPage.locator('#pool-run-prompt')).toHaveValue(MAX_PUBLIC_PROTEIN_SEQUENCE);
      await requesterPage.locator('[data-pool-run-recovery-action="retry_interrupted_request"]').click();

      const retried = await waitForActualResult({
        page: requesterPage,
        resultId: 'pool-run-result',
        timeoutMs: 1500000,
        isComplete: (parsed) => (
          parsed.transport === 'webrtc_peer_room'
          && parsed.receiptHash
          && typeof parsed.sequenceResultHash === 'string'
        )
      });
      expect(retried.assignment?.assignmentId).toBeTruthy();
      expect(retried.assignment.assignmentId).not.toBe(interruptedAssignmentId);
      expect(retried.receiptHash).toMatch(/^sha256:/);
      expect(retried.agreement?.accepted).toBe(true);
      expect(retried.requesterAcceptance?.accepted).toBe(true);
      expect(retried.deliveryPolicy).toEqual({
        queueWindowMs: 600000,
        receiptWindowMs: 600000,
        queueDeadlineStartsOn: 'provider_queued_status',
        receiptDeadlineStartsOn: 'input_dispatch_or_provider_execution_started'
      });
      const retriedStatusTypes = retried.executionStatusEvidence.map((status) => status.type);
      expect(retriedStatusTypes).toContain('execution_started');
      if (retriedStatusTypes.includes('queued')) {
        expect(retriedStatusTypes.indexOf('queued')).toBeLessThan(
          retriedStatusTypes.indexOf('execution_started')
        );
      }
      expect(retried.executionStatusEvidence.every((status) => (
        status.assignmentId === retried.assignment.assignmentId
        && status.providerId === retried.assignment.providerId
        && status.claimBoundary.includes('not a signed receipt')
      ))).toBe(true);

      await testInfo.attach('poolday-actual-interruption-retry-observation.json', {
        body: Buffer.from(JSON.stringify({
          schema: 'poolday.actual_browser_interruption_retry_observation/v1',
          status: 'observed',
          qualificationEligible: false,
          release: browserQualificationReleaseIdentity(),
          roomId,
          modelId: LAUNCH_MODEL.modelId,
          modelHash: LAUNCH_MODEL.modelHash,
          manifestHash: LAUNCH_MODEL.manifestHash,
          sequenceLength: MAX_PUBLIC_PROTEIN_SEQUENCE.length,
          executionStartObserved: true,
          recoveryCode: 'peer_request_interrupted',
          automaticRetry: false,
          userDecision: 'retry',
          interruptedAssignmentId,
          retriedAssignmentId: retried.assignment.assignmentId,
          distinctAssignment: retried.assignment.assignmentId !== interruptedAssignmentId,
          retryQueuedBehindInterruptedExecution: retriedStatusTypes.includes('queued'),
          queueStatusObserved: retriedStatusTypes.includes('queued'),
          executionStartedStatusObserved: retriedStatusTypes.includes('execution_started'),
          deliveryPolicy: retried.deliveryPolicy,
          retriedReceiptHash: retried.receiptHash,
          retriedAgreementAccepted: retried.agreement?.accepted === true,
          retriedRequesterAccepted: retried.requesterAcceptance?.accepted === true,
          claimBoundary: retriedStatusTypes.includes('queued')
            ? 'After actual ESM-2 execution began and requester reload required a decision, explicit retry created a distinct assignment. The single-job provider queued it until the abandoned execution settled, then returned a newly accepted receipt. This dirty local observation is not automatic resume, exactly-once execution, or clean-release browser qualification.'
            : 'After actual ESM-2 execution began and requester reload required a decision, explicit retry created a distinct assignment. The retry reached the provider without a reported queue wait, started a new execution, and returned a newly accepted receipt. This dirty local observation is not automatic resume, exactly-once execution, or clean-release browser qualification.'
        }, null, 2)),
        contentType: 'application/json'
      });
    } finally {
      await nodes.close();
    }
  });

  test('cancels actual ESM-2 work after execution starts without publishing a receipt', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(900000);
    const roomId = roomIdFor(testInfo);
    const nodes = await createInferenceNodeContexts(browser);
    try {
      const providerPage = await openPoolPage(nodes.providerContext, baseURL, '/compute', roomId, 'cancellation-provider');
      const artifactRequests = trackModelArtifactRequests(providerPage, LAUNCH_MODEL);
      const requesterPage = await openPoolPage(nodes.requesterContext, baseURL, '/ask', roomId, 'cancellation-requester');
      await waitForProviderListening(providerPage, artifactRequests);
      await requesterPage.evaluate(() => {
        window.REPLOID_POOL_RECEIPT_WINDOW_MS = 5000;
      });

      await submitActualSequence(requesterPage, LONG_PUBLIC_PROTEIN_SEQUENCE);
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveText('Computing', {
        timeout: 30000
      });
      const toggle = providerPage.locator('#pool-provider-worker-toggle');
      await expect(toggle).toHaveAttribute('data-contribution-action', 'stop');
      await toggle.click();
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveText('Stopping', {
        timeout: 30000
      });
      const stopping = (await readSnapshot(providerPage, 'pool-provider-result')).parsed;
      expect(stopping).toMatchObject({
        runner: 'stopping',
        cancellation: {
          status: 'cancelled',
          reason: 'provider_stopped',
          cancellation: {
            requested: true,
            method: 'abort_signal',
            signal: { requested: true, method: 'abort_signal' },
            session: { requested: false, method: null }
          }
        }
      });

      await expect(requesterPage.locator('[data-pool-run-status]')).toHaveText(
        'No matching provider is currently available',
        { timeout: 30000 }
      );
      const requesterFailure = await requesterPage.locator('#pool-run-result-raw').textContent();
      expect(requesterFailure).toContain('Code: peer_provider_unresponsive');
      expect(requesterFailure).not.toContain('receiptHash');
      await testInfo.attach('poolday-actual-cancellation-observation.json', {
        body: Buffer.from(JSON.stringify({
          schema: 'poolday.actual_browser_cancellation_observation/v1',
          status: 'observed',
          qualificationEligible: false,
          release: browserQualificationReleaseIdentity(),
          roomId,
          modelId: LAUNCH_MODEL.modelId,
          modelHash: LAUNCH_MODEL.modelHash,
          manifestHash: LAUNCH_MODEL.manifestHash,
          sequenceLength: LONG_PUBLIC_PROTEIN_SEQUENCE.length,
          mode: 'after_start',
          runtimeCancellation: stopping.cancellation || null,
          receiptPublished: false,
          requesterFailureCode: 'peer_provider_unresponsive',
          claimBoundary: 'Actual Poolday cancellation requested the per-execution abort signal, invalidated late output, and closed the peer session. This does not by itself prove that the current Doppler sequence backend stopped GPU work before queue settlement; this dirty local observation is not a clean-release qualification check.'
        }, null, 2)),
        contentType: 'application/json'
      });
    } finally {
      await nodes.close();
    }
  });

  test('rejects a superseded actual ESM-2 result before receipt publication', async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(900000);
    const roomId = roomIdFor(testInfo);
    const nodes = await createInferenceNodeContexts(browser);
    try {
      const providerPage = await openPoolPage(nodes.providerContext, baseURL, '/compute', roomId, 'stale-provider');
      await providerPage.evaluate(async () => {
        const { createDopplerRuntime } = await import('/pool/doppler-runtime.js');
        const runtime = createDopplerRuntime({
          resultReleaseBarrier: async ({ signal }) => {
            window.REPLOID_E2E_RESULT_RELEASE_HELD = true;
            await new Promise((resolve) => {
              if (signal.aborted) {
                resolve();
                return;
              }
              signal.addEventListener('abort', resolve, { once: true });
            });
          }
        });
        window.REPLOID_DOPPLER_RUNTIME = runtime;
        window.REPLOID_POOL_ATTACH_DOPPLER_HANDLE = (handle, model = null, runtimeInfo = null) => (
          runtime.attachHandle(handle, model, runtimeInfo)
        );
      });
      const artifactRequests = trackModelArtifactRequests(providerPage, LAUNCH_MODEL);
      const requesterPage = await openPoolPage(nodes.requesterContext, baseURL, '/ask', roomId, 'stale-requester');
      await waitForProviderListening(providerPage, artifactRequests);
      await requesterPage.evaluate(() => {
        window.REPLOID_POOL_RECEIPT_WINDOW_MS = 5000;
      });

      await submitActualSequence(requesterPage, PUBLIC_PROTEIN_SEQUENCE);
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveText('Computing', {
        timeout: 30000
      });
      await expect.poll(() => providerPage.evaluate(() => (
        window.REPLOID_E2E_RESULT_RELEASE_HELD === true
      )), {
        timeout: 300000,
        intervals: [250, 500, 1000]
      }).toBe(true);
      const toggle = providerPage.locator('#pool-provider-worker-toggle');
      await toggle.click();
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveText('Idle', {
        timeout: 30000
      });
      const settled = (await readSnapshot(providerPage, 'pool-provider-result')).parsed;
      expect(settled).toMatchObject({
        runner: 'stopped',
        runtime: {
          ok: true,
          status: 'closed',
          workSettlement: {
            status: 'stale_result_rejected',
            epoch: 0,
            errorName: 'StaleResultError',
            errorCode: 'pool_runtime_stale_result',
            reason: 'provider_stopped'
          }
        }
      });
      await expect(requesterPage.locator('[data-pool-run-status]')).toHaveText(
        'No matching provider is currently available',
        { timeout: 30000 }
      );
      const requesterFailure = await requesterPage.locator('#pool-run-result-raw').textContent();
      expect(requesterFailure).toContain('Code: peer_provider_unresponsive');
      expect(requesterFailure).not.toContain('receiptHash');
      await testInfo.attach('poolday-actual-stale-result-rejection-observation.json', {
        body: Buffer.from(JSON.stringify({
          schema: 'poolday.actual_browser_stale_result_rejection_observation/v1',
          status: 'observed',
          qualificationEligible: false,
          release: browserQualificationReleaseIdentity(),
          roomId,
          modelId: LAUNCH_MODEL.modelId,
          modelHash: LAUNCH_MODEL.modelHash,
          manifestHash: LAUNCH_MODEL.manifestHash,
          sequenceLength: PUBLIC_PROTEIN_SEQUENCE.length,
          mode: 'after_backend_result_before_release',
          resultReleaseBarrier: 'qualification_probe',
          runtimeSettlement: settled.runtime?.workSettlement || null,
          receiptPublished: false,
          requesterFailureCode: 'peer_provider_unresponsive',
          claimBoundary: 'Actual ESM-2 completed behind a qualification-only result-release barrier; Poolday invalidated its epoch and rejected the superseded output before receipt construction. This dirty local observation is not a clean-release qualification check.'
        }, null, 2)),
        contentType: 'application/json'
      });
    } finally {
      await nodes.close();
    }
  });

  test('rejects a corrupted ESM-2 manifest before advertising the provider', async ({ browser, baseURL }, testInfo) => {
    test.skip(!STRICT_ARTIFACT_PREFLIGHT, 'Strict artifact preflight is required for the corruption probe.');
    test.setTimeout(300000);
    const roomId = roomIdFor(testInfo);
    const nodes = await createInferenceNodeContexts(browser);
    const manifestUrl = buildModelArtifactUrls(LAUNCH_MODEL).manifest;
    let corruptionEvidence = null;
    try {
      await nodes.providerContext.route(manifestUrl, async (route) => {
        const upstream = await route.fetch();
        const originalText = await upstream.text();
        const corruptedManifest = {
          ...JSON.parse(originalText),
          manifestHash: LAUNCH_MODEL.manifestHash,
          corruptionProbe: 'uncommitted_manifest_mutation'
        };
        const corruptedText = JSON.stringify(corruptedManifest);
        corruptionEvidence = {
          manifestUrl,
          configuredManifestHash: LAUNCH_MODEL.manifestHash,
          selfDeclaredManifestHash: corruptedManifest.manifestHash,
          originalTextHash: `sha256:${createHash('sha256').update(originalText).digest('hex')}`,
          corruptedTextHash: `sha256:${createHash('sha256').update(corruptedText).digest('hex')}`
        };
        await route.fulfill({
          response: upstream,
          body: corruptedText,
          headers: {
            ...upstream.headers(),
            'content-type': 'application/json'
          }
        });
      });

      const providerPage = await openPoolPage(
        nodes.providerContext,
        baseURL,
        '/compute',
        roomId,
        'corruption-provider'
      );
      const artifactRequests = trackModelArtifactRequests(providerPage, LAUNCH_MODEL);
      const toggle = providerPage.locator('#pool-provider-worker-toggle');
      await expect(toggle).toHaveAttribute('data-contribution-action', 'start');
      await toggle.click();
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveText('Starting');
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveText('Idle', {
        timeout: 30000
      });
      const rejected = await readSnapshot(providerPage, 'pool-provider-result');
      expect(rejected.providerState).toBe('offline');
      expect(rejected.raw).toContain('Error: This tab could not start');
      expect(rejected.raw).toContain('model manifest hash does not match configured manifestHash');
      expect(rejected.raw).toContain('Code: model_artifact_unavailable');
      expect(rejected.raw).toContain('Artifact: manifest_unavailable');
      await expect(toggle).toHaveAttribute('data-contribution-action', 'start');
      expect(corruptionEvidence).toMatchObject({
        configuredManifestHash: LAUNCH_MODEL.manifestHash,
        selfDeclaredManifestHash: LAUNCH_MODEL.manifestHash,
        originalTextHash: LAUNCH_MODEL.manifestHash
      });
      expect(corruptionEvidence.corruptedTextHash).not.toBe(LAUNCH_MODEL.manifestHash);
      expect(artifactRequests.some((url) => /shard_\d+\.bin(?:$|[?#])/i.test(url))).toBe(false);
      await testInfo.attach('poolday-actual-corruption-rejection-observation.json', {
        body: Buffer.from(JSON.stringify({
          schema: 'poolday.actual_browser_corruption_rejection_observation/v1',
          status: 'observed',
          qualificationEligible: false,
          release: browserQualificationReleaseIdentity(),
          roomId,
          modelId: LAUNCH_MODEL.modelId,
          modelHash: LAUNCH_MODEL.modelHash,
          manifestHash: LAUNCH_MODEL.manifestHash,
          corruption: corruptionEvidence,
          providerAdvertised: false,
          shardRequested: false,
          rejectionCode: 'model_artifact_unavailable',
          rejectionReason: 'model manifest hash does not match configured manifestHash',
          claimBoundary: 'Actual Chromium strict preflight rejected mutated manifest bytes before model load or provider advertisement. This dirty local probe does not qualify the browser release or establish shard-corruption recovery.'
        }, null, 2)),
        contentType: 'application/json'
      });
    } finally {
      await nodes.close();
    }
  });

  test('recovers a corrupted cached ESM-2 shard before provider advertisement', async ({ browser, baseURL }, testInfo) => {
    test.skip(!STRICT_ARTIFACT_PREFLIGHT, 'Strict artifact preflight is required for the cached-shard recovery probe.');
    test.setTimeout(900000);
    const roomId = roomIdFor(testInfo);
    const nodes = await createInferenceNodeContexts(browser);
    try {
      const providerPage = await openPoolPage(
        nodes.providerContext,
        baseURL,
        '/compute',
        roomId,
        'cached-shard-recovery-provider'
      );
      const artifactRequests = trackModelArtifactRequests(providerPage, LAUNCH_MODEL);
      const requesterPage = await openPoolPage(
        nodes.requesterContext,
        baseURL,
        '/ask',
        roomId,
        'cached-shard-recovery-requester'
      );
      await waitForProviderListening(providerPage, artifactRequests);
      const primedProvider = (await readSnapshot(providerPage, 'pool-provider-result')).parsed;
      expect(primedProvider.runtime?.cachePreflight).toMatchObject({
        schema: 'reploid.pool.model_cache_integrity/v1',
        modelId: LAUNCH_MODEL.modelId,
        status: 'not_cached',
        valid: null,
        invalidated: false
      });
      const baseline = await runActualSequence(requesterPage, PUBLIC_PROTEIN_SEQUENCE);

      const toggle = providerPage.locator('#pool-provider-worker-toggle');
      await toggle.click();
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveText('Idle', {
        timeout: 30000
      });
      const mutation = await corruptCachedModelShard(providerPage, LAUNCH_MODEL);
      expect(mutation.originalHash).toBe(rawSha256(mutation.expectedHash));
      expect(mutation.mutatedHash).not.toBe(mutation.originalHash);
      expect(mutation.bytes).toBeGreaterThan(0);

      let recoveryShardRequests = 0;
      providerPage.on('request', (request) => {
        if (/\/shard_\d+\.bin(?:$|[?#])/i.test(request.url())) recoveryShardRequests += 1;
      });
      await waitForProviderListening(providerPage, artifactRequests);
      const recoveredProvider = (await readSnapshot(providerPage, 'pool-provider-result')).parsed;
      expect(recoveredProvider.runtime?.cachePreflight).toMatchObject({
        schema: 'reploid.pool.model_cache_integrity/v1',
        modelId: LAUNCH_MODEL.modelId,
        status: 'invalidated',
        valid: false,
        invalidated: true,
        files: expect.arrayContaining([
          expect.objectContaining({
            kind: 'shard',
            path: mutation.path,
            expectedHash: rawSha256(mutation.expectedHash),
            observedHash: mutation.mutatedHash,
            valid: false
          })
        ]),
        reasons: expect.arrayContaining([
          `${mutation.path}: stored hash does not match the manifest`
        ])
      });
      expect(recoveredProvider.runtime?.persistentCache).toMatchObject({
        backend: 'opfs',
        fromCache: false
      });
      expect(recoveryShardRequests).toBeGreaterThan(0);

      const recovered = await runActualSequence(requesterPage, PUBLIC_PROTEIN_SEQUENCE);
      expect(recovered.sequenceResultHash).toBe(baseline.sequenceResultHash);
      expect(recovered.receiptHash).not.toBe(baseline.receiptHash);
      expect(recovered.agreement?.accepted).toBe(true);
      expect(recovered.requesterAcceptance?.accepted).toBe(true);
      await testInfo.attach('poolday-actual-cached-shard-recovery-observation.json', {
        body: Buffer.from(JSON.stringify({
          schema: 'poolday.actual_browser_cached_shard_recovery_observation/v1',
          status: 'observed',
          qualificationEligible: false,
          release: browserQualificationReleaseIdentity(),
          roomId,
          modelId: LAUNCH_MODEL.modelId,
          modelHash: LAUNCH_MODEL.modelHash,
          manifestHash: LAUNCH_MODEL.manifestHash,
          mutation,
          cachePreflight: recoveredProvider.runtime?.cachePreflight || null,
          persistentCache: recoveredProvider.runtime?.persistentCache || null,
          recoveryShardRequests,
          baselineOutputHash: baseline.sequenceResultHash,
          recoveredOutputHash: recovered.sequenceResultHash,
          outputRestored: recovered.sequenceResultHash === baseline.sequenceResultHash,
          baselineReceiptHash: baseline.receiptHash,
          recoveredReceiptHash: recovered.receiptHash,
          receiptsDistinct: recovered.receiptHash !== baseline.receiptHash,
          recoveredAgreementAccepted: recovered.agreement?.accepted === true,
          recoveredRequesterAccepted: recovered.requesterAcceptance?.accepted === true,
          claimBoundary: 'Actual Chromium mutated one manifest-declared OPFS shard through Doppler public storage tooling. Poolday detected the digest mismatch, invalidated the exact-model cache, re-imported immutable source artifacts, and restored the same bounded output before advertising recovered work. This dirty local observation is not a clean-release browser qualification check.'
        }, null, 2)),
        contentType: 'application/json'
      });
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
      await waitForProviderListening(providerPage, artifactRequests);
      await expectPinnedArtifactOrigin(artifactRequests, SEQUENCE_MODEL, providerPage.url());
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
      expect(result.researchSubmissionHash).toBeUndefined();
      expect(result.researchResultHash).toBeUndefined();
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
      const artifactRequests = trackModelArtifactRequests(providerPage, LAUNCH_MODEL);
      await expect(providerPage.locator('#pool-provider-model')).toHaveValue(LAUNCH_MODEL.modelId);
      const firstRunPage = await openPoolPage(context, baseURL, '/ask', roomId, 'requester-one');
      const secondRunPage = await openPoolPage(context, baseURL, '/ask', roomId, 'requester-two');
      await waitForProviderListening(providerPage, artifactRequests);
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
        expect(result.researchSubmissionHash).toBeUndefined();
        expect(result.researchResultHash).toBeUndefined();
      }
      expect(first.assignment.providerId).toBe(second.assignment.providerId);
      expect(first.receiptHash).not.toBe(second.receiptHash);
      await testInfo.attach('poolday-actual-queue-continuity-observation.json', {
        body: Buffer.from(JSON.stringify({
          schema: 'poolday.actual_browser_queue_continuity_observation/v1',
          status: 'observed',
          qualificationEligible: false,
          release: browserQualificationReleaseIdentity(),
          roomId,
          modelId: LAUNCH_MODEL.modelId,
          modelHash: LAUNCH_MODEL.modelHash,
          manifestHash: LAUNCH_MODEL.manifestHash,
          providerId: first.assignment.providerId,
          assignmentIds: [first.assignment.assignmentId, second.assignment.assignmentId],
          receiptHashes: [first.receiptHash, second.receiptHash],
          accepted: [first.agreement.accepted, second.agreement.accepted],
          claimBoundary: 'One loaded same-operator browser provider serialized two assignments and returned distinct accepted receipts. This is transport continuity evidence, not independent reproduction or browser qualification.'
        }, null, 2)),
        contentType: 'application/json'
      });
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
      const firstArtifactRequests = trackModelArtifactRequests(firstProviderPage, LAUNCH_MODEL);
      const secondArtifactRequests = trackModelArtifactRequests(secondProviderPage, LAUNCH_MODEL);
      await waitForProviderListening(firstProviderPage, firstArtifactRequests);
      await waitForProviderListening(secondProviderPage, secondArtifactRequests);

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
      expect(new Set(result.receiptHashes || []).size).toBe(2);
      expect(new Set(result.receiptPayloads.map((payload) => (
        payload?.body?.receipt?.providerId
        || payload?.body?.receipt?.provider?.providerId
        || payload?.body?.providerId
      ))).size).toBe(2);
      expect(result.requesterAcceptance?.accepted).toBe(true);
      expect(result.researchSubmissionHash).toMatch(/^sha256:/);
      expect(result.researchResultHash).toMatch(/^sha256:/);
      expect(result.embeddingPublicationConsent).toBe(true);
      await attachRelayReceipt(testInfo, 'protein-ring-2', roomId, result);
    } finally {
      await nodes.close();
    }
  });
});
