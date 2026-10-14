// Per-operator capture of request 2 (184 prompt tokens) for locating the first divergent operation
// of the plain profile. Teacher-forced along the approved reference tokens, exactly as
// plain-reference-check.mjs does, with the same logits comparison per step. Adds:
//   - full operator captures (Doppler operator diagnostics, `full` level) for the whole prefill
//     and for one decode step, written as float64 values (paired captures are decoded hi+lo);
//   - the physical F16 KV cache bytes of the six full-attention layers after the prefill and
//     after the last required decode step, with sha256 per layer (comparable to the approved
//     F64 evaluator's cache identities, which hash the same [tokens, kvHeads, headDim] f16 bytes).
// Observation only: no captured value is fed back into execution.
//
// Usage: node divergence-capture.mjs <doppler package root> <model dir> <approved-reference.json>
//          <contracts dir> <out dir> <config.json> [decode capture step] [opId regex]
// config.json: {"label": ..., "runtimeConfig": {...}} (passed to createPipeline as-is, as the speed
// harness does for the Capsule TargetPlan config) or {"label": ..., "sessionOverrides": {...}}
// (applied to a copy of the default runtime config, as plain-reference-check.mjs does) or
// {"label": ...} for manifest defaults.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [packageRoot, modelDir, referencePath, contractsDir, outDir, configPath, decodeStepArg, opFilterArg] = process.argv.slice(2);
if (!configPath) throw new Error('Usage: divergence-capture.mjs PACKAGE MODEL REFERENCE CONTRACTS OUT_DIR CONFIG [STEP]');
const captureStep = Number(decodeStepArg ?? 15);
const REQUEST = 2;
const mod = relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const [{ bootstrapNodeWebGPU, releaseNodeWebGPU }, { installNodeFileFetchShim },
  { initDevice, destroyDevice, getKernelCapabilities, getDevice }, { createPipeline },
  { createNodeFileArtifactStorageContext }, { createModelHandle }, { formatChatMessages }, { DOPPLER_VERSION },
  { getRuntimeConfig }, { createDopplerLoader }, { OperatorEventEmitter }, { createDefaultCaptureConfig }] = await Promise.all([
  mod('tooling/node-webgpu.js'), mod('tooling/node-file-fetch.js'), mod('gpu/device.js'),
  mod('inference/pipelines/text.js'), mod('storage/artifact-storage-context.js'),
  mod('client/model-host/model-session.js'), mod('inference/pipelines/text/chat-format.js'), mod('version.js'),
  mod('config/runtime.js'), mod('loader/doppler-loader.js'), mod('inference/pipelines/text/operator-events.js'),
  mod('debug/capture-policy.js'),
]);

const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const referenceBytes = await fs.readFile(referencePath);
const reference = JSON.parse(referenceBytes);
const contract = JSON.parse(await fs.readFile(path.join(contractsDir, `request-${REQUEST}-contract.json`)));
const manifestBytes = await fs.readFile(path.join(modelDir, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const layerTypes = manifest.inference.layerPattern.layerTypes;
const fullLayers = layerTypes.flatMap((type, layer) => type === 'full_attention' ? [layer] : []);
await fs.mkdir(outDir, { recursive: true });

const targetOpIds = ['embed.out', 'final_norm.out'];
for (let layer = 0; layer < layerTypes.length; layer++) {
  targetOpIds.push(...['attn.post_input_norm', 'attn.out', 'attn.post_attn', 'ffn.out', 'layer.out'].map(op => `layer.${layer}.${op}`));
  if (layerTypes[layer] === 'full_attention') {
    targetOpIds.push(...['attn.q_proj', 'attn.k_proj', 'attn.v_proj', 'attn.q_norm', 'attn.k_norm', 'attn.q_rope', 'attn.k_rope', 'attn.core_out']
      .map(op => `layer.${layer}.${op}`));
  } else {
    targetOpIds.push(...['attn.qkv_proj', 'attn.linear_z_proj', 'attn.linear_core_out'].map(op => `layer.${layer}.${op}`));
  }
}
// An optional opId regex bounds the capture (full paired captures also retain their raw components).
const selectedOpIds = opFilterArg ? targetOpIds.filter(id => new RegExp(opFilterArg).test(id)) : targetOpIds;
const captureConfig = { ...createDefaultCaptureConfig(), enabled: true, defaultLevel: 'none', targetOpIds: selectedOpIds, targetLevel: 'full' };

const report = { schema: 'reploid.plain-divergence-capture/v1', label: config.label, startedAt: new Date().toISOString(), machine: 'amd-host',
  dopplerVersion: DOPPLER_VERSION, referenceSha256: 'sha256:' + sha256(referenceBytes), manifestIdentity: 'sha256:' + sha256(manifestBytes),
  configSha256: 'sha256:' + sha256(JSON.stringify(config)), request: REQUEST, captureStep, opFilter: opFilterArg ?? null, steps: [], captures: {}, caches: {} };

function decodeReferenceLogits(step) {
  const bytes = Buffer.from(step.logits, 'base64');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return (step.logitsDtype ?? 'f32') === 'f64' ? new Float64Array(buffer) : new Float32Array(buffer);
}
const argmax = values => { let best = 0; for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i; return best; };

// Concatenate the captured chunks of each opId in emission order and write them as float64.
async function writeTimeline(name, timeline) {
  const groups = new Map();
  for (const row of timeline) {
    const capture = row.capture;
    if (!capture || !Array.isArray(capture.data)) continue;
    const opId = row.opId;
    if (!groups.has(opId)) groups.set(opId, { opId, width: capture.shape?.at(-1) ?? null, chunks: [], tokens: 0, precision: capture.precision ?? 'f32' });
    const group = groups.get(opId);
    group.chunks.push(Float64Array.from(capture.data));
    group.tokens += capture.shape?.[0] ?? 0;
  }
  const index = [];
  let offset = 0;
  const handle = await fs.open(path.join(outDir, `${name}.f64`), 'wx');
  try {
    for (const group of groups.values()) {
      const length = group.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      index.push({ opId: group.opId, tokens: group.tokens, width: group.width, length, offset, precision: group.precision, chunks: group.chunks.length });
      for (const chunk of group.chunks) await handle.write(new Uint8Array(chunk.buffer));
      offset += length;
    }
  } finally { await handle.close(); }
  report.captures[name] = index;
}

async function readCaches(name, expectedSeqLen) {
  const cache = pipeline.kvCache;
  const device = getDevice();
  // A sparse attention cache is a view addressed by model layer index (cache.layerIndices).
  const allocation = cache.layerIndices || cache.numLayers === layerTypes.length ? fullLayers
    : cache.numLayers === fullLayers.length ? fullLayers.map((_, i) => i) : null;
  if (!allocation) throw new Error(`Unexpected KV cache layer count ${cache.numLayers}`);
  if (cache.layout !== 'contiguous' || cache.kvDtype !== 'f16') throw new Error('Expected contiguous f16 KV cache');
  const rows = [];
  const bytes = expectedSeqLen * cache.numHeads * cache.headDim * 2;
  const handle = await fs.open(path.join(outDir, `${name}.f16`), 'wx');
  try {
    for (let i = 0; i < fullLayers.length; i++) {
      const buffers = cache.getGPUBuffers(allocation[i]);
      if (!buffers || buffers.seqLen !== expectedSeqLen) throw new Error(`Cache layer ${fullLayers[i]} seqLen ${buffers?.seqLen} != ${expectedSeqLen}`);
      const row = { layer: fullLayers[i], seqLen: expectedSeqLen, numHeads: cache.numHeads, headDim: cache.headDim };
      for (const [kind, source] of [['key', buffers.keysGPU], ['value', buffers.valuesGPU]]) {
        const staging = device.createBuffer({ label: 'divergence_cache_readback', size: bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        try {
          const encoder = device.createCommandEncoder({ label: 'divergence_cache_readback' });
          encoder.copyBufferToBuffer(source, 0, staging, 0, bytes);
          device.queue.submit([encoder.finish()]);
          await staging.mapAsync(GPUMapMode.READ);
          const data = new Uint8Array(staging.getMappedRange().slice(0));
          staging.unmap();
          row[kind + 'Sha256'] = sha256(data);
          await handle.write(data);
        } finally { staging.destroy(); }
      }
      rows.push(row);
    }
  } finally { await handle.close(); }
  report.caches[name] = rows;
}

const bootstrap = await bootstrapNodeWebGPU();
if (!bootstrap?.ok) throw new Error('Node WebGPU bootstrap failed: ' + bootstrap?.detail);
installNodeFileFetchShim();
await initDevice();
const capabilities = getKernelCapabilities();
report.gpu = { adapter: capabilities.adapterInfo ?? null, hasF16: capabilities.hasF16 };

const storage = createNodeFileArtifactStorageContext(pathToFileURL(modelDir + path.sep).href, manifest);
const pipelineOptions = { storage, ownsLoader: true };
if (config.runtimeConfig) {
  Object.assign(pipelineOptions, { runtimeConfig: structuredClone(config.runtimeConfig), loader: createDopplerLoader(config.runtimeConfig.loading) });
} else if (config.sessionOverrides) {
  const runtimeConfig = structuredClone(getRuntimeConfig());
  Object.assign(runtimeConfig.inference.session, config.sessionOverrides);
  Object.assign(pipelineOptions, { runtimeConfig, loader: createDopplerLoader(runtimeConfig.loading) });
}
const pipeline = await createPipeline(manifest, pipelineOptions);
const handle = createModelHandle(pipeline, { modelId: manifest.modelId, manifestHash: report.manifestIdentity.slice(7) });
try {
  const thinking = pipeline.modelConfig?.chatTemplateThinking === true ? { thinking: true } : undefined;
  const target = reference.expected[REQUEST];
  const ids = handle.advanced.tokenizeText(formatChatMessages(reference.prompts[REQUEST], manifest.inference.chatTemplate.type, thinking));
  report.promptTokens = ids.length;
  report.promptMatchesFrozenPrefix = JSON.stringify(ids) === JSON.stringify(contract.inputIds.slice(0, contract.prefixLengths[0]));
  pipeline.reset();
  const context = [...ids];
  let cache = null;
  try {
    for (let step = 0; step < target.steps.length; step++) {
      let output;
      if (step === 0) {
        output = await pipeline.prefillWithLogits(reference.prompts[REQUEST], { inputIds: ids, useChatTemplate: false,
          diagnostics: { enabled: true, captureConfig } });
        cache = output.cache;
        await writeTimeline('prefill', pipeline.stats.operatorDiagnostics?.timeline ?? []);
        pipeline.stats.operatorDiagnostics = null;
        await readCaches('cache-after-prefill', ids.length);
      } else if (step === captureStep) {
        const emitter = new OperatorEventEmitter({ modelHash: manifest.modelId });
        pipeline.operatorDiagnostics = { enabled: true, captureConfig, emitter, tsirFixture: null };
        try { output = await pipeline.decodeStepLogits(context, { useChatTemplate: false }); }
        finally { pipeline.operatorDiagnostics = null; }
        await writeTimeline(`decode-${step}`, emitter.getTimeline());
      } else {
        output = await pipeline.decodeStepLogits(context, { useChatTemplate: false });
      }
      const actual = output.logits, independent = decodeReferenceLogits(target.steps[step]);
      let maxDifference = 0, at = -1, finite = actual.length === independent.length;
      for (let index = 0; index < actual.length; index++) {
        if (!Number.isFinite(actual[index])) { finite = false; continue; }
        const difference = Math.abs(actual[index] - independent[index]);
        if (difference > maxDifference) { maxDifference = difference; at = index; }
      }
      const tokenId = argmax(actual);
      report.steps.push({ step, maxDifference, maxDifferenceAt: at, finite, withinTolerance: finite && maxDifference <= 0.001,
        tokenId, referenceTokenId: target.steps[step].tokenId, tokenMatches: tokenId === target.steps[step].tokenId });
      if (step === 0 || step === captureStep) {
        await fs.writeFile(path.join(outDir, `logits-${step}.f32`), new Uint8Array(actual.buffer, actual.byteOffset, actual.byteLength), { flag: 'wx' });
      }
      context.push(target.steps[step].tokenId);
    }
    // After the last step the cache holds the prompt plus the 50 forced decode tokens.
    await readCaches('cache-final', ids.length + target.steps.length - 1);
  } finally { cache?.destroy?.(); }
  report.maxDifference = Math.max(...report.steps.map(s => s.maxDifference));
  report.failedSteps = report.steps.filter(s => !s.withinTolerance).map(s => s.step);
  console.log(JSON.stringify({ label: config.label, maxDifference: report.maxDifference, failedSteps: report.failedSteps.length,
    caches: report.caches['cache-final'].map(r => [r.layer, r.keySha256.slice(0, 12), r.valueSha256.slice(0, 12)]) }));
} finally {
  await handle.unload();
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1) + '\n', { flag: 'wx' });
  destroyDevice();
  await releaseNodeWebGPU();
}
