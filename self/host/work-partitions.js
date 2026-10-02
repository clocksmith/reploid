/** Host composition of Doppler's pinned manifest and selectively verified pieces. */
import { createResidentPartition } from '../vendor/reploid/mesh/index.js';
import { DOPPLER_PARTITIONS_MODULE_URL, DOPPLER_KERNEL_BASE_URL } from '../config/doppler-local-models.js';
import profile from '../config/work-profile.json' with { type: 'json' };
import policy from '../config/partition-policy.json' with { type: 'json' };

export async function loadWorkPartition(files, selected, index, { signal, participantId, onProgress }) {
  globalThis.__DOPPLER_KERNEL_BASE_PATH__ = DOPPLER_KERNEL_BASE_URL;
  const runtime = await import(DOPPLER_PARTITIONS_MODULE_URL);
  const source = await files.preparePartitionSource(selected, { signal, onProgress });
  const manifest = source.manifest;
  const plan = runtime.createLayerPartitionPlan({ modelId: manifest.modelId, ...manifest.architecture,
    activationDtype: manifest.inference.session.compute.defaults.activationDtype });
  const planId = runtime.hashLayerPartitionPlan(plan);
  const model = { ...selected, generation: { ...profile.generation, ...policy.generation, maxSeqLen: policy.maxSeqLen } };
  const factory = runtime.createManifestResidentPartitionFactory({ manifest, manifestIdentity: model.identity,
    runtimeConfig: { inference: { session: { kvcache: { maxSeqLen: policy.maxSeqLen } } } },
    createStorage: async () => source.storage });
  const resident = createResidentPartition({ runtime: factory, model, plan, planId, index,
    participantId, limits: policy.limits });
  try {
    await resident.prepare({ approved: true, signal });
    return { runtime, model, plan, planId, resident, getReceipt: source.getReceipt };
  } catch (error) { await resident.close(); await source.storage.close(); throw error; }
}
