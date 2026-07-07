/**
 * @fileoverview Launch model identity contract from canonical pool config.
 */

import { LAUNCH_MODEL, MODEL_CATALOG } from './config.js';

export { LAUNCH_MODEL, MODEL_CATALOG };

export const POOLDAY_MODEL_WORKLOADS = Object.freeze({
  textGeneration: 'text_generation',
  embedding: 'embedding'
});
export const SUPPORTED_MODEL_EXECUTION_MODES = Object.freeze({
  textGeneration: 'full_model_browser_local',
  embedding: 'full_model_browser_embedding'
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
  return model.workload || model.workloadType || model.modelType || POOLDAY_MODEL_WORKLOADS.textGeneration;
}

export function getPoolModelExecutionMode(model = {}) {
  return model.executionMode
    || model.execution
    || (
      getPoolModelWorkload(model) === POOLDAY_MODEL_WORKLOADS.embedding
        ? SUPPORTED_MODEL_EXECUTION_MODES.embedding
        : SUPPORTED_MODEL_EXECUTION_MODES.textGeneration
    );
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
  const executionMode = requirements.executionMode || requirements.execution || null;
  const expectedExecutionMode = model ? getPoolModelExecutionMode(model) : SUPPORTED_MODEL_EXECUTION_MODE;
  if (executionMode && executionMode !== expectedExecutionMode) {
    reasons.push(`modelRequirements.executionMode ${executionMode} is not supported; only ${expectedExecutionMode} is supported`);
  }
  if (model && !executionMode && expectedExecutionMode !== SUPPORTED_MODEL_EXECUTION_MODE) {
    reasons.push(`modelRequirements.executionMode ${expectedExecutionMode} is required for ${requirements.modelId}`);
  }
  const workload = requirements.workload || requirements.workloadType || null;
  const expectedWorkload = model ? getPoolModelWorkload(model) : POOLDAY_MODEL_WORKLOADS.textGeneration;
  if (workload && workload !== expectedWorkload) {
    reasons.push(`modelRequirements.workload ${workload} is not supported for ${requirements.modelId || 'selected model'}; expected ${expectedWorkload}`);
  }
  for (const field of UNSUPPORTED_MODEL_SPLIT_FIELDS) {
    const value = requirements[field];
    if (value !== undefined && value !== null && value !== false) {
      reasons.push(`modelRequirements.${field} is not supported by browser peer-room execution`);
    }
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
  getPoolModelExecutionMode,
  SUPPORTED_MODEL_EXECUTION_MODE,
  isLaunchModelRequirement,
  validateLaunchModelRequirement
};
