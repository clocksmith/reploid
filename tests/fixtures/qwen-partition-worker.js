// Private, bounded physical diagnostic over an owned process's stdin/stdout.
// This transport is not Reploid discovery, permissions, or WebRTC qualification.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { collectNativeSourceReceipts, collectClosedNativeSourceReceipts } from './native-source-receipts.js';
import { verifyDiagnosticRuntime } from './diagnostic-runtime-identity.js';
import { openDiagnosticModelSource } from './native-diagnostic-source.js';
import { openDiagnosticWholeModel, closeDiagnosticSources, inspectDiagnosticModel } from './native-diagnostic-whole.js';
import { runNativeCompleteRequest } from './native-complete-request.js';
import { serveCompleteRequestProtocol } from './complete-request-protocol.js';

const config = JSON.parse(await fs.readFile(process.argv[2]));
const mod = file => import(pathToFileURL(path.join(config.installedPackage, 'src', file)).href);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let runtime, bootstrapNodeWebGPU, releaseNodeWebGPU, installNodeFileFetchShim;
let getDevice, destroyDevice, getBufferPool, destroyBufferPool;
let createNodeFileArtifactStorageContext, createHttpArtifactStorageContext, load;
let manifest, manifestBytes, generation, plan, planId, model, verifiedIdentity;
async function initializeRuntime() {
  const candidateRuntime = await mod('partitions.js');
  const { resolveGenerationOptions } = await mod('config/generation-contract.js');
  ({ bootstrapNodeWebGPU, releaseNodeWebGPU } = await mod('tooling/node-webgpu.js'));
  ({ installNodeFileFetchShim } = await mod('tooling/node-file-fetch.js'));
  ({ getDevice, destroyDevice } = await mod('gpu/device.js'));
  ({ getBufferPool, destroyBufferPool } = await mod('memory/buffer-pool.js'));
  ({ createNodeFileArtifactStorageContext, createHttpArtifactStorageContext } = await mod('storage/artifact-storage-context.js'));
  ({ load } = await mod('index.js'));
  manifestBytes = await fs.readFile(config.manifestPath);
  assert.equal(sha(manifestBytes), config.manifestSha256);
  manifest = JSON.parse(manifestBytes);
  generation = resolveGenerationOptions(config.generation);
  // Preserve manifest-declared residual streams at the transport boundary.
  // Flash carries four streams, rather than one hidden-width activation.
  plan = candidateRuntime.createOrderedLayerPartitionPlanFromManifest(manifest, {
    splitLayers: config.splitLayers ?? [1], activationDtype: 'f32', activationPrecision: 'f32' });
  planId = candidateRuntime.hashLayerPartitionPlan(plan);
  model = { id: manifest.modelId, identity: 'sha256:' + config.manifestSha256, generation };
  runtime = candidateRuntime;
}
const residents = new Map();
const sources = [];
const receipts = () => collectNativeSourceReceipts(sources);
let whole;
const memory = () => ({ process: process.memoryUsage(), pool: getBufferPool().getStats(), device: runtime.inspectDeviceMemory() });
const encode = value => {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return Buffer.from(bytes).toString('base64');
};
async function close() {
  let sourceReceipts, receiptFailure;
  try { sourceReceipts = await receipts(); } catch (error) { receiptFailure = String(error); }
  for (const resident of residents.values()) await resident.close();
  residents.clear();
  await whole?.unload(); whole = null;
  await closeDiagnosticSources(sources);
  const closedSourceReceipts = collectClosedNativeSourceReceipts(sources);
  const sourceCleanup = 'settled';
  if (!getDevice?.()) {
    await releaseNodeWebGPU?.();
    return { gpuOpened: false, sourceReceipts, receiptFailure, closedSourceReceipts, sourceCleanup };
  }
  await getDevice().queue.onSubmittedWorkDone();
  const settled = memory();
  assert.equal(settled.pool.resources.active.bytes, 0);
  assert.equal(settled.pool.resources.retainedModel.bytes, 0);
  assert.equal(settled.pool.resources.deferredCleanup.bytes, 0);
  destroyBufferPool(); destroyDevice(); await releaseNodeWebGPU();
  return { ...settled, sourceReceipts, receiptFailure, closedSourceReceipts, sourceCleanup };
}
async function invoke(request) {
  if (request.op === 'identity') {
    verifiedIdentity = await verifyDiagnosticRuntime(config);
    return verifiedIdentity;
  }
  if (request.op === 'preflight') {
    verifiedIdentity = await verifyDiagnosticRuntime(config);
    return { runtime: verifiedIdentity, model: await inspectDiagnosticModel(config), gpuOpened: false };
  }
  if (request.op === 'open') {
    const openStarted = performance.now();
    assert(!config.sourceMap || config.pieceIndex, 'Explicit diagnostic source map requires pinned pieceIndex');
    assert(!config.workerGather || (config.pieceIndex && (request.indices === null
      || Array.isArray(request.indices) && request.indices.length > 0)),
    'workerGather requires pinned pieceIndex and explicit whole-model or partition selection');
    assert(!whole && residents.size === 0);
    assert(verifiedIdentity, 'Runtime identity preflight is required before model opening');
    const packageCheckStarted = performance.now();
    assert.deepEqual(await verifyDiagnosticRuntime(config), verifiedIdentity, 'Runtime changed after preflight');
    const packageRecheckMs = performance.now() - packageCheckStarted;
    const modelPreflightStarted = performance.now();
    if (request.indices === null && config.pieceIndex) {
      const readiness = await inspectDiagnosticModel(config);
      assert(readiness.readyForWholeModel, 'Whole diagnostic source files are unavailable: '
        + readiness.files.filter(file => !file.available).map(file => file.path).join(', '));
    }
    const modelPreflightMs = performance.now() - modelPreflightStarted;
    if (!runtime) await initializeRuntime();
    if (process.platform === 'linux') {
      const available = Number((await fs.readFile('/proc/meminfo', 'utf8')).match(/^MemAvailable:\s+(\d+)/m)[1]) * 1024;
      const base = '/sys/class/drm/card1/device/';
      const headroom = Number(await fs.readFile(base + 'mem_info_gtt_total')) - Number(await fs.readFile(base + 'mem_info_gtt_used'));
      assert(available >= config.minHostAvailableBytes && headroom >= config.minGpuAvailableBytes, 'Insufficient live headroom');
    }
    const bootstrap = await bootstrapNodeWebGPU(); assert(bootstrap.ok, bootstrap.detail);
    installNodeFileFetchShim();
    await runtime.configureDeviceMemoryBudget({ maxBytes: config.runtimeConfig.shared.bufferPool.budget.maxTotalBytes });
    const start = performance.now();
    if (request.indices === null) {
      if (config.pieceIndex) {
        const opened = await openDiagnosticWholeModel({ config, manifestBytes, model, runtime, load,
          signal: AbortSignal.timeout(config.limits.maxPreparationMs), onSource: source => sources.push(source) });
        whole = opened.model;
      } else whole = await load({ url: config.modelUrl }, { runtimeConfig: config.runtimeConfig });
    } else {
      const factory = runtime.createManifestResidentPartitionFactory({ manifest, manifestIdentity: model.identity,
        runtimeConfig: config.runtimeConfig,
        createStorage: async () => {
          if (!config.pieceIndex) return config.modelUrl.startsWith('file:')
            ? createNodeFileArtifactStorageContext(config.modelUrl, manifest)
            : createHttpArtifactStorageContext(config.modelUrl, manifest);
          const source = await openDiagnosticModelSource({ config, model, runtime,
            signal: AbortSignal.timeout(config.limits.maxPreparationMs),
            onSource: source => sources.push(source),
          });
          return source.storage;
        } });
      for (const index of request.indices) {
        residents.set(index, await factory.openResidentPartition({ model, plan, planId, index,
          participantId: 'q4-stage-' + index, limits: config.limits, signal: AbortSignal.timeout(config.limits.maxPreparationMs) }));
      }
    }
    return { plan, planId, generation, model, packageRecheckMs, modelPreflightMs, openWallMs: performance.now() - openStarted,
      generationDigest: runtime.hashPartitionGeneration(generation),
      provider: bootstrap.receipt, elapsedMs: performance.now() - start, memory: memory(),
      descriptors: [...residents].map(([index, resident]) => ({ index, descriptor: resident.getDescriptor() })) };
  }
  if (request.op === 'request') {
    assert(whole, 'Whole model must be opened before a complete request');
    const result = await runNativeCompleteRequest({ model: whole, prompt: request.prompt, promptIds: request.promptIds,
      generation, timeoutMs: config.requestTimeoutMs });
    return { ...result, memory: memory() };
  }
  if (request.op === 'whole') {
    assert(whole);
    const { sampleCapsuleLogits, stoppingReason } = await mod('inference/generation-step.js');
    whole.resetGenerationState();
    const ids = whole.advanced.tokenizePrompt(request.prompt, generation);
    const context = [...ids], rows = [], output = [];
    const special = whole.advanced.getSpecialTokens();
    const tokenContract = { eosTokenId: special.eos, padTokenId: special.pad, stopTokenIds: whole.advanced.getStopTokenIds() };
    const started = performance.now();
    if (config.wholeLogitsMode === 'generation-observer') {
      // Observe the ordinary generation path without exporting a partial cache.
      // Hyper-connection models own more state than the legacy logits API exports.
      assert.equal(generation.repetitionPenalty, 1, 'Raw-logit comparison requires neutral penalties');
      let previous = started;
      const generated = whole.generate(request.prompt, { ...generation,
        onLogits(logits, { tokenId }) {
          assert(logits.every(Number.isFinite));
          const now = performance.now();
          rows.push({ tokenId, logits: encode(logits), elapsedMs: now - previous });
          output.push(tokenId); previous = now;
        } });
      // Drain normal generation; retain the raw sampled tokens below.
      while (!(await generated.next()).done) { /* Sampling is observed through onLogits. */ }
      assert(rows.length > 0, 'Normal generation must expose sampled logits');
      return { ids, rows, text: whole.advanced.decodeTokenIds(output), elapsedMs: performance.now() - started, memory: memory() };
    }
    for (let step = 0; step < generation.maxTokens; step++) {
      const start = performance.now();
      const result = step === 0 ? await whole.advanced.prefillWithLogits(request.prompt, generation)
        : await whole.advanced.decodeStepLogits([context.at(-1)], generation);
      try {
        const tokenId = sampleCapsuleLogits(result.logits, context, generation, tokenContract);
        assert(result.logits.every(Number.isFinite));
        rows.push({ tokenId, logits: encode(result.logits), elapsedMs: performance.now() - start });
        output.push(tokenId); context.push(tokenId);
        if (stoppingReason(tokenId, step + 1, generation, tokenContract, () => whole.advanced.decodeTokenIds(output))) break;
      } finally { result.cache?.destroy(); }
    }
    return { ids, rows, text: whole.advanced.decodeTokenIds(output), elapsedMs: performance.now() - started, memory: memory() };
  }
  if (request.op === 'step') {
    const { index, parameters, activation } = request;
    const resident = residents.get(index); assert(resident);
    let decoded;
    if (activation) {
      const bytes = Uint8Array.from(Buffer.from(activation.buffer, 'base64')).buffer;
      decoded = runtime.validateActivationFrameForPlan({ ...activation, buffer: bytes }, plan);
    }
    const result = await resident.executeStage({ ...parameters, partitionIndex: index,
      ...(decoded ? { activation: decoded } : {}), signal: AbortSignal.timeout(config.stepTimeoutMs) });
    const frame = result.activationTensor ? runtime.serializeActivationFrame(result.activationTensor) : null;
    return { ...result, activationTensor: undefined,
      activation: frame ? { ...frame, buffer: encode(frame.buffer) } : null,
      logits: result.logits ? encode(result.logits) : null };
  }
  if (request.op === 'receipts') return receipts();
  if (request.op === 'retire') {
    for (const [index, resident] of residents) await resident.closeAttempt({ identity: request.identity, partitionIndex: index });
    return memory();
  }
  if (request.op === 'close') return close();
  throw new Error('Unknown private diagnostic operation');
}
await serveCompleteRequestProtocol({ invoke, onClose: close });
