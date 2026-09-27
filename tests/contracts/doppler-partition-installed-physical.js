/** Installed-package, same-device numerical qualification through Reploid's runner.
 * Supply DOPPLER_PARTITION_MODEL_DIR. This uses Doppler's internal session entry
 * for local model loading; it does not qualify public signed Capsule acquisition.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLayerPartitionPlan, hashLayerPartitionPlan, comparePartitionExecution,
  serializeActivationFrame, deserializeActivationFrame, LAYER_PARTITION_SCHEMA,
  ACTIVATION_TENSOR_SCHEMA } from 'doppler-gpu/partitions';
import { qualifyDopplerPartitionSessions } from './doppler-partition-session.js';

const directory = process.env.DOPPLER_PARTITION_MODEL_DIR;
if (!directory) throw new Error('Set DOPPLER_PARTITION_MODEL_DIR to the identified local model directory.');
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.resolve('doppler-gpu'))), '..');
const installed = async relative => import(pathToFileURL(path.join(packageRoot, 'src', relative)).href);
const [{ bootstrapNodeWebGPU, releaseNodeWebGPU }, { installNodeFileFetchShim },
  { initDevice, destroyDevice }, { createPipeline }, { createNodeFileArtifactStorageContext },
  { createModelHandle }, { createCapsuleProgramAdapter }, { createResidentPartitionSession },
  { resolveResidentPartitionAllocation }, { resolveGenerationOptions },
  { sampleCapsuleLogits, stoppingReason }] = await Promise.all([
  installed('tooling/node-webgpu.js'), installed('tooling/node-file-fetch.js'), installed('gpu/device.js'),
  installed('inference/pipelines/text.js'), installed('storage/artifact-storage-context.js'),
  installed('client/model-host/model-session.js'), installed('client/runtime/capsule-program-adapter.js'),
  installed('inference/pipelines/text/resident-partition.js'),
  installed('inference/pipelines/text/resident-partition-contract.js'),
  installed('config/generation-contract.js'), installed('inference/generation-step.js'),
]);
const manifestBytes = await fs.readFile(path.join(directory, 'manifest.json'));
const manifest = JSON.parse(manifestBytes);
const identity = 'sha256:' + createHash('sha256').update(manifestBytes).digest('hex');
const plan = createLayerPartitionPlan({ modelId: manifest.modelId, ...manifest.architecture,
  activationDtype: manifest.inference.session.compute.defaults.activationDtype });
const generation = resolveGenerationOptions({ maxTokens: 3, maxSeqLen: 128, temperature: 0,
  topK: 0, topP: 1, repetitionPenalty: 1.1, repetitionPenaltyWindow: 0,
  presencePenalty: 0.1, useChatTemplate: false });
const limits = { maxTokens: 3, maxPromptTokens: 64, maxActivationBytes: 1024 * 1024,
  maxOutputCharacters: 1024, maxAttempts: 16, maxConcurrentAttempts: 2 };
const model = { id: manifest.modelId, identity, generation };
const runtime = { createLayerPartitionPlan, hashLayerPartitionPlan, comparePartitionExecution,
  serializeActivationFrame, deserializeActivationFrame, LAYER_PARTITION_SCHEMA, ACTIVATION_TENSOR_SCHEMA };
const storage = createNodeFileArtifactStorageContext(pathToFileURL(path.resolve(directory)).href, manifest);
const config = { inference: { session: { kvcache: { maxSeqLen: generation.maxSeqLen } } } };
const live = new Set();
let referencePipeline;
try {
  const bootstrap = await bootstrapNodeWebGPU();
  assert(bootstrap?.ok, bootstrap?.detail || 'Node WebGPU bootstrap failed');
  installNodeFileFetchShim(); await initDevice();
  const factory = { async openResidentPartition(allocation) {
    const { signal, ...input } = allocation;
    signal.throwIfAborted();
    const selected = resolveResidentPartitionAllocation(manifest, identity,
      { ...input, generation: input.model.generation });
    const pipeline = await createPipeline(manifest, { runtimeConfig: config, storage,
      partition: { plan: selected.plan, index: selected.index } });
    const handle = createModelHandle(pipeline, { modelId: manifest.modelId, manifestHash: identity.slice(7) });
    const tokens = createCapsuleProgramAdapter(handle,
      { modelId: manifest.modelId, program: { executionGraphHash: 'installed-diagnostic' } },
      { phases: { prefill: [], decode: [] } });
    const resident = await createResidentPartitionSession(pipeline, selected, tokens, () => handle.unload());
    live.add(resident);
    return resident;
  } };
  referencePipeline = await createPipeline(manifest, { runtimeConfig: config, storage });
  const referenceHandle = createModelHandle(referencePipeline,
    { modelId: manifest.modelId, manifestHash: identity.slice(7) });
  const referenceTokens = createCapsuleProgramAdapter(referenceHandle,
    { modelId: manifest.modelId, program: { executionGraphHash: 'installed-diagnostic' } },
    { phases: { prefill: [], decode: [] } });
  const reference = async ({ model: referenceModel, messages }) => {
    const settings = referenceModel.generation;
    referencePipeline.reset();
    const input = referenceTokens.tokenize(messages, settings);
    const context = [...input], decoder = referenceTokens.createIncrementalDecoder();
    const steps = []; let content = '', cache;
    try {
      for (let step = 0; step < settings.maxTokens; step++) {
        const output = step === 0
          ? await referencePipeline.prefillWithLogits(messages, { inputIds: input, useChatTemplate: false })
          : await referencePipeline.decodeStepLogits(context, { useChatTemplate: false });
        if (step === 0) cache = output.cache;
        const tokenId = sampleCapsuleLogits(output.logits, context, settings, referenceTokens.getTokenContract());
        context.push(tokenId); content += decoder.push(tokenId);
        const reason = stoppingReason(tokenId, step + 1, settings, referenceTokens.getTokenContract(),
          () => content + decoder.pendingText());
        steps.push({ tokenId, logits: output.logits });
        if (reason) break;
      }
      content += decoder.finish();
      return { modelIdentity: identity, content, steps };
    } finally { cache?.destroy(); }
  };
  const receipt = await qualifyDopplerPartitionSessions({ factory, runtime, model, plan, limits,
    messages: [{ role: 'user', content: 'The color of the sky is' }], reference, tolerance: 1e-4 });
  const secondaryMessages = [{ role: 'user', content: 'The capital of France is' }];
  const secondary = await reference({ model, messages: secondaryMessages });
  const stoppedModel = { ...model,
    generation: resolveGenerationOptions({ ...generation, stopSequences: [' I'] }) };
  const stopped = await qualifyDopplerPartitionSessions({ factory, runtime, model: stoppedModel,
    plan, limits, messages: [{ role: 'user', content: 'The color of the sky is' }],
    reference, tolerance: 1e-4 });
  assert.equal(stopped.result.stopReason, 'stop-sequence');
  console.log(JSON.stringify({ ...receipt,
    result: { content: receipt.result.content, tokenIds: receipt.result.tokenIds,
      stopReason: receipt.result.stopReason, execution: receipt.result.execution },
    additionalReference: { modelIdentity: secondary.modelIdentity, messages: secondaryMessages,
      content: secondary.content, tokenIds: secondary.steps.map(step => step.tokenId) },
    stopSequence: { content: stopped.result.content, tokenIds: stopped.result.tokenIds,
      stopReason: stopped.result.stopReason, steps: stopped.steps },
    packageRoot, modelDirectory: path.resolve(directory),
    provider: bootstrap.receipt, actualModelInference: true, publicCapsuleAcquisition: false,
    physicalDevices: 1 }));
} finally {
  await Promise.allSettled([...live].map(resident => resident.close()));
  await referencePipeline?.unload();
  destroyDevice(); await releaseNodeWebGPU();
}
