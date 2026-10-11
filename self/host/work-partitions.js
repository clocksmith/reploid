/** Host composition of explicit manifest or signed Capsule residents and verified pieces. */
import { createResidentPartition } from '../vendor/reploid/mesh/index.js';
import { DOPPLER_MODULE_URL, DOPPLER_PARTITIONS_MODULE_URL, DOPPLER_KERNEL_BASE_URL } from '../config/doppler-local-models.js';
import profile from '../config/work-profile.json' with { type: 'json' };
import { resolveGenerationOptions } from '../config/doppler-generation-contract.js';
import policy from '../config/partition-policy.json' with { type: 'json' };
import { prepareLocalPackRelease } from '../pool/pack-release-policy.js';
import { assertWorkResidentCapsule } from './work-partition-capsule.js';

export async function loadWorkPartition(files, selected, index, { signal, participantId, onProgress }) {
  const openedAt = performance.now();
  globalThis.__DOPPLER_KERNEL_BASE_PATH__ = DOPPLER_KERNEL_BASE_URL;
  const runtime = await import(DOPPLER_PARTITIONS_MODULE_URL);
  await runtime.configureDeviceMemoryBudget({ maxBytes: policy.maxGpuBufferBytes });
  const acquisitionStarted = performance.now();
  const source = await files.preparePartitionSource(selected, { signal, onProgress });
  const manifest = source.manifest;
  let resident = null, release = null, capsuleVerification = null;
  let sourceSettled = false, releaseSettled = false;
  const closeSources = async failures => {
    if (!sourceSettled) {
      sourceSettled = true;
      try { await source.storage.close(); } catch (error) { failures.push(error); }
    }
    if (release && !releaseSettled) {
      releaseSettled = true;
      try { await release.close(); } catch (error) { failures.push(error); }
    }
  };
  try {
    signal?.throwIfAborted();
    const plan = runtime.createLayerPartitionPlan({ modelId: manifest.modelId, ...manifest.architecture,
      splitLayer: selected.partitionSplitLayer,
      activationDtype: manifest.inference.session.compute.defaults.activationDtype });
    const planId = runtime.hashLayerPartitionPlan(plan);
    const model = { ...selected, generation: resolveGenerationOptions({ ...profile.generation, ...policy.generation, maxSeqLen: policy.maxSeqLen }) };
    let factory;
    if (selected.capsule !== undefined) {
      if (!source.artifactStore || !selected.packOpenOptions || !selected.executablePack) {
        throw new Error('Signed resident requires an explicit Capsule, release policy and pinned artifact source');
      }
      release = await prepareLocalPackRelease({ model });
      const { openCapsule } = await import(DOPPLER_MODULE_URL);
      factory = runtime.createResidentPartitionFactory({ capsuleOptions: { ...release.options, artifactStore: source.artifactStore },
        async openCapsule(capsule, options) {
          const session = await openCapsule(capsule, options);
          try {
            await assertWorkResidentCapsule(model, session);
            await release.assertCurrent(session);
            capsuleVerification = session.verification;
            const partition = session.residentPartition;
            if (!partition) throw new Error('Capsule opener did not return a qualified resident');
            let closing = null;
            const invoke = async (method, request) => {
              await release.assertCurrent(session);
              const failures = []; let result;
              try { result = await partition[method](request); } catch (error) { failures.push(error); }
              try { await release.assertCurrent(session); } catch (error) { failures.push(error); }
              if (failures.length === 1) throw failures[0];
              if (failures.length) throw new AggregateError(failures, 'Resident computation and authorization failed');
              return result;
            };
            return { ...session, residentPartition: Object.freeze({ ...partition,
              tokenize: request => invoke('tokenize', request),
              executeGroup0: request => invoke('executeGroup0', request),
              executeGroup1: request => invoke('executeGroup1', request),
              close() {
                if (!closing) closing = (async () => {
                  const failures = [];
                  try { await session.close(); } catch (error) { failures.push(error); }
                  await closeSources(failures);
                  if (failures.length) throw new AggregateError(failures, 'Signed resident cleanup failed');
                })();
                return closing;
              }
            }) };
          } catch (error) {
            try { await session.close(); } catch (cleanup) {
              throw new AggregateError([error, cleanup], 'Signed resident admission and cleanup failed');
            }
            throw error;
          }
        } });
    } else factory = runtime.createManifestResidentPartitionFactory({ manifest, manifestIdentity: model.identity,
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
      getReceipt: () => ({ ...(selected.capsule === undefined ? source.getReceipt() : { sourceAcquisition: source.getReceipt() }),
        preparation, memory: runtime.inspectDeviceMemory(),
        openingMode: selected.capsule === undefined ? 'pinned-manifest' : 'signed-capsule', capsuleVerification }) };
  } catch (error) {
    const failures = [error];
    try { await resident?.close(); } catch (cleanup) { failures.push(cleanup); }
    await closeSources(failures);
    if (failures.length > 1) throw new AggregateError(failures, 'Partition opening and cleanup failed');
    throw error;
  }
}
