/**
 * @fileoverview Launch model identity contract from canonical pool config.
 */

import { LAUNCH_MODEL } from './config.js';

export { LAUNCH_MODEL };

export function isLaunchModelRequirement(requirements = {}) {
  return requirements.modelId === LAUNCH_MODEL.modelId
    && requirements.modelHash === LAUNCH_MODEL.modelHash
    && requirements.manifestHash === LAUNCH_MODEL.manifestHash
    && requirements.runtime === LAUNCH_MODEL.runtime
    && requirements.backend === LAUNCH_MODEL.backend;
}

export default {
  LAUNCH_MODEL,
  isLaunchModelRequirement
};
