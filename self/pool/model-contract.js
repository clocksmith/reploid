/**
 * @fileoverview Launch model identity contract for the fastest-receipt pool.
 */

export const LAUNCH_MODEL = Object.freeze({
  modelId: 'gemma-3-270m-it-q4k-ehf16-af32',
  modelHash: 'sha256:launch-model-hash-required',
  manifestHash: 'sha256:launch-manifest-hash-required',
  contextLength: 4096,
  quantization: 'q4k',
  runtime: 'doppler',
  backend: 'browser-webgpu'
});

export function buildLaunchModelRequirements(overrides = {}) {
  return {
    modelId: LAUNCH_MODEL.modelId,
    modelHash: LAUNCH_MODEL.modelHash,
    manifestHash: LAUNCH_MODEL.manifestHash,
    runtime: LAUNCH_MODEL.runtime,
    backend: LAUNCH_MODEL.backend,
    ...overrides
  };
}

export function buildLaunchProviderModel(overrides = {}) {
  return {
    ...LAUNCH_MODEL,
    ...overrides
  };
}

export default {
  LAUNCH_MODEL,
  buildLaunchModelRequirements,
  buildLaunchProviderModel
};
