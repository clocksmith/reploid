/**
 * @fileoverview Launch model identity contract from canonical pool config.
 */

import { LAUNCH_MODEL, MODEL_CATALOG } from './config.js';

export { LAUNCH_MODEL, MODEL_CATALOG };

export const ENABLED_MODEL_CATALOG = Object.freeze(
  MODEL_CATALOG.filter((model) => model.enabled !== false && model.modelHash && model.manifestHash)
);

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

export default {
  LAUNCH_MODEL,
  MODEL_CATALOG,
  ENABLED_MODEL_CATALOG,
  getEnabledPoolModelContract,
  isLaunchModelRequirement
};
