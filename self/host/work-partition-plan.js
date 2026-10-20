/** Hosts carry an explicit Doppler plan; Doppler validates its geometry and storage. */
import { freezeJson } from '../vendor/reploid/config/index.js';
import { partitionActivationContract } from '../vendor/reploid/mesh/partitions/partition-contract.js';
import { validateRouteCostPolicy } from '../vendor/reploid/mesh/partitions/partition-route-ranking.js';
import { selectWorkAdapters } from '../providers/work-adapter.js';
import partitionPolicy from '../config/partition-policy.json' with { type: 'json' };

export function snapshotWorkPartitionSelection(selected) {
  const adapters = selectWorkAdapters(selected);
  selected = { ...selected, adapters };
  if (selected.partitionPlan === undefined) return selected;
  const plan = selected.partitionPlan;
  if (!plan || plan.modelId !== selected.id
    || selected.partitionSplitLayer !== undefined && plan.splitLayer !== selected.partitionSplitLayer) {
    throw new Error('Declared partition plan differs from the selected model or split');
  }
  return { ...selected, partitionPlan: freezeJson({ ...structuredClone(plan), ...(adapters.length ? { adapterIdentities: adapters.map(adapter => adapter.identity) } : {}) }) };
}

/** A catalog model participates in ordered routes only through its declared Doppler plan version. */
export const isWorkOrderedModel = model => model?.partitionPlan?.schema === 'doppler.layer-partition-contract/v3';

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
      ...(selected.adapters.length ? { adapterIdentities: selected.adapters.map(adapter => adapter.identity) } : {}),
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
    runtime.validateOrderedLayerPartitionPlan(manifest, plan);
  }
  runtime.resolveLayerPartition(manifest, { plan, index });
  partitionActivationContract(runtime, plan);
  return plan;
}

/** Launch 3 policy members; each stays off unless the operator configures it. */
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const exactKeys = (value, keys) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const validCostPolicy = value => { try { validateRouteCostPolicy(value); return true; } catch { return false; } };
const ORCHESTRATION_POLICIES = Object.freeze({
  autoStage: value => exactKeys(value, ['dwellMs']) && Number.isSafeInteger(value.dwellMs) && value.dwellMs >= 0,
  // Prices, priors and reserves come only from the operator's versioned cost policy.
  routeRanking: value => exactKeys(value, ['margin', 'smoothing', 'maxObservations', 'workload', 'costs'])
    && typeof value.margin === 'number' && value.margin >= 0 && value.margin < 1
    && typeof value.smoothing === 'number' && value.smoothing > 0 && value.smoothing <= 1 && positiveInteger(value.maxObservations)
    && exactKeys(value.workload, ['promptTokens', 'expectedTokens']) && positiveInteger(value.workload.promptTokens)
    && positiveInteger(value.workload.expectedTokens) && validCostPolicy(value.costs),
  // Never above the existing per-executor allocation ceiling.
  admission: value => exactKeys(value, ['maxBytes', 'maxConcurrentAttempts', 'attemptBytes', ...(value?.queue === undefined ? [] : ['queue'])])
    && positiveInteger(value.maxBytes) && value.maxBytes <= partitionPolicy.maxGpuBufferBytes
    && positiveInteger(value.maxConcurrentAttempts) && positiveInteger(value.attemptBytes) && value.attemptBytes <= value.maxBytes
    // A queued reservation must be answered before the execution channel's request timeout.
    && (value.queue === undefined || exactKeys(value.queue, ['maxQueued', 'maxQueuedPerRequester', 'maxWaitMs'])
      && positiveInteger(value.queue.maxQueued) && positiveInteger(value.queue.maxQueuedPerRequester)
      && positiveInteger(value.queue.maxWaitMs) && value.queue.maxWaitMs < partitionPolicy.executionChannel.timeoutMs),
  replicas: value => exactKeys(value, ['queueBound', 'bottleneckRatio']) && Number.isSafeInteger(value.queueBound)
    && value.queueBound >= 0 && typeof value.bottleneckRatio === 'number' && Number.isFinite(value.bottleneckRatio) && value.bottleneckRatio > 1
});
const isAutoStage = stage => stage?.assignment === 'auto';

/** Snapshot operator-selected geometry and limits before host connection awaits. */
export function snapshotWorkOrderedParticipation(ordered, canonical, models) {
  if (ordered === null) return null;
  if (!ordered || canonical) throw new Error('Ordered participation requires an explicit ordinary host configuration');
  const copy = structuredClone(ordered);
  for (const key of ['maxStages', 'maxStageOffersPerPeer', 'maxRouteBytes', 'maxSelectionSteps', 'maxRoutes']) {
    if (!Number.isSafeInteger(copy[key]) || copy[key] <= 0) throw new Error('Explicit ordered host limit required: ' + key);
  }
  if (copy.orchestration !== undefined) {
    const policy = copy.orchestration;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)
      || Object.entries(policy).some(([key, value]) => !Object.hasOwn(ORCHESTRATION_POLICIES, key) || !ORCHESTRATION_POLICIES[key](value))) {
      throw new Error('Ordered orchestration policy must name known, explicitly bounded mechanisms');
    }
  }
  if (isAutoStage(copy.stage) !== (copy.orchestration?.autoStage !== undefined)
    || copy.orchestration?.replicas !== undefined && !isAutoStage(copy.stage)) {
    throw new Error('Automatic ordered stage requires both the operator auto choice and its orchestration policy');
  }
  if (isAutoStage(copy.stage)) {
    // The operator authorizes this contributor's own policy to pick a stage of this model.
    const stage = copy.stage, selected = models.find(model => model.id === stage.modelId);
    if (!selected || selected.partitionPlan?.schema !== 'doppler.layer-partition-contract/v3'
      || selected.partitionPlan.stageCount > copy.maxStages
      || Object.keys(stage).some(key => !['modelId', 'assignment'].includes(key))) {
      throw new Error('Ordered host stage requires a matching declared model plan and allocation identity');
    }
  } else if (copy.stage !== null) {
    const stage = copy.stage, selected = models.find(model => model.id === stage?.modelId);
    if (!selected || selected.partitionPlan?.schema !== 'doppler.layer-partition-contract/v3'
      || !Number.isSafeInteger(stage.index) || stage.index < 0 || stage.index >= selected.partitionPlan.stageCount
      || selected.partitionPlan.stageCount > copy.maxStages
      || !['residentId', 'executionId'].every(key => typeof stage[key] === 'string' && stage[key].length > 0)
      || Object.keys(stage).some(key => !['modelId', 'index', 'residentId', 'executionId', 'participantId', 'transportId'].includes(key))) {
      throw new Error('Ordered host stage requires a matching declared model plan and allocation identity');
    }
  }
  return freezeJson(copy);
}

/** Bind identity from the authenticated host, never from discovery or a caller route. */
export function bindWorkOrderedParticipation(options, participantId, transportId, policy) {
  if (!options) return { ordered: null, policy };
  const configured = options.stage;
  if (![participantId, transportId].every(value => typeof value === 'string' && value.length > 0)
    || configured && (configured.participantId !== undefined && configured.participantId !== participantId
      || configured.transportId !== undefined && configured.transportId !== transportId)) {
    throw new Error('Ordered host identity differs from the authenticated transport');
  }
  const stage = configured === null || isAutoStage(configured) ? null : { index: configured.index, participantId, transportId,
    residentId: configured.residentId, executionId: configured.executionId };
  // Absent orchestration keeps the Launch 1 binding unchanged.
  const orchestration = options.orchestration === undefined ? null : structuredClone(options.orchestration);
  if (orchestration?.autoStage) orchestration.autoStage = { ...orchestration.autoStage, transportId };
  return { ordered: { stage, maxRouteBytes: options.maxRouteBytes, maxSelectionSteps: options.maxSelectionSteps, maxRoutes: options.maxRoutes,
    ...(orchestration ? { orchestration } : {}) },
  // Every ordered stage, the coordinator's own included, runs under the declared execution-channel bound.
  policy: { ...policy, maxStageOffersPerPeer: options.maxStageOffersPerPeer,
    limits: { ...policy.limits, maxStages: options.maxStages, stageTimeoutMs: policy.executionChannel?.timeoutMs } } };
}
