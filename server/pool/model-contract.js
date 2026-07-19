/**
 * @fileoverview Launch model identity contract from canonical pool config.
 */

import { LAUNCH_MODEL, MODEL_CATALOG } from './config.js';
import {
  modelSupportsAdapterRequirement,
  validateAdapterRequirement
} from '../../self/pool/adapter-pack.js';
import {
  SEQUENCE_EXECUTION_MODE,
  SEQUENCE_WORKLOADS,
  isSequenceWorkload,
  validateSequenceRequest
} from '../../self/pool/sequence-workload.js';

export { modelSupportsAdapterRequirement };

export { LAUNCH_MODEL, MODEL_CATALOG };

export const POOLDAY_MODEL_WORKLOADS = Object.freeze({
  textGeneration: 'text_generation',
  embedding: 'embedding',
  sequenceEmbedding: SEQUENCE_WORKLOADS.embedding,
  sequenceMaskedLogits: SEQUENCE_WORKLOADS.maskedLogits
});
export const SUPPORTED_MODEL_EXECUTION_MODES = Object.freeze({
  textGeneration: 'full_model_browser_local',
  embedding: 'full_model_browser_embedding',
  sequence: SEQUENCE_EXECUTION_MODE
});
export const SUPPORTED_MODEL_EXECUTION_MODE = SUPPORTED_MODEL_EXECUTION_MODES.textGeneration;

export const ENABLED_MODEL_CATALOG = Object.freeze(
  MODEL_CATALOG.filter((model) => model.enabled !== false && model.modelHash && model.manifestHash)
);

const UNSUPPORTED_MODEL_SPLIT_FIELDS = Object.freeze([
  'distributedExecution',
  'executionTopology',
  'modelSplit',
  'modelPartitions',
  'partitionPlan',
  'splitPlan',
  'kvShardPlan',
  'attentionShardPlan'
]);

export function getEnabledPoolModelContract(modelId = LAUNCH_MODEL.modelId) {
  return ENABLED_MODEL_CATALOG.find((model) => model.modelId === modelId) || null;
}

export function getPoolModelWorkload(model = {}) {
  return model.workload
    || model.workloadType
    || model.modelType
    || (Array.isArray(model.workloads) ? model.workloads[0] : null)
    || POOLDAY_MODEL_WORKLOADS.textGeneration;
}

export function getPoolModelWorkloads(model = {}) {
  const declared = Array.isArray(model.workloads)
    ? model.workloads
    : (Array.isArray(model.requirements?.workloads) ? model.requirements.workloads : []);
  return [...new Set([getPoolModelWorkload(model), ...declared].filter(Boolean))];
}

export function modelSupportsPoolWorkload(model = {}, workload) {
  return getPoolModelWorkloads(model).includes(workload);
}

export function getPoolModelExecutionMode(model = {}, workload = getPoolModelWorkload(model)) {
  const declaredModes = model.executionModes || model.requirements?.executionModes || {};
  if (declaredModes[workload]) return declaredModes[workload];
  if (workload === getPoolModelWorkload(model) && (model.executionMode || model.execution)) {
    return model.executionMode || model.execution;
  }
  if (workload === POOLDAY_MODEL_WORKLOADS.embedding) return SUPPORTED_MODEL_EXECUTION_MODES.embedding;
  if (isSequenceWorkload(workload)) return SUPPORTED_MODEL_EXECUTION_MODES.sequence;
  return SUPPORTED_MODEL_EXECUTION_MODES.textGeneration;
}

export function isLaunchModelRequirement(requirements = {}) {
  const model = getEnabledPoolModelContract(requirements.modelId);
  return !!model
    && requirements.modelHash === model.modelHash
    && requirements.manifestHash === model.manifestHash
    && requirements.runtime === model.runtime
    && requirements.backend === model.backend;
}

export function validateLaunchModelRequirement(requirements = {}) {
  const reasons = [];
  const model = getEnabledPoolModelContract(requirements.modelId);
  if (!model || !isLaunchModelRequirement(requirements)) {
    reasons.push('model requirements do not match an enabled model contract');
  }
  const workload = requirements.workload || requirements.workloadType || null;
  const expectedWorkload = model ? getPoolModelWorkload(model) : POOLDAY_MODEL_WORKLOADS.textGeneration;
  const resolvedWorkload = workload || expectedWorkload;
  const executionMode = requirements.executionMode || requirements.execution || null;
  const expectedExecutionMode = model ? getPoolModelExecutionMode(model, resolvedWorkload) : SUPPORTED_MODEL_EXECUTION_MODE;
  if (executionMode && executionMode !== expectedExecutionMode) {
    reasons.push(`modelRequirements.executionMode ${executionMode} is not supported; only ${expectedExecutionMode} is supported`);
  }
  if (model && !executionMode && expectedExecutionMode !== SUPPORTED_MODEL_EXECUTION_MODE) {
    reasons.push(`modelRequirements.executionMode ${expectedExecutionMode} is required for ${requirements.modelId}`);
  }
  if (workload && model && !modelSupportsPoolWorkload(model, workload)) {
    reasons.push(`modelRequirements.workload ${workload} is not supported for ${requirements.modelId || 'selected model'}; supported workloads: ${getPoolModelWorkloads(model).join(', ')}`);
  }
  if (isSequenceWorkload(resolvedWorkload)) {
    reasons.push(...validateSequenceRequest(requirements.sequenceRequest || {}, { model }).reasons);
  }
  for (const field of UNSUPPORTED_MODEL_SPLIT_FIELDS) {
    const value = requirements[field];
    if (value !== undefined && value !== null && value !== false) {
      reasons.push(`modelRequirements.${field} is not supported by browser peer-room execution`);
    }
  }
  if (requirements.adapter) {
    reasons.push(...validateAdapterRequirement(requirements.adapter).reasons);
    if (model && (
      requirements.adapter.baseModelId !== model.modelId
      || requirements.adapter.baseModelHash !== model.modelHash
      || requirements.adapter.baseManifestHash !== model.manifestHash
    )) reasons.push('adapter requirement does not match the selected base model');
  }
  return {
    ok: reasons.length === 0,
    reasons
  };
}

export default {
  LAUNCH_MODEL,
  MODEL_CATALOG,
  ENABLED_MODEL_CATALOG,
  POOLDAY_MODEL_WORKLOADS,
  SUPPORTED_MODEL_EXECUTION_MODES,
  getEnabledPoolModelContract,
  getPoolModelWorkload,
  getPoolModelWorkloads,
  modelSupportsPoolWorkload,
  getPoolModelExecutionMode,
  SUPPORTED_MODEL_EXECUTION_MODE,
  isLaunchModelRequirement,
  validateLaunchModelRequirement,
  modelSupportsAdapterRequirement
};
