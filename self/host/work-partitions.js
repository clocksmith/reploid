/** Host composition of explicit manifest or signed Capsule residents and verified pieces. */
import { createResidentPartition } from '../vendor/reploid/mesh/index.js';
import { DOPPLER_MODULE_URL, DOPPLER_PARTITIONS_MODULE_URL, DOPPLER_KERNEL_BASE_URL } from '../config/doppler-local-models.js';
import { resolvePartitionGeneration } from '../config/partition-generation.js';
import policy from '../config/partition-policy.json' with { type: 'json' };
import { prepareLocalPackRelease } from '../pool/pack-release-policy.js';
import { assertWorkResidentCapsule } from './work-partition-capsule.js';
import { createSignedResidentFactory } from '../vendor/reploid/mesh/partitions/signed-resident-factory.js';
import { createPartitionTokenizerGuard } from './work-partition-tokenizer-guard.js';

export async function loadWorkPartition(files, selected, index, { signal, participantId, onProgress, registerCleanup }) {
  const model = { ...selected, generation: resolvePartitionGeneration(selected) };
  const openedAt = performance.now();
  globalThis.__DOPPLER_KERNEL_BASE_PATH__ = DOPPLER_KERNEL_BASE_URL;
  const runtime = await import(DOPPLER_PARTITIONS_MODULE_URL);
  await runtime.configureDeviceMemoryBudget({ maxBytes: policy.maxGpuBufferBytes });
  const acquisitionStarted = performance.now();
  const source = await files.preparePartitionSource(selected, { signal, onProgress });
  const manifest = source.manifest;
  let resident = null, release = null, capsuleVerification = null;
  let sourceSettled = false, releaseSettled = false;
  const sessions = new Set();
  const trackSession = session => { sessions.add(session); return () => sessions.delete(session); };
  const closeSources = async failures => {
    if (!sourceSettled) {
      try { await source.storage.close(); sourceSettled = true; } catch (error) { failures.push(error); }
    }
    if (release && !releaseSettled) {
      try { await release.close(); releaseSettled = true; } catch (error) { failures.push(error); }
    }
  };
  let cleaning = null;
  const cleanupOwner = { close() {
    return cleaning ||= (async () => {
      const failures = [];
      try { await resident?.close(); } catch (error) { failures.push(error); }
      for (const session of sessions) {
        try { await session.close(); sessions.delete(session); } catch (error) { failures.push(error); }
      }
      await closeSources(failures);
      if (failures.length === 1) throw failures[0];
      if (failures.length) throw new AggregateError(failures, 'Partition preparation cleanup failed');
      releaseCleanup?.();
    })().catch(error => { cleaning = null; throw error; });
  } };
  const releaseCleanup = registerCleanup?.(cleanupOwner);
  const tokenizer = createPartitionTokenizerGuard(source.storage);
  try {
    signal?.throwIfAborted();
    const plan = runtime.createLayerPartitionPlan({ modelId: manifest.modelId, ...manifest.architecture,
      splitLayer: selected.partitionSplitLayer,
      activationDtype: manifest.inference.session.compute.defaults.activationDtype });
    const planId = runtime.hashLayerPartitionPlan(plan);
    let factory;
    if (selected.capsule !== undefined) {
      if (!source.artifactStore || !selected.packOpenOptions || !selected.executablePack) {
        throw new Error('Signed resident requires an explicit Capsule, release policy and pinned artifact source');
      }
      release = await prepareLocalPackRelease({ model });
      const { openCapsule } = await import(DOPPLER_MODULE_URL);
      factory = createSignedResidentFactory({ createFactory: runtime.createResidentPartitionFactory,
        openCapsule, model, artifactStore: source.artifactStore, release,
        assertSession: assertWorkResidentCapsule, closeSources, trackSession,
        onVerification: value => { capsuleVerification = value; } });
    } else factory = runtime.createManifestResidentPartitionFactory({ manifest, manifestIdentity: model.identity,
      runtimeConfig: { shared: { bufferPool: policy.bufferPool, debug: { profiler: { enabled: policy.profileGpu } } },
        inference: { session: { kvcache: { maxSeqLen: model.generation.maxSeqLen },
          prefillChunkLayers: policy.prefillChunkLayers, prefillTokenChunkSize: policy.prefillTokenChunkSize } } },
      createStorage: async () => tokenizer.storage });
    resident = createResidentPartition({ runtime: factory, model, plan, planId, index,
      participantId, limits: policy.limits });
    await resident.prepare({ approved: true, signal });
    tokenizer.assertAvailable();
    const preparation = { openMs: performance.now() - openedAt,
      acquisitionAndMaterializationMs: performance.now() - acquisitionStarted,
      memoryAtOpen: runtime.inspectDeviceMemory() };
    return { runtime, model, plan, planId, resident,
      getReceipt: () => ({ ...(selected.capsule === undefined ? source.getReceipt() : { sourceAcquisition: source.getReceipt() }),
        preparation, memory: runtime.inspectDeviceMemory(),
        openingMode: selected.capsule === undefined ? 'pinned-manifest' : 'signed-capsule', capsuleVerification }) };
  } catch (error) {
    const openingError = tokenizer.explain(error);
    const failures = [openingError];
    try { await cleanupOwner.close(); } catch (cleanup) { failures.push(cleanup); }
    if (failures.length > 1) throw new AggregateError(failures, 'Partition opening and cleanup failed');
    throw openingError;
  }
}
