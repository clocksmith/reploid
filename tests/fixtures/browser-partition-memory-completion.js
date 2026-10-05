/** Two physical browsers, installed package, exact retained requests, full decode.
 * Local verified bytes and Node tensor forwarding are not P2P acquisition proof. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
import { physicalWebGpuBrowserOptions } from './physical-webgpu-browser.js';
const raw = await readFile(process.env.REPLOID_DIAGNOSTIC_REQUESTS);
assert.equal(createHash('sha256').update(raw).digest('hex'), '794960332f164cb2506cc25b3d3adbde2492bf7aad120f300dd0149294c0d19e');
const requests = JSON.parse(raw), output = process.env.REPLOID_CAPTURE_OUT;
const policy = JSON.parse(await readFile(new URL('../../self/config/partition-policy.json', import.meta.url)));
const profile = JSON.parse(await readFile(new URL('../../self/config/work-profile.json', import.meta.url)));
const generation = { ...requests[0].model.generation, ...profile.generation, ...policy.generation,
  maxSeqLen: policy.maxSeqLen };
assert(generation.maxTokens <= policy.limits.maxTokens);
assert.equal(generation.maxSeqLen, policy.maxSeqLen);
const phase = process.env.REPLOID_MEMORY_PHASE ?? 'repetition';
assert(['repetition', 'cancellation', 'cancel-only'].includes(phase));
const cases = phase === 'repetition'
  ? [{ request: requests[0], tokens: 494 }, { request: requests[1], tokens: 1588 }, { request: requests[1], tokens: 1588 }]
  : [{ request: requests[1], tokens: 1588, cancel: true }, { request: requests[1], tokens: 1588 }];
if (phase === 'cancel-only') cases.splice(1);
assert(output && process.env.REPLOID_EXECUTOR_WS);
const local = await chromium.launch(physicalWebGpuBrowserOptions(process.platform));
const remote = await chromium.connect(process.env.REPLOID_EXECUTOR_WS);
const contexts = [], pages = [], runs = [], descriptors = [];
const evidence = { scope: 'Installed package, exact local verified model bytes, two-browser partition memory acceptance; not P2P or numerical qualification',
  requestFixtureSha256: createHash('sha256').update(raw).digest('hex'), phase, runs, descriptors };
try {
  for (const [index, browser] of [local, remote].entries()) {
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
        activationDtype: manifest.inference.session.compute.defaults.activationDtype });
      const planId = runtime.hashLayerPartitionPlan(plan);
      await runtime.configureDeviceMemoryBudget({ maxBytes: policy.maxGpuBufferBytes });
      globalThis.memorySnapshot = () => ({ device: runtime.inspectDeviceMemory(),
        pool: getBufferPool().getStats(), activeLabels: getBufferPool().getLabelStats() });
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
      const beforePreparation = memorySnapshot();
      const factory = runtime.createManifestResidentPartitionFactory({ manifest, manifestIdentity: identity,
        runtimeConfig: { shared: { debug: { profiler: { enabled: false } } }, inference: { session: {
          kvcache: { maxSeqLen: model.generation.maxSeqLen }, prefillChunkLayers: policy.prefillChunkLayers } } },
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
    }, { model: { ...requests[0].model, generation }, index, modelSource: process.env.REPLOID_MODEL_BASE_URL || 'http://127.0.0.1:9230/' });
    descriptors.push({ ...prepared, platform: index ? 'linux' : 'mac', browser: browser.version() });
    console.log(JSON.stringify({ prepared: index, bytes: prepared.afterPreparation.device.liveBytes }));
  }
  for (const [attempt, testCase] of cases.entries()) {
    const { request } = testCase;
    const identity = { modelId: request.model.id, modelIdentity: request.model.identity, planId: descriptors[0].planId,
      participantA: 'memory-A', participantB: 'memory-B', threadId: `memory-${attempt}`, attemptId: `memory-${attempt}` };
    const row = { attempt, generation, retainedGeneration: request.model.generation, before: [], after: [], text: '', steps: 0 }; runs.push(row);
    for (const page of pages) row.before.push(await page.evaluate(() => { chunks = []; return settleMemory(); }));
    try {
      const tokenized = await pages[0].evaluate(({ identity, messages }) => resident.tokenize({ identity, messages,
        signal: new AbortController().signal }), { identity, messages: request.messages });
      let ids = tokenized.tokenIds, position = 0, aContinuation = null, bContinuation = null;
      row.inputTokens = ids.length; assert.equal(ids.length, testCase.tokens);
      for (let step = 0; step < generation.maxTokens; step++) {
        const parameters = { identity, step, tokenPosition: position, inputTokenCount: ids.length,
          generation, maxTokens: generation.maxTokens };
        const a = await pages[0].evaluate(async ({ parameters, ids, continuation, cancel }) => {
          observePrefill = parameters.step === 0;
          const controller = new AbortController(); if (cancel) abortOnSubmit = controller;
          const value = await resident.executeGroup0({ ...parameters, tokenIds: ids, continuation, signal: controller.signal });
          return { activation: { ...value.activationTensor, data: encodeBytes(value.activationTensor.data) }, continuation: value.continuation };
        }, { parameters, ids, continuation: aContinuation, cancel: testCase.cancel === true });
        const b = await pages[1].evaluate(async ({ parameters, ids, activation, continuation }) => {
          observePrefill = parameters.step === 0;
          const value = await resident.executeGroup1({ ...parameters, inputTokenIds: ids,
            activation: { ...activation, tensorData: Uint8Array.from(atob(activation.data), c => c.charCodeAt(0)).buffer },
            continuation, signal: new AbortController().signal });
          return { tokenId: value.tokenId, delta: value.delta, done: value.done, stopReason: value.stopReason, continuation: value.continuation };
        }, { parameters, ids, activation: a.activation, continuation: bContinuation });
        row.steps++; row.text += b.delta; row.stopReason = b.stopReason;
        position += ids.length; ids = [b.tokenId]; aContinuation = a.continuation; bContinuation = b.continuation;
        if (step % 128 === 0 || b.done) console.log(JSON.stringify({ attempt, inputTokens: row.inputTokens, step, done: b.done }));
        if (b.done) { row.completed = true; break; }
      }
      assert(row.completed, 'Runtime must report correct completion at the configured token limit');
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
} finally {
  evidence.afterResidentClose = [];
  for (const page of pages) evidence.afterResidentClose.push(await page.evaluate(async () => {
    await globalThis.resident?.close(); return globalThis.settleMemory?.();
  }).catch(error => ({ error: error.message })));
  await writeFile(output, JSON.stringify(evidence));
  for (const context of contexts) await context.close();
  await local.close(); await remote.close();
}
