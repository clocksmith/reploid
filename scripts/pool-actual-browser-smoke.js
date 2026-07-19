#!/usr/bin/env node
import { chromium } from '@playwright/test';

import { LAUNCH_MODEL, getEnabledPoolModelContract } from '../self/pool/model-contract.js';
import {
  SIGNATURE_DOMAINS,
  acceptanceSigningPayload,
  verifyCanonicalSignature
} from '../self/pool/inference-receipt.js';
import { verifyPeerMessage } from '../self/pool/peer-control-plane.js';

const args = process.argv.slice(2);
const positionalUrl = args.find((arg) => !arg.startsWith('--'));
const onlyArg = args.find((arg) => arg.startsWith('--only='));
const modelArg = args.find((arg) => arg.startsWith('--model='));
const channelArg = args.find((arg) => arg.startsWith('--channel='));
const selectedMode = onlyArg
  ? onlyArg.split('=').slice(1).join('=')
  : args.includes('--ring12-only')
    ? 'ring12'
    : 'all';
const selectedModelId = modelArg ? modelArg.split('=').slice(1).join('=').trim() : '';
const selectedBrowserChannel = channelArg
  ? channelArg.split('=').slice(1).join('=').trim()
  : String(process.env.REPLOID_POOL_ACTUAL_BROWSER_CHANNEL || '').trim();
const baseUrl = (positionalUrl || process.env.REPLOID_POOL_ACTUAL_SMOKE_URL || '').replace(/\/+$/, '');
const ACTUAL_SMOKE_WINDOW_MS = Number(process.env.REPLOID_POOL_ACTUAL_SMOKE_WINDOW_MS || 300000);
const ACTUAL_DISCOVERY_WINDOW_MS = Number(
  process.env.REPLOID_POOL_ACTUAL_DISCOVERY_WINDOW_MS
  || Math.min(ACTUAL_SMOKE_WINDOW_MS, 15000)
);
const ACTUAL_MAX_OUTPUT_TOKENS = Math.max(2, Number(
  process.env.REPLOID_POOL_ACTUAL_MAX_OUTPUT_TOKENS || 8
));
const dopplerModuleUrl = String(process.env.REPLOID_DOPPLER_MODULE_URL || '').trim();
const dopplerKernelBaseUrl = String(process.env.REPLOID_DOPPLER_KERNEL_BASE_URL || '').trim();
const dopplerLoadOptionsJson = String(process.env.REPLOID_DOPPLER_LOAD_OPTIONS_JSON || '').trim();

if (!baseUrl) {
  console.error('REPLOID_POOL_ACTUAL_SMOKE_URL or first argument is required');
  process.exit(1);
}

const SMOKE_MODEL = selectedModelId
  ? getEnabledPoolModelContract(selectedModelId)
  : LAUNCH_MODEL;

if (!SMOKE_MODEL) {
  console.error(`Selected Poolday model is not enabled: ${selectedModelId}`);
  process.exit(1);
}

const roomIdFor = (label) => (
  `actual-smoke-${label}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
);

const routeUrl = (route, roomId, { relay = null } = {}) => {
  const url = new URL(route, baseUrl);
  url.searchParams.set('room', roomId);
  if (relay) url.searchParams.set('relay', relay);
  return url.toString();
};

const parseJson = (text) => {
  try {
    return JSON.parse(text || '{}');
  } catch {
    const start = String(text || '').indexOf('{');
    if (start < 0) return null;
    try {
      return JSON.parse(String(text).slice(start));
    } catch {
      return null;
    }
  }
};

const parseEnvJson = (text, label) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error(`${label} must be valid JSON: ${error.message}`);
    process.exit(1);
  }
};

const dopplerLoadOptions = parseEnvJson(dopplerLoadOptionsJson, 'REPLOID_DOPPLER_LOAD_OPTIONS_JSON');

const readSnapshot = async (page, resultId) => page.evaluate((id) => {
  const raw = document.getElementById(`${id}-raw`)?.textContent || '';
  return {
    url: window.location.href,
    providerStatus: document.querySelector('[data-pool-provider-status]')?.textContent?.trim() || null,
    providerState: document.querySelector('[data-pool-provider-status]')?.dataset?.providerState || null,
    message: document.getElementById(id)?.textContent || '',
    stream: document.getElementById(`${id}-stream`)?.textContent || '',
    raw
  };
}, resultId).then((snapshot) => ({
  ...snapshot,
  parsed: parseJson(snapshot.raw)
}));

const fail = (message, details = null) => {
  const error = new Error(message);
  error.details = details;
  throw error;
};

const expectEqual = (actual, expected, label) => {
  if (actual !== expected) fail(`${label}: expected ${expected}, got ${actual}`);
};

const expectEqualWithDetails = (actual, expected, label, details = null) => {
  if (actual !== expected) fail(`${label}: expected ${expected}, got ${actual}`, details);
};

const expectTruthy = (value, label, details = null) => {
  if (!value) fail(`${label} is required`, details);
};

const waitFor = async (probe, expected, label) => {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < ACTUAL_SMOKE_WINDOW_MS) {
    last = await probe();
    if (last === expected) return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fail(`${label}: expected ${expected}, last state ${last}`);
};

const readPeerRoomSummary = async (roomId) => {
  const url = new URL(`/pool/peer/rooms/${encodeURIComponent(roomId)}/summary`, baseUrl);
  url.searchParams.set('limit', '100');
  const response = await fetch(url, {
    headers: {
      'X-Reploid-Client-Id': 'actual_smoke_probe'
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    fail(`room summary failed: ${response.status}`, payload);
  }
  return payload;
};

const waitForRoomProviderCount = async (roomId, expectedCount) => {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < ACTUAL_DISCOVERY_WINDOW_MS) {
    last = await readPeerRoomSummary(roomId);
    if (Number(last.providerCount || 0) >= expectedCount) return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fail(`room provider summary: expected at least ${expectedCount}, got ${Number(last?.providerCount || 0)}`, last);
};

const summarizeProviderAdvert = (advert = {}) => ({
  providerId: advert.body?.providerId || advert.fromPeerId || null,
  runtimeProfileHash: advert.body?.runtimeProfileHash || null,
  modelIds: (advert.body?.models || []).map((model) => model.modelId || model.id || null),
  modelHashes: (advert.body?.models || []).map((model) => model.modelHash || null),
  manifestHashes: (advert.body?.models || []).map((model) => model.manifestHash || null),
  acceptedPolicies: advert.body?.availability?.acceptedPolicies || []
});

const installActualRuntimeConfig = async (context) => {
  await context.addInitScript(({ windowMs, discoveryWindowMs, maxOutputTokens, moduleUrl, kernelBaseUrl, loadOptions }) => {
    window.REPLOID_POOL_DISCOVERY_WINDOW_MS = discoveryWindowMs;
    window.REPLOID_POOL_RECEIPT_WINDOW_MS = windowMs;
    window.REPLOID_POOL_MAX_OUTPUT_TOKENS = maxOutputTokens;
    window.REPLOID_POOL_STRICT_ARTIFACT_PREFLIGHT = false;
    if (moduleUrl) window.REPLOID_DOPPLER_MODULE_URL = moduleUrl;
    if (kernelBaseUrl) window.REPLOID_DOPPLER_KERNEL_BASE_URL = kernelBaseUrl;
    if (loadOptions) window.REPLOID_DOPPLER_LOAD_OPTIONS = loadOptions;
  }, {
    windowMs: ACTUAL_SMOKE_WINDOW_MS,
    discoveryWindowMs: ACTUAL_DISCOVERY_WINDOW_MS,
    maxOutputTokens: ACTUAL_MAX_OUTPUT_TOKENS,
    moduleUrl: dopplerModuleUrl,
    kernelBaseUrl: dopplerKernelBaseUrl,
    loadOptions: dopplerLoadOptions,
  });
};

const wireDiagnostics = (page, label) => {
  page.on('console', (message) => {
    const text = message.text();
    if (/doppler|webgpu|model|manifest|pool|peer|error|failed|probe|logits|embed|attn|ffn/i.test(text)) {
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
  page.on('response', (response) => {
    const url = response.url();
    if (response.status() >= 400 && /doppler|models|esm\.sh|webgpu|storage|tokenizer|shard|safetensors|bin/i.test(url)) {
      console.log(`[${label}:response:${response.status()}] ${response.request().method()} ${url}`);
    }
  });
};

const openPoolPage = async (context, route, roomId, label, options = {}) => {
  const page = await context.newPage();
  page.setDefaultTimeout(ACTUAL_SMOKE_WINDOW_MS);
  page.setDefaultNavigationTimeout(ACTUAL_SMOKE_WINDOW_MS);
  wireDiagnostics(page, label);
  await page.goto(routeUrl(route, roomId, options), {
    waitUntil: 'domcontentloaded',
    timeout: ACTUAL_SMOKE_WINDOW_MS
  });
  await page.waitForSelector('.pool-home', { timeout: ACTUAL_SMOKE_WINDOW_MS });
  const roomText = await page.locator('[data-pool-room-id]').textContent();
  expectEqual(roomText, roomId, `${label} room`);
  return page;
};

const waitForProviderListening = async (page) => {
  await page.waitForSelector('#pool-provider-worker-toggle', { timeout: ACTUAL_SMOKE_WINDOW_MS });
  await page.locator('#pool-provider-worker-toggle').click();
  let lastObserved = null;
  await waitFor(async () => {
    const snapshot = await readSnapshot(page, 'pool-provider-result');
    const parsed = snapshot.parsed || {};
    const observed = JSON.stringify({
      providerStatus: snapshot.providerStatus,
      providerState: snapshot.providerState,
      runner: parsed.runner || null,
      status: parsed.status || null,
      error: parsed.error || null,
      reason: parsed.reason || null
    });
    if (observed !== lastObserved) {
      console.log(`[actual-smoke] provider state ${observed}`);
      lastObserved = observed;
    }
    if (parsed.status === 'error' || parsed.error) fail('Actual provider did not start', snapshot);
    if (snapshot.providerState === 'offline' && (snapshot.raw || snapshot.message)) {
      fail('Actual provider went offline before listening', snapshot);
    }
    if (snapshot.providerState === 'online' && parsed.runner === 'peer_room_listening') {
      console.log(`[actual-smoke] provider advert ${JSON.stringify(summarizeProviderAdvert(parsed.advert))}`);
      return 'ready';
    }
    return parsed.runner || parsed.status || snapshot.providerStatus || 'waiting';
  }, 'ready', 'provider readiness');
};

const selectRunPolicy = async (page, policyId) => {
  if (!policyId) return;
  const details = page.locator('details.pool-advanced').first();
  if (await details.count()) {
    const open = await details.evaluate((element) => element.open);
    if (!open) await details.locator('summary').click();
  }
  await page.locator('#pool-run-policy').selectOption(policyId);
};

const selectRunModel = async (page, modelId) => {
  if (!modelId) return;
  const details = page.locator('details.pool-advanced').first();
  if (await details.count()) {
    const open = await details.evaluate((element) => element.open);
    if (!open) await details.locator('summary').click();
  }
  await page.locator('#pool-run-model').selectOption(modelId);
};

const selectProviderModel = async (page, modelId) => {
  if (!modelId) return;
  await page.locator('#pool-provider-model').selectOption(modelId);
};

const runActualPrompt = async (page, prompt, { policyId = null } = {}) => {
  await page.waitForSelector('#pool-run-submit', { timeout: ACTUAL_SMOKE_WINDOW_MS });
  await selectRunPolicy(page, policyId);
  await selectRunModel(page, SMOKE_MODEL.modelId);
  await page.locator('#pool-run-prompt').fill(prompt);
  await page.locator('#pool-run-submit').click();
  await waitFor(async () => {
    const snapshot = await readSnapshot(page, 'pool-run-result');
    const parsed = snapshot.parsed || {};
    if (parsed.status === 'error' || parsed.error) fail('Actual P2P inference did not complete', snapshot);
    const singleComplete = parsed.receiptHash && typeof parsed.outputText === 'string';
    const ringComplete = parsed.agreement?.accepted === true
      && Array.isArray(parsed.receiptPayloads)
      && parsed.receiptPayloads.length > 0;
    if (parsed.transport === 'webrtc_peer_room' && (singleComplete || ringComplete)) return 'complete';
    return parsed.status || parsed.transport || snapshot.stream || 'waiting';
  }, 'complete', 'request completion');
  return (await readSnapshot(page, 'pool-run-result')).parsed;
};

const validateActualResult = async (result, label, { receiptCount = 1, expectedMode = null, requiredAgreement = null } = {}) => {
  expectEqual(result.transport, 'webrtc_peer_room', `${label} transport`);
  const receiptPayloadCount = Array.isArray(result.receiptPayloads) ? result.receiptPayloads.length : 0;
  if (expectedMode === 'ring_quorum') {
    if (receiptCount === null) {
      expectTruthy(receiptPayloadCount >= Number(requiredAgreement || 1), `${label} quorum receipt payload`, result);
    } else {
      expectTruthy(receiptPayloadCount === receiptCount, `${label} receipt payload`, result);
    }
  } else {
    expectTruthy(result.outputText.trim().length > 0, `${label} non-whitespace outputText`, result);
    expectTruthy(/[a-z0-9]/i.test(result.outputText), `${label} meaningful outputText`, result);
  }
  expectTruthy(/^sha256:/.test(result.receiptHash || ''), `${label} receiptHash`, result);
  const receiptModel = result.receiptRecord?.receipt?.model
    || result.receiptPayload?.body?.receipt?.model
    || result.receiptPayloads?.[0]?.body?.receipt?.model
    || result.agreement?.acceptedRecords?.[0]?.receiptPayload?.body?.receipt?.model
    || result.assignment?.model
    || null;
  expectEqualWithDetails(
    receiptModel?.id || receiptModel?.modelId,
    SMOKE_MODEL.modelId,
    `${label} model`,
    result
  );
  if (receiptCount === null) {
    expectTruthy(receiptPayloadCount >= Number(requiredAgreement || 1), `${label} receipt payload`, result);
  } else {
    expectTruthy(receiptPayloadCount === receiptCount, `${label} receipt payload`, result);
  }
  expectTruthy(result.agreement?.accepted === true, `${label} accepted agreement`, result);
  if (expectedMode) expectEqual(result.agreement?.mode, expectedMode, `${label} agreement mode`);
  if (requiredAgreement !== null) expectEqual(Number(result.agreement?.requiredAgreement), Number(requiredAgreement), `${label} required agreement`);
  const acceptance = result.requesterAcceptance;
  expectTruthy(acceptance?.accepted === true, `${label} requester acceptance`, result);
  expectEqual(acceptance?.receiptHash, result.agreement?.receiptHash, `${label} accepted receipt hash`);
  expectEqual(acceptance?.agreementHash, result.agreement?.agreementHash, `${label} accepted agreement hash`);
  expectTruthy(acceptance?.requesterSignature, `${label} requester signature`, result);
  const ledgerEvents = Array.isArray(result.ledgerEvents) ? result.ledgerEvents : [];
  const requesterPublicKey = ledgerEvents[0]?.publicKey;
  expectTruthy(requesterPublicKey, `${label} requester public key`, result);
  expectTruthy(await verifyCanonicalSignature(
    acceptanceSigningPayload(acceptance),
    requesterPublicKey,
    acceptance.requesterSignature,
    { domain: SIGNATURE_DOMAINS.requesterAcceptance }
  ), `${label} requester signature validity`, result);
  expectTruthy(ledgerEvents.some((event) => event.type === 'points_event'), `${label} points event`, result);
  expectTruthy(ledgerEvents.some((event) => event.type === 'reputation_event'), `${label} reputation event`, result);
  expectTruthy(ledgerEvents.every((event) => event.messageHash && event.signature), `${label} signed ledger events`, result);
  const ledgerDecisions = await Promise.all(ledgerEvents.map((event) => verifyPeerMessage(event)));
  expectTruthy(ledgerDecisions.every((decision) => decision.ok), `${label} ledger signature validity`, {
    result,
    ledgerDecisions
  });
  expectTruthy(ledgerEvents.every((event) => (
    event.publicKey === requesterPublicKey && event.fromPeerId === acceptance.requesterId
  )), `${label} ledger signer identity`, result);
};

const runSingleReceipt = async (browser) => {
  const roomId = roomIdFor('single');
  const context = await browser.newContext();
  await installActualRuntimeConfig(context);
  try {
    const providerPage = await openPoolPage(context, '/compute', roomId, 'single-provider');
    await selectProviderModel(providerPage, SMOKE_MODEL.modelId);
    await expectEqual(await providerPage.locator('#pool-provider-model').inputValue(), SMOKE_MODEL.modelId, 'single provider model');
    const runPage = await openPoolPage(context, '/ask', roomId, 'single-requester');
    await waitForProviderListening(providerPage);

    const result = await runActualPrompt(runPage, 'The color of the sky is');
    await validateActualResult(result, 'single');
    console.log(`[actual-smoke] single receipt ${result.receiptHash}`);
  } finally {
    await context.close().catch(() => null);
  }
};

const runQueuedReceipts = async (browser) => {
  const roomId = roomIdFor('queue');
  const context = await browser.newContext();
  await installActualRuntimeConfig(context);
  try {
    const providerPage = await openPoolPage(context, '/compute', roomId, 'queue-provider');
    await selectProviderModel(providerPage, SMOKE_MODEL.modelId);
    await expectEqual(await providerPage.locator('#pool-provider-model').inputValue(), SMOKE_MODEL.modelId, 'queue provider model');
    const firstRunPage = await openPoolPage(context, '/ask', roomId, 'queue-requester-one');
    const secondRunPage = await openPoolPage(context, '/ask', roomId, 'queue-requester-two');
    await waitForProviderListening(providerPage);
    const [first, second] = await Promise.all([
      runActualPrompt(firstRunPage, 'Reply with exactly A.'),
      runActualPrompt(secondRunPage, 'Reply with exactly B.')
    ]);
    await validateActualResult(first, 'queue first');
    await validateActualResult(second, 'queue second');
    expectEqual(first.assignment.providerId, second.assignment.providerId, 'queued provider identity');
    expectTruthy(first.receiptHash !== second.receiptHash, 'queued receipts must be distinct', { first, second });
    console.log(`[actual-smoke] queued receipts ${first.receiptHash} ${second.receiptHash}`);
  } finally {
    await context.close().catch(() => null);
  }
};

const startSharedRuntimeProviderRing = async (page, roomId, providerCount) => page.evaluate(async ({ roomId: targetRoomId, providerCount: targetProviderCount, targetModel }) => {
  const [
    { createDopplerRuntime },
    { createProviderClient },
    { createPoolIdentity },
    { createPeerProviderNode },
    { createSdkPeerRoomRelayBus },
    { createPoolSdk },
    { listPolicies }
  ] = await Promise.all([
    import('/pool/doppler-runtime.js'),
    import('/pool/provider-client.js'),
    import('/pool/identity.js'),
    import('/pool/peer-room.js'),
    import('/pool/peer-rendezvous.js'),
    import('/pool/sdk.js'),
    import('/pool/policy-router.js')
  ]);

  if (window.__POOL_ACTUAL_SHARED_RING?.nodes?.length) {
    await Promise.allSettled(window.__POOL_ACTUAL_SHARED_RING.nodes.map((node) => node.stop?.()));
  }

  const runtime = window.REPLOID_DOPPLER_RUNTIME || createDopplerRuntime();
  window.REPLOID_DOPPLER_RUNTIME = runtime;
  if (!runtime.isReady?.()) {
    const loadResult = await runtime.loadModel(targetModel);
    if (!loadResult?.ok || !runtime.isReady?.()) {
      throw new Error(`Shared runtime model load failed: ${loadResult?.reason || 'runtime not ready'}`);
    }
  }

  const loadedModel = runtime.getModelInfo?.() || targetModel;
  const roomBusFactory = ({ roomId, localPeerId } = {}) => createSdkPeerRoomRelayBus({
    sdk: createPoolSdk({
      authTokenProvider: null,
      clientId: localPeerId || `actual_shared_${targetRoomId}`
    }),
    roomId,
    localPeerId,
    pollIntervalMs: 1000,
    relayTtlMs: 120000
  });
  const acceptedPolicies = listPolicies().map((policy) => policy.policyId);
  const nodes = [];
  const providers = [];
  const activity = [];

  for (let index = 0; index < targetProviderCount; index += 1) {
    const identity = createPoolIdentity('provider', {
      localOnly: true,
      namespace: `actual_shared_${targetRoomId}_${index}`
    });
    const providerClient = createProviderClient({
      sdk: null,
      runtime,
      identity
    });
    const node = createPeerProviderNode({
      roomId: targetRoomId,
      providerClient,
      roomBusFactory,
      maxActiveSessions: 1,
      maxQueuedSessions: targetProviderCount,
      onActivity(event) {
        activity.push({
          providerIndex: index,
          status: event?.status || null,
          sessionId: event?.sessionId || null,
          receiptHash: event?.receiptRecord?.receiptHash || null,
          reason: event?.reason || null,
          error: event?.error || null
        });
        activity.splice(0, Math.max(0, activity.length - 200));
      }
    });
    const startResult = await node.start({
      models: [loadedModel],
      availability: {
        maxConcurrentJobs: 1,
        maxTokensPerJob: 128,
        acceptedPolicies
      }
    });
    nodes.push(node);
    providers.push({
      index,
      providerId: startResult.advert?.body?.providerId || startResult.providerId || null,
      advertHash: startResult.advert?.messageHash || null
    });
  }

  window.__POOL_ACTUAL_SHARED_RING = {
    roomId: targetRoomId,
    providerCount: targetProviderCount,
    runtime,
    model: loadedModel,
    nodes,
    providers,
    activity
  };

  return {
    roomId: targetRoomId,
    providerCount: providers.length,
    model: loadedModel,
    providers
  };
}, { roomId, providerCount, targetModel: SMOKE_MODEL });

const runTwelveProviderRing = async (browser) => {
  const roomId = roomIdFor('ring12');
  const providerCount = 12;
  const context = await browser.newContext();
  await installActualRuntimeConfig(context);
  try {
    const providerHubPage = await openPoolPage(context, '/compute', roomId, 'ring12-provider-hub');
    const providerRing = await startSharedRuntimeProviderRing(providerHubPage, roomId, providerCount);
    expectEqual(providerRing.providerCount, providerCount, 'ring12 shared provider count');
    expectEqual(providerRing.model.modelId, SMOKE_MODEL.modelId, 'ring12 shared runtime model');
    console.log(`[actual-smoke] ring12 shared runtime providers ${providerRing.providers.map((provider) => provider.providerId).join(' ')}`);
    const roomSummary = await waitForRoomProviderCount(roomId, providerCount);
    console.log(`[actual-smoke] ring12 room providers ${roomSummary.providerCount}/${providerCount}, messages ${roomSummary.messageCount}`);
    const runPage = await openPoolPage(context, '/ask', roomId, 'ring12-requester');
    const result = await runActualPrompt(runPage, 'Reply with exactly YES.', {
      policyId: 'ring_quorum_receipt'
    });
    await validateActualResult(result, 'ring12', {
      receiptCount: null,
      expectedMode: 'ring_quorum',
      requiredAgreement: 7
    });
    const assignments = Array.isArray(result.assignments) ? result.assignments : result.plan?.assignments;
    const receiptHashes = Array.isArray(result.receiptHashes) ? result.receiptHashes : result.agreement?.receiptHashes;
    expectTruthy(Array.isArray(assignments) && assignments.length === providerCount, 'ring12 assignments', result);
    expectTruthy(new Set(assignments.map((assignment) => assignment.providerId)).size === providerCount, 'ring12 distinct providers', result);
    expectTruthy(Number(result.agreement?.acceptedProviderCount) >= Number(result.agreement?.requiredAgreement || 7), 'ring12 accepted provider quorum', result);
    expectEqual(Number(result.plan?.ring?.ringSize), providerCount, 'ring12 plan size');
    expectTruthy(providerRing.providers.length === providerCount, 'ring12 shared provider nodes', result);
    expectTruthy(Array.isArray(receiptHashes) && receiptHashes.length >= Number(result.agreement?.requiredAgreement || 7), 'ring12 receipt hashes', result);
    console.log(`[actual-smoke] ring12 receipts ${receiptHashes.join(' ')}`);
  } finally {
    await context.close().catch(() => null);
  }
};

const browserLaunchArgs = process.platform === 'darwin'
  ? [
      '--enable-unsafe-webgpu'
    ]
  : [
      '--enable-unsafe-webgpu',
      '--enable-features=Vulkan',
      '--use-angle=vulkan',
      '--disable-gpu-sandbox'
    ];

const browserLaunchOptions = {
  args: browserLaunchArgs
};
if (selectedBrowserChannel) {
  browserLaunchOptions.channel = selectedBrowserChannel;
}

const browser = await chromium.launch(browserLaunchOptions);

try {
  if (selectedMode === 'all' || selectedMode === 'single') await runSingleReceipt(browser);
  if (selectedMode === 'all' || selectedMode === 'queue') await runQueuedReceipts(browser);
  if (selectedMode === 'all' || selectedMode === 'ring12') await runTwelveProviderRing(browser);
  console.log(`[actual-smoke] passed ${baseUrl}`);
} catch (error) {
  console.error(error.message);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close().catch(() => null);
}
