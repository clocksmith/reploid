/** Hosts carry an explicit Doppler plan; Doppler validates its geometry and storage. */
import { freezeJson } from '../../../shared/vendor/reploid/config/index.js';
import { partitionActivationContract } from '../../../shared/vendor/reploid/mesh/partitions/partition-contract.js';
import { validateRouteCostPolicy } from '../../../shared/vendor/reploid/mesh/partitions/partition-route-ranking.js';
import { selectWorkAdapters } from '../providers/work-adapter.js';
import partitionPolicy from '../config/partition-policy.json' with { type: 'json' };

export function snapshotWorkPartitionSelection(selected) {
  const adapters = selectWorkAdapters(selected);
  selected = { ...selected, adapters };
  if (selected.partitionRequest !== undefined) {
    const request = selected.partitionRequest;
    if (selected.partitionPlan !== undefined || selected.partitionSplitLayer !== undefined || selected.capsule !== undefined
      || !/^sha256:[a-f0-9]{64}$/.test(selected.partitionPlanId)
      || !Array.isArray(request?.splitLayers) || !request.splitLayers.length
      || request.splitLayers.some((cut, index) => !Number.isSafeInteger(cut) || cut <= (request.splitLayers[index - 1] ?? 0))) {
      throw new Error('Compact partition requires an unsigned model, ordered cuts, and one pinned plan digest');
    }
    return { ...selected, partitionRequest: freezeJson(structuredClone(request)) };
  }
  if (selected.partitionPlan === undefined) return selected;
  const plan = selected.partitionPlan;
  if (!plan || plan.modelId !== selected.id
    || selected.partitionSplitLayer !== undefined && plan.splitLayer !== selected.partitionSplitLayer) {
    throw new Error('Declared partition plan differs from the selected model or split');
  }
  return { ...selected, partitionPlan: freezeJson({ ...structuredClone(plan), ...(adapters.length ? { adapterIdentities: adapters.map(adapter => adapter.identity) } : {}) }) };
}

/** A catalog model participates in ordered routes only through its declared Doppler plan version. */
const orderedStageCount = model => model?.partitionRequest?.splitLayers?.length + 1 || model?.partitionPlan?.stageCount;
export const isWorkOrderedModel = model => model?.partitionRequest !== undefined
  || model?.partitionPlan?.schema === 'doppler.layer-partition-contract/v3';

/** Host stage identity is explicit; discovery cannot invent a resident session. */
export function snapshotWorkPartitionStage(selected, index, participantId, ordered, canonical) {
  const isOrdered = isWorkOrderedModel(selected);
  if (!isOrdered && !ordered) return null;
  const stage = ordered?.stage;
  if (!isOrdered || canonical || !stage || !Number.isSafeInteger(index) || index < 0
    || index >= orderedStageCount(selected) || stage.index !== index || stage.participantId !== participantId
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
  if (selected.partitionRequest !== undefined) {
    if (manifest.modelId !== selected.id || runtime.ORDERED_LAYER_PARTITION_SCHEMA !== 'doppler.layer-partition-contract/v3'
      || !['createOrderedLayerPartitionPlanFromManifest', 'hashLayerPartitionPlan',
        'resolveLayerPartition', 'validateOrderedLayerPartitionPlan'].every(key => typeof runtime[key] === 'function')) {
      throw new Error('Compact partition requires the matching verified manifest and installed Doppler ordered plan runtime');
    }
    const plan = runtime.createOrderedLayerPartitionPlanFromManifest(manifest, { ...selected.partitionRequest,
      ...(selected.adapters.length ? { adapterIdentities: selected.adapters.map(adapter => adapter.identity) } : {}) });
    if (runtime.hashLayerPartitionPlan(plan) !== selected.partitionPlanId) {
      throw new Error('Compact partition differs from the pinned Doppler plan digest');
    }
    runtime.validateOrderedLayerPartitionPlan(manifest, plan);
    runtime.resolveLayerPartition(manifest, { plan, index });
    partitionActivationContract(runtime, plan);
    return freezeJson(plan);
  }
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
  // Never above the operator's explicit stage budget (legacy hosts keep their ceiling).
  admission: (value, maxGpuBufferBytes) => exactKeys(value, ['maxBytes', 'maxConcurrentAttempts', 'attemptBytes', ...(value?.queue === undefined ? [] : ['queue'])])
    && positiveInteger(value.maxBytes) && value.maxBytes <= maxGpuBufferBytes
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
  const selected = models.find(model => model.id === copy.stage?.modelId);
  const budgets = selected?.partitionRuntime?.maxGpuBufferBytes;
  let maxGpuBufferBytes = partitionPolicy.maxGpuBufferBytes;
  if (budgets !== undefined) {
    if (!Array.isArray(budgets) || budgets.length !== orderedStageCount(selected) || !budgets.every(positiveInteger)) {
      throw new Error('Ordered model requires one explicit positive GPU budget per stage');
    }
    // Automatic reassignment may pick any stage, so its shared admission bound
    // must fit the smallest of the authorized stage budgets.
    maxGpuBufferBytes = isAutoStage(copy.stage) ? Math.min(...budgets) : budgets[copy.stage.index];
  }
  for (const key of ['maxStages', 'maxStageOffersPerPeer', 'maxRouteBytes', 'maxSelectionSteps', 'maxRoutes']) {
    if (!Number.isSafeInteger(copy[key]) || copy[key] <= 0) throw new Error('Explicit ordered host limit required: ' + key);
  }
  if (copy.orchestration !== undefined) {
    const policy = copy.orchestration;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)
      || Object.entries(policy).some(([key, value]) => !Object.hasOwn(ORCHESTRATION_POLICIES, key) || !ORCHESTRATION_POLICIES[key](value, maxGpuBufferBytes))) {
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
    if (!selected || !isWorkOrderedModel(selected)
      || orderedStageCount(selected) > copy.maxStages
      || Object.keys(stage).some(key => !['modelId', 'assignment'].includes(key))) {
      throw new Error('Ordered host stage requires a matching declared model plan and allocation identity');
    }
  } else if (copy.stage !== null) {
    const stage = copy.stage, selected = models.find(model => model.id === stage?.modelId);
    if (!selected || !isWorkOrderedModel(selected)
      || !Number.isSafeInteger(stage.index) || stage.index < 0 || stage.index >= orderedStageCount(selected)
      || orderedStageCount(selected) > copy.maxStages
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
