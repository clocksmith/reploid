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

/** Host stage identity is explicit; discovery cannot invent a resident session. */
export function snapshotWorkPartitionStage(selected, index, participantId, ordered, canonical) {
  const isOrdered = selected.partitionPlan?.schema === 'doppler.layer-partition-contract/v3';
  if (!isOrdered && !ordered) return null;
  const stage = ordered?.stage;
  if (!isOrdered || canonical || !stage || !Number.isSafeInteger(index) || index < 0
    || index >= selected.partitionPlan.stageCount || stage.index !== index || stage.participantId !== participantId
    || !['participantId', 'transportId', 'residentId', 'executionId'].every(key => typeof stage[key] === 'string' && stage[key].length > 0)
    || Object.keys(stage).some(key => !['index', 'participantId', 'transportId', 'residentId', 'executionId'].includes(key))) {
    throw new Error('Ordered contribution requires an explicit matching host stage and ordinary execution');
  }
  return freezeJson(structuredClone(stage));
}

export function workOrderedResidentOptions(runtime, stage) {
  if (!stage) return {};
  if (runtime.ORDERED_LAYER_PARTITION_SCHEMA !== 'doppler.layer-partition-contract/v3'
    || !['validateOrderedLayerPartitionPlan', 'resolveLayerPartition', 'hashLayerPartitionPlan',
      'hashPartitionGeneration', 'getPartitionActivationContract'].every(key => typeof runtime[key] === 'function')) {
    throw new Error('Installed Doppler does not support the ordered resident contract');
  }
  return { ordered: { runtime, stage } };
}

export function createWorkPartitionPlan(runtime, manifest, selected, index = 0) {
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
  if (plan.schema === 'doppler.layer-partition-contract/v3') {
    if (runtime.ORDERED_LAYER_PARTITION_SCHEMA !== plan.schema
      || typeof runtime.validateOrderedLayerPartitionPlan !== 'function') {
      throw new Error('Installed Doppler does not support the declared ordered plan');
    }
    runtime.validateOrderedLayerPartitionPlan(plan);
  }
  runtime.resolveLayerPartition(manifest, { plan, index });
  partitionActivationContract(runtime, plan);
  return plan;
}
