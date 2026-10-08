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
const distributedControls = [];
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
  if (reference) assert.equal(descriptors[0].planId, reference.planId, 'Frozen partition traversal must remain unchanged');
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
            row.firstDivergence = { attempt, parameters, messages: request.messages, prefillTokenIds: tokenized.tokenIds, inputTokenIds: ids,
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
  const first = runs.find(row => row.firstDivergence)?.firstDivergence;
  if (first && process.env.REPLOID_REQUIRE_NUMERICAL_TOLERANCE === '1') {
    evidence.unsplitFirstDivergence = { scope: 'Same installed package, model, prompt tokens and generation; independent 6 GB diagnostics, excluded from constrained capacity proof', runs: [] };
    for (const [slot, browser] of [local, remote].entries()) {
      const context = await browser.newContext();
      const diagnostic = { host: slot ? 'linux' : 'mac', unsplitStepParity: [] };
      const linearCaptures = [];
      const captureLinear = process.env.DOPPLER_ATTENTION_CACHE_CAPTURE === '1';
      evidence.unsplitFirstDivergence.runs.push(diagnostic);
      try {
        if (captureLinear) {
          const { observeAttentionCache } = await import('../../../doppler/tests/fixtures/attention-cache-observer.js');
          diagnostic.captureHelperSha256 = createHash('sha256').update(observeAttentionCache.toString()).digest('hex');
          await observeAttentionCache(context, new URL('../../node_modules/doppler-gpu', import.meta.url).pathname,
            linearCaptures, { linearOnly: true, captureCondition: 'globalThis.numericalObservation?.capture === true' });
        }
        const page = await context.newPage();
        if (captureLinear) {
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
            tolerance: 0.001, matches: maxDifference <= 0.001 });
        });
        page.on('console', message => {
          if (message.text().startsWith('numerical-diagnostic:')) console.log(message.text());
        });
        console.log(JSON.stringify({ unsplit: diagnostic.host, phase: 'loading' }));
        await page.goto(new URL('/config/chat-files.json', process.env.REPLOID_E2E_BASE_URL).href);
        const source = slot ? process.env.REPLOID_PEER_MODEL_BASE_URL : process.env.REPLOID_MODEL_BASE_URL;
        Object.assign(diagnostic, await page.evaluate(async ({ model, source, first, generation, policy, controls, captureLinear }) => {
          const config = await import('/config/doppler-local-models.js');
          const base = new URL(config.DOPPLER_PARTITIONS_MODULE_URL, location.href);
          globalThis.__DOPPLER_KERNEL_BASE_PATH__ = config.DOPPLER_KERNEL_BASE_URL;
          const runtime = await import(config.DOPPLER_PARTITIONS_MODULE_URL);
          const { load } = await import(config.DOPPLER_MODULE_URL);
          const { createHttpArtifactStorageContext } = await import(new URL('./storage/artifact-storage-context.js', base));
          const manifestText = await (await fetch(source + 'manifest.json')).text();
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(manifestText))), b => b.toString(16).padStart(2, '0')).join('');
          if ('sha256:' + hash !== model.identity) throw Error('Unsplit diagnostic model identity mismatch');
          const manifest = JSON.parse(manifestText), maxGpuBufferBytes = 6000000000;
          await runtime.configureDeviceMemoryBudget({ maxBytes: maxGpuBufferBytes });
          let handle;
          try {
            handle = await load({ manifest, manifestText, manifestHash: hash, baseUrl: source,
              storage: createHttpArtifactStorageContext(source, manifest, { verifyHashes: true }) },
            { onProgress: progress => console.log('numerical-diagnostic:' + JSON.stringify(progress)),
              runtimeConfig: { shared: { bufferPool: policy.bufferPool }, inference: { session: {
              kvcache: { maxSeqLen: generation.maxSeqLen }, prefillChunkLayers: policy.prefillChunkLayers,
              prefillTokenChunkSize: policy.prefillTokenChunkSize } } } });
            const tokenIds = handle.advanced.tokenizePrompt(first.messages, generation);
            if (JSON.stringify(tokenIds) !== JSON.stringify(first.prefillTokenIds)) throw Error('Unsplit diagnostic tokenization differs');
            const { maxSeqLen: _contextLength, ...executionOptions } = generation;
            globalThis.numericalObservation = { prompt: first.attempt, step: 0, capture: captureLinear };
            let result = await handle.advanced.prefillWithLogits(first.messages, { ...executionOptions, inputIds: tokenIds });
            globalThis.numericalObservation.capture = false;
            result.cache?.destroy();
            for (const tokenId of first.priorTokenIds) result = await handle.advanced.decodeStepLogits([tokenId], executionOptions);
            const encode = logits => {
              const bytes = new Uint8Array(logits.buffer, logits.byteOffset, logits.byteLength);
              let encoded = ''; for (let offset = 0; offset < bytes.length; offset += 8192) encoded += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
              return btoa(encoded);
            };
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
                ...['qkv_proj', 'linear_z_proj', 'linear_a_proj', 'linear_b_proj',
                  'linear_core_out', 'out', 'post_attn'].map(op => 'layer.0.attn.' + op),
                ...['in', 'gate', 'up', 'act', 'out'].map(op => 'layer.0.ffn.' + op),
                ...Array.from({ length: manifest.architecture.numLayers }, (_, layer) =>
                  [`layer.${layer}.attn.post_input_norm`, `layer.${layer}.layer.out`]).flat()];
              await handle.resetGenerationState();
              const observationOptions = { ...executionOptions, diagnostics: { enabled: true,
                captureConfig: { enabled: true, defaultLevel: 'none', targetOpIds, targetLevel: 'full' } } };
              // Ordinary generation owns the diagnostics lifecycle for both
              // prefill and decode; the advanced decode method only returns logits.
              const sampledTokenIds = [];
              const specialTokens = handle.advanced.getSpecialTokens();
              probe = { sampledTokenIds, samplingExcludedTokenIds: [specialTokens.pad, ...executionOptions.suppressTokenIds]
                .filter(tokenId => Number.isInteger(tokenId)),
                observation: 'Public generation with command batching disabled for tensor readback' };
              let observedLogits;
              for await (const _chunk of handle.generate(first.messages, {
                ...observationOptions, disableCommandBatching: true,
                onLogits: (values, metadata) => {
                  if (sampledTokenIds.length === first.parameters.step) observedLogits = encode(values);
                  sampledTokenIds.push(metadata.tokenId);
                },
              })) {}
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
            for (const [attempt, control] of controls.entries()) {
              await handle.resetGenerationState();
              const ids = handle.advanced.tokenizePrompt(control.messages, generation);
              if (JSON.stringify(ids) !== JSON.stringify(control.tokenIds)) throw Error('Unsplit control tokenization differs');
              let value = await handle.advanced.prefillWithLogits(control.messages, { ...executionOptions, inputIds: ids });
              value.cache?.destroy();
              checkCaptureReplay(attempt, 0, value.logits);
              await globalThis.compareUnsplitStep(attempt, 0, encode(value.logits));
              for (let step = 1; step < control.tokenIdsByStep.length; step++) {
                value = await handle.advanced.decodeStepLogits([control.tokenIdsByStep[step - 1]], executionOptions);
                checkCaptureReplay(attempt, step, value.logits);
                await globalThis.compareUnsplitStep(attempt, step, encode(value.logits));
              }
            }
            return { packageVersion: config.DOPPLER_PACKAGE_VERSION, modelIdentity: model.identity,
              tokenIds, generation, maxGpuBufferBytes, logits, stats, probe, captureReplay,
              resolvedRuntimeSession: handle.advanced.getResolvedRuntimeSession(), memory: runtime.inspectDeviceMemory() };
          } finally { await handle?.unload(); }
        }, { model: requests[0].model, source, first, generation, policy, captureLinear,
          controls: distributedControls.map(({ messages, tokenIds, steps }) => ({ messages, tokenIds,
            tokenIdsByStep: steps.map(step => step.tokenId) })) }));
        const decode = text => { const bytes = Buffer.from(text, 'base64');
          return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); };
        const actual = decode(diagnostic.logits);
        diagnostic.comparisons = {};
        const references = [['distributed', first.group1.logits], ['frozen', first.frozen.logits]];
        if (diagnostic.probe?.logits) references.push(['observed', diagnostic.probe.logits]);
        for (const [name, encoded] of references) {
          const expected = decode(encoded); assert.equal(actual.length, expected.length);
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
      } catch (error) { diagnostic.failure = { name: error.name, message: error.message }; }
      finally {
        try { await context.close(); }
        catch (error) { diagnostic.cleanupFailure = { name: error.name, message: error.message }; }
        if (captureLinear) {
          diagnostic.linearCapture = { captures: linearCaptures };
          if (!linearCaptures.some(capture => capture.records.some(record => record.boundary === 'linear-inputs'))) {
            diagnostic.captureFailure = 'The recurrent diagnostic did not retain its actual input boundary';
          }
        }
        await writeFile(output, JSON.stringify(evidence));
      }
    }
    const [mac, linux] = evidence.unsplitFirstDivergence.runs;
    if (mac.probe?.timeline && linux.probe?.timeline) {
      evidence.unsplitFirstDivergence.operatorComparison = mac.probe.timeline
        .filter(record => record.capture?.data).map(record => {
          const counterpart = linux.probe.timeline.find(item => item.opId === record.opId && item.capture?.data);
          assert(counterpart, `Linux capture missing ${record.opId}`);
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
  await writeFile(output, JSON.stringify(evidence));
  for (const context of contexts) await context.close();
  await local.close(); await remote.close();
}
