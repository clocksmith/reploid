// Private, bounded physical diagnostic over an owned process's stdin/stdout.
// This transport is not Reploid discovery, permissions, or WebRTC qualification.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const config = JSON.parse(await fs.readFile(process.argv[2]));
const mod = file => import(pathToFileURL(path.join(config.installedPackage, 'src', file)).href);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const runtime = await mod('partitions.js');
const { resolveGenerationOptions } = await mod('config/generation-contract.js');
const { bootstrapNodeWebGPU, releaseNodeWebGPU } = await mod('tooling/node-webgpu.js');
const { installNodeFileFetchShim } = await mod('tooling/node-file-fetch.js');
const { getDevice, destroyDevice } = await mod('gpu/device.js');
const { getBufferPool, destroyBufferPool } = await mod('memory/buffer-pool.js');
const { createNodeFileArtifactStorageContext, createHttpArtifactStorageContext } = await mod('storage/artifact-storage-context.js');
const { load } = await mod('index.js');
const manifestBytes = await fs.readFile(config.manifestPath);
assert.equal(sha(manifestBytes), config.manifestSha256);
const manifest = JSON.parse(manifestBytes);
const generation = resolveGenerationOptions(config.generation);
const plan = runtime.createOrderedLayerPartitionPlan({ modelId: manifest.modelId,
  ...manifest.architecture, splitLayers: [1], activationDtype: 'f32' });
const planId = runtime.hashLayerPartitionPlan(plan);
const model = { id: manifest.modelId, identity: 'sha256:' + config.manifestSha256, generation };
const residents = new Map();
let whole;
const memory = () => ({ process: process.memoryUsage(), pool: getBufferPool().getStats(), device: runtime.inspectDeviceMemory() });
const encode = value => {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return Buffer.from(bytes).toString('base64');
};
async function close() {
  for (const resident of residents.values()) await resident.close();
  residents.clear();
  await whole?.unload(); whole = null;
  if (getDevice()) await getDevice().queue.onSubmittedWorkDone();
  const settled = memory();
  assert.equal(settled.pool.resources.active.bytes, 0);
  assert.equal(settled.pool.resources.retainedModel.bytes, 0);
  assert.equal(settled.pool.resources.deferredCleanup.bytes, 0);
  destroyBufferPool(); destroyDevice(); await releaseNodeWebGPU();
  return settled;
}
async function invoke(request) {
  if (request.op === 'open') {
    assert(!whole && residents.size === 0);
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
      whole = await load({ url: config.modelUrl }, { runtimeConfig: config.runtimeConfig });
    } else {
      const factory = runtime.createManifestResidentPartitionFactory({ manifest, manifestIdentity: model.identity,
        runtimeConfig: config.runtimeConfig,
        createStorage: () => config.modelUrl.startsWith('file:')
          ? createNodeFileArtifactStorageContext(config.modelUrl, manifest)
          : createHttpArtifactStorageContext(config.modelUrl, manifest) });
      for (const index of request.indices) {
        residents.set(index, await factory.openResidentPartition({ model, plan, planId, index,
          participantId: 'q4-stage-' + index, limits: config.limits, signal: AbortSignal.timeout(config.limits.maxPreparationMs) }));
      }
    }
    return { plan, planId, generation, model, generationDigest: runtime.hashPartitionGeneration(generation),
      provider: bootstrap.receipt, elapsedMs: performance.now() - start, memory: memory(),
      descriptors: [...residents].map(([index, resident]) => ({ index, descriptor: resident.getDescriptor() })) };
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
  if (request.op === 'retire') {
    for (const [index, resident] of residents) await resident.closeAttempt({ identity: request.identity, partitionIndex: index });
    return memory();
  }
  if (request.op === 'close') return close();
  throw new Error('Unknown private diagnostic operation');
}
let closed = false;
try {
  for await (const line of readline.createInterface({ input: process.stdin })) {
    const request = JSON.parse(line);
    try {
      const value = await invoke(request);
      process.stdout.write('@q4-response ' + JSON.stringify({ id: request.id, value }) + '\n');
      if (request.op === 'close') { closed = true; break; }
    } catch (error) {
      process.stdout.write('@q4-response ' + JSON.stringify({ id: request.id,
        error: { name: error.name, message: error.message, stack: error.stack } }) + '\n');
    }
  }
} finally { if (!closed) await close(); }
