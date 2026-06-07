/**
 * @fileoverview Launch model identity contract from canonical pool config.
 */

import { LAUNCH_MODEL } from './config.js';

export { LAUNCH_MODEL };

const replaceModelPathTokens = (template, model = LAUNCH_MODEL) => String(template || '')
  .replace(/<modelId>/g, model.modelId)
  .replace(/<manifestHash>/g, model.manifestHash)
  .replace(/<modelHash>/g, model.modelHash);

export const LAUNCH_MODEL_ARTIFACT_PATHS = Object.freeze({
  manifest: replaceModelPathTokens(LAUNCH_MODEL.artifactPolicy?.paths?.manifest),
  tokenizer: replaceModelPathTokens(LAUNCH_MODEL.artifactPolicy?.paths?.tokenizer),
  shards: replaceModelPathTokens(LAUNCH_MODEL.artifactPolicy?.paths?.shards)
});

export function buildLaunchModelArtifactUrls({ baseUrl = globalThis.REPLOID_POOL_MODEL_BASE_URL || '', paths = LAUNCH_MODEL_ARTIFACT_PATHS } = {}) {
  const normalizedBase = String(baseUrl || '').replace(/\/+$/, '');
  const join = (path) => normalizedBase ? `${normalizedBase}/${path}` : path;
  return {
    transport: LAUNCH_MODEL.artifactPolicy?.transport || 'offloaded_content_addressed',
    cache: LAUNCH_MODEL.artifactPolicy?.cache || 'browser_opfs',
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
