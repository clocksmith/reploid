/** Host composition of Doppler's pinned manifest and selectively verified pieces. */
import { createResidentPartition } from '../vendor/reploid/mesh/index.js';
import { DOPPLER_PARTITIONS_MODULE_URL, DOPPLER_KERNEL_BASE_URL } from '../config/doppler-local-models.js';
import profile from '../config/work-profile.json' with { type: 'json' };
import { resolveGenerationOptions } from '../config/doppler-generation-contract.js';
import policy from '../config/partition-policy.json' with { type: 'json' };

export async function loadWorkPartition(files, selected, index, { signal, participantId, onProgress }) {
  const openedAt = performance.now();
  globalThis.__DOPPLER_KERNEL_BASE_PATH__ = DOPPLER_KERNEL_BASE_URL;
  const runtime = await import(DOPPLER_PARTITIONS_MODULE_URL);
  await runtime.configureDeviceMemoryBudget({ maxBytes: policy.maxGpuBufferBytes });
  const acquisitionStarted = performance.now();
  const source = await files.preparePartitionSource(selected, { signal, onProgress });
  const manifest = source.manifest;
  let resident = null;
  try {
    signal?.throwIfAborted();
    const plan = runtime.createLayerPartitionPlan({ modelId: manifest.modelId, ...manifest.architecture,
      splitLayer: selected.partitionSplitLayer,
      activationDtype: manifest.inference.session.compute.defaults.activationDtype });
    const planId = runtime.hashLayerPartitionPlan(plan);
    const model = { ...selected, generation: resolveGenerationOptions({ ...profile.generation, ...policy.generation, maxSeqLen: policy.maxSeqLen }) };
    const factory = runtime.createManifestResidentPartitionFactory({ manifest, manifestIdentity: model.identity,
      runtimeConfig: { shared: { bufferPool: policy.bufferPool, debug: { profiler: { enabled: policy.profileGpu } } },
        inference: { session: { kvcache: { maxSeqLen: policy.maxSeqLen },
          prefillChunkLayers: policy.prefillChunkLayers, prefillTokenChunkSize: policy.prefillTokenChunkSize } } },
      createStorage: async () => source.storage });
    resident = createResidentPartition({ runtime: factory, model, plan, planId, index,
      participantId, limits: policy.limits });
    await resident.prepare({ approved: true, signal });
    const preparation = { openMs: performance.now() - openedAt,
      acquisitionAndMaterializationMs: performance.now() - acquisitionStarted,
      memoryAtOpen: runtime.inspectDeviceMemory() };
    return { runtime, model, plan, planId, resident,
      getReceipt: () => ({ ...source.getReceipt(), preparation, memory: runtime.inspectDeviceMemory() }) };
  } catch (error) {
    const failures = [error];
    try { await resident?.close(); } catch (cleanup) { failures.push(cleanup); }
    try { await source.storage.close(); } catch (cleanup) { failures.push(cleanup); }
    if (failures.length > 1) throw new AggregateError(failures, 'Partition opening and cleanup failed');
    throw error;
  }
}
