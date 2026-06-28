/**
 * @fileoverview Launch model identity contract from canonical pool config.
 */

import { LAUNCH_MODEL, MODEL_CATALOG } from './config.js';

export { LAUNCH_MODEL, MODEL_CATALOG };

export const ENABLED_MODEL_CATALOG = Object.freeze(
  MODEL_CATALOG.filter((model) => model.enabled !== false && model.modelHash && model.manifestHash)
);
export const SUPPORTED_MODEL_EXECUTION_MODE = 'full_model_browser_local';

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
  if (!isLaunchModelRequirement(requirements)) {
    reasons.push('model requirements do not match an enabled model contract');
  }
  const executionMode = requirements.executionMode || requirements.execution || null;
  if (executionMode && executionMode !== SUPPORTED_MODEL_EXECUTION_MODE) {
    reasons.push(`modelRequirements.executionMode ${executionMode} is not supported; only ${SUPPORTED_MODEL_EXECUTION_MODE} is supported`);
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
  getEnabledPoolModelContract,
  SUPPORTED_MODEL_EXECUTION_MODE,
  isLaunchModelRequirement,
  validateLaunchModelRequirement
};
