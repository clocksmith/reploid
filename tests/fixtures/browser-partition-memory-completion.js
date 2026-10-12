/** Physical browser/native executors, installed package, exact retained requests, full decode.
 * Local verified bytes and Node tensor forwarding are not P2P acquisition proof. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { loadPairedPartitionFixture, assertPartitionTraversal } from './paired-partition-binding.js';
import { runConcurrentPartitionMemory } from './concurrent-partition-memory.js';
import { selectPartitionDiagnostic } from './partition-diagnostic-selection.js';
import { observePartitionAttemptCleanup } from './partition-attempt-cleanup.js';
import { connectNativePartitionEndpoint } from './native-partition-endpoint.js';
import { preparePartitionMemory } from './prepare-partition-memory.js';
import { verifyNumericalTestDelivery } from './numerical-test-delivery.js';
import { observeResidentOpening } from './resident-opening-observer.js';
import { chromium } from 'playwright';
import referenceContract from './distributed-reference-contract.json' with { type: 'json' };
import { decodeReferenceLogits } from './independent-numerical-reference.js';
import { physicalWebGpuBrowserOptions, connectPhysicalBrowser } from './physical-webgpu-browser.js';
const raw = await readFile(process.env.REPLOID_DIAGNOSTIC_REQUESTS);
assert.equal(createHash('sha256').update(raw).digest('hex'), '794960332f164cb2506cc25b3d3adbde2492bf7aad120f300dd0149294c0d19e');
const requests = JSON.parse(raw), output = process.env.REPLOID_CAPTURE_OUT;
const retainedModelIdentity = requests[0].model.identity;
// The fixture freezes prompts and generation. Artifact and runtime identities
// come from the same ordinary application package under test.
const catalog = JSON.parse(await readFile(new URL('../../self/config/chat-models.json', import.meta.url)));
const packageIdentity = JSON.parse(await readFile(new URL('../../self/config/doppler-package.json', import.meta.url)));
for (const request of requests) {
  const selected = catalog.find(model => model.id === request.model.id);
  assert(selected, 'Retained request model must remain in the application catalog');
  request.model = { ...request.model, ...selected, generation: request.model.generation,
    packageVersion: packageIdentity.version };
}
const testDelivery = process.env.REPLOID_TEST_DELIVERY_BINDING ? await verifyNumericalTestDelivery({
  root: resolve(import.meta.dirname, '../..'), bindingPath: process.env.REPLOID_TEST_DELIVERY_BINDING,
  bindingSha256: process.env.REPLOID_TEST_DELIVERY_SHA256,
  archivePath: resolve(import.meta.dirname, '../..', packageIdentity.spec.replace(/^file:/, '')),
  runtimeDirectory: resolve(import.meta.dirname, '../../self/vendor/doppler', packageIdentity.version)
}) : null;
const policy = JSON.parse(await readFile(new URL('../../self/config/partition-policy.json', import.meta.url)));
const profile = JSON.parse(await readFile(new URL('../../self/config/work-profile.json', import.meta.url)));
const phase = process.env.REPLOID_MEMORY_PHASE ?? 'repetition';
const referenceBytes = phase === 'reference' ? await readFile(process.env.REPLOID_REFERENCE_FILE) : null;
if (referenceBytes) assert.equal(createHash('sha256').update(referenceBytes).digest('hex'),
  process.env.REPLOID_REFERENCE_SHA256 || referenceContract.sha256);
const reference = referenceBytes ? JSON.parse(referenceBytes) : null;
if (reference) {
  assert.equal(reference.numericalReference?.proposalSha256, referenceContract.independent.proposal.sha256);
  assert.equal(reference.numericalReference?.outputIndexSha256, referenceContract.independent.index.sha256);
}
const pairedBinding = await loadPairedPartitionFixture({
  modelDirectory: process.env.DOPPLER_CHAT_MODEL_DIR || resolve(import.meta.dirname, '../../../doppler/models/local', requests[0].model.id),
  archivePath: resolve(import.meta.dirname, '../..', packageIdentity.spec.replace(/^file:/, '')),
  referenceIdentity: reference?.modelIdentity || retainedModelIdentity
});
const { prompt: probePrompt, step: probeStep, promptOnly } = selectPartitionDiagnostic({
  prompt: process.env.REPLOID_DIAGNOSTIC_PROMPT, step: process.env.REPLOID_DIAGNOSTIC_STEP, reference
});
const generation = reference?.generation || { ...requests[0].model.generation, ...profile.generation, ...policy.generation,
  maxSeqLen: policy.maxSeqLen };
assert(generation.maxTokens <= policy.limits.maxTokens);
assert(generation.maxSeqLen <= policy.maxSeqLen);
assert(['reference', 'repetition', 'cancellation', 'cancel-only', 'capacity', 'concurrent'].includes(phase));
const capacityModel = phase === 'capacity' ? JSON.parse(await readFile(new URL('../../self/config/chat-models.json', import.meta.url)))
  .find(model => model.id === process.env.REPLOID_TEST_MODEL) : null;
if (phase === 'capacity') assert(capacityModel, 'Capacity diagnostic requires a catalog model');
const cases = capacityModel ? [{ request: { ...requests[0], model: { ...capacityModel, generation } }, tokens: 494 }]
  : reference ? reference.prompts.map((messages, index) => ({
  request: { ...requests[0], messages }, expected: reference.expected[index], referenceIndex: index }))
    .filter(testCase => probePrompt === null || testCase.referenceIndex === probePrompt) : phase === 'repetition'
  ? [{ request: requests[0], tokens: 494 }, { request: requests[1], tokens: 1588 }, { request: requests[1], tokens: 1588 }]
  : [{ request: requests[1], tokens: 1588, cancel: true }, { request: requests[1], tokens: 1588 }];
if (phase === 'cancel-only') cases.splice(1);
const nativeEndpoint = process.env.REPLOID_NATIVE_EXECUTOR_WS || null;
assert(output && (nativeEndpoint || process.env.REPLOID_EXECUTOR_WS));
const reverse = process.env.REPLOID_REFERENCE_REVERSE === '1';
const referenceHost = process.env.REPLOID_REFERENCE_HOST || null;
if (nativeEndpoint) assert(phase === 'reference' && !referenceHost, 'Native adapter currently qualifies only the frozen split reference');
assert(!referenceHost || (reference && ['mac', 'linux'].includes(referenceHost) && !reverse));
if (referenceHost) assert.equal(process.platform, 'darwin', 'The physical controller must be the Mac; its remote executor is Linux');
const local = await chromium.launch(physicalWebGpuBrowserOptions(process.platform));
let remote;
try {
  remote = nativeEndpoint ? await connectNativePartitionEndpoint(nativeEndpoint)
    : await connectPhysicalBrowser(chromium, process.env.REPLOID_EXECUTOR_WS);
} catch (error) { await local.close(); throw error; }
const contexts = [], pages = [], runs = [], descriptors = [];
const distributedControls = [];
let cleanupFailure = null;
const hostBrowsers = referenceHost === 'mac' ? [local, local]
  : referenceHost === 'linux' ? [remote, remote] : [local, remote];
const hostNames = referenceHost ? [referenceHost, referenceHost]
  : [hostname(), process.env.REPLOID_TEST_PEER || 'remote executor (endpoint-bound)'];
const evidence = { scope: reference
  ? referenceHost ? 'Same-device partition versus unsplit execution on shared frozen tokens; not mixed-device or application acceptance'
    : 'Installed package, frozen generation options, exact model bytes and logits on two physical GPUs; not P2P acquisition proof'
  : 'Installed package, exact local verified model bytes, two-browser partition memory acceptance; not P2P or numerical qualification',
  partitionHosts: hostNames.map((host, slot) => ({ index: reverse ? 1 - slot : slot, host })),
  tokenSequence: reference ? 'Frozen reference token IDs, with sampled tokens checked separately' : null,
  observationTarget: probePrompt === null ? null : { prompt: probePrompt, step: probeStep,
    scope: promptOnly ? 'One complete original request; no boundary capture or auxiliary unsplit execution'
      : 'Selected from the retained four-control comparison; not necessarily the first frozen-reference failure' },
  testDelivery, pairedBinding, requestFixtureSha256: createHash('sha256').update(raw).digest('hex'), phase, runs, descriptors };
try {
  for (const [slot, browser] of hostBrowsers.entries()) {
    const index = reverse ? 1 - slot : slot;
    const context = await browser.newContext(); contexts.push(context);
    const page = await context.newPage(); pages.push(page);
    if (browser.native) await browser.open();
    else await page.goto(new URL('/config/chat-files.json', process.env.REPLOID_E2E_BASE_URL || 'http://localhost:8000').href);
    const openingObserver = pairedBinding ? await observeResidentOpening(page, {
      runtimeBaseUrl: browser.native ? browser.identity.fixture.runtimeBaseUrl : await page.evaluate(async () => {
        const config = await import('/config/doppler-local-models.js');
        return new URL('./', new URL(config.DOPPLER_PARTITIONS_MODULE_URL, location.href)).href;
      }),
      factorySource: await readFile(new URL(`../../self/vendor/doppler/${packageIdentity.version}/src/client/resident-partitions.js`, import.meta.url), 'utf8'),
      identitySource: await readFile(new URL(`../../self/vendor/doppler/${packageIdentity.version}/src/config/initial-execution-identity.js`, import.meta.url), 'utf8')
    }) : null;
    let prepared;
    try {
    prepared = await page.evaluate(preparePartitionMemory, { config: browser.native ? browser.identity.fixture.config : await page.evaluate(async () => {
      const config = await import('/config/doppler-local-models.js');
      return { DOPPLER_PACKAGE_VERSION: config.DOPPLER_PACKAGE_VERSION, DOPPLER_PARTITIONS_MODULE_URL: new URL(config.DOPPLER_PARTITIONS_MODULE_URL, location.href).href,
        DOPPLER_KERNEL_BASE_URL: new URL(config.DOPPLER_KERNEL_BASE_URL, location.href).href };
    }), policy, model: { ...(capacityModel || requests[0].model), generation }, index, pairedBinding,
      modelSource: (browser === remote ? process.env.REPLOID_PEER_MODEL_BASE_URL : null)
        || process.env.REPLOID_MODEL_BASE_URL || 'http://127.0.0.1:9230/' });
    if (openingObserver) prepared.openingObservation = await openingObserver.finish();
    if (browser.native) prepared.nativeProvider = await page.evaluate(() => __nativePartitionFixture.observeProvider());
    } finally { await openingObserver?.close(); }
    descriptors.push({ ...prepared, platform: hostNames[slot],
      ...(browser.native ? { surface: 'node-webgpu', nativePid: browser.identity.pid, node: browser.identity.node, nativeHost: browser.identity.fixture }
        : { surface: 'browser-webgpu', browser: browser.version() }) });
    console.log(JSON.stringify({ prepared: index, bytes: prepared.afterPreparation.device.liveBytes }));
  }
  assert.equal(descriptors[0].planId, descriptors[1].planId, 'Both executors must use the exact same plan');
  for (const prepared of descriptors) {
    if (reference) assert.equal(prepared.legacyPlanId, reference.planId, 'Frozen partition traversal must remain unchanged');
    if (pairedBinding) assertPartitionTraversal(prepared.legacyPlan, prepared.plan);
  }
  const pageA = pages[reverse ? 1 : 0], pageB = pages[reverse ? 0 : 1];
  if (phase === 'concurrent') {
    evidence.scope = 'Two live 1,588-token resident attempts, submitted cancellation, surviving output and fresh retry; Node tensor forwarding, not signed application acceptance';
    await runConcurrentPartitionMemory({ pages, pageA, pageB, request: requests[1], generation,
      planId: descriptors[0].planId, runs,
      persist: () => writeFile(output, JSON.stringify(evidence)),
      onProgress: row => console.log(JSON.stringify(row)) });
  } else for (const [attempt, testCase] of cases.entries()) {
    const { request } = testCase;
    const identity = { modelId: request.model.id, modelIdentity: request.model.identity, planId: descriptors[0].planId,
      participantA: 'memory-A', participantB: 'memory-B', threadId: `memory-${attempt}`, attemptId: `memory-${attempt}` };
    const row = { attempt, generation, retainedGeneration: request.model.generation, before: [], after: [], text: '', steps: 0,
      ...(reference ? { numerical: [] } : {}) }; runs.push(row);
    for (const page of pages) row.before.push(await page.evaluate(() => { chunks = []; return settleMemory(); }));
    try {
      const tokenized = await pageA.evaluate(({ identity, messages }) => resident.tokenize({ identity, messages,
        signal: new AbortController().signal }), { identity, messages: request.messages });
      let ids = tokenized.tokenIds, position = 0, aContinuation = null, bContinuation = null;
      if (reference) distributedControls[attempt] = { messages: request.messages, tokenIds: ids, steps: [] };
      row.inputTokens = ids.length;
      if (!reference) assert.equal(ids.length, testCase.tokens);
      for (let step = 0; step < generation.maxTokens; step++) {
        const parameters = { identity, step, tokenPosition: position, inputTokenCount: ids.length,
          generation, maxTokens: generation.maxTokens };
        const a = await pageA.evaluate(async ({ parameters, ids, continuation, cancel }) => {
          observePrefill = parameters.step === 0;
          const controller = new AbortController(); if (cancel) abortOnSubmit = controller;
          const value = await resident.executeGroup0({ ...parameters, tokenIds: ids, continuation, signal: controller.signal });
          return { activation: { ...value.activationTensor, data: encodeBytes(value.activationTensor.data) }, continuation: value.continuation };
        }, { parameters, ids, continuation: aContinuation, cancel: testCase.cancel === true });
        const b = await pageB.evaluate(async ({ parameters, ids, activation, continuation, captureLogits }) => {
          observePrefill = parameters.step === 0;
          const value = await resident.executeGroup1({ ...parameters, inputTokenIds: ids,
            activation: { ...activation, tensorData: Uint8Array.from(atob(activation.data), c => c.charCodeAt(0)).buffer },
            continuation, signal: new AbortController().signal });
          return { tokenId: value.tokenId, delta: value.delta, done: value.done, stopReason: value.stopReason, continuation: value.continuation,
            ...(captureLogits ? { logits: encodeBytes(value.logits) } : {}) };
        }, { parameters, ids, activation: a.activation, continuation: bContinuation, captureLogits: !!reference });
        if (reference) {
          distributedControls[attempt].steps.push({ logits: b.logits, tokenId: b.tokenId });
          const expected = testCase.expected.steps[step];
          assert(expected, 'Reference generation has an unexpected extra step');
          const decode = text => { const bytes = Buffer.from(text, 'base64');
            return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); };
          const actual = decode(b.logits), baseline = decodeReferenceLogits(expected);
          assert.equal(actual.length, baseline.length);
          let maxDifference = 0, maxDifferenceIndex = null;
          for (let i = 0; i < actual.length; i++) {
            assert(Number.isFinite(actual[i]), 'Nonfinite distributed score');
            const difference = Math.abs(actual[i] - baseline[i]);
            if (difference > maxDifference) { maxDifference = difference; maxDifferenceIndex = i; }
          }
          const selectedBoundary = probeStep !== null && step === probeStep;
          if (selectedBoundary || (!row.firstDivergence && (maxDifference > 0.001 || b.tokenId !== expected.tokenId
            || b.stopReason !== expected.stopReason))) {
            const boundary = { attempt, referenceIndex: testCase.referenceIndex, parameters, messages: request.messages, prefillTokenIds: tokenized.tokenIds, inputTokenIds: ids,
              group0: { activation: a.activation, continuation: a.continuation },
              group1: { ...b }, frozen: expected, maxDifference, maxDifferenceIndex,
              tolerance: 0.001, priorTokenIds: row.numerical.map(item => item.tokenId) };
            if (selectedBoundary) row.observationBoundary = boundary;
            else row.firstDivergence = boundary;
            // Preserve the actual boundary before token/stopping assertions can fail.
            await writeFile(output, JSON.stringify(evidence));
          }
          row.numerical.push({ step, tokenId: b.tokenId, stopReason: b.stopReason,
            maxDifference, maxDifferenceIndex, tolerance: 0.001, matches: maxDifference <= 0.001,
            ...(referenceHost || pairedBinding ? { logits: b.logits, inputTokenIds: ids } : {}) });
          assert.equal(b.tokenId, expected.tokenId, 'Sampled token differs from the frozen reference');
          assert.equal(b.stopReason, expected.stopReason, 'Stopping differs from the frozen reference');
        }
        row.steps++; row.text += b.delta; row.stopReason = b.stopReason;
        position += ids.length; ids = [reference ? testCase.expected.steps[step].tokenId : b.tokenId];
        aContinuation = a.continuation; bContinuation = b.continuation;
        if (step % 128 === 0 || b.done) console.log(JSON.stringify({ attempt, inputTokens: row.inputTokens, step, done: b.done }));
        if (b.done) { row.completed = true; break; }
      }
      assert(row.completed, 'Runtime must report correct completion at the configured token limit');
      assert.equal(row.stopReason, 'eos-token', 'Answer reached the output limit instead of finishing');
      for (const page of pages) assert.deepEqual(await page.evaluate(() => gpuValidationErrors), [],
        'A complete answer cannot come from rejected WebGPU submissions');
      if (reference) {
        assert.equal(row.steps, testCase.expected.steps.length);
        assert.equal(row.text, testCase.expected.text);
      }
    } catch (error) {
      row.error = error.message;
      if (testCase.cancel && error.message.includes('diagnostic prefill cancellation')) row.cancelled = true;
      else throw error;
    }
    finally {
      Object.assign(row, await observePartitionAttemptCleanup(pages, identity));
      await writeFile(output, JSON.stringify(evidence));
      if (row.cleanupErrors.length && !row.error) {
        throw new AggregateError(row.cleanupErrors.map(error => new Error(error.message)), 'Attempt cleanup failed');
      }
    }

    if (testCase.cancel) {
      assert(row.cancelled, 'Cancellation must reject before generation completes');
      row.allocationRejections = [];
      for (const page of pages) row.allocationRejections.push(await page.evaluate(() => rejectOversizedAllocation()));
    }
  }
} catch (error) {
  evidence.failure = { message: error.message };
  throw error;
} finally {
  evidence.afterResidentClose = [];
  for (const page of pages) evidence.afterResidentClose.push(await page.evaluate(async () => {
    await globalThis.resident?.close(); return globalThis.settleMemory?.();
  }).catch(error => ({ error: error.message })));
  // A completion requested by close can retire one batch and schedule another.
  // Preserve the first snapshot, then observe cleanup without destroying the pool.
  evidence.residentSettlement = [];
  for (const page of pages) evidence.residentSettlement.push(await page.evaluate(async () => {
    const started = performance.now();
    let snapshot = await settleMemory(), barriers = 1;
    while (snapshot.pool.resources.deferredCleanup.count > 0 && performance.now() - started < 10000) {
      await new Promise(resolve => setTimeout(resolve, 0));
      snapshot = await settleMemory(); barriers++;
    }
    return { barriers, snapshot };
  }).catch(error => ({ error: error.message })));
  await writeFile(output, JSON.stringify(evidence));
  try {
    for (const settlement of evidence.residentSettlement) {
      assert(!settlement.error, 'Resident cleanup observation failed');
      const { snapshot } = settlement;
      assert.equal(snapshot.pool.resources.retainedModel.count, 0, 'Closed resident still owns weights');
      assert.equal(snapshot.pool.resources.active.count, 0, 'Closed resident still owns active buffers');
      assert.equal(snapshot.pool.resources.deferredCleanup.count, 0, 'Retired buffers did not settle');
      assert.equal(snapshot.device.categories.weights, 0, 'Closed resident weights were not destroyed');
      assert.deepEqual(snapshot.gpuValidationErrors, [], 'Cleanup produced WebGPU errors');
    }
  } catch (error) {
    cleanupFailure = error;
    evidence.cleanupFailure = { message: error.message };
  }
  const completeControl = referenceHost && runs.length === cases.length && runs.every(row => row.completed);
  const first = runs.find(row => row.observationBoundary)?.observationBoundary
    || runs.find(row => row.firstDivergence)?.firstDivergence || (completeControl && {
    attempt: 0, parameters: { step: 0 }, messages: cases[0].request.messages,
    prefillTokenIds: distributedControls[0].tokenIds, priorTokenIds: [],
    group1: distributedControls[0].steps[0], frozen: cases[0].expected.steps[0] });
  if (!nativeEndpoint && !promptOnly && first && (!referenceHost || completeControl) && (referenceHost || process.env.REPLOID_REQUIRE_NUMERICAL_TOLERANCE === '1')) {
    const probeLayer = Number(process.env.REPLOID_DIAGNOSTIC_LAYER ?? 0);
    assert(Number.isSafeInteger(probeLayer) && probeLayer >= 0, 'Invalid diagnostic layer');
    evidence.unsplitFirstDivergence = { scope: 'Same installed package, model, prompt tokens and generation; independent 6 GB diagnostics, excluded from constrained capacity proof', runs: [] };
    const unsplitBrowsers = referenceHost ? [[referenceHost === 'mac' ? 0 : 1, hostBrowsers[0]]]
      : [...[local, remote].entries()];
    for (const [slot, browser] of unsplitBrowsers) {
      const context = await browser.newContext();
      const diagnostic = { host: slot ? 'linux' : 'mac', unsplitStepParity: [] };
      const linearCaptures = [];
      const captureKind = process.env.DOPPLER_ATTENTION_CACHE_CAPTURE;
      const captureAttention = !referenceHost && ['1', 'attention', 'attention-projection'].includes(captureKind);
      evidence.unsplitFirstDivergence.runs.push(diagnostic);
      try {
        if (captureAttention) {
          const { observeAttentionCache } = await import('../../../doppler/tests/fixtures/attention-cache-observer.js');
          diagnostic.captureHelperSha256 = createHash('sha256').update(observeAttentionCache.toString()).digest('hex');
          await observeAttentionCache(context, new URL('../../node_modules/doppler-gpu', import.meta.url).pathname,
            linearCaptures, { ...(captureKind !== '1' ? { attentionLayer: probeLayer,
              ...(captureKind === 'attention-projection' ? { projectionLayer: probeLayer } : {}) }
              : probePrompt === null ? { linearOnly: true } : { linearLayer: probeLayer }),
              captureCondition: 'globalThis.numericalObservation?.capture === true' });
        }
        const page = await context.newPage();
        if (captureAttention) {
          const session = await context.newCDPSession(page);
          session.on('Debugger.paused', () => session.send('Debugger.resume'));
        }
        await page.exposeFunction('compareUnsplitStep', (attempt, step, encoded) => {
          const values = text => { const b = Buffer.from(text, 'base64');
            return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
          const actual = values(encoded), expected = values(distributedControls[attempt].steps[step].logits);
          assert.equal(actual.length, expected.length);
          let maxDifference = 0, maxDifferenceIndex = null;
          for (let index = 0; index < actual.length; index++) {
            assert(Number.isFinite(actual[index]) && Number.isFinite(expected[index]));
            const difference = Math.abs(actual[index] - expected[index]);
            if (difference > maxDifference) { maxDifference = difference; maxDifferenceIndex = index; }
          }
          diagnostic.unsplitStepParity.push({ attempt, step, maxDifference, maxDifferenceIndex,
            tolerance: 0.001, matches: maxDifference <= 0.001,
            ...(referenceHost ? { logits: encoded } : {}) });
        });
        page.on('console', message => {
          if (message.text().startsWith('numerical-diagnostic:')) console.log(message.text());
        });
        console.log(JSON.stringify({ unsplit: diagnostic.host, phase: 'loading' }));
        await page.goto(new URL('/config/chat-files.json', process.env.REPLOID_E2E_BASE_URL).href);
        const source = slot ? process.env.REPLOID_PEER_MODEL_BASE_URL : process.env.REPLOID_MODEL_BASE_URL;
        Object.assign(diagnostic, await page.evaluate(async ({ model, source, first, generation, policy, controls, captureLinear, probeLayer, referenceHost, pairedBinding }) => {
          const config = await import('/config/doppler-local-models.js');
          const base = new URL(config.DOPPLER_PARTITIONS_MODULE_URL, location.href);
          globalThis.__DOPPLER_KERNEL_BASE_PATH__ = config.DOPPLER_KERNEL_BASE_URL;
          const runtime = await import(config.DOPPLER_PARTITIONS_MODULE_URL);
          const { load } = await import(config.DOPPLER_MODULE_URL);
          const { createHttpArtifactStorageContext } = await import(new URL('./storage/artifact-storage-context.js', base));
          const manifestText = await (await fetch(source + 'manifest.json')).text();
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(manifestText))), b => b.toString(16).padStart(2, '0')).join('');
          if ('sha256:' + hash !== model.identity) throw Error('Unsplit diagnostic model identity mismatch');
          const manifest = JSON.parse(manifestText), maxGpuBufferBytes = pairedBinding ? policy.maxGpuBufferBytes : 6000000000;
          if (probeLayer >= manifest.architecture.numLayers) throw Error('Diagnostic layer exceeds model');
          await runtime.configureDeviceMemoryBudget({ maxBytes: maxGpuBufferBytes });
          let handle;
          try {
            handle = await load({ manifest, manifestText, manifestHash: hash, baseUrl: source,
              storage: createHttpArtifactStorageContext(source, manifest, { verifyHashes: true }) },
            { onProgress: progress => console.log('numerical-diagnostic:' + JSON.stringify(progress)),
              runtimeConfig: { shared: { bufferPool: policy.bufferPool }, inference: { session: {
              ...pairedBinding?.session, kvcache: { maxSeqLen: generation.maxSeqLen }, prefillChunkLayers: policy.prefillChunkLayers,
              prefillTokenChunkSize: policy.prefillTokenChunkSize } } } });
            const tokenIds = handle.advanced.tokenizePrompt(first.messages, generation);
            if (JSON.stringify(tokenIds) !== JSON.stringify(first.prefillTokenIds)) throw Error('Unsplit diagnostic tokenization differs');
            const { maxSeqLen: _contextLength, ...executionOptions } = generation;
            const encode = logits => {
              const bytes = new Uint8Array(logits.buffer, logits.byteOffset, logits.byteLength);
              let encoded = ''; for (let offset = 0; offset < bytes.length; offset += 8192) encoded += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
              return btoa(encoded);
            };
            const replayControls = async checkReplay => {
              for (const [attempt, control] of controls.entries()) {
                await handle.resetGenerationState();
                const ids = handle.advanced.tokenizePrompt(control.messages, generation);
                if (JSON.stringify(ids) !== JSON.stringify(control.tokenIds)) throw Error('Unsplit control tokenization differs');
                let value = await handle.advanced.prefillWithLogits(control.messages, { ...executionOptions, inputIds: ids });
                value.cache?.destroy();
                checkReplay?.(attempt, 0, value.logits);
                await globalThis.compareUnsplitStep(attempt, 0, encode(value.logits));
                for (let step = 1; step < control.tokenIdsByStep.length; step++) {
                  value = await handle.advanced.decodeStepLogits([control.tokenIdsByStep[step - 1]], executionOptions);
                  checkReplay?.(attempt, step, value.logits);
                  await globalThis.compareUnsplitStep(attempt, step, encode(value.logits));
                }
              }
            };
            if (referenceHost) {
              await replayControls();
              return { packageVersion: config.DOPPLER_PACKAGE_VERSION, modelIdentity: model.identity,
                generation, maxGpuBufferBytes, resolvedRuntimeSession: handle.advanced.getResolvedRuntimeSession(),
                memory: runtime.inspectDeviceMemory() };
            }
            globalThis.numericalObservation = { prompt: first.referenceIndex ?? first.attempt, step: 0,
              capture: captureLinear && first.parameters.step === 0 };
            let result = await handle.advanced.prefillWithLogits(first.messages, { ...executionOptions, inputIds: tokenIds });
            globalThis.numericalObservation.capture = false;
            result.cache?.destroy();
            for (const tokenId of first.priorTokenIds) result = await handle.advanced.decodeStepLogits([tokenId], executionOptions);
            const firstLogits = Float32Array.from(result.logits);
            const logits = encode(firstLogits);
            const { operatorDiagnostics: _initialDiagnostics, ...stats } = handle.advanced.getStats();
            let probe = null;
            let captureReplay = null;
            const checkCaptureReplay = (attempt, step, values) => {
              if (attempt !== first.attempt || step !== first.parameters.step) return;
              let maxDifference = 0;
              for (let i = 0; i < firstLogits.length; i++) {
                if (!Number.isFinite(values[i])) throw Error('Nonfinite capture replay');
                maxDifference = Math.max(maxDifference, Math.abs(firstLogits[i] - values[i]));
              }
              captureReplay = { maxDifference, byteExact: maxDifference === 0,
                scope: 'Same prefix replayed after state reset without buffer observation' };
            };
            // Replay the same prefix and observe only the first divergent step:
            // diagnostics can change fusion, so quantify their effect separately.
            // Retain unobserved logits and quantify that effect before interpreting tensors.
            try {
              console.log('numerical-diagnostic:' + JSON.stringify({ phase: 'boundary-capture', step: first.parameters.step }));
              const targetOpIds = ['embed.out', 'final_norm.pre', 'final_norm.out',
                ...['q_proj', 'k_proj', 'v_proj', 'q_norm', 'k_norm', 'q_rope', 'k_rope', 'core_out',
                  'qkv_proj', 'linear_z_proj', 'linear_a_proj', 'linear_b_proj',
                  'linear_core_out', 'out', 'post_attn'].map(op => `layer.${probeLayer}.attn.` + op),
                ...['in', 'gate', 'up', 'act', 'out'].map(op => `layer.${probeLayer}.ffn.` + op),
                ...Array.from({ length: manifest.architecture.numLayers }, (_, layer) =>
                  [`layer.${layer}.attn.post_input_norm`, `layer.${layer}.layer.out`]).flat()];
              await handle.resetGenerationState();
              const observationOptions = { ...executionOptions, diagnostics: { enabled: true,
                captureConfig: { enabled: true, defaultLevel: 'none', targetOpIds, targetLevel: 'full' } } };
              // Ordinary generation owns the diagnostics lifecycle for both
              // prefill and decode; the advanced decode method only returns logits.
              const sampledTokenIds = [];
              const specialTokens = handle.advanced.getSpecialTokens();
              globalThis.numericalObservation = { prompt: first.referenceIndex ?? first.attempt, step: 0,
                capture: captureLinear && first.parameters.step === 0 };
              probe = { sampledTokenIds, samplingExcludedTokenIds: [specialTokens.pad, ...executionOptions.suppressTokenIds]
                .filter(tokenId => Number.isInteger(tokenId)),
                observation: 'Public generation with command batching disabled; stop after the requested diagnostic step' };
              let observedLogits;
              for await (const _chunk of handle.generate(first.messages, {
                ...observationOptions, disableCommandBatching: true,
                onLogits: (values, metadata) => {
                  if (sampledTokenIds.length === first.parameters.step) observedLogits = encode(values);
                  sampledTokenIds.push(metadata.tokenId);
                  globalThis.numericalObservation.step = sampledTokenIds.length;
                  globalThis.numericalObservation.capture = captureLinear && sampledTokenIds.length === first.parameters.step;
                },
              })) {
                if (sampledTokenIds.length > first.parameters.step) break;
              }
              const { operatorDiagnostics, ...observedStats } = handle.advanced.getStats();
              probe.stats = observedStats;
              if (!observedLogits) throw Error('Generation did not observe the divergent step');
              if (JSON.stringify(sampledTokenIds.slice(0, first.priorTokenIds.length)) !== JSON.stringify(first.priorTokenIds)) {
                throw Error('Observed generation prefix differs from the distributed prefix');
              }
              const timeline = operatorDiagnostics?.timeline || [];
              // Capture records currently omit phase/position. Each embedding
              // marks a forward pass; retain the requested pass, not its prefill.
              const starts = timeline.flatMap((record, index) => record.opId === 'embed.out' ? [index] : []);
              if (starts.length <= first.parameters.step) throw Error('Generation trace is missing the divergent forward pass');
              probe.logits = observedLogits;
              probe.timeline = timeline.slice(starts[first.parameters.step], starts[first.parameters.step + 1]);
              if (!probe.timeline?.some(record => record.opId === 'layer.11.layer.out' && record.capture?.data)) {
                throw Error('Boundary capture did not retain layer 11 output');
              }
            } catch (error) {
              probe = { ...probe, failure: { name: error.name, message: error.message } };
            }
            // Compare every retained distributed step against fresh unsplit
            // state on the same installed package. Feed identical token prefixes;
            // this is numerical parity, not free-running answer-quality proof.
            await replayControls(checkCaptureReplay);
            return { packageVersion: config.DOPPLER_PACKAGE_VERSION, modelIdentity: model.identity,
              tokenIds, generation, maxGpuBufferBytes, logits, stats, probe, probeLayer, captureReplay,
              resolvedRuntimeSession: handle.advanced.getResolvedRuntimeSession(), memory: runtime.inspectDeviceMemory() };
          } finally { await handle?.unload(); }
        }, { model: requests[0].model, source, first, generation, policy, captureLinear: captureAttention, probeLayer, referenceHost, pairedBinding,
          controls: distributedControls.map(({ messages, tokenIds }, attempt) => ({ messages, tokenIds,
            tokenIdsByStep: cases[attempt].expected.steps.map(step => step.tokenId) })) }));
        if (referenceHost) {
          assert.equal(diagnostic.unsplitStepParity.length, distributedControls.reduce((count, control) => count + control.steps.length, 0));
          diagnostic.summary = { steps: diagnostic.unsplitStepParity.length,
            failed: diagnostic.unsplitStepParity.filter(step => !step.matches).length,
            maxDifference: Math.max(...diagnostic.unsplitStepParity.map(step => step.maxDifference)), tolerance: 0.001 };
          console.log(JSON.stringify({ unsplit: diagnostic.host, sameDevicePartitionParity: diagnostic.summary }));
          assert.equal(diagnostic.summary.failed, 0, 'Same-device partition versus unsplit tolerance exceeded');
          continue;
        }
        const decode = text => { const bytes = Buffer.from(text, 'base64');
          return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); };
        const actual = decode(diagnostic.logits);
        diagnostic.comparisons = {};
        const references = [['distributed', first.group1.logits], ['frozen', first.frozen.logits]];
        if (diagnostic.probe?.logits) references.push(['observed', diagnostic.probe.logits]);
        for (const [name, encoded] of references) {
          const expected = name === 'frozen' ? decodeReferenceLogits(first.frozen) : decode(encoded);
          assert.equal(actual.length, expected.length);
          let maxDifference = 0, maxDifferenceIndex = null;
          const samplingMasks = [];
          for (let index = 0; index < actual.length; index++) {
            assert(Number.isFinite(actual[index]));
            if (!Number.isFinite(expected[index])) {
              assert(name === 'observed' && expected[index] === -Infinity
                && diagnostic.probe.samplingExcludedTokenIds.includes(index), 'Unexpected nonfinite diagnostic logit');
              samplingMasks.push(index); continue;
            }
            const difference = Math.abs(actual[index] - expected[index]);
            if (difference > maxDifference) { maxDifference = difference; maxDifferenceIndex = index; }
          }
          diagnostic.comparisons[name] = { maxDifference, maxDifferenceIndex, tolerance: 0.001, matches: maxDifference <= 0.001,
            ...(samplingMasks.length ? { samplingMasks, scope: 'Unmasked logits; declared sampling exclusions checked separately' } : {}) };
        }
        if (diagnostic.probe?.timeline) {
          const boundary = diagnostic.probe.timeline.find(record => record.opId === 'layer.11.layer.out');
          const transferred = decode(first.group0.activation.data);
          assert.equal(boundary.capture.data.length, transferred.length);
          let maxDifference = 0, maxDifferenceIndex = null;
          for (let index = 0; index < transferred.length; index++) {
            const difference = Math.abs(boundary.capture.data[index] - transferred[index]);
            if (difference > maxDifference) { maxDifference = difference; maxDifferenceIndex = index; }
          }
          diagnostic.partitionBoundary = { opId: boundary.opId, shape: boundary.capture.shape,
            dtype: boundary.capture.dtype, maxDifference, maxDifferenceIndex,
            observedLogitsMaxDifference: diagnostic.comparisons.observed.maxDifference };
        }
        console.log(JSON.stringify({ unsplit: diagnostic.host, comparisons: diagnostic.comparisons }));
      } catch (error) {
        diagnostic.failure = { name: error.name, message: error.message };
        if (referenceHost) cleanupFailure ||= error;
      }
      finally {
        try { await context.close(); }
        catch (error) { diagnostic.cleanupFailure = { name: error.name, message: error.message }; }
        if (captureAttention) {
          diagnostic.linearCapture = { captures: linearCaptures };
          const inputBoundary = captureKind === '1' ? 'linear-inputs' : 'inputs';
          if (!linearCaptures.some(capture => capture.records.some(record => record.boundary === inputBoundary))) {
            diagnostic.captureFailure = 'The attention diagnostic did not retain its actual input boundary';
          }
          if (captureKind === 'attention-projection'
            && !linearCaptures.some(capture => capture.records.some(record => record.boundary === 'projection'))) {
            diagnostic.captureFailure = 'The attention diagnostic did not retain its output projection';
          }
        }
        await writeFile(output, JSON.stringify(evidence));
      }
    }
    const [localRun, remoteRun] = evidence.unsplitFirstDivergence.runs;
    if (localRun?.probe?.timeline && remoteRun?.probe?.timeline) {
      evidence.unsplitFirstDivergence.operatorComparison = localRun.probe.timeline
        .filter(record => record.capture?.data).map(record => {
          const counterpart = remoteRun.probe.timeline.find(item => item.opId === record.opId && item.capture?.data);
          assert(counterpart, `Remote capture missing ${record.opId}`);
          const actual = record.capture.data, expected = counterpart.capture.data;
          assert.equal(actual.length, expected.length);
          let maxDifference = 0, maxDifferenceIndex = null;
          for (let index = 0; index < actual.length; index++) {
            assert(Number.isFinite(actual[index]) && Number.isFinite(expected[index]));
            const difference = Math.abs(actual[index] - expected[index]);
            if (difference > maxDifference) { maxDifference = difference; maxDifferenceIndex = index; }
          }
          return { opId: record.opId, shape: record.capture.shape, dtype: record.capture.dtype,
            maxDifference, maxDifferenceIndex };
        });
      console.log(JSON.stringify({ boundaryComparisons: evidence.unsplitFirstDivergence.runs.map(run => ({
        host: run.host, ...run.partitionBoundary })),
      firstOperatorDifference: evidence.unsplitFirstDivergence.operatorComparison.find(row => row.maxDifference > 0) }));
    }
  }
  evidence.deviceObservations = await Promise.all(pages.map(page => page.evaluate(() => ({
    deviceEvents: globalThis.partitionDeviceEvents || [], snapshot: globalThis.memorySnapshot?.()
  })).catch(error => ({ error: error.message }))));
  await writeFile(output, JSON.stringify(evidence));
  for (const context of contexts) await context.close();
  await local.close();
  try {
    const closed = await remote.close();
    if (nativeEndpoint) evidence.nativeHostSettlement = { ...closed, pid: remote.identity.pid };
  } catch (error) {
    if (nativeEndpoint) evidence.nativeHostSettlement = { pid: remote.identity.pid, ownedProviderReleased: false, error: error.message };
    cleanupFailure ||= error;
  }
  await writeFile(output, JSON.stringify(evidence));
  if (cleanupFailure && !evidence.failure) throw cleanupFailure;
}
