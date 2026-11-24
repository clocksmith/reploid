import { randomUUID } from 'node:crypto';
import { snapshotWorkPartitionSelection, createWorkPartitionPlan, snapshotWorkPartitionStage, workOrderedResidentOptions } from '../apps/poolday/host/work-partition-plan.js';
import { resolvePartitionGeneration } from '../apps/poolday/config/partition-generation.js';
import policy from '../apps/poolday/config/partition-policy.json' with { type: 'json' };
import { createPartitionPreparationOwner } from '../shared/vendor/reploid/mesh/partitions/preparation-owner.js';
import { createPartitionTokenizerGuard } from '../apps/poolday/host/work-partition-tokenizer-guard.js';
import { createResidentPartition, createSignedResidentFactory, createPartitionStageCommitAuthority, residentPreparationProgress } from '../shared/vendor/reploid/mesh/index.js';
import { prepareLocalPackRelease } from '../apps/poolday/pool/pack-release-policy.js';
import { openNativeReleaseCheckpoints } from './native-release-storage.js';
import { assertWorkResidentCapsule } from '../apps/poolday/host/work-partition-capsule.js';
import { createModelAdapterResolver } from '../shared/vendor/reploid/adapters/model-adapter.js';
import { requireValue } from './native-host-utils.js';
import { openNativeModelSource } from './native-model-source.js';
import { withGpuMemoryCheck } from './native-gpu-host.js';

export async function openNativePartition({ model: selected, modelDirectory, nativeGpu, index, signal, participantId,
  files, releaseDirectory, registerCleanup, canonical = null, ordered = null, device = null, attemptBytes, onProgress = () => {},
  gpuBufferBytes, evidenceSigner = null, onEvidence = null, shaderCache = null, resolveSource = null, sourceRuntime = null }) {
  selected = snapshotWorkPartitionSelection(selected);
  const stageBinding = snapshotWorkPartitionStage(selected, index, participantId, ordered, canonical);
  if (selected.capsule !== undefined) requireValue(files && selected.packOpenOptions && selected.executablePack && releaseDirectory,
    'Signed native resident requires release policy, checkpoint directory and pinned artifact source');
  const configured = { ...selected, generation: resolvePartitionGeneration(selected) };
  if (sourceRuntime !== null) {
    requireValue(selected.capsule === undefined && !files && resolveSource === null && !canonical,
      'Explicit source runtime cannot replace signed, canonical or custody-backed partition loading');
    requireValue(sourceRuntime.runtime && sourceRuntime.gather && typeof sourceRuntime.assertCurrent === 'function',
      'Explicit source runtime requires its selected runtime, gather policy and identity recheck');
    signal.throwIfAborted();
    await sourceRuntime.assertCurrent();
    signal.throwIfAborted();
  }
  const runtime = sourceRuntime === null ? await import('dopplerx/partitions') : sourceRuntime.runtime;
  const orderedOptions = workOrderedResidentOptions(runtime, stageBinding);
  if (canonical) {
    requireValue(typeof runtime.canonicalGenerationIdentity === 'function' && selected.canonicalGeneration
      && canonical.identity?.peerId === participantId && canonical.participantEpoch === canonical.epochs?.participantEpoch,
    'Canonical native contribution requires declared generation, provider capability and durable epochs');
    canonical.epochs.assertCurrent();
  }
  const gpu = await nativeGpu(); signal.throwIfAborted();
  await runtime.configureDeviceMemoryBudget({ maxBytes: gpuBufferBytes ?? selected.partitionRuntime?.maxGpuBufferBytes?.[index] ?? policy.maxGpuBufferBytes });
  const source = await openNativeModelSource({ model: selected, modelDirectory, signal, runtime, files, resolveSource,
    gather: sourceRuntime?.gather ?? null });
  let resident, release = null, capsuleVerification = null, commitAuthority = null;
  const ownerId = canonical ? randomUUID().replaceAll('-', '') : null;
  let ownershipRecorded = false;
  const cleanupOwner = createPartitionPreparationOwner({ source, registerCleanup,
    errorMessage: 'Native preparation cleanup failed',
    onSettled() { if (ownershipRecorded) { canonical.epochs.settle(ownerId); ownershipRecorded = false; } } });
  const { closeSources, trackSession } = cleanupOwner;
  const tokenizer = createPartitionTokenizerGuard(source.storage);
  const onLoadProgress = event => { const progress = residentPreparationProgress(event); if (progress) onProgress(progress); };
  try {
    signal.throwIfAborted();
    const manifest = source.manifest;
    const plan = createWorkPartitionPlan(runtime, manifest, selected, index);
    const planId = runtime.hashLayerPartitionPlan(plan);
    let canonicalOptions = {};
    if (canonical) {
      canonical.epochs.assertCurrent();
      const generation = runtime.canonicalGenerationIdentity(selected.canonicalGeneration.policy,
        selected.canonicalGeneration.executionIdentity, plan.vocabSize);
      const stage = { participantId, participantEpoch: canonical.participantEpoch,
        deviceEpoch: randomUUID().replaceAll('-', ''), residentId: randomUUID(), partitionIndex: index,
        executionId: generation.executionIdentity };
      stage.stageId = runtime.metadataDigest('reploid.partition-resident-stage/v1', { modelIdentity: selected.identity, planId, ...stage });
      commitAuthority = createPartitionStageCommitAuthority({ runtime, identity: canonical.identity, stage });
      cleanupOwner.commitAuthority = commitAuthority;
      canonicalOptions = { canonicalGeneration: selected.canonicalGeneration, canonicalRuntime: runtime,
        canonicalCommitAuthority: { getStage: () => { canonical.epochs.assertCurrent(); return commitAuthority.getStage(); },
          async sign(request) { canonical.epochs.assertCurrent(); const result = await commitAuthority.sign(request); canonical.epochs.assertCurrent(); return result; },
          close: () => commitAuthority.close() } };
    }
    let factory;
    if (selected.capsule !== undefined) {
      requireValue(source.artifactStore, 'Signed native resident requires a pinned artifact source');
      release = await prepareLocalPackRelease({ model: configured,
        openCheckpoints: () => openNativeReleaseCheckpoints({ directory: releaseDirectory }) });
      cleanupOwner.release = release;
      const { openCapsule } = await import('dopplerx/host');
      factory = createSignedResidentFactory({ createFactory: runtime.createResidentPartitionFactory,
        openCapsule, model: configured, artifactStore: source.artifactStore, release,
        assertSession: assertWorkResidentCapsule, closeSources, trackSession, canonical: !!canonical,
        onVerification: value => { capsuleVerification = value; }, onLoadProgress });
    } else factory = runtime.createManifestResidentPartitionFactory({ resolveAdapter: createModelAdapterResolver({ models: [selected], acquire: files?.acquireAdapter }), manifest, manifestIdentity: selected.identity, onLoadProgress,
      runtimeConfig: selected.partitionRuntime?.runtimeConfig ?? { shared: { bufferPool: policy.bufferPool, debug: { profiler: { enabled: policy.profileGpu } } },
        inference: { session: { kvcache: { maxSeqLen: configured.generation.maxSeqLen },
          prefillChunkLayers: policy.prefillChunkLayers, prefillTokenChunkSize: policy.prefillTokenChunkSize } } },
      createStorage: async () => tokenizer.storage });
    resident = createResidentPartition({ runtime: factory, model: configured, plan, planId, index, participantId,
      limits: policy.limits, onEvidence, ...canonicalOptions, ...orderedOptions, ...(device ? { device, attemptBytes } : {}),
      // Ordered stages sign receipts for charged attempts with this host's participant identity.
      ...(orderedOptions.ordered && evidenceSigner?.participantId === participantId ? { evidence: evidenceSigner } : {}) });
    cleanupOwner.resident = resident;
    onProgress({ stage: 'opening', message: 'Opening native assigned partition' });
    if (canonical) { canonical.epochs.begin(ownerId); ownershipRecorded = true; }
    const prepared = await withGpuMemoryCheck(gpu, () => resident.prepare({ approved: true, signal }));
    tokenizer.assertAvailable();
    // A complete preparation lets the process seal its shader cache; the outcome is reported, never thrown.
    shaderCache?.seal({ ...prepared?.descriptor?.pipelinePreparation, planId, index, modelIdentity: selected.identity });
    const bindCanonicalMethod = (name, value) => {
      if (typeof value !== 'function') return value;
      if (name === 'close') return () => cleanupOwner.close();
      if (name === 'closeAttempt') return (...args) => value(...args);
      return (...args) => {
          canonical.epochs.assertCurrent(); const result = value(...args);
          if (result?.then) return result.then(output => { canonical.epochs.assertCurrent(); return output; });
          canonical.epochs.assertCurrent(); return result;
      };
    };
    return { runtime, model: configured, plan, planId, resident: canonical ? Object.freeze(Object.fromEntries(
      Object.entries(resident).map(([name, value]) => [name, bindCanonicalMethod(name, value)]))) : resident,
      getGatherReceipt: source.getGatherReceipt ?? null,
      getReceipt: () => ({ ...(selected.capsule === undefined ? source.getReceipt() : { sourceAcquisition: source.getReceipt() }),
        ...(sourceRuntime ? { runtimeSource: sourceRuntime.receipt, workerGather: sourceRuntime.gather } : {}),
        host: 'node', openingMode: selected.capsule === undefined ? 'pinned-manifest' : 'signed-capsule',
        capsuleVerification, memory: runtime.inspectDeviceMemory() }) };
  } catch (error) {
    const openingError = tokenizer.explain(error);
    const failures = [openingError];
    try { await cleanupOwner.close(); } catch (cleanup) { failures.push(cleanup); }
    if (failures.length > 1) throw new AggregateError(failures, 'Native opening and cleanup failed');
    throw openingError;
  }
}
