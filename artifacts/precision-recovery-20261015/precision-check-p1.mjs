// Precision-recovery session copy (2026-10-15) of substitution-check.mjs from
// plain-profile-reference-20261014 (byte-identical to the qk-norm-graph-20261015 copy). The 55-step
// comparison, the timing loop and every substitution mode are unchanged. Additions, recorded only:
//   - report.preparation: wall time of each pipeline opening (load), and the first-use 56-token prefill
//     and first decode step of speed pass 0 (lazy pipeline creation lands there; run with a fresh
//     private MESA_SHADER_CACHE_DIR for a cold measurement, the same directory again for warm);
//   - report.resolved: each pipeline's matched capability policy, lane integrity, applied transforms,
//     intermediate precision and KV cache dtype and bytes, so a candidate's executed lane is on record;
//   - report.memory: Doppler buffer-pool statistics after the run and the process VmHWM;
//   - dumpCaches also covers a split (front partition layers from the front pipeline) and an F32 cache
//     (4-byte elements; the summarizer compares the nearest F16 of each stored value).
//
// One configuration per process: the unchanged 55-step check against the approved independent F64
// reference, plus prompt and decode timing, for the plain/paired controls and each controlled
// substitution or candidate correction.
//
// The comparison is copied unchanged from plain-reference-check.mjs: for each of the 55
// teacher-forced steps, every one of the 248,320 f32 logits must be within 0.001 of the F64
// reference and the argmax must equal the reference token. A run passes only if all 55 steps are
// within 0.001; matching tokens alone never count as passing.
//
// Timing (same per-token loop as speed-ladder.mjs's ordinary-per-token mode: prefillWithLogits, then
// one decodeStepLogits per token with logits read back every token, greedy argmax):
//   - the 56-token answer-cause turn 1 prompt, prefill plus SPEED_DECODE_TOKENS decode steps, run
//     twice; the second (warm) pass is reported;
//   - the 184-token request-2 prefill, timed again warm after the check.
//
// Usage: node substitution-check.mjs <doppler package root> <model dir> <approved-reference.json>
//          <contracts dir> <distributed-observed.json> <config.json> <out dir>
// config.json fields (all optional except label):
//   label
//   runtimeConfig      passed to createPipeline as-is (the Capsule TargetPlan config, as the speed harness does)
//   sessionOverrides   applied to a copy of Doppler's default runtime config (as plain-reference-check.mjs does)
//   dumpCaches         true: after each request, write the full F16 KV cache of every full-attention layer
//                      (the paired control writes the F64-backed caches used by kvSubstitution)
//   kvSubstitution     {cacheDir, layers: [...], kinds: ['key','value']}: diagnostic. After every KV cache
//                      store in the listed layers, the stored F16 values of the stored positions are
//                      replaced, inside the same command stream and before attention reads them, by the
//                      F64-backed values from cacheDir. Not an implementable correction.
//   hybridPrefill      {modelDir, runtimeConfig}: prompt processing (step 0) runs in a second pipeline with
//                      this configuration; its KV cache and linear-attention states are handed to the main
//                      pipeline, which runs every decode step. Paired conv states are narrowed to their
//                      nearest F32 (hi + lo); paired recurrent states are kept as two-F32 when the main
//                      pipeline uses linearRecurrentStatePrecision "two-f32", otherwise narrowed.
//   split              {splitLayer, front: {modelDir, runtimeConfig | sessionOverrides}}: layers 0..splitLayer-1
//                      (with the embedding) run as partition 0 of a two-partition plan in a pipeline with the
//                      front configuration; layers splitLayer..23 and the LM head run as partition 1 in the
//                      main pipeline/configuration. A paired front activation is narrowed to its nearest F32
//                      (hi + lo) at the boundary. Both partitions run every step (prefill and decode).
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [packageRoot, modelDir, referencePath, contractsDir, observedPath, configPath, outDir] = process.argv.slice(2);
if (!outDir) throw new Error('Usage: substitution-check.mjs PACKAGE MODEL REFERENCE CONTRACTS OBSERVED CONFIG OUT_DIR');
const SPEED_DECODE_TOKENS = 64;
const mod = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const now = () => performance.now();

const [{ bootstrapNodeWebGPU, releaseNodeWebGPU }, { installNodeFileFetchShim },
  { initDevice, destroyDevice, getKernelCapabilities, getDevice }, { createPipeline },
  { createNodeFileArtifactStorageContext }, { createModelHandle }, { formatChatMessages }, { DOPPLER_VERSION },
  { getRuntimeConfig }, { createDopplerLoader }, { KVCache }, { createLayerPartitionPlan },
  { executePartitionLayers }, { readBuffer, releaseBuffer, getBufferPool }] = await Promise.all([
  mod('tooling/node-webgpu.js'), mod('tooling/node-file-fetch.js'), mod('gpu/device.js'),
  mod('inference/pipelines/text.js'), mod('storage/artifact-storage-context.js'),
  mod('client/model-host/model-session.js'), mod('inference/pipelines/text/chat-format.js'), mod('version.js'),
  mod('config/runtime.js'), mod('loader/doppler-loader.js'), mod('inference/kv-cache/base.js'),
  mod('config/layer-partition-plan.js'), mod('inference/pipelines/text/partition-execution.js'), mod('memory/buffer-pool.js'),
]);
const processStatus = async () => {
  const text = await fs.readFile('/proc/self/status', 'utf8');
  const field = name => Number(text.match(new RegExp(`^${name}:\\s+(\\d+) kB`, 'm'))?.[1] ?? NaN) * 1024;
  return { vmHWMBytes: field('VmHWM'), vmRSSBytes: field('VmRSS') };
};
const preparation = { mesaShaderCacheDir: process.env.MESA_SHADER_CACHE_DIR ?? null,
  mesaShaderCacheDisabled: process.env.MESA_SHADER_CACHE_DISABLE ?? null, openMs: {} };
function resolvedOf(target) {
  if (!target) return null;
  const session = target.resolvedRuntimeSession;
  const cache = target.kvCache;
  let kvCacheBytes = null;
  if (cache?.layers) {
    kvCacheBytes = 0;
    for (const layer of cache.layers) if (layer) for (const buffer of [layer.keysGPU, layer.valuesGPU]) kvCacheBytes += buffer?.size ?? 0;
  }
  return { capabilityPolicy: session?.capabilityPolicy ?? null, laneIntegrity: session?.laneIntegrity ?? null,
    appliedTransforms: session?.execution?.appliedTransforms ?? null, resolvedStepsHash: session?.execution?.resolvedStepsHash ?? null,
    intermediatePrecision: session?.runtime?.session?.intermediatePrecision ?? null,
    kvDtype: cache?.kvDtype ?? null, kvCacheLayers: cache?.numLayers ?? null, kvMaxSeqLen: cache?.maxSeqLen ?? null, kvCacheBytes };
}

const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
await fs.mkdir(outDir, { recursive: true });
const referenceBytes = await fs.readFile(referencePath);
const reference = JSON.parse(referenceBytes);
const contractBytes = await Promise.all(reference.expected.map((_, index) => fs.readFile(path.join(contractsDir, `request-${index}-contract.json`))));
const requests = contractBytes.map(bytes => JSON.parse(bytes));
const observed = JSON.parse(await fs.readFile(observedPath, 'utf8'));
const speedTurn = observed.runs['run-5'].turns[0];
const manifestBytes = await fs.readFile(path.join(modelDir, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const manifestIdentity = 'sha256:' + sha256(manifestBytes);
const layerTypes = manifest.inference.layerPattern.layerTypes;
const fullLayers = layerTypes.flatMap((type, layer) => type === 'full_attention' ? [layer] : []);
const report = { schema: 'reploid.plain-substitution-check/v1', label: config.label, startedAt: new Date().toISOString(), machine: 'amd-host',
  dopplerVersion: DOPPLER_VERSION, referenceSha256: 'sha256:' + sha256(referenceBytes), referenceModelIdentity: reference.modelIdentity,
  manifestIdentity, manifestMatchesReference: manifestIdentity === reference.modelIdentity, config,
  configSha256: 'sha256:' + sha256(await fs.readFile(configPath)), tolerance: reference.numericalReference.tolerance,
  requiredSteps: reference.numericalReference.steps, requestContractSha256: contractBytes.map(bytes => 'sha256:' + sha256(bytes)),
  speed: {}, requests: [] };

function decodeReferenceLogits(step) {
  const bytes = Buffer.from(step.logits, 'base64');
  const dtype = step.logitsDtype ?? 'f32';
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return dtype === 'f64' ? new Float64Array(buffer) : new Float32Array(buffer);
}
const argmax = values => { let best = 0; for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i; return best; };
function summarize(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
  return { count: values.length, totalMs: values.reduce((a, b) => a + b, 0), medianMs: at(0.5), p90Ms: at(0.9), minMs: sorted[0], maxMs: sorted.at(-1) };
}

const bootstrap = await bootstrapNodeWebGPU();
if (!bootstrap?.ok) throw new Error('Node WebGPU bootstrap failed: ' + bootstrap?.detail);
installNodeFileFetchShim();
await initDevice();
const capabilities = getKernelCapabilities();
report.gpu = { adapter: capabilities.adapterInfo ?? null, hasF16: capabilities.hasF16 };

function precisionOf(runConfig) {
  return runConfig.runtimeConfig?.inference?.session?.intermediatePrecision
    ?? runConfig.sessionOverrides?.intermediatePrecision ?? 'f32';
}
async function openPipeline(directory, programManifest, runConfig, partition = null) {
  const storage = createNodeFileArtifactStorageContext(pathToFileURL(directory + path.sep).href, programManifest);
  const options = { storage, ownsLoader: true, ...(partition ? { partition } : {}) };
  if (runConfig.runtimeConfig) {
    Object.assign(options, { runtimeConfig: structuredClone(runConfig.runtimeConfig), loader: createDopplerLoader(runConfig.runtimeConfig.loading) });
  } else if (runConfig.sessionOverrides) {
    const runtimeConfig = structuredClone(getRuntimeConfig());
    Object.assign(runtimeConfig.inference.session, runConfig.sessionOverrides);
    Object.assign(options, { runtimeConfig, loader: createDopplerLoader(runtimeConfig.loading) });
  }
  return createPipeline(programManifest, options);
}

// ---------------------------------------------------------------------------------------------
// Diagnostic F64-backed KV substitution.
let substitution = null;
if (config.kvSubstitution) {
  const { layers, kinds } = config.kvSubstitution;
  substitution = { layers, kinds, buffers: null, counts: {}, storesOutsideCheck: 0, original: {} };
  const copyApproved = (cache, localLayer, startPos, numTokens, encoder) => {
    if (cache.numLayers !== fullLayers.length) throw new Error('KV substitution expects the sparse full-attention cache.');
    const modelLayer = fullLayers[localLayer];
    if (!substitution.layers.includes(modelLayer)) return false;
    // Speed passes run outside the 55-step check and have no approved cache: left unsubstituted.
    if (!substitution.buffers) { substitution.storesOutsideCheck++; return false; }
    const rowBytes = cache.numHeads * cache.headDim * 2;
    const target = cache.layers[localLayer];
    for (const kind of substitution.kinds) {
      const source = substitution.buffers[modelLayer][kind];
      if ((startPos + numTokens) * rowBytes > source.size) throw new Error(`Approved cache shorter than position ${startPos + numTokens}`);
      encoder.copyBufferToBuffer(source, startPos * rowBytes, kind === 'key' ? target.keysGPU : target.valuesGPU, startPos * rowBytes, numTokens * rowBytes);
    }
    const key = `${modelLayer}`;
    substitution.counts[key] = (substitution.counts[key] ?? 0) + numTokens;
    return true;
  };
  for (const name of ['recordUpdateF32ToF16FromGPU', 'recordUpdateFromGPU']) {
    const original = KVCache.prototype[name];
    KVCache.prototype[name] = async function (recorder, layerIdx, keys, values, startPos, numTokens, ...rest) {
      const result = await original.call(this, recorder, layerIdx, keys, values, startPos, numTokens, ...rest);
      if (recorder) copyApproved(this, layerIdx, startPos, numTokens, recorder.getEncoder());
      else {
        const encoder = getDevice().createCommandEncoder({ label: 'kv_substitution' });
        if (copyApproved(this, layerIdx, startPos, numTokens, encoder)) getDevice().queue.submit([encoder.finish()]);
      }
      return result;
    };
  }
  for (const name of ['updateFromGPU', 'update', 'recordF16UpdateAlreadyWrittenFromGPU']) {
    const original = KVCache.prototype[name];
    KVCache.prototype[name] = function (...args) {
      throw new Error(`KV substitution does not cover ${name}; refusing to run an unsubstituted store.`);
    };
    substitution.original[name] = original;
  }
}
async function loadApprovedCaches(index) {
  if (!substitution) return;
  const device = getDevice();
  const meta = JSON.parse(await fs.readFile(path.join(config.kvSubstitution.cacheDir, `request-${index}.json`), 'utf8'));
  const data = await fs.readFile(path.join(config.kvSubstitution.cacheDir, `request-${index}.f16`));
  if ('sha256:' + sha256(data) !== meta.dataSha256) throw new Error('Approved cache bytes changed');
  releaseApprovedCaches();
  substitution.buffers = {};
  let cursor = 0;
  for (const row of meta.layers) {
    const bytes = row.seqLen * row.numHeads * row.headDim * 2;
    substitution.buffers[row.layer] = {};
    for (const kind of ['key', 'value']) {
      const buffer = device.createBuffer({ label: 'approved_kv', size: bytes, usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buffer, 0, data, cursor, bytes);
      substitution.buffers[row.layer][kind] = buffer;
      cursor += bytes;
    }
  }
  report.requests.at(-1).approvedCaches = { source: meta.label, dataSha256: meta.dataSha256, seqLen: meta.layers[0].seqLen };
}
function releaseApprovedCaches() {
  if (!substitution?.buffers) return;
  for (const layer of Object.values(substitution.buffers)) for (const buffer of Object.values(layer)) buffer.destroy();
  substitution.buffers = null;
}

async function dumpCaches(pipeline, index, seqLen) {
  const device = getDevice();
  const chunks = [], layers = [];
  for (const layer of fullLayers) {
    // Split: layers before the split live in the front partition's cache.
    const owner = front && layer < config.split.splitLayer ? front : pipeline;
    const cache = owner.kvCache;
    const buffers = cache.getGPUBuffers(layer);
    if (!buffers || buffers.seqLen !== seqLen) throw new Error(`Cache layer ${layer} seqLen ${buffers?.seqLen} != ${seqLen}`);
    const elementBytes = cache.kvDtype === 'f32' ? 4 : 2;
    const bytes = seqLen * cache.numHeads * cache.headDim * elementBytes;
    const row = { layer, seqLen, numHeads: cache.numHeads, headDim: cache.headDim, kvDtype: cache.kvDtype,
      partition: owner === front ? 0 : (front ? 1 : null) };
    for (const [kind, source] of [['key', buffers.keysGPU], ['value', buffers.valuesGPU]]) {
      const staging = device.createBuffer({ label: 'cache_dump', size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try {
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(source, 0, staging, 0, bytes);
        device.queue.submit([encoder.finish()]);
        await staging.mapAsync(GPUMapMode.READ);
        const data = new Uint8Array(staging.getMappedRange().slice(0));
        staging.unmap();
        row[kind + 'Sha256'] = sha256(data);
        chunks.push(data);
      } finally { staging.destroy(); }
    }
    layers.push(row);
  }
  const data = Buffer.concat(chunks);
  const cacheDir = path.join(outDir, 'caches');
  await fs.mkdir(cacheDir, { recursive: true });
  const extension = layers.every(row => row.kvDtype !== 'f32') ? 'f16' : 'f32';
  await fs.writeFile(path.join(cacheDir, `request-${index}.${extension}`), data, { flag: 'wx' });
  await fs.writeFile(path.join(cacheDir, `request-${index}.json`), JSON.stringify({ label: config.label, request: index,
    dataSha256: 'sha256:' + sha256(data), layers }, null, 1) + '\n', { flag: 'wx' });
  report.requests.at(-1).finalCaches = layers;
}

// ---------------------------------------------------------------------------------------------
// Split mode: partition plans for each side, with the representation of its own session.
let front = null, frontHandle = null, splitPlans = null;
if (config.split) {
  const geometry = { modelId: manifest.modelId, numLayers: layerTypes.length, hiddenSize: manifest.architecture.hiddenSize,
    vocabSize: manifest.architecture.vocabSize, splitLayer: config.split.splitLayer };
  const planFor = runConfig => createLayerPartitionPlan({ ...geometry, ...(precisionOf(runConfig) === 'two-f32' ? { activationPrecision: 'two-f32' } : {}) });
  splitPlans = { front: planFor(config.split.front), back: planFor(config) };
  const bytes = await fs.readFile(path.join(config.split.front.modelDir, 'manifest.json'));
  const frontManifest = JSON.parse(bytes);
  report.splitFrontManifestIdentity = 'sha256:' + sha256(bytes);
  report.splitPlans = splitPlans;
  const opened = now();
  front = await openPipeline(config.split.front.modelDir, frontManifest, config.split.front, { plan: splitPlans.front, index: 0 });
  preparation.openMs.front = now() - opened;
  frontHandle = createModelHandle(front, { modelId: frontManifest.modelId, manifestHash: report.splitFrontManifestIdentity.slice(7) });
}
const openedMain = now();
const pipeline = await openPipeline(modelDir, manifest, config, splitPlans ? { plan: splitPlans.back, index: 1 } : null);
preparation.openMs.main = now() - openedMain;
const handle = createModelHandle(pipeline, { modelId: manifest.modelId, manifestHash: manifestIdentity.slice(7) });
let prefillPipeline = null, prefillHandle = null, linearTemplate = null;
if (config.hybridPrefill) {
  const bytes = await fs.readFile(path.join(config.hybridPrefill.modelDir, 'manifest.json'));
  const prefillManifest = JSON.parse(bytes);
  report.hybridPrefillManifestIdentity = 'sha256:' + sha256(bytes);
  prefillPipeline = await openPipeline(config.hybridPrefill.modelDir, prefillManifest, config.hybridPrefill);
  prefillHandle = createModelHandle(prefillPipeline, { modelId: prefillManifest.modelId, manifestHash: report.hybridPrefillManifestIdentity.slice(7) });
}
const thinking = pipeline.modelConfig?.chatTemplateThinking === true ? { thinking: true } : undefined;
const tokenize = messages => (frontHandle ?? handle).advanced.tokenizeText(formatChatMessages(messages, manifest.inference.chatTemplate.type, thinking));

// Split execution of new tokens through both partitions; returns last-position logits.
const splitBoundary = { narrowedValues: 0 };
async function splitStep(tokenIds) {
  const numTokens = tokenIds.length, signal = new AbortController().signal;
  const first = await executePartitionLayers(front, { numTokens, tokenIds }, signal);
  front.currentSeqLen += numTokens; front.decodeStepCount++;
  let activation = first.activationBytes;
  if (splitPlans.front.activationPrecision === 'two-f32' && splitPlans.back.activationPrecision !== 'two-f32') {
    const pairs = new Float32Array(activation);
    activation = narrowPairs(pairs).buffer;
    splitBoundary.narrowedValues += pairs.length / 2;
  } else if (splitPlans.front.activationPrecision !== splitPlans.back.activationPrecision) {
    throw new Error('Unsupported split boundary representation');
  }
  const second = await executePartitionLayers(pipeline, { numTokens, activationBytes: new Uint8Array(activation) }, signal);
  pipeline.currentSeqLen += numTokens; pipeline.decodeStepCount++;
  if (!second.logits) throw new Error('Split back partition produced no logits');
  try {
    return { logits: new Float32Array(await readBuffer(second.logits.logitsBuffer, second.logits.vocabSize * Float32Array.BYTES_PER_ELEMENT)) };
  } finally { releaseBuffer(second.logits.logitsBuffer); }
}
function resetAll() { pipeline.reset(); front?.reset(); }
async function decode(context) {
  if (front) return splitStep([context.at(-1)]);
  return pipeline.decodeStepLogits(context, { useChatTemplate: false });
}

// Hand a paired prefill's states to the main pipeline. Parameters (weights, epsilons) stay the main
// pipeline's own; only the evolving conv/recurrent states, sequence length and KV cache move.
function narrowPairs(values) {
  const out = new Float32Array(values.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Math.fround(values[2 * i] + values[2 * i + 1]);
  return out;
}
const transferStats = [];
function transferState(prefillOutput) {
  const source = prefillOutput.linearAttention;
  const layers = new Map();
  const notes = { convNarrowed: 0, recurrentNarrowed: 0, recurrentKeptPaired: 0 };
  for (const [layerIdx, template] of linearTemplate.layers.entries()) {
    const paired = source.layers.get(layerIdx);
    if (!paired) throw new Error(`Paired prefill has no linear state for layer ${layerIdx}`);
    const state = { ...template, seqLen: paired.seqLen };
    if (paired.convStateComponents === 2 && template.convStateComponents === 1) { state.convState = narrowPairs(paired.convState); notes.convNarrowed++; }
    else if (paired.convStateComponents === template.convStateComponents) state.convState = paired.convState.slice();
    else throw new Error('Unsupported conv state transfer');
    if (paired.recurrentStateComponents === template.recurrentStateComponents) { state.recurrentState = paired.recurrentState.slice(); notes.recurrentKeptPaired++; }
    else if (paired.recurrentStateComponents === 2 && template.recurrentStateComponents === 1) { state.recurrentState = narrowPairs(paired.recurrentState); notes.recurrentNarrowed++; }
    else throw new Error('Unsupported recurrent state transfer');
    layers.set(layerIdx, state);
  }
  pipeline.applyKVCacheSnapshot({ cache: prefillOutput.cache, seqLen: prefillOutput.seqLen,
    linearAttention: { schemaVersion: linearTemplate.schemaVersion, layers } });
  transferStats.push(notes);
}

async function prefill(messages, ids) {
  if (front) return { ...(await splitStep(ids)), cache: null };
  if (!prefillPipeline) return pipeline.prefillWithLogits(messages, { inputIds: ids, useChatTemplate: false });
  prefillPipeline.reset();
  const output = await prefillPipeline.prefillWithLogits(messages, { inputIds: ids, useChatTemplate: false });
  try { transferState(output); } finally { output.cache?.destroy?.(); }
  return { logits: output.logits, cache: null };
}

try {
  if (prefillPipeline) {
    // Template of the main pipeline's own linear-attention state shape and parameters.
    pipeline.reset();
    const warm = await pipeline.prefillWithLogits(reference.prompts[0], { inputIds: tokenize(reference.prompts[0]), useChatTemplate: false });
    linearTemplate = warm.linearAttention;
    warm.cache?.destroy?.();
    const differences = [];
    const probe = await prefillPipeline.prefillWithLogits(reference.prompts[0], { inputIds: tokenize(reference.prompts[0]), useChatTemplate: false });
    for (const [layerIdx, template] of linearTemplate.layers.entries()) {
      const paired = probe.linearAttention.layers.get(layerIdx);
      for (const field of ['convWeight', 'dtBias', 'aLog', 'normWeight', 'rmsNormEps', 'normWeightOffset', 'convDim', 'convKernelSize', 'numVHeads', 'headKDim', 'headVDim']) {
        const a = template[field], b = paired[field];
        const same = ArrayBuffer.isView(a) ? a.length === b.length && a.every((value, i) => value === b[i]) : a === b;
        if (!same) differences.push({ layerIdx, field });
      }
    }
    probe.cache?.destroy?.();
    report.hybridParameterDifferences = differences;
  }

  // Speed: 56-token turn, twice (second pass warm).
  const speedIds = tokenize(speedTurn.requestMessages);
  report.speed.promptTokens = speedIds.length;
  report.speed.passes = [];
  for (let pass = 0; pass < 2; pass++) {
    resetAll();
    const context = [...speedIds], steps = [];
    let cache = null, prefillMs = null;
    try {
      for (let step = 0; step <= SPEED_DECODE_TOKENS; step++) {
        const started = now();
        const output = step === 0 ? await prefill(speedTurn.requestMessages, speedIds)
          : await decode(context);
        const elapsed = now() - started;
        if (step === 0) { cache = output.cache; prefillMs = elapsed; } else steps.push(elapsed);
        context.push(argmax(output.logits));
      }
    } finally { cache?.destroy?.(); }
    report.speed.passes.push({ prefillMs, decode: summarize(steps), firstDecodeMs: steps[0] ?? null });
    console.log(JSON.stringify({ label: config.label, speedPass: pass, prefillMs, decodeMedianMs: summarize(steps).medianMs }));
  }

  // The unchanged 55-step check.
  for (let attempt = 0; attempt < reference.expected.length; attempt++) {
    const target = reference.expected[attempt];
    const contract = requests[attempt];
    const ids = tokenize(reference.prompts[attempt]);
    const frozenPrefix = contract?.inputIds?.slice(0, contract.prefixLengths?.[0]) ?? null;
    const row = { attempt, promptTokens: ids.length, promptMatchesFrozenPrefix: frozenPrefix ? JSON.stringify(ids) === JSON.stringify(frozenPrefix) : null, steps: [] };
    report.requests.push(row);
    await loadApprovedCaches(attempt);
    resetAll();
    const context = [...ids];
    let cache = null;
    try {
      for (let step = 0; step < target.steps.length; step++) {
        const started = now();
        const output = step === 0 ? await prefill(reference.prompts[attempt], ids)
          : await decode(context);
        const elapsedMs = now() - started;
        if (step === 0) cache = output.cache;
        const actual = output.logits, independent = decodeReferenceLogits(target.steps[step]);
        let maxDifference = 0, at = -1, finite = actual.length === independent.length, over = 0;
        for (let index = 0; index < actual.length; index++) {
          if (!Number.isFinite(actual[index])) { finite = false; continue; }
          const difference = Math.abs(actual[index] - independent[index]);
          if (difference > 0.001) over++;
          if (difference > maxDifference) { maxDifference = difference; at = index; }
        }
        const tokenId = argmax(actual);
        row.steps.push({ step, maxDifference, maxDifferenceAt: at, valuesOverTolerance: over, finite, withinTolerance: finite && maxDifference <= 0.001,
          tokenId, referenceTokenId: target.steps[step].tokenId, tokenMatches: tokenId === target.steps[step].tokenId, elapsedMs });
        context.push(target.steps[step].tokenId); // teacher-forced along the reference tokens
      }
      if (config.dumpCaches) await dumpCaches(pipeline, attempt, ids.length + target.steps.length - 1);
    } finally { cache?.destroy?.(); }
    row.maxDifference = Math.max(...row.steps.map(s => s.maxDifference));
    row.failedSteps = row.steps.filter(s => !s.withinTolerance || !s.tokenMatches).map(s => s.step);
    console.log(JSON.stringify({ label: config.label, attempt, promptTokens: ids.length, maxDifference: row.maxDifference, failedSteps: row.failedSteps.length }));
  }
  releaseApprovedCaches();
  const all = report.requests.flatMap(r => r.steps);
  report.summary = { comparedSteps: all.length, withinTolerance: all.filter(s => s.withinTolerance).length,
    tokenMatches: all.filter(s => s.tokenMatches).length, maxDifference: Math.max(...all.map(s => s.maxDifference)),
    valuesOverTolerance: all.reduce((sum, s) => sum + s.valuesOverTolerance, 0),
    passed: all.length === reference.numericalReference.steps && all.every(s => s.withinTolerance && s.tokenMatches) };

  // Warm 184-token prefill timing (request 2 prompt), after the check.
  const longIds = tokenize(reference.prompts[2]);
  resetAll();
  const started = now();
  const output = await prefill(reference.prompts[2], longIds);
  report.speed.longPrompt = { promptTokens: longIds.length, prefillMs: now() - started };
  output.cache?.destroy?.();
  const decodeSteps = report.requests[2].steps.slice(1).map(s => s.elapsedMs);
  report.speed.checkRequest2Decode = summarize(decodeSteps);
  report.speed.summary = { prompt56Ms: report.speed.passes[1].prefillMs, prompt184Ms: report.speed.longPrompt.prefillMs,
    decodeMedianMs: report.speed.passes[1].decode.medianMs };
  if (substitution) report.substitutionCounts = substitution.counts;
  if (front) report.splitBoundary = splitBoundary;
  report.preparation = { ...preparation, firstUsePrefill56Ms: report.speed.passes[0].prefillMs,
    firstUseDecodeMs: report.speed.passes[0].firstDecodeMs, warmPrefill56Ms: report.speed.passes[1].prefillMs,
    warmFirstDecodeMs: report.speed.passes[1].firstDecodeMs };
  report.resolved = { main: resolvedOf(pipeline), front: resolvedOf(front) };
  const poolStats = getBufferPool().getStats();
  report.memory = { pool: { currentBytesAllocated: poolStats.currentBytesAllocated, peakBytesAllocated: poolStats.peakBytesAllocated,
    peakBytesRequested: poolStats.peakBytesRequested, activeBuffers: poolStats.activeBuffers, pooledBuffers: poolStats.pooledBuffers },
    process: await processStatus(), perExecutorLimitBytes: 1_420_000_000 };
  if (transferStats.length) report.hybridTransfers = { count: transferStats.length, first: transferStats[0] };
  console.log(JSON.stringify({ label: config.label, ...report.summary, ...report.speed.summary }));
} finally {
  await handle.unload();
  if (prefillHandle) await prefillHandle.unload();
  if (frontHandle) await frontHandle.unload();
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1) + '\n', { flag: 'wx' });
  destroyDevice();
  await releaseNodeWebGPU();
}
