/** Hosts carry an explicit Doppler plan; Doppler validates its geometry and storage. */
import { freezeJson } from '../vendor/reploid/config/index.js';
import { partitionActivationContract } from '../vendor/reploid/mesh/partitions/partition-contract.js';

export function snapshotWorkPartitionSelection(selected) {
  if (selected.partitionPlan === undefined) return selected;
  const plan = selected.partitionPlan;
  if (!plan || plan.modelId !== selected.id
    || selected.partitionSplitLayer !== undefined && plan.splitLayer !== selected.partitionSplitLayer) {
    throw new Error('Declared partition plan differs from the selected model or split');
  }
  return { ...selected, partitionPlan: freezeJson(structuredClone(plan)) };
}

export function createWorkPartitionPlan(runtime, manifest, selected) {
  selected = snapshotWorkPartitionSelection(selected);
  if (selected.partitionPlan === undefined) {
    return runtime.createLayerPartitionPlan({ modelId: manifest.modelId, ...manifest.architecture,
      splitLayer: selected.partitionSplitLayer,
      activationDtype: manifest.inference.session.compute.defaults.activationDtype });
  }
  if (manifest.modelId !== selected.id || typeof runtime.resolveLayerPartition !== 'function') {
    throw new Error('Declared partition plan requires the matching manifest and Doppler plan validator');
  }
  const plan = selected.partitionPlan;
  runtime.resolveLayerPartition(manifest, { plan, index: 0 });
  partitionActivationContract(runtime, plan);
  return plan;
}
