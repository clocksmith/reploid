/** Two physical browsers, installed package, exact retained requests, full decode.
 * Local verified bytes and Node tensor forwarding are not P2P acquisition proof. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { physicalWebGpuBrowserOptions, connectPhysicalBrowser } from './physical-webgpu-browser.js';
const raw = await readFile(process.env.REPLOID_DIAGNOSTIC_REQUESTS);
assert.equal(createHash('sha256').update(raw).digest('hex'), '794960332f164cb2506cc25b3d3adbde2492bf7aad120f300dd0149294c0d19e');
const requests = JSON.parse(raw), output = process.env.REPLOID_CAPTURE_OUT;
const policy = JSON.parse(await readFile(new URL('../../self/config/partition-policy.json', import.meta.url)));
const profile = JSON.parse(await readFile(new URL('../../self/config/work-profile.json', import.meta.url)));
const phase = process.env.REPLOID_MEMORY_PHASE ?? 'repetition';
const referenceBytes = phase === 'reference' ? await readFile(process.env.REPLOID_REFERENCE_FILE) : null;
if (referenceBytes) assert.equal(createHash('sha256').update(referenceBytes).digest('hex'),
  '9444f0d632de4b51624752a8c3d05a1e7cd7aea4b4ebaef71d96663bb650b6bd');
const reference = referenceBytes ? JSON.parse(referenceBytes) : null;
const generation = reference?.generation || { ...requests[0].model.generation, ...profile.generation, ...policy.generation,
  maxSeqLen: policy.maxSeqLen };
assert(generation.maxTokens <= policy.limits.maxTokens);
assert(generation.maxSeqLen <= policy.maxSeqLen);
assert(['reference', 'repetition', 'cancellation', 'cancel-only', 'capacity'].includes(phase));
const capacityModel = phase === 'capacity' ? JSON.parse(await readFile(new URL('../../self/config/chat-models.json', import.meta.url)))
  .find(model => model.id === process.env.REPLOID_TEST_MODEL) : null;
if (phase === 'capacity') assert(capacityModel, 'Capacity diagnostic requires a catalog model');
const cases = capacityModel ? [{ request: { ...requests[0], model: { ...capacityModel, generation } }, tokens: 494 }]
  : reference ? reference.prompts.map((messages, index) => ({
  request: { ...requests[0], messages }, expected: reference.expected[index] })) : phase === 'repetition'
  ? [{ request: requests[0], tokens: 494 }, { request: requests[1], tokens: 1588 }, { request: requests[1], tokens: 1588 }]
  : [{ request: requests[1], tokens: 1588, cancel: true }, { request: requests[1], tokens: 1588 }];
if (phase === 'cancel-only') cases.splice(1);
assert(output && process.env.REPLOID_EXECUTOR_WS);
const local = await chromium.launch(physicalWebGpuBrowserOptions(process.platform));
const remote = await connectPhysicalBrowser(chromium, process.env.REPLOID_EXECUTOR_WS);
const contexts = [], pages = [], runs = [], descriptors = [];
const reverse = process.env.REPLOID_REFERENCE_REVERSE === '1';
const evidence = { scope: reference
  ? 'Installed package, frozen generation options, exact model bytes and logits on two physical GPUs; not P2P acquisition proof'
  : 'Installed package, exact local verified model bytes, two-browser partition memory acceptance; not P2P or numerical qualification',
  partitionHosts: [{ index: reverse ? 1 : 0, host: 'mac' }, { index: reverse ? 0 : 1, host: 'linux' }],
  requestFixtureSha256: createHash('sha256').update(raw).digest('hex'), phase, runs, descriptors };
try {
  for (const [slot, browser] of [local, remote].entries()) {
    const index = reverse ? 1 - slot : slot;
    const context = await browser.newContext(); contexts.push(context);
    const page = await context.newPage(); pages.push(page);
    await page.goto(new URL('/config/chat-files.json', process.env.REPLOID_E2E_BASE_URL || 'http://localhost:8000').href);
    const prepared = await page.evaluate(async ({ model, index, modelSource }) => {
      const config = await import('/config/doppler-local-models.js');
      const base = new URL(config.DOPPLER_PARTITIONS_MODULE_URL, location.href);
      globalThis.__DOPPLER_KERNEL_BASE_PATH__ = config.DOPPLER_KERNEL_BASE_URL;
      const runtime = await import(config.DOPPLER_PARTITIONS_MODULE_URL);
      const { getDevice } = await import(new URL('./gpu/device.js', base));
      const { getBufferPool } = await import(new URL('./memory/buffer-pool.js', base));
      const { createHttpArtifactStorageContext } = await import(new URL('./storage/artifact-storage-context.js', base));
      const policy = await (await fetch('/config/partition-policy.json')).json();
      if (policy.maxGpuBufferBytes !== 1420000000) throw Error('Allocation budget changed');
      const source = modelSource;
      const bytes = await (await fetch(source + 'manifest.json')).arrayBuffer();
      const identity = 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      if (identity !== model.identity) throw Error('Model identity changed');
      const manifest = JSON.parse(new TextDecoder().decode(bytes));
      const plan = runtime.createLayerPartitionPlan({ modelId: manifest.modelId, ...manifest.architecture,
        splitLayer: model.partitionSplitLayer,
        activationDtype: manifest.inference.session.compute.defaults.activationDtype });
      const planId = runtime.hashLayerPartitionPlan(plan);
      await runtime.configureDeviceMemoryBudget({ maxBytes: policy.maxGpuBufferBytes });
      globalThis.gpuValidationErrors = [];
      getDevice().addEventListener('uncapturederror', event => gpuValidationErrors.push(event.error.message));
      globalThis.memorySnapshot = () => ({ device: runtime.inspectDeviceMemory(),
        pool: getBufferPool().getStats(), activeLabels: getBufferPool().getLabelStats(),
        gpuValidationErrors: [...gpuValidationErrors] });
      globalThis.settleMemory = async () => { await getDevice().queue.onSubmittedWorkDone(); return memorySnapshot(); };
      globalThis.rejectOversizedAllocation = async () => {
        const before = await settleMemory();
        try {
          const buffer = getDevice().createBuffer({ label: 'diagnostic_budget_guard',
            size: policy.maxGpuBufferBytes + 4, usage: GPUBufferUsage.STORAGE });
          buffer.destroy(); throw Error('Oversized allocation was not rejected');
        } catch (error) {
          if (error.code !== 'RESOURCE_EXHAUSTED') throw error;
          return { scope: 'Direct allocation-guard rejection, not an injected model-operation failure',
            code: error.code, before, after: await settleMemory() };
        }
      };
      const beforePreparation = { device: runtime.inspectDeviceMemory() };
      const factory = runtime.createManifestResidentPartitionFactory({ manifest, manifestIdentity: identity,
        runtimeConfig: { shared: { bufferPool: policy.bufferPool, debug: { profiler: { enabled: false } } }, inference: { session: {
          kvcache: { maxSeqLen: model.generation.maxSeqLen }, prefillChunkLayers: policy.prefillChunkLayers,
          prefillTokenChunkSize: policy.prefillTokenChunkSize } } },
        createStorage: () => createHttpArtifactStorageContext(source, manifest, { verifyHashes: true }) });
      globalThis.resident = await factory.openResidentPartition({ model, plan, planId, index,
        participantId: index ? 'memory-B' : 'memory-A', limits: policy.limits, signal: new AbortController().signal });
      globalThis.chunks = []; globalThis.observePrefill = false; globalThis.abortOnSubmit = null;
      const submit = getDevice().queue.submit.bind(getDevice().queue);
      getDevice().queue.submit = buffers => { const result = submit(buffers);
        if (observePrefill) chunks.push(memorySnapshot());
        if (abortOnSubmit) {
          abortOnSubmit.abort(new DOMException('diagnostic prefill cancellation', 'AbortError')); abortOnSubmit = null;
        }
        return result; };
      globalThis.encodeBytes = data => {
        const bytes = new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength);
        let text = ''; for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
        return btoa(text);
      };
      return { descriptor: resident.getDescriptor(), packageVersion: config.DOPPLER_PACKAGE_VERSION,
        beforePreparation, afterPreparation: await settleMemory(), planId };
    }, { model: { ...(capacityModel || requests[0].model), generation }, index,
      modelSource: (browser === remote ? process.env.REPLOID_PEER_MODEL_BASE_URL : null)
        || process.env.REPLOID_MODEL_BASE_URL || 'http://127.0.0.1:9230/' });
    descriptors.push({ ...prepared, platform: slot ? 'linux' : 'mac', browser: browser.version() });
    console.log(JSON.stringify({ prepared: index, bytes: prepared.afterPreparation.device.liveBytes }));
  }
  const pageA = pages[reverse ? 1 : 0], pageB = pages[reverse ? 0 : 1];
  for (const [attempt, testCase] of cases.entries()) {
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
          const expected = testCase.expected.steps[step];
          assert(expected, 'Reference generation has an unexpected extra step');
          const decode = text => { const bytes = Buffer.from(text, 'base64');
            return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); };
          const actual = decode(b.logits), baseline = decode(expected.logits);
          assert.equal(actual.length, baseline.length);
          let maxDifference = 0, maxDifferenceIndex = null;
          for (let i = 0; i < actual.length; i++) {
            assert(Number.isFinite(actual[i]), 'Nonfinite distributed score');
            const difference = Math.abs(actual[i] - baseline[i]);
            if (difference > maxDifference) { maxDifference = difference; maxDifferenceIndex = i; }
          }
          if (!row.firstDivergence && (maxDifference > 0.001 || b.tokenId !== expected.tokenId
            || b.stopReason !== expected.stopReason)) {
            row.firstDivergence = { parameters, messages: request.messages, inputTokenIds: ids,
              group0: { activation: a.activation, continuation: a.continuation },
              group1: { ...b }, frozen: expected, maxDifference, maxDifferenceIndex,
              tolerance: 0.001, priorTokenIds: row.numerical.map(item => item.tokenId) };
            // Preserve the actual boundary before token/stopping assertions can fail.
            await writeFile(output, JSON.stringify(evidence));
          }
          row.numerical.push({ step, tokenId: b.tokenId, stopReason: b.stopReason,
            maxDifference, maxDifferenceIndex, tolerance: 0.001, matches: maxDifference <= 0.001 });
          assert.equal(b.tokenId, expected.tokenId, 'Sampled token differs from the frozen reference');
          assert.equal(b.stopReason, expected.stopReason, 'Stopping differs from the frozen reference');
        }
        row.steps++; row.text += b.delta; row.stopReason = b.stopReason;
        position += ids.length; ids = [b.tokenId]; aContinuation = a.continuation; bContinuation = b.continuation;
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
      row.beforeClose = []; row.chunks = [];
      for (const page of pages) {
        row.beforeClose.push(await page.evaluate(() => memorySnapshot()));
        await page.evaluate(identity => resident.closeAttempt({ identity }), identity);
        row.after.push(await page.evaluate(() => settleMemory()));
        row.chunks.push(await page.evaluate(() => chunks));
      }
      await writeFile(output, JSON.stringify(evidence));
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
  await writeFile(output, JSON.stringify(evidence));
  for (const context of contexts) await context.close();
  await local.close(); await remote.close();
}
