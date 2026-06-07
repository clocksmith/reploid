/**
 * @fileoverview Launch model identity contract for the fastest-receipt pool.
 */

export const LAUNCH_MODEL = Object.freeze({
  modelId: 'gemma-3-270m-it-q4k-ehf16-af32',
  modelHash: 'sha256:b55fde5809dbc198f880b08af21e40e3175a6d2f9f88a9fad59fa0afd7190dc9',
  manifestHash: 'sha256:abac153d8cee1b6cc4fd2743defa84b91f67b3d030af028bbd5ed8ba8cabee6b',
  contextLength: 32768,
  quantization: 'q4k',
  runtime: 'doppler',
  backend: 'browser-webgpu',
  dopplerLoadRef: 'gemma3-270m'
});

export const LAUNCH_MODEL_ARTIFACT_PATHS = Object.freeze({
  manifest: `${LAUNCH_MODEL.modelId}/${LAUNCH_MODEL.manifestHash}/manifest.json`,
  tokenizer: `${LAUNCH_MODEL.modelId}/${LAUNCH_MODEL.manifestHash}/tokenizer.json`,
  shards: `${LAUNCH_MODEL.modelId}/${LAUNCH_MODEL.manifestHash}/shards/`
});

export function buildLaunchModelArtifactUrls({ baseUrl = globalThis.REPLOID_POOL_MODEL_BASE_URL || '', paths = LAUNCH_MODEL_ARTIFACT_PATHS } = {}) {
  const normalizedBase = String(baseUrl || '').replace(/\/+$/, '');
  const join = (path) => normalizedBase ? `${normalizedBase}/${path}` : path;
  return {
    transport: 'offloaded_content_addressed',
    cache: 'browser_opfs',
    manifestUrl: join(paths.manifest),
    tokenizerUrl: join(paths.tokenizer),
    shardBaseUrl: join(paths.shards)
  };
}

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

export function isLaunchModelRequirement(requirements = {}) {
  return requirements.modelId === LAUNCH_MODEL.modelId
    && requirements.modelHash === LAUNCH_MODEL.modelHash
    && requirements.manifestHash === LAUNCH_MODEL.manifestHash
    && requirements.runtime === LAUNCH_MODEL.runtime
    && requirements.backend === LAUNCH_MODEL.backend;
}

export default {
  LAUNCH_MODEL,
  LAUNCH_MODEL_ARTIFACT_PATHS,
  buildLaunchModelArtifactUrls,
  buildLaunchModelRequirements,
  buildLaunchProviderModel,
  isLaunchModelRequirement
};
