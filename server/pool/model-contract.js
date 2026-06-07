/**
 * @fileoverview Launch model identity contract for server-side policy enforcement.
 */

export const LAUNCH_MODEL = Object.freeze({
  modelId: 'gemma-3-270m-it-q4k-ehf16-af32',
  modelHash: 'sha256:b55fde5809dbc198f880b08af21e40e3175a6d2f9f88a9fad59fa0afd7190dc9',
  manifestHash: 'sha256:abac153d8cee1b6cc4fd2743defa84b91f67b3d030af028bbd5ed8ba8cabee6b',
  runtime: 'doppler',
  backend: 'browser-webgpu',
  dopplerLoadRef: 'gemma3-270m'
});

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
