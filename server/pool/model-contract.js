/**
 * @fileoverview Launch model identity contract for server-side policy enforcement.
 */

export const LAUNCH_MODEL = Object.freeze({
  modelId: 'gemma-3-270m-it-q4k-ehf16-af32',
  modelHash: 'sha256:launch-model-hash-required',
  manifestHash: 'sha256:launch-manifest-hash-required',
  runtime: 'doppler',
  backend: 'browser-webgpu'
});

export function isLaunchModelRequirement(requirements = {}) {
  return requirements.modelId === LAUNCH_MODEL.modelId
    && requirements.modelHash === LAUNCH_MODEL.modelHash
    && requirements.manifestHash === LAUNCH_MODEL.manifestHash
    && (!requirements.runtime || requirements.runtime === LAUNCH_MODEL.runtime)
    && (!requirements.backend || requirements.backend === LAUNCH_MODEL.backend);
}

export default {
  LAUNCH_MODEL,
  isLaunchModelRequirement
};
