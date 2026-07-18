/**
 * E2E Test: P2P mesh
 * Drives the Run, Contribute, and Records routes through the browser peer room.
 */
import { test, expect } from '@playwright/test';

import { LAUNCH_MODEL } from '../../self/pool/model-contract.js';

const BASE_URL = 'http://localhost:8000';
const RELAY_MODE = 'local';
const RELAY_LABEL = 'local tab';

const model = {
  modelId: LAUNCH_MODEL.modelId,
  modelHash: LAUNCH_MODEL.modelHash,
  manifestHash: LAUNCH_MODEL.manifestHash,
  contextLength: LAUNCH_MODEL.contextLength,
  quantization: LAUNCH_MODEL.quantization,
  artifactIdentity: LAUNCH_MODEL.artifactIdentity,
  runtime: LAUNCH_MODEL.runtime,
  backend: LAUNCH_MODEL.backend
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

const installDeterministicRuntime = async (context, {
  runtimeLabel,
  generationDelayMs = 0,
  startReady = true,
  loadModelResult = null
}) => {
  await context.addInitScript(({ launchModel, label, delayMs, initialReady, loadResult }) => {
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
    const runtimeModel = { ...launchModel };
    const runtimeState = {
      ready: initialReady,
      model: initialReady ? runtimeModel : null
    };
    window.REPLOID_POOL_RELAY_MODE = 'local';
    window.REPLOID_POOL_DISCOVERY_WINDOW_MS = 30000;
    window.REPLOID_POOL_RECEIPT_WINDOW_MS = 30000;
    window.REPLOID_POOL_STRICT_ARTIFACT_PREFLIGHT = false;
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
        publicApi: 'generate',
        profile: { implementation: 'playwright-p2p', label }
      }),
      getRuntimeProfile: async () => {
        const runtimeProfile = {
          profileVersion: 'playwright-p2p/v1',
          model: runtimeModel,
          runtime: {
            runtime: runtimeModel.runtime,
            backend: runtimeModel.backend,
            publicApi: 'generate'
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
        features: ['datachannel'],
        limits: { maxBufferSize: 1024 }
      }),
      generate: async ({ prompt }) => {
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
        return {
          outputText: `e2e:${prompt}`,
          tokenIds: [401, 402, 403, 404],
          transcript: {
            outputText: `e2e:${prompt}`,
            tokenIds: [401, 402, 403, 404]
          },
          tokenCounts: {
            input: String(prompt || '').split(/\s+/).filter(Boolean).length,
            output: 4
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
    loadResult: loadModelResult
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
  await expect(page.locator('[data-pool-provider-status]')).toHaveText('Available');
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

const runPeerPrompt = async (page, prompt, policyId = 'ring_quorum_receipt') => {
  await expect(page.locator('#pool-run-submit')).toBeVisible();
  await page.locator('details.pool-advanced summary').first().click();
  await expect(page.locator('#pool-run-policy')).toBeVisible();
  await page.locator('#pool-run-policy').selectOption(policyId);
  await page.locator('#pool-run-prompt').fill(prompt);
  await page.locator('#pool-run-submit').click();
  await expect(page.locator('#pool-run-result-stream')).toContainText(`e2e:${prompt}`, { timeout: 60000 });
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
      await homePage.locator('#pool-home-ask-prompt').fill(prompt);
      await homePage.locator('#pool-home-run-submit').click();
      await expect(homePage.locator('#pool-home-run-result-stream')).toContainText(`e2e:${prompt}`, { timeout: 60000 });
      await expect(homePage.locator('[data-pool-run-surface="home"]')).toHaveAttribute('data-run-state', 'complete');
      await expect(homePage.locator('[data-pool-run-surface="home"]')).toHaveAttribute('data-run-phase', 'answer');
      await expect(homePage.locator('[data-pool-run-output]')).toBeVisible();
      await expect(homePage.locator('[data-pool-run-status]')).toHaveText('Answer verified');

      const result = JSON.parse(await homePage.locator('#pool-home-run-result-raw').textContent() || '{}');
      const states = await homePage.evaluate(() => window.REPLOID_E2E_RUN_VISUAL_STATES || []);
      expect(result).toMatchObject({
        roomId,
        outputText: `e2e:${prompt}`,
        transport: 'webrtc_peer_room'
      });
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
      expect(result.outputText).toBe('e2e:run tab existed before mesh');

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
      await expect(providerPage.locator('#pool-provider-result')).toContainText('This tab could not start');
      await expect(providerPage.locator('#pool-provider-result-raw')).toContainText('synthetic load failure');
      await expect(toggle).toBeEnabled();
      await expect(toggle).toHaveText('Start contributing');
      await expect(toggle).toHaveAttribute('data-contribution-action', 'start');
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
      expect(result.outputText).toBe('e2e:five page browser quorum');
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
      const receiptsPage = await openPoolPage(context, baseURL, '/history', roomId);
      const reputationPage = await openPoolPage(context, baseURL, '/network', roomId);

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

      await reputationPage.reload({ waitUntil: 'domcontentloaded' });
      await reputationPage.waitForSelector('.pool-home');
      await reputationPage.locator('details.pool-record-tools > summary').click();
      await expect(reputationPage.locator('#pool-peer-ledger table[aria-label="Local contributor scores"]')).toBeVisible();
      await expect(reputationPage.locator('#pool-peer-ledger')).toContainText('Matched');

      await openPoolNav(runPage);
      await runPage.getByRole('link', { name: 'Records', exact: true }).click();
      await expect(runPage.locator('[data-pool-room-id]')).toHaveText(roomId);
      await runPage.locator('details.pool-record-tools > summary').click();
      await expect(runPage.locator('#pool-receipt-ledger')).toContainText('accepted');
      await receiptsPage.reload({ waitUntil: 'domcontentloaded' });
      await receiptsPage.waitForSelector('.pool-home');
      await receiptsPage.locator('details.pool-record-tools > summary').click();
      await expect(receiptsPage.locator('#pool-receipt-ledger')).toContainText('accepted');
      await runPage.locator('details.pool-record-lookup > summary').click();
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
      expect(first.outputText).toBe('e2e:queued browser request one');
      expect(second.outputText).toBe('e2e:queued browser request two');
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
      expect(resultOne.outputText).toBe('e2e:room one prompt');
      expect(resultTwo.outputText).toBe('e2e:room two prompt');
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
      expect(first.outputText).toBe('e2e:distributed browser quorum one');
      expect(second.outputText).toBe('e2e:distributed browser quorum two');
    } finally {
      await closeContexts(contexts);
    }
  });
});
