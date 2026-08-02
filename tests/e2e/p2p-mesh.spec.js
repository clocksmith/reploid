/**
 * E2E Test: P2P mesh
 * Drives the Run, Contribute, and Records routes through the browser peer room.
 */
import { test, expect } from '@playwright/test';

import { buildLaunchProviderModel } from '../../self/pool/model-contract.js';

const BASE_URL = 'http://localhost:8000';
const RELAY_MODE = process.env.REPLOID_E2E_RELAY_MODE === 'server' ? 'server' : 'local';
const RELAY_LABEL = RELAY_MODE === 'server' ? 'server relay' : 'local tab';

// The deterministic browser runtime must advertise the full frozen contract.
// A partial fixture would bypass the same exact-identity checks used in a live
// provider advert and would no longer exercise server-browser contract parity.
const model = buildLaunchProviderModel();

const TEST_PUBLIC_SEQUENCE = 'MKTAYIAKQRQISFVKSHFSRQ';
const TEST_AMINO_ACIDS = 'ACDEFGHIKLMNPQRSTVWY';
const sequenceFor = (label = '') => {
  const normalized = String(label || '').trim();
  if (!normalized) return TEST_PUBLIC_SEQUENCE;
  return [...normalized].map((character) => (
    TEST_AMINO_ACIDS[character.codePointAt(0) % TEST_AMINO_ACIDS.length]
  )).join('');
};

const roomIdFor = (testInfo, label) => (
  `p2p-${label}-${testInfo.workerIndex}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
);

const routeUrl = (baseURL, route, roomId) => {
  const url = new URL(route, baseURL || BASE_URL);
  url.searchParams.set('room', roomId);
  url.searchParams.set('relay', RELAY_MODE);
  return url.toString();
};

const ensureDetailsOpen = async (details) => {
  await expect(details).toBeVisible();
  if (!await details.evaluate((element) => element.open)) {
    await details.locator(':scope > summary').click();
  }
  await expect(details).toHaveJSProperty('open', true);
};

const installDeterministicRuntime = async (context, {
  runtimeLabel,
  generationDelayMs = 0,
  startReady = true,
  loadModelResult = null
}) => {
  await context.addInitScript(({ launchModel, label, delayMs, initialReady, loadResult, relayMode }) => {
    const textEncoder = new TextEncoder();
    const bytesToHex = (bytes) => Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const canonicalize = (value) => {
      if (value === null || typeof value !== 'object') return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map((item) => canonicalize(item)).join(',')}]`;
      const keys = Object.keys(value).sort();
      return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
    };
    const sha256Hex = async (value) => {
      const input = value instanceof Uint8Array ? value : textEncoder.encode(String(value));
      const digest = await crypto.subtle.digest('SHA-256', input);
      return `sha256:${bytesToHex(new Uint8Array(digest))}`;
    };
    const hashJson = async (value) => sha256Hex(canonicalize(value));
    const hashFloat32 = async (values) => {
      const bytes = new Uint8Array(values.length * 4);
      const view = new DataView(bytes.buffer);
      values.forEach((value, index) => view.setFloat32(index * 4, Number(value), true));
      return sha256Hex(bytes);
    };
    const runtimeModel = { ...launchModel };
    const runtimeState = {
      ready: initialReady,
      model: initialReady ? runtimeModel : null
    };
    window.REPLOID_POOL_RELAY_MODE = relayMode;
    window.REPLOID_POOL_DISCOVERY_WINDOW_MS = 30000;
    window.REPLOID_POOL_RECEIPT_WINDOW_MS = 30000;
    window.REPLOID_POOL_STRICT_ARTIFACT_PREFLIGHT = false;
    window.REPLOID_POOL_ADAPTER_DISCOVERY_TIMEOUT_MS = 100;
    window.REPLOID_DOPPLER_RUNTIME = {
      isReady: () => runtimeState.ready,
      loadModel: async () => {
        if (loadResult) {
          runtimeState.ready = loadResult.ok === true;
          runtimeState.model = loadResult.ok === true ? runtimeModel : null;
          return { ...loadResult, model: runtimeState.model || runtimeModel };
        }
        runtimeState.ready = true;
        runtimeState.model = runtimeModel;
        return { ok: true, model: runtimeModel, status: 'model_loaded' };
      },
      getLoadState: () => ({ status: runtimeState.ready ? 'ready' : 'not_loaded', model: runtimeState.model }),
      getModelInfo: () => runtimeState.model,
      getRuntimeInfo: () => ({
        runtime: runtimeModel.runtime,
        backend: runtimeModel.backend,
        publicApi: 'encodeSequence',
        profile: { implementation: 'playwright-p2p', label }
      }),
      getRuntimeProfile: async () => {
        const runtimeProfile = {
          profileVersion: 'playwright-p2p/v1',
          model: runtimeModel,
          runtime: {
            runtime: runtimeModel.runtime,
            backend: runtimeModel.backend,
            publicApi: 'encodeSequence'
          },
          device: {
            hasWebGPU: true,
            probeStatus: 'playwright'
          },
          browser: {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            label
          }
        };
        return {
          runtimeProfile,
          runtimeProfileHash: await hashJson(runtimeProfile)
        };
      },
      getDeviceInfo: async () => ({
        hasWebGPU: true,
        probeStatus: 'playwright',
        adapterInfo: { vendor: 'playwright', architecture: label },
        features: ['datachannel', 'shader-f16', 'subgroups'],
        capabilityBenchmark: {
          status: 'measured',
          samplesMs: [1, 1, 1, 1, 1],
          medianMs: 1,
          gigaOpsPerSecond: 100,
          stability: 1
        },
        limits: {
          maxBufferSize: 1_073_741_824,
          maxStorageBufferBindingSize: 536_870_912,
          maxComputeInvocationsPerWorkgroup: 256
        }
      }),
      encodeSequence: async ({ sequence, request }) => {
        window.REPLOID_E2E_ENCODE_STARTED = [
          ...(window.REPLOID_E2E_ENCODE_STARTED || []),
          { sequence, startedAt: Date.now() }
        ];
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        const tokens = Array.from(sequence, (_, index) => index % 33);
        const pooledEmbedding = Array.from(
          { length: Number(runtimeModel.embeddingDimensions) },
          (_, index) => ((index % 17) - 8) / 16
        );
        const pooledEmbeddingHash = await hashFloat32(pooledEmbedding);
        const sequenceResult = {
          schema: 'reploid.pool.sequence_result/v1',
          workload: request.workload,
          alphabet: request.alphabet,
          sequenceHash: request.sequenceHash,
          sequenceLength: request.sequenceLength,
          tokenCount: tokens.length,
          tokensHash: await hashJson(tokens),
          includedTokenCount: tokens.length,
          embeddingDim: pooledEmbedding.length,
          vocabSize: 33,
          pooledEmbeddingHash,
          tokenEmbeddingsHash: null,
          maskedLogitsHash: null,
          coordinateSystem: request.coordinateSystem,
          sequenceIndices: request.sequenceIndices,
          tokenIndices: request.tokenIndices,
          topK: request.topK
        };
        const sequenceResultHash = await hashJson(sequenceResult);
        return {
          outputKind: request.workload,
          outputText: `e2e:${sequence}`,
          tokenIds: [],
          vectorHash: pooledEmbeddingHash,
          sequenceResultHash,
          sequenceResult,
          sequenceOutput: {
            pooledEmbedding,
            tokenEmbeddings: null,
            maskedLogits: []
          },
          embeddingDimensions: pooledEmbedding.length,
          embeddingStats: { dimensions: pooledEmbedding.length, nonFiniteCount: 0, l2Norm: 0.935414 },
          transcript: {
            outputKind: request.workload,
            sequenceResultHash,
            sequenceResult
          },
          tokenCounts: {
            input: sequence.length,
            output: 0
          },
          timing: {
            startedAt: '2026-06-27T00:00:00.000Z',
            completedAt: '2026-06-27T00:00:01.000Z'
          },
          status: 'completed'
        };
      }
    };
  }, {
    launchModel: model,
    label: runtimeLabel,
    delayMs: generationDelayMs,
    initialReady: startReady,
    loadResult: loadModelResult,
    relayMode: RELAY_MODE
  });
};

const createPoolContext = async (browser, runtimeLabel, options = {}) => {
  const context = await browser.newContext();
  await installDeterministicRuntime(context, { runtimeLabel, ...options });
  return context;
};

const openPoolPage = async (context, baseURL, route, roomId) => {
  const page = await context.newPage();
  await page.goto(routeUrl(baseURL, route, roomId), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.pool-home');
  await expect(page.locator('[data-pool-room-id]')).toHaveText(roomId);
  await expect(page.locator('[data-pool-relay-mode]')).toHaveText(RELAY_LABEL);
  await expect.poll(() => page.evaluate(() => window.REPLOID_POOL_RELAY_MODE || new URL(window.location.href).searchParams.get('relay'))).toBe(RELAY_MODE);
  return page;
};

const openPoolNav = async (page) => {
  const nav = page.locator('.pool-nav-rail');
  const isOpen = await nav.evaluate((node) => node.classList.contains('is-open'));
  if (!isOpen) {
    await nav.locator('.pool-nav-toggle').click();
  }
};

const startProviderPage = async (page) => {
  const toggle = page.locator('#pool-provider-worker-toggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('data-contribution-action', 'start');
  await toggle.click();
  await expect.poll(async () => {
    const status = (await page.locator('[data-pool-provider-status]').textContent())?.trim();
    if (status === 'Idle') {
      throw new Error(`Contributor start failed: ${await page.locator('#pool-provider-result-raw').textContent()}`);
    }
    return status;
  }).toBe('Available');
  await expect(page.locator('[data-pool-provider-status]')).toHaveAttribute('data-provider-state', 'online');
  await expect(toggle).toHaveText('Stop');
  await expect(toggle).toHaveAttribute('data-contribution-action', 'stop');
  await expect(page.locator('#pool-provider-result')).toContainText('This contributor tab is available');
  await expect(page.locator('#pool-provider-result-raw')).toContainText('peer_room_listening');
};

const stopProviderPage = async (page) => {
  const toggle = page.locator('#pool-provider-worker-toggle');
  await expect(toggle).toHaveAttribute('data-contribution-action', 'stop');
  await toggle.click();
  await expect(page.locator('[data-pool-provider-status]')).toHaveText('Idle');
  await expect(page.locator('#pool-provider-result-raw')).toContainText('peer_provider_stopped');
  await expect(toggle).toBeEnabled();
  await expect(toggle).toHaveText('Start contributing');
  await expect(toggle).toHaveAttribute('data-contribution-action', 'start');
};

const confirmPublicResearchPublication = async (page, {
  sequenceSelector,
  researchSelector
}) => {
  const publicSequence = page.locator(sequenceSelector);
  if (!(await publicSequence.isChecked())) await publicSequence.check();
  const publicResearch = page.locator(researchSelector);
  if (!(await publicResearch.isChecked())) await publicResearch.check();
};

const runPeerPrompt = async (page, prompt, policyId = 'ring_quorum_receipt') => {
  const sequence = sequenceFor(prompt);
  await expect(page.locator('#pool-run-submit')).toBeVisible();
  await page.locator('details.pool-advanced summary').first().click();
  await expect(page.locator('#pool-run-policy')).toBeVisible();
  await page.locator('#pool-run-policy').selectOption(policyId);
  await confirmPublicResearchPublication(page, {
    sequenceSelector: '#pool-run-sequence-public',
    researchSelector: '#pool-run-research-public'
  });
  await page.locator('#pool-run-prompt').fill(sequence);
  await page.locator('#pool-run-submit').click();
  await expect(page.locator('#pool-run-result-stream')).toContainText(`e2e:${sequence}`, { timeout: 60000 });
  return expect.poll(async () => {
    const text = await page.locator('#pool-run-result-raw').textContent();
    try {
      return JSON.parse(text || '{}');
    } catch {
      return null;
    }
  }).not.toBeNull();
};

const readRunResult = async (page) => JSON.parse(await page.locator('#pool-run-result-raw').textContent() || '{}');
const readProviderResult = async (page) => JSON.parse(await page.locator('#pool-provider-result-raw').textContent() || '{}');
const readReceiptResult = async (page) => JSON.parse(await page.locator('#pool-receipt-result-raw').textContent() || '{}');

const closeContexts = async (contexts) => {
  await Promise.all(contexts.map((context) => context.close().catch(() => null)));
};

test.describe('Run, Contribute, Records peer room', () => {
  test('runs from Home and drives the graph with real peer activity', async ({ browser, baseURL }, testInfo) => {
    const roomId = roomIdFor(testInfo, 'home-run');
    const contexts = [];
    try {
      const context = await createPoolContext(browser, 'home_run');
      contexts.push(context);
      const providerPage = await openPoolPage(context, baseURL, '/compute', roomId);
      await startProviderPage(providerPage);
      const homePage = await openPoolPage(context, baseURL, '/', roomId);
      await homePage.evaluate(() => {
        window.REPLOID_E2E_RUN_VISUAL_STATES = [];
        window.addEventListener('reploid:pool-run-visual-state', (event) => {
          window.REPLOID_E2E_RUN_VISUAL_STATES.push({
            ...event.detail,
            outputHidden: document.querySelector('[data-pool-run-output]')?.hidden
          });
        });
      });

      const prompt = 'home graph follows execution';
      const sequence = sequenceFor(prompt);
      await confirmPublicResearchPublication(homePage, {
        sequenceSelector: '#pool-home-sequence-public',
        researchSelector: '#pool-home-research-public'
      });
      await homePage.locator('#pool-home-ask-prompt').fill(sequence);
      await homePage.locator('#pool-home-run-submit').click();
      await expect(homePage.locator('#pool-home-run-result-stream')).toContainText(`e2e:${sequence}`, { timeout: 60000 });
      await expect(homePage.locator('[data-pool-run-surface="home"]')).toHaveAttribute('data-run-state', 'complete');
      await expect(homePage.locator('[data-pool-run-surface="home"]')).toHaveAttribute('data-run-phase', 'answer');
      await expect(homePage.locator('[data-pool-run-output]')).toBeVisible();
      await expect(homePage.locator('[data-pool-run-status]')).toHaveText('Protein embedding verified');

      const result = JSON.parse(await homePage.locator('#pool-home-run-result-raw').textContent() || '{}');
      const states = await homePage.evaluate(() => window.REPLOID_E2E_RUN_VISUAL_STATES || []);
      expect(result).toMatchObject({
        roomId,
        outputText: `e2e:${sequence}`,
        transport: 'webrtc_peer_room'
      });
      await expect(homePage.locator('#pool-home-run-result-embedding-outcome')).toBeVisible();
      await expect(homePage.locator('#pool-home-run-result-embedding-outcome')).toContainText(
        'Use it with embeddings made by the same ESM-2 model and contract when comparing sequences.'
      );
      await expect(homePage.locator('[data-pool-copy-embedding]')).toBeEnabled();
      expect(states).toEqual(expect.arrayContaining([
        expect.objectContaining({ state: 'submitting', phase: 'prompt' }),
        expect.objectContaining({ state: 'running', phase: 'match' }),
        expect.objectContaining({ state: 'running', phase: 'infer' }),
        expect.objectContaining({ state: 'running', phase: 'verify' }),
        expect.objectContaining({ state: 'complete', phase: 'answer' })
      ]));
      expect(states.filter((state) => state.state === 'running').every((state) => state.outputHidden === true)).toBe(true);
      expect(states.find((state) => state.state === 'complete')?.outputHidden).toBe(false);
    } finally {
      await closeContexts(contexts);
    }
  });

  test('preserves room context when Run opens before Contribute', async ({ browser, baseURL }, testInfo) => {
    const roomId = roomIdFor(testInfo, 'run-first');
    const contexts = [];
    try {
      const context = await createPoolContext(browser, 'run_before_mesh');
      contexts.push(context);
      const runPage = await openPoolPage(context, baseURL, '/ask', roomId);
      await expect(runPage.locator('[data-pool-invite-link]')).toHaveAttribute('href', new RegExp(`room=${roomId}`));

      const meshPage = await openPoolPage(context, baseURL, '/compute', roomId);
      await startProviderPage(meshPage);
      await runPeerPrompt(runPage, 'run tab existed before mesh', 'fastest_receipt');
      const result = await readRunResult(runPage);

      expect(result.roomId).toBe(roomId);
      expect(result.transport).toBe('webrtc_peer_room');
      expect(result.outputText).toBe(`e2e:${sequenceFor('run tab existed before mesh')}`);
      expect(result.relayMetrics).toMatchObject({
        published: expect.any(Number),
        received: expect.any(Number),
        duplicateSuppressed: expect.any(Number),
        publishLatencyCount: expect.any(Number),
        deliveryLagCount: expect.any(Number),
        backlogSampleCount: expect.any(Number),
        acknowledgementLatencyCount: expect.any(Number),
        reconnectSuccesses: expect.any(Number)
      });
      expect(result.relayMetrics.published).toBeGreaterThan(0);
      expect(result.relayMetrics.received).toBeGreaterThan(0);
      await testInfo.attach(`poolday-${RELAY_MODE}-relay-metrics.json`, {
        body: Buffer.from(JSON.stringify({
          schema: 'reploid.pool.relay_metrics/v1',
          roomId,
          relay: RELAY_MODE,
          transport: result.transport,
          accepted: result.agreement?.accepted === true,
          relayMetrics: result.relayMetrics
        }, null, 2)),
        contentType: 'application/json'
      });
      await expect(runPage.locator('#pool-run-result-embedding-outcome')).toBeVisible();
      await expect(runPage.locator('#pool-run-result-embedding-outcome')).toContainText(
        `${model.embeddingDimensions} dimensions`
      );
      await expect(runPage.locator('[data-pool-copy-embedding]')).toBeEnabled();

      await openPoolNav(runPage);
      await runPage.getByRole('link', { name: 'Contribute', exact: true }).click();
      await expect(runPage.locator('[data-pool-room-id]')).toHaveText(roomId);
      await openPoolNav(runPage);
      await runPage.getByRole('link', { name: 'Records', exact: true }).click();
      await expect(runPage.locator('[data-pool-room-id]')).toHaveText(roomId);
    } finally {
      await closeContexts(contexts);
    }
  });

  test('preserves the Records facet and open disclosures across refreshes', async ({ browser, baseURL }, testInfo) => {
    const roomId = roomIdFor(testInfo, 'record-view');
    const contexts = [];
    try {
      const context = await createPoolContext(browser, 'record_view_refresh');
      contexts.push(context);
      const providerPage = await openPoolPage(context, baseURL, '/compute', roomId);
      await startProviderPage(providerPage);
      const runPage = await openPoolPage(context, baseURL, '/ask', roomId);
      await runPeerPrompt(runPage, 'persist record view', 'fastest_receipt');

      await openPoolNav(runPage);
      await runPage.getByRole('link', { name: 'Records', exact: true }).click();
      await runPage.getByRole('button', { name: /^Answers \(/ }).click();

      const recordDetails = runPage.locator('details.pool-record-event').first();
      const toolsDetails = runPage.locator('details.pool-record-tools');
      const lookupDetails = runPage.locator('details.pool-record-lookup');
      await recordDetails.locator(':scope > summary').click();
      await toolsDetails.locator(':scope > summary').click();
      await lookupDetails.locator(':scope > summary').click();
      await expect(recordDetails).toHaveJSProperty('open', true);
      await expect(toolsDetails).toHaveJSProperty('open', true);
      await expect(lookupDetails).toHaveJSProperty('open', true);

      await runPage.waitForTimeout(5500);
      await expect(runPage.locator('#pool-record-ledger')).toHaveAttribute('data-record-facet', 'answer');
      await expect(runPage.locator('details.pool-record-event').first()).toHaveJSProperty('open', true);

      await runPage.reload({ waitUntil: 'domcontentloaded' });
      await runPage.waitForSelector('.pool-home');
      await expect(runPage.locator('#pool-record-ledger')).toHaveAttribute('data-record-facet', 'answer');
      await expect(runPage.locator('details.pool-record-event').first()).toHaveJSProperty('open', true);
      await expect(runPage.locator('details.pool-record-tools')).toHaveJSProperty('open', true);
      await expect(runPage.locator('details.pool-record-lookup')).toHaveJSProperty('open', true);

      await openPoolNav(runPage);
      await runPage.getByRole('link', { name: 'Run', exact: true }).click();
      await expect(runPage.locator('[data-pool-run-status]')).toHaveText('Showing last saved answer');
      await expect(runPage.locator('[data-pool-run-output]')).toBeVisible();
      await expect(runPage.locator('#pool-run-result-stream')).toContainText(`e2e:${sequenceFor('persist record view')}`);
    } finally {
      await closeContexts(contexts);
    }
  });

  test('starts and stops a provider with stable page identity', async ({ browser, baseURL }, testInfo) => {
    const roomId = roomIdFor(testInfo, 'stop');
    const contexts = [];
    try {
      const context = await createPoolContext(browser, 'provider_stop');
      contexts.push(context);
      const providerPage = await openPoolPage(context, baseURL, '/compute', roomId);
      await startProviderPage(providerPage);
      const firstStart = await readProviderResult(providerPage);
      const firstRoleId = firstStart.identity?.roleId;
      expect(firstRoleId).toMatch(/^provider_/);

      await stopProviderPage(providerPage);
      await startProviderPage(providerPage);
      const secondStart = await readProviderResult(providerPage);
      expect(secondStart.identity?.roleId).toBe(firstRoleId);

      const secondProviderPage = await openPoolPage(context, baseURL, '/compute', roomId);
      await startProviderPage(secondProviderPage);
      const otherStart = await readProviderResult(secondProviderPage);
      expect(otherStart.identity?.roleId).toMatch(/^provider_/);
      expect(otherStart.identity?.roleId).not.toBe(firstRoleId);
    } finally {
      await closeContexts(contexts);
    }
  });

  test('restores an active provider after reload with the same page identity', async ({ browser, baseURL }, testInfo) => {
    const roomId = roomIdFor(testInfo, 'provider-reload');
    const contexts = [];
    try {
      const context = await createPoolContext(browser, 'provider_reload');
      contexts.push(context);
      const providerPage = await openPoolPage(context, baseURL, '/compute', roomId);
      await startProviderPage(providerPage);
      const firstStart = await readProviderResult(providerPage);
      const firstRoleId = firstStart.identity?.roleId;
      expect(firstRoleId).toMatch(/^provider_/);

      await providerPage.reload({ waitUntil: 'domcontentloaded' });
      await providerPage.waitForSelector('.pool-home');
      await expect(providerPage.locator('[data-pool-room-id]')).toHaveText(roomId);
      await expect(providerPage.locator('[data-pool-relay-mode]')).toHaveText(RELAY_LABEL);
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveText('Available');
      await expect(providerPage.locator('#pool-provider-worker-toggle')).toHaveText('Stop');
      await expect(providerPage.locator('#pool-provider-worker-toggle')).toHaveAttribute('data-contribution-action', 'stop');
      const restored = await readProviderResult(providerPage);
      expect(restored.identity?.roleId).toBe(firstRoleId);
      expect(restored.status).toBe('peer_provider_listening');

      const requesterPage = await openPoolPage(context, baseURL, '/ask', roomId);
      await runPeerPrompt(requesterPage, 'provider survived reload', 'fastest_receipt');
      const result = await readRunResult(requesterPage);
      expect(result).toMatchObject({
        roomId,
        outputText: `e2e:${sequenceFor('provider survived reload')}`,
        transport: 'webrtc_peer_room'
      });
    } finally {
      await closeContexts(contexts);
    }
  });

  test('asks before retrying a requester run interrupted by reload', async ({ browser, baseURL }, testInfo) => {
    const roomId = roomIdFor(testInfo, 'requester-reload-during-work');
    const contexts = [];
    try {
      const context = await createPoolContext(browser, 'requester_reload_during_work', {
        generationDelayMs: 1000
      });
      contexts.push(context);
      const providerPage = await openPoolPage(context, baseURL, '/compute', roomId);
      const requesterPage = await openPoolPage(context, baseURL, '/ask', roomId);
      await startProviderPage(providerPage);

      const sequence = sequenceFor('requester reload during active work');
      await confirmPublicResearchPublication(requesterPage, {
        sequenceSelector: '#pool-run-sequence-public',
        researchSelector: '#pool-run-research-public'
      });
      await requesterPage.locator('#pool-run-prompt').fill(sequence);
      await requesterPage.locator('#pool-run-submit').click();
      await expect.poll(() => providerPage.evaluate(() => (
        window.REPLOID_E2E_ENCODE_STARTED?.length || 0
      ))).toBe(1);

      await requesterPage.reload({ waitUntil: 'domcontentloaded' });
      await requesterPage.waitForSelector('.pool-home');
      await expect(requesterPage.locator('[data-pool-run-status]')).toHaveText('Previous request needs a decision');
      await expect(requesterPage.locator('#pool-run-result-raw')).toContainText('Code: peer_request_interrupted');
      await expect(requesterPage.locator('#pool-run-result-recovery')).toContainText('has not been resumed or sent again');
      await expect(requesterPage.locator('#pool-run-prompt')).toHaveValue(sequence);

      await requesterPage.locator('[data-pool-run-recovery-action="discard_interrupted_request"]').click();
      await expect(requesterPage.locator('[data-pool-run-status]')).toHaveText('Ready for a new request');
      await expect(requesterPage.locator('[data-pool-run-output]')).toBeHidden();
    } finally {
      await closeContexts(contexts);
    }
  });

  test('classifies a contributor reload during inference as recoverable unavailability', async ({ browser, baseURL }, testInfo) => {
    const roomId = roomIdFor(testInfo, 'provider-reload-during-work');
    const contexts = [];
    try {
      const context = await createPoolContext(browser, 'provider_reload_during_work', {
        generationDelayMs: 1000
      });
      contexts.push(context);
      const providerPage = await openPoolPage(context, baseURL, '/compute', roomId);
      const requesterPage = await openPoolPage(context, baseURL, '/ask', roomId);
      await startProviderPage(providerPage);
      await requesterPage.evaluate(() => {
        window.REPLOID_POOL_RECEIPT_WINDOW_MS = 100;
      });

      const sequence = sequenceFor('provider reload during active work');
      await confirmPublicResearchPublication(requesterPage, {
        sequenceSelector: '#pool-run-sequence-public',
        researchSelector: '#pool-run-research-public'
      });
      await requesterPage.locator('#pool-run-prompt').fill(sequence);
      await requesterPage.locator('#pool-run-submit').click();
      await expect.poll(() => providerPage.evaluate(() => (
        window.REPLOID_E2E_ENCODE_STARTED?.length || 0
      ))).toBe(1);

      await providerPage.reload({ waitUntil: 'domcontentloaded' });
      await providerPage.waitForSelector('.pool-home');
      await expect(requesterPage.locator('[data-pool-run-status]')).toHaveText(
        'No matching provider is currently available'
      );
      const failureRaw = await requesterPage.locator('#pool-run-result-raw').textContent();
      expect(failureRaw).toContain('Code: peer_provider_unresponsive');
      expect(failureRaw).toContain('Contributor failures:');
      expect(failureRaw).toContain('(peer_receipt_timeout)');
    } finally {
      await closeContexts(contexts);
    }
  });

  test('fails provider start closed when runtime model load fails', async ({ browser, baseURL }, testInfo) => {
    const roomId = roomIdFor(testInfo, 'load-fail');
    const contexts = [];
    try {
      const context = await createPoolContext(browser, 'provider_load_failure', {
        startReady: false,
        loadModelResult: {
          ok: false,
          reason: 'synthetic load failure',
          status: 'load_failed'
        }
      });
      contexts.push(context);
      const providerPage = await openPoolPage(context, baseURL, '/compute', roomId);

      const toggle = providerPage.locator('#pool-provider-worker-toggle');
      await toggle.click();
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveText('Idle');
      await expect(providerPage.locator('#pool-provider-result')).toContainText(
        'Doppler model load failed: synthetic load failure'
      );
      await expect(providerPage.locator('#pool-provider-result-raw')).toContainText('synthetic load failure');
      await expect(toggle).toBeEnabled();
      await expect(toggle).toHaveText('Start contributing');
      await expect(toggle).toHaveAttribute('data-contribution-action', 'start');
    } finally {
      await closeContexts(contexts);
    }
  });

  test('recovers contributor startup after a server-relay publish outage', async ({ browser, baseURL }, testInfo) => {
    test.skip(RELAY_MODE !== 'server', 'Requires the SDK-backed server relay.');
    const roomId = roomIdFor(testInfo, 'relay-recovery');
    const contexts = [];
    try {
      const context = await createPoolContext(browser, 'relay_recovery');
      contexts.push(context);
      const providerPage = await openPoolPage(context, baseURL, '/compute', roomId);
      await providerPage.route('**/pool/peer/rooms/**/messages', async (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'relay unavailable', retryable: true })
        });
      });

      await providerPage.locator('#pool-provider-worker-toggle').click();
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveText('Idle');
      await expect(providerPage.locator('#pool-provider-result-raw')).toContainText('relay unavailable');
      await expect(providerPage.locator('#pool-provider-worker-toggle')).toHaveAttribute('data-contribution-action', 'start');

      await providerPage.unroute('**/pool/peer/rooms/**/messages');
      await startProviderPage(providerPage);
    } finally {
      await closeContexts(contexts);
    }
  });

  test('reports and recovers a live server-relay polling outage', async ({ browser, baseURL }, testInfo) => {
    test.skip(RELAY_MODE !== 'server', 'Requires the SDK-backed server relay.');
    const roomId = roomIdFor(testInfo, 'relay-poll-recovery');
    const contexts = [];
    try {
      const context = await createPoolContext(browser, 'relay_poll_recovery');
      contexts.push(context);
      const providerPage = await openPoolPage(context, baseURL, '/compute', roomId);
      await startProviderPage(providerPage);

      await providerPage.route('**/pool/peer/rooms/**/messages**', async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'relay unavailable', retryable: true })
        });
      });
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveText('Relay unavailable', {
        timeout: 15000
      });
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveAttribute('data-provider-state', 'degraded');

      await providerPage.unrouteAll({ behavior: 'ignoreErrors' });
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveText('Available', {
        timeout: 15000
      });
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveAttribute('data-provider-state', 'online');
    } finally {
      await closeContexts(contexts);
    }
  });

  test('honors a server relay rate limit and returns contributor status to Available', async ({ browser, baseURL }, testInfo) => {
    test.skip(RELAY_MODE !== 'server', 'Requires the SDK-backed server relay.');
    const roomId = roomIdFor(testInfo, 'relay-rate-limit-recovery');
    const contexts = [];
    try {
      const context = await createPoolContext(browser, 'relay_rate_limit_recovery');
      contexts.push(context);
      const providerPage = await openPoolPage(context, baseURL, '/compute', roomId);
      await startProviderPage(providerPage);

      await providerPage.route('**/pool/peer/rooms/**/messages**', async (route) => {
        if (route.request().method() !== 'GET') return route.continue();
        await route.fulfill({
          status: 429,
          headers: { 'Retry-After': '1' },
          contentType: 'application/json',
          body: JSON.stringify({ error: 'pool rate limit exceeded', retryable: true, retryAfter: 1 })
        });
      });
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveText('Relay unavailable', {
        timeout: 15000
      });
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveAttribute('data-provider-state', 'degraded');

      await providerPage.unrouteAll({ behavior: 'ignoreErrors' });
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveText('Available', {
        timeout: 15000
      });
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveAttribute('data-provider-state', 'online');
    } finally {
      await closeContexts(contexts);
    }
  });

  test('reports and recovers from a contributor network transition', async ({ browser, baseURL }, testInfo) => {
    test.skip(RELAY_MODE !== 'server', 'Requires the SDK-backed server relay.');
    const roomId = roomIdFor(testInfo, 'network-transition-recovery');
    const contexts = [];
    try {
      const context = await createPoolContext(browser, 'network_transition_recovery');
      contexts.push(context);
      const providerPage = await openPoolPage(context, baseURL, '/compute', roomId);
      await startProviderPage(providerPage);

      await context.setOffline(true);
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveText('Relay unavailable', {
        timeout: 15000
      });
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveAttribute('data-provider-state', 'degraded');

      await context.setOffline(false);
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveText('Available', {
        timeout: 15000
      });
      await expect(providerPage.locator('[data-pool-provider-status]')).toHaveAttribute('data-provider-state', 'online');
    } finally {
      await closeContexts(contexts);
    }
  });

  test('completes a five-page ring quorum through real UI routes', async ({ browser, baseURL }, testInfo) => {
    const roomId = roomIdFor(testInfo, 'five');
    const contexts = [];
    try {
      const context = await createPoolContext(browser, 'five_page_mesh');
      contexts.push(context);
      const providerPages = [];
      for (let index = 0; index < 4; index += 1) {
        providerPages.push(await openPoolPage(context, baseURL, '/compute', roomId));
      }
      await Promise.all(providerPages.map(startProviderPage));

      const requesterPage = await openPoolPage(context, baseURL, '/ask', roomId);

      await runPeerPrompt(requesterPage, 'five page browser quorum');
      const result = await readRunResult(requesterPage);

      expect(providerPages.length + 1).toBe(5);
      expect(result.transport).toBe('webrtc_peer_room');
      expect(result.outputText).toBe(`e2e:${sequenceFor('five page browser quorum')}`);
      expect(result.assignments).toHaveLength(4);
      expect(result.receiptPayloads).toHaveLength(4);
      expect(result.agreement).toMatchObject({
        accepted: true,
        mode: 'ring_quorum',
        requiredAgreement: 3,
        acceptedProviderCount: 4
      });
      await Promise.all(providerPages.map((page) => (
        expect(page.locator('#pool-provider-result-raw')).toContainText('peer_receipt_sent')
      )));
    } finally {
      await closeContexts(contexts);
    }
  });

  test('runs a twelve-provider mesh and records the accepted ledger locally', async ({ browser, baseURL }, testInfo) => {
    test.skip(
      testInfo.project.name === 'chromium-swiftshader',
      'SwiftShader cannot reliably initialize twelve background browser tabs; Chromium owns this topology check.'
    );
    const roomId = roomIdFor(testInfo, 'twelve');
    const contexts = [];
    try {
      const context = await createPoolContext(browser, 'twelve_page_mesh');
      contexts.push(context);
      const providerPages = [];
      for (let index = 0; index < 12; index += 1) {
        providerPages.push(await openPoolPage(context, baseURL, '/compute', roomId));
      }
      await Promise.all(providerPages.map(startProviderPage));

      const runPage = await openPoolPage(context, baseURL, '/ask', roomId);

      await runPeerPrompt(runPage, 'twelve page browser quorum');
      const result = await readRunResult(runPage);

      expect(providerPages).toHaveLength(12);
      expect(result.transport).toBe('webrtc_peer_room');
      expect(result.assignments).toHaveLength(12);
      expect(result.receiptPayloads).toHaveLength(12);
      expect(result.agreement).toMatchObject({
        accepted: true,
        mode: 'ring_quorum',
        requiredAgreement: 7,
        acceptedProviderCount: 12
      });
      expect(new Set(result.assignments.map((assignment) => assignment.providerId)).size).toBe(12);

      await Promise.all(providerPages.map((page) => page.close()));
      const receiptsPage = await openPoolPage(context, baseURL, '/history', roomId);
      const reputationPage = await openPoolPage(context, baseURL, '/network', roomId);

      await ensureDetailsOpen(reputationPage.locator('details.pool-record-tools'));
      await expect(reputationPage.locator('#pool-peer-ledger table[aria-label="Local contributor scores"]')).toBeVisible();
      await expect(reputationPage.locator('#pool-peer-ledger')).toContainText('Matched');

      await openPoolNav(runPage);
      await runPage.getByRole('link', { name: 'Records', exact: true }).click();
      await expect(runPage.locator('[data-pool-room-id]')).toHaveText(roomId);
      await runPage.keyboard.press('Escape');
      await ensureDetailsOpen(runPage.locator('details.pool-record-tools'));
      await expect(runPage.locator('#pool-receipt-ledger')).toContainText('accepted');
      await ensureDetailsOpen(receiptsPage.locator('details.pool-record-tools'));
      await expect(receiptsPage.locator('#pool-receipt-ledger')).toContainText('accepted');
      await ensureDetailsOpen(runPage.locator('details.pool-record-lookup'));
      await runPage.locator('#pool-receipt-hash').fill(result.receiptHash);
      await runPage.locator('#pool-receipt-lookup').click();
      await expect(runPage.locator('#pool-receipt-result-raw')).toContainText(result.receiptHash);
      await expect.poll(async () => (await readReceiptResult(runPage)).localVerification !== undefined).toBe(true);
      const lookup = await readReceiptResult(runPage);
      expect(lookup.localVerification, JSON.stringify(lookup.localVerification, null, 2)).toMatchObject({ ok: true });
    } finally {
      await closeContexts(contexts);
    }
  });

  test('queues simultaneous requester pages through one provider', async ({ browser, baseURL }, testInfo) => {
    const roomId = roomIdFor(testInfo, 'queue');
    const contexts = [];
    try {
      const context = await createPoolContext(browser, 'single_provider_queue', { generationDelayMs: 150 });
      contexts.push(context);
      const providerPage = await openPoolPage(context, baseURL, '/compute', roomId);
      await startProviderPage(providerPage);

      const firstRunPage = await openPoolPage(context, baseURL, '/ask', roomId);
      const secondRunPage = await openPoolPage(context, baseURL, '/ask', roomId);

      await Promise.all([
        runPeerPrompt(firstRunPage, 'queued browser request one', 'fastest_receipt'),
        runPeerPrompt(secondRunPage, 'queued browser request two', 'fastest_receipt')
      ]);
      const first = await readRunResult(firstRunPage);
      const second = await readRunResult(secondRunPage);

      expect(first.transport).toBe('webrtc_peer_room');
      expect(second.transport).toBe('webrtc_peer_room');
      expect(first.outputText).toBe(`e2e:${sequenceFor('queued browser request one')}`);
      expect(second.outputText).toBe(`e2e:${sequenceFor('queued browser request two')}`);
      expect(first.receiptPayloads).toHaveLength(1);
      expect(second.receiptPayloads).toHaveLength(1);
      expect(first.assignment.providerId).toBe(second.assignment.providerId);
      expect(first.agreement.accepted).toBe(true);
      expect(second.agreement.accepted).toBe(true);
    } finally {
      await closeContexts(contexts);
    }
  });

  test('keeps two active rooms isolated', async ({ browser, baseURL }, testInfo) => {
    const roomOne = roomIdFor(testInfo, 'room-one');
    const roomTwo = roomIdFor(testInfo, 'room-two');
    const contexts = [];
    try {
      const context = await createPoolContext(browser, 'two_room_isolation');
      contexts.push(context);
      const providerOne = await openPoolPage(context, baseURL, '/compute', roomOne);
      const providerTwo = await openPoolPage(context, baseURL, '/compute', roomTwo);
      await Promise.all([startProviderPage(providerOne), startProviderPage(providerTwo)]);
      const providerStartOne = await readProviderResult(providerOne);
      const providerStartTwo = await readProviderResult(providerTwo);

      const runOne = await openPoolPage(context, baseURL, '/ask', roomOne);
      const runTwo = await openPoolPage(context, baseURL, '/ask', roomTwo);
      await Promise.all([
        runPeerPrompt(runOne, 'room one prompt', 'fastest_receipt'),
        runPeerPrompt(runTwo, 'room two prompt', 'fastest_receipt')
      ]);
      const resultOne = await readRunResult(runOne);
      const resultTwo = await readRunResult(runTwo);

      expect(resultOne.roomId).toBe(roomOne);
      expect(resultTwo.roomId).toBe(roomTwo);
      expect(resultOne.outputText).toBe(`e2e:${sequenceFor('room one prompt')}`);
      expect(resultTwo.outputText).toBe(`e2e:${sequenceFor('room two prompt')}`);
      expect(resultOne.assignment.providerId).toBe(providerStartOne.identity.roleId);
      expect(resultTwo.assignment.providerId).toBe(providerStartTwo.identity.roleId);
      expect(resultOne.assignment.providerId).not.toBe(resultTwo.assignment.providerId);
    } finally {
      await closeContexts(contexts);
    }
  });

  test('runs simultaneous distributed ring requests across provider pages', async ({ browser, baseURL }, testInfo) => {
    const roomId = roomIdFor(testInfo, 'distributed');
    const contexts = [];
    try {
      const context = await createPoolContext(browser, 'distributed_ring_queue', { generationDelayMs: 120 });
      contexts.push(context);
      const providerPages = [];
      for (let index = 0; index < 4; index += 1) {
        providerPages.push(await openPoolPage(context, baseURL, '/compute', roomId));
      }
      await Promise.all(providerPages.map(startProviderPage));

      const firstRunPage = await openPoolPage(context, baseURL, '/ask', roomId);
      const secondRunPage = await openPoolPage(context, baseURL, '/ask', roomId);

      await Promise.all([
        runPeerPrompt(firstRunPage, 'distributed browser quorum one'),
        runPeerPrompt(secondRunPage, 'distributed browser quorum two')
      ]);
      const first = await readRunResult(firstRunPage);
      const second = await readRunResult(secondRunPage);

      for (const result of [first, second]) {
        expect(result.transport).toBe('webrtc_peer_room');
        expect(result.assignments).toHaveLength(4);
        expect(result.receiptPayloads).toHaveLength(4);
        expect(result.agreement).toMatchObject({
          accepted: true,
          mode: 'ring_quorum',
          requiredAgreement: 3,
          acceptedProviderCount: 4
        });
        expect(new Set(result.assignments.map((assignment) => assignment.providerId)).size).toBe(4);
      }
      expect(first.outputText).toBe(`e2e:${sequenceFor('distributed browser quorum one')}`);
      expect(second.outputText).toBe(`e2e:${sequenceFor('distributed browser quorum two')}`);
    } finally {
      await closeContexts(contexts);
    }
  });
});
