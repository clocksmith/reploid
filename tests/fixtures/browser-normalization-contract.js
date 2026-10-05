/** Diagnostic transport carries unchanged tensors between real browser partitions.
 * This local-byte diagnostic is separate from the ordinary-page WebRTC proof. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { observeBrowserNumerics } from './browser-numerical-observer.js';
import { observeNormalizationDispatch } from './normalization-dispatch-observer.js';
const reference = JSON.parse(await readFile(process.env.DOPPLER_PARTITION_REFERENCE_OUT, 'utf8'));
const output = process.env.REPLOID_CAPTURE_OUT;
const observationMode = process.env.DOPPLER_DISPATCH_OBSERVATION ?? 'dispatch';
assert(['dispatch', 'layers', 'calls'].includes(observationMode));
const observedSteps = process.env.DOPPLER_OBSERVED_STEPS
  ? JSON.parse(process.env.DOPPLER_OBSERVED_STEPS) : [0, 1, 25, 50];
assert(Array.isArray(observedSteps) && observedSteps.length > 0
  && observedSteps.every(step => Number.isSafeInteger(step) && step >= 0), 'Explicit nonnegative observation steps required');
const placement = process.env.DOPPLER_DISPATCH_PLACEMENT
  ?? (process.env.REPLOID_DIAGNOSTIC_A === 'mac' ? 'mac-linux' : 'linux-mac');
assert(['linux-mac', 'mac-linux', 'mac-mac', 'linux-linux'].includes(placement), 'Explicit diagnostic placement required');
const promptCount = Number(process.env.DOPPLER_DISPATCH_PROMPT_COUNT ?? reference.prompts.length);
assert(Number.isInteger(promptCount) && promptCount > 0 && promptCount <= reference.prompts.length);
const interventionPath = process.env.DOPPLER_CAPTURE_PIPELINE_INTERVENTION;
const intervention = interventionPath ? JSON.parse(await readFile(interventionPath, 'utf8')) : null;
let interventionShader = null;
if (intervention) {
  assert.equal(process.env.DOPPLER_TEST_ONLY_ARITHMETIC, '1', 'Pipeline substitutions are test-only');
  assert.equal(observationMode, 'dispatch', 'Entry-point isolation uses operand observation, not contract acceptance');
  assert(['main', 'main_subgroup'].includes(intervention.fromEntryPoint));
  assert(['main', 'main_subgroup'].includes(intervention.toEntryPoint));
  interventionShader = await readFile('node_modules/doppler-gpu/src/gpu/kernels/rmsnorm.wgsl', 'utf8');
  assert.equal(createHash('sha256').update(interventionShader).digest('hex'), intervention.shaderSha256,
    'Entry-point intervention must identify the exact installed shader');
}
const sourceRoot = process.env.DOPPLER_DISPATCH_SOURCE_ROOT;
const sourcePaths = ['config/kernel-path-loader.js', 'gpu/kernels/rmsnorm.js',
  'inference/pipelines/text/linear-attention.js', 'inference/pipelines/text/attention/interpreter.js',
  'inference/pipelines/text/ffn/standard.js', 'inference/pipelines/text/logits/index.js',
  'inference/pipelines/text/logits/gpu.js', 'inference/pipelines/text/logits/gpu-executor.js'];
const sources = sourceRoot ? await Promise.all(sourcePaths.map(async path => {
  const body = await readFile(resolve(sourceRoot, path), 'utf8');
  return { path, body, sha256: createHash('sha256').update(body).digest('hex') };
})) : [];
if (process.env.DOPPLER_DISPATCH_RMSNORM_SOURCE) {
  const body = await readFile(process.env.DOPPLER_DISPATCH_RMSNORM_SOURCE, 'utf8');
  sources.push({ path: 'gpu/kernels/rmsnorm.wgsl', body, sha256: createHash('sha256').update(body).digest('hex') });
}
assert(!intervention || sources.length === 0, 'Entry-point isolation cannot also substitute source files');
assert(output && process.env.REPLOID_EXECUTOR_WS, 'Output and physical executor endpoint are required');
const mac = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal'] });
const linux = await chromium.connect(process.env.REPLOID_EXECUTOR_WS);
const browsers = { mac, linux };
const hosts = placement.split('-').map(platform => browsers[platform]);
const contexts = [], pages = [], observers = [], descriptors = [];
try {
  for (const [index, host] of hosts.entries()) {
    const context = await host.newContext(); contexts.push(context);
    if (sources.length) await context.route('**/vendor/doppler/**', async route => {
      const path = new URL(route.request().url()).pathname;
      const source = sources.find(source => path.endsWith('/' + source.path));
      if (source) await route.fulfill({ status: 200,
        contentType: source.path.endsWith('.wgsl') ? 'text/plain' : 'text/javascript', body: source.body });
      else await route.continue();
    });

    await context.addInitScript(({ intervention, interventionShader }) => {
      const modules = new WeakMap();
      globalThis.pipelineObservations = [];
      globalThis.bindingObservations = [];
      const uniformBytes = new WeakMap();
      const write = GPUQueue.prototype.writeBuffer;
      GPUQueue.prototype.writeBuffer = function (buffer, offset, data, dataOffset = 0, size) {
        if (buffer.label?.includes('rmsnorm') && buffer.label?.includes('uniform')) {
          const scale = data.BYTES_PER_ELEMENT ?? 1;
          const bytes = ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
          uniformBytes.set(buffer, Array.from(bytes.slice(dataOffset * scale, size === undefined ? undefined : (dataOffset + size) * scale)));
        }
        return write.call(this, buffer, offset, data, dataOffset, size);
      };
      const bind = GPUDevice.prototype.createBindGroup;
      GPUDevice.prototype.createBindGroup = function (descriptor) {
        if (descriptor.label?.includes('rmsnorm') && bindingObservations.length < 8) {
          bindingObservations.push({ label: descriptor.label, entries: descriptor.entries.map(entry => ({
            binding: entry.binding, label: entry.resource.buffer?.label,
            bytes: entry.resource.buffer?.size, offset: entry.resource.offset ?? 0,
            bindingSize: entry.resource.size ?? null, uniformBytes: uniformBytes.get(entry.resource.buffer) ?? null,
          })) });
        }
        return bind.call(this, descriptor);
      };
      const shader = GPUDevice.prototype.createShaderModule;
      GPUDevice.prototype.createShaderModule = function (descriptor) {
        const module = shader.call(this, descriptor); modules.set(module, descriptor.code); return module;
      };
      for (const method of ['createComputePipeline', 'createComputePipelineAsync']) {
        const original = GPUDevice.prototype[method];
        GPUDevice.prototype[method] = function (descriptor) {
          const code = modules.get(descriptor.compute.module);
          const requestedEntryPoint = descriptor.compute.entryPoint;
          const substituted = intervention !== null && code === interventionShader
            && requestedEntryPoint === intervention.fromEntryPoint;
          if (substituted) descriptor = { ...descriptor, compute: { ...descriptor.compute,
            entryPoint: intervention.toEntryPoint } };
          if (descriptor.label?.includes('rmsnorm')) pipelineObservations.push({label:descriptor.label,
            requestedEntryPoint, substituted,
            entryPoint:descriptor.compute.entryPoint, constants:descriptor.compute.constants,
            shaderSource: code, candidate:!!(code?.includes('refined_root') || code?.includes('reciprocal_residual'))});
          return original.call(this, descriptor);
        };
      }
    }, { intervention, interventionShader });
    const page = await context.newPage(); pages.push(page);
    await page.goto('http://localhost:8000/config/chat-files.json');
    const metadata = [], observationErrors = [];
    const cdp = observationMode === 'dispatch' ? await context.newCDPSession(page) : null;
    if (cdp) {
      await cdp.send('Debugger.enable');
      const lines = (sources.find(source => source.path === 'inference/pipelines/text/linear-attention.js')?.body
        ?? await readFile('node_modules/doppler-gpu/src/inference/pipelines/text/linear-attention.js', 'utf8')).split('\n');
      const bp = await cdp.send('Debugger.setBreakpointByUrl', {
        urlRegex: '/pipelines/text/linear-attention\\.js$',
        lineNumber: lines.findIndex(line => line.includes('let normedTensor = inputTensor;')),
        condition: 'layerIdx === 0'
      });
      cdp.on('Debugger.paused', async event => {
        try {
          if (!event.hitBreakpoints.includes(bp.breakpointId)) return;
          const value = await cdp.send('Debugger.evaluateOnCallFrame', {
            callFrameId:event.callFrames[0].callFrameId,
            expression:'(captureNormalizationInputs(inputTensor, layerWeights.inputNorm, numTokens, hiddenSize, recorder), {phase, layerIdx, kernelPath, dtype:inputTensor.dtype})', returnByValue:true });
          if (value.exceptionDetails) throw Error(value.exceptionDetails.text);
          metadata.push({data:value.result.value});
        } catch(error) {observationErrors.push(error.message);}
        finally {await cdp.send('Debugger.resume');}
      });
    }
    await page.evaluate(async () => {
      globalThis.numericalObservation = {};
      globalThis.normalizationInputObservations = [];
      const config = await import('/config/doppler-local-models.js');
      const base = new URL(config.DOPPLER_PARTITIONS_MODULE_URL, location.href);
      const { getDevice } = await import(new URL('./gpu/device.js', base));
      const { getBuffer } = await import(new URL('./gpu/weight-buffer.js', base));
      const { resolveNormWeightDtype } = await import(new URL('./gpu/kernels/rmsnorm.js', base));
      globalThis.captureNormalizationInputs = (input, weight, numTokens, hiddenSize, recorder) => {
        if (normalizationInputObservations.length) return;
        const device = getDevice(), weightDtype = resolveNormWeightDtype(weight, hiddenSize);
        const inputBytes = input.dtype === 'f16' ? 2 : 4, weightBytes = weightDtype === 'f16' ? 2 : 4;
        for (const [role, buffer, dtype, offset, length] of [
          ['input-last-row', input.buffer, input.dtype, (numTokens - 1) * hiddenSize * inputBytes, hiddenSize * inputBytes],
          ['weight', getBuffer(weight), weightDtype, 0, hiddenSize * weightBytes],
        ]) {
          const result = { role, dtype, offset, length, data: null, sha256: null };
          normalizationInputObservations.push(result);
          const staging = device.createBuffer({ label: 'normalization_input_observation', size: length,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
          recorder.getEncoder().copyBufferToBuffer(buffer, offset, staging, 0, length);
          recorder.enqueueCompletionTask(async () => {
            try {
              await staging.mapAsync(GPUMapMode.READ);
              const bytes = staging.getMappedRange().slice(0);
              result.data = btoa(String.fromCharCode(...new Uint8Array(bytes)));
              result.sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
            } finally { staging.unmap(); staging.destroy(); }
          });
        }
      };
    });
    observers.push(cdp ? {read:async()=>({records:metadata,errors:observationErrors}),close:()=>cdp.detach()}
      : observationMode === 'calls' ? await observeNormalizationDispatch(page, sources)
        : await observeBrowserNumerics(page, 'node_modules/doppler-gpu', { steps: observedSteps }));
    const opened = await page.evaluate(async ({ reference, index }) => {
      const config = await import('/config/doppler-local-models.js');
      const base = new URL(config.DOPPLER_PARTITIONS_MODULE_URL, location.href);
      globalThis.__DOPPLER_KERNEL_BASE_PATH__ = config.DOPPLER_KERNEL_BASE_URL;
      const runtime = await import(config.DOPPLER_PARTITIONS_MODULE_URL);
      const { createHttpArtifactStorageContext } = await import(new URL('./storage/artifact-storage-context.js', base));
      const policy = await (await fetch('/config/partition-policy.json')).json();
      const source = 'http://127.0.0.1:9230/';
      const bytes = await (await fetch(source + 'manifest.json')).arrayBuffer();
      const identity = 'sha256:' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
      if (identity !== reference.modelIdentity) throw Error('Manifest identity mismatch');
      const manifest = JSON.parse(new TextDecoder().decode(bytes));
      const plan = runtime.createLayerPartitionPlan({ modelId: manifest.modelId, ...manifest.architecture,
        activationDtype: manifest.inference.session.compute.defaults.activationDtype });
      const planId = runtime.hashLayerPartitionPlan(plan);
      if (planId !== reference.planId) throw Error('Plan identity mismatch');
      await runtime.configureDeviceMemoryBudget({ maxBytes: policy.maxGpuBufferBytes });
      const factory = runtime.createManifestResidentPartitionFactory({ manifest, manifestIdentity: identity,
        runtimeConfig: { shared: { debug: { profiler: { enabled: policy.profileGpu } } },
          inference: { session: { kvcache: { maxSeqLen: reference.generation.maxSeqLen } } } },
        createStorage: () => createHttpArtifactStorageContext(source, manifest, { verifyHashes: true }) });
      globalThis.resident = await factory.openResidentPartition({ model: { id: manifest.modelId, identity, generation: reference.generation },
        plan, planId, index, participantId: index ? 'diagnostic-B' : 'diagnostic-A', limits: policy.limits, signal: new AbortController().signal });
      globalThis.encodeNumericalBytes = data => {
        let text = ''; const bytes = new Uint8Array(data.buffer || data, data.byteOffset || 0, data.byteLength);
        for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384));
        return btoa(text);
      };
      return { descriptor: resident.getDescriptor(), packageVersion: config.DOPPLER_PACKAGE_VERSION, maxGpuBufferBytes: policy.maxGpuBufferBytes };
    }, { reference, index });
    descriptors.push({ ...opened, platform: host === mac ? 'mac' : 'linux', browser: host.version() });
    console.log(`Opened ${index} on ${descriptors.at(-1).platform}`);
  }
  const runs = [];
  for (const [prompt, messages] of reference.prompts.slice(0, promptCount).entries()) {
    const identity = { modelId: descriptors[0].descriptor.modelId, modelIdentity: reference.modelIdentity,
      planId: reference.planId, participantA: 'diagnostic-A', participantB: 'diagnostic-B', threadId: `prompt-${prompt}`, attemptId: `attempt-${prompt}` };
    const tokenized = await pages[0].evaluate(({ identity, messages }) => resident.tokenize({ identity, messages, signal: new AbortController().signal }), { identity, messages });
    let ids = tokenized.tokenIds;
    const inputTokenIds = ids, steps = []; let position = 0, aContinuation = null, bContinuation = null, text = '';
    for (let step = 0; step < reference.generation.maxTokens; step++) {
      const request = { identity, step, tokenPosition: position, inputTokenCount: ids.length,
        generation: reference.generation, maxTokens: reference.generation.maxTokens };
      const a = await pages[0].evaluate(async ({ request, ids, continuation, prompt }) => {
        numericalObservation.prompt = prompt; numericalObservation.step = request.step;
        const result = await resident.executeGroup0({ ...request, tokenIds: ids, continuation, signal: new AbortController().signal });
        return { activation: { ...result.activationTensor, data: encodeNumericalBytes(result.activationTensor.data) }, continuation: result.continuation };
      }, { request, ids, continuation: aContinuation, prompt });
      const b = await pages[1].evaluate(async ({ request, ids, activation, continuation, prompt }) => {
        numericalObservation.prompt = prompt; numericalObservation.step = request.step;
        const data = Uint8Array.from(atob(activation.data), c => c.charCodeAt(0)).buffer;
        const result = await resident.executeGroup1({ ...request, inputTokenIds: ids,
          activation: { ...activation, tensorData: data }, continuation, signal: new AbortController().signal });
        return { tokenId: result.tokenId, stopReason: result.stopReason, done: result.done, delta: result.delta,
          logits: encodeNumericalBytes(result.logits), continuation: result.continuation };
      }, { request, ids, activation: a.activation, continuation: bContinuation, prompt });
      steps.push({ step, tokenId: b.tokenId, stopReason: b.stopReason, logits: b.logits }); text += b.delta;
      aContinuation = a.continuation; bContinuation = b.continuation; position += ids.length; ids = [b.tokenId];
      if (b.done) break;
    }
    runs.push({ prompt, inputTokenIds, text, steps });
    for (const page of pages) await page.evaluate(identity => resident.closeAttempt({ identity }), identity);
    console.log(JSON.stringify({ prompt, text, steps: steps.length }));
  }
  const observations = [], dispatchPipelines = [];
  for (const observer of observers) {
    const data = await observer.read(); assert.deepEqual(data.errors, []);
    assert(data.records.every(record => record.data && !record.error), 'Incomplete partition capture');
    observations.push(data.records);
    if (data.pipelines) dispatchPipelines.push(data.pipelines);
  }
  const pipelineObservations = await Promise.all(pages.map(page => page.evaluate(() => globalThis.pipelineObservations)));
  for (const pipelines of pipelineObservations) for (const pipeline of pipelines) {
    pipeline.shaderSha256 = createHash('sha256').update(pipeline.shaderSource).digest('hex');
    delete pipeline.shaderSource;
  }
  if (intervention) assert(pipelineObservations.every(pipelines => pipelines.some(pipeline => pipeline.substituted)),
    'The identified intervention must execute on both participants');
  const bindingObservations = await Promise.all(pages.map(page => page.evaluate(() => globalThis.bindingObservations)));
  const inputObservations = await Promise.all(pages.map(page => page.evaluate(() => globalThis.normalizationInputObservations)));
  await writeFile(output, JSON.stringify({ pipelineObservations, intervention, surface: 'browser', placement, observationMode, observedSteps,
    sourceOverrides: sources.map(({ path, sha256 }) => ({ path, sha256 })),
    scope: intervention ? 'Test-only pipeline entry-point intervention; not installed-package acceptance or P2P qualification'
      : sources.length ? 'Test-only source substitution over pinned package; not installed-package or P2P qualification'
      : 'Canonical package dispatch diagnosis with read-only operand copies; not P2P or numerical qualification',
    modelIdentity: reference.modelIdentity, planId: reference.planId, generation: reference.generation,
    bindingObservations, inputObservations, promptCount, descriptors, runs, observations, dispatchPipelines }));
  console.log(JSON.stringify({ output, records: observations.map(records => records.length) }));
} finally {
  for (const page of pages) await page.evaluate(() => globalThis.resident?.close()).catch(() => {});
  for (const observer of observers) await observer.close();
  for (const context of contexts) await context.close();
  await mac.close(); await linux.close();
}
