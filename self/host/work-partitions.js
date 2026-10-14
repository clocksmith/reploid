/** Host composition of explicit manifest or signed Capsule residents and verified pieces. */
import { createResidentPartition, createPartitionStageCommitAuthority } from '../vendor/reploid/mesh/index.js';
import { DOPPLER_MODULE_URL, DOPPLER_PARTITIONS_MODULE_URL, DOPPLER_KERNEL_BASE_URL } from '../config/doppler-local-models.js';
import { resolvePartitionGeneration } from '../config/partition-generation.js';
import policy from '../config/partition-policy.json' with { type: 'json' };
import { prepareLocalPackRelease } from '../pool/pack-release-policy.js';
import { assertWorkResidentCapsule } from './work-partition-capsule.js';
import { createSignedResidentFactory } from '../vendor/reploid/mesh/partitions/signed-resident-factory.js';
import { residentPreparationProgress } from '../vendor/reploid/mesh/partitions/partition-preparation-progress.js';
import { snapshotWorkPartitionSelection, createWorkPartitionPlan,
  snapshotWorkPartitionStage, workOrderedResidentOptions } from './work-partition-plan.js';
import { createPartitionTokenizerGuard } from './work-partition-tokenizer-guard.js';

export async function loadWorkPartition(files, selected, index, { signal, participantId, onProgress, registerCleanup, canonical = null, ordered = null,
  device = null, attemptBytes }) {
  canonical = canonical ? Object.freeze({ identity: canonical.identity, participantEpoch: canonical.participantEpoch }) : null;
  selected = snapshotWorkPartitionSelection(selected);
  const stage = snapshotWorkPartitionStage(selected, index, participantId, ordered, canonical);
  const model = { ...selected, generation: resolvePartitionGeneration(selected) };
  const openedAt = performance.now();
  globalThis.__DOPPLER_KERNEL_BASE_PATH__ = DOPPLER_KERNEL_BASE_URL;
  const runtime = await import(DOPPLER_PARTITIONS_MODULE_URL);
  const orderedOptions = workOrderedResidentOptions(runtime, stage);
  if (canonical && (typeof runtime.canonicalGenerationIdentity !== 'function'
    || canonical.identity?.peerId !== participantId || !/^[a-f0-9]{32}$/.test(canonical.participantEpoch)
    || !selected.canonicalGeneration)) throw new Error('Canonical contribution requires declared generation and provider capability');
  await runtime.configureDeviceMemoryBudget({ maxBytes: policy.maxGpuBufferBytes });
  const acquisitionStarted = performance.now();
  const source = await files.preparePartitionSource(selected, { signal, onProgress });
  const manifest = source.manifest;
  let resident = null, release = null, capsuleVerification = null, commitAuthority = null;
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
      const failures = []; commitAuthority?.close();
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
  const onLoadProgress = event => { const progress = residentPreparationProgress(event); if (progress) onProgress?.(progress); };
  try {
    signal?.throwIfAborted();
    const plan = createWorkPartitionPlan(runtime, manifest, selected, index);
    const planId = runtime.hashLayerPartitionPlan(plan);
    let canonicalOptions = {};
    if (canonical) {
      const generation = runtime.canonicalGenerationIdentity(selected.canonicalGeneration.policy,
        selected.canonicalGeneration.executionIdentity, plan.vocabSize);
      const stage = { participantId, participantEpoch: canonical.participantEpoch,
        deviceEpoch: crypto.randomUUID().replaceAll('-', ''), residentId: crypto.randomUUID(), partitionIndex: index,
        executionId: generation.executionIdentity };
      stage.stageId = runtime.metadataDigest('reploid.partition-resident-stage/v1', { modelIdentity: model.identity, planId, ...stage });
      commitAuthority = createPartitionStageCommitAuthority({ runtime, identity: canonical.identity, stage });
      canonicalOptions = { canonicalGeneration: selected.canonicalGeneration, canonicalRuntime: runtime, canonicalCommitAuthority: commitAuthority };
    }
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
        canonical: !!canonical, onVerification: value => { capsuleVerification = value; }, onLoadProgress });
    } else factory = runtime.createManifestResidentPartitionFactory({ manifest, manifestIdentity: model.identity, onLoadProgress,
      runtimeConfig: { shared: { bufferPool: policy.bufferPool, debug: { profiler: { enabled: policy.profileGpu } } },
        inference: { session: { kvcache: { maxSeqLen: model.generation.maxSeqLen },
          prefillChunkLayers: policy.prefillChunkLayers, prefillTokenChunkSize: policy.prefillTokenChunkSize } } },
      createStorage: async () => tokenizer.storage });
    resident = createResidentPartition({ runtime: factory, model, plan, planId, index,
      participantId, limits: policy.limits, ...canonicalOptions, ...orderedOptions, ...(device ? { device, attemptBytes } : {}) });
    await resident.prepare({ approved: true, signal });
    tokenizer.assertAvailable();
    const preparation = { openMs: performance.now() - openedAt,
      acquisitionAndMaterializationMs: performance.now() - acquisitionStarted,
      memoryAtOpen: runtime.inspectDeviceMemory() };
    return { runtime, model, plan, planId, resident: canonical ? Object.freeze({ ...resident,
      close() { commitAuthority.close(); return resident.close(); } }) : resident,
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
