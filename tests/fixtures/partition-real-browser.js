/** Real local model loading for the existing two-tab partition coordinator.
 * This diagnostic uses installed Doppler internals, not signed Capsule opening.
 */
import * as runtime from '/vendor/doppler/0.6.3-dev.split.1/src/partitions.js';
import { createPipeline } from '/vendor/doppler/0.6.3-dev.split.1/src/inference/pipelines/text.js';
import { createHttpArtifactStorageContext } from '/vendor/doppler/0.6.3-dev.split.1/src/storage/artifact-storage-context.js';
import { createModelHandle } from '/vendor/doppler/0.6.3-dev.split.1/src/client/model-host/model-session.js';
import { createCapsuleProgramAdapter } from '/vendor/doppler/0.6.3-dev.split.1/src/client/runtime/capsule-program-adapter.js';
import { createResidentPartitionSession } from '/vendor/doppler/0.6.3-dev.split.1/src/inference/pipelines/text/resident-partition.js';
import { resolveResidentPartitionAllocation } from '/vendor/doppler/0.6.3-dev.split.1/src/inference/pipelines/text/resident-partition-contract.js';
import { start } from '/partition-browser-fixture.js';

export async function startReal(index) {
  const response = await fetch('/partition-model/manifest.json');
  if (!response.ok) throw new Error('Local model manifest is unavailable.');
  const bytes = await response.arrayBuffer();
  const manifest = JSON.parse(new TextDecoder().decode(bytes));
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  const modelIdentity = 'sha256:' + digest;
  const plan = runtime.createLayerPartitionPlan({ modelId: manifest.modelId, ...manifest.architecture,
    activationDtype: manifest.inference.session.compute.defaults.activationDtype });
  const generation = { maxTokens: 3, maxSeqLen: 128, temperature: 0, topK: 0, topP: 1,
    repetitionPenalty: 1.1, repetitionPenaltyWindow: 0, presencePenalty: 0.1,
    useChatTemplate: false };
  const policy = { maxTokens: 3, maxPromptTokens: 64, maxActivationBytes: 1024 * 1024,
    maxOutputCharacters: 1024, maxAttempts: 16, maxConcurrentAttempts: 2 };
  const channelLimits = { maxFrameBytes: 16 * 1024, maxControlBytes: 8192,
    maxPayloadBytes: policy.maxActivationBytes, maxPendingBytes: 2 * policy.maxActivationBytes,
    maxPendingRequests: 8, maxRequestsPerChannel: 512, maxBufferedBytes: policy.maxActivationBytes,
    maxTransferBytes: 4 * policy.maxActivationBytes, timeoutMs: 30000 };
  const model = { id: manifest.modelId, name: 'Gemma 3 270M F16 split diagnostic',
    provider: 'doppler', identity: modelIdentity, generation, adapters: [] };
  const storage = createHttpArtifactStorageContext(new URL('/partition-model', location.href).href, manifest);
  const config = { inference: { session: { kvcache: { maxSeqLen: generation.maxSeqLen } } } };
  const log = { opens: [], closes: [] };
  let hold = null;
  const factory = { log,
    get entered() { return hold?.entered ?? false; },
    holdNext() {
      if (hold) throw new Error('A resident step is already held.');
      let release;
      const promise = new Promise(resolve => { release = resolve; });
      hold = { promise, release, entered: false };
    },
    release() { hold?.release(); hold = null; },
    async openResidentPartition(allocation) {
    const { signal, ...input } = allocation;
    signal.throwIfAborted();
    const selected = resolveResidentPartitionAllocation(manifest, modelIdentity,
      { ...input, generation: input.model.generation });
    const pipeline = await createPipeline(manifest, { runtimeConfig: config, storage,
      partition: { plan: selected.plan, index: selected.index } });
    const handle = createModelHandle(pipeline, { modelId: manifest.modelId, manifestHash: digest });
    const tokens = createCapsuleProgramAdapter(handle,
      { modelId: manifest.modelId, program: { executionGraphHash: 'browser-diagnostic' } },
      { phases: { prefill: [], decode: [] } });
    const resident = await createResidentPartitionSession(pipeline, selected, tokens, () => handle.unload());
    log.opens.push(index);
    return { ...resident,
      async executeGroup1(request) {
        if (index === 1 && hold) {
          const waiting = hold; waiting.entered = true;
          await waiting.promise;
        }
        return resident.executeGroup1(request);
      },
      async close() { factory.release(); await resident.close(); log.closes.push(index); } };
  } };
  return start(index, { model, plan, policy, factory, channelLimits });
}
