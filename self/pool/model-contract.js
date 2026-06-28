/**
 * @fileoverview Launch model identity contract from canonical pool config.
 */

import { BROWSER_RUNTIME_CONFIG, LAUNCH_MODEL, MODEL_CATALOG } from './config.js';

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

export function listPoolModels({ enabledOnly = false } = {}) {
  return enabledOnly ? ENABLED_MODEL_CATALOG : MODEL_CATALOG;
}

export function getPoolModelContract(modelId = LAUNCH_MODEL.modelId) {
  return MODEL_CATALOG.find((model) => model.modelId === modelId) || null;
}

export function getEnabledPoolModelContract(modelId = LAUNCH_MODEL.modelId) {
  return ENABLED_MODEL_CATALOG.find((model) => model.modelId === modelId) || null;
}

const replaceModelPathTokens = (template, model = LAUNCH_MODEL) => String(template || '')
  .replace(/<modelId>/g, model.modelId)
  .replace(/<manifestHash>/g, model.manifestHash)
  .replace(/<modelHash>/g, model.modelHash);

export const LAUNCH_MODEL_ARTIFACT_PATHS = Object.freeze({
  manifest: replaceModelPathTokens(LAUNCH_MODEL.artifactPolicy?.paths?.manifest),
  tokenizer: replaceModelPathTokens(LAUNCH_MODEL.artifactPolicy?.paths?.tokenizer),
  shards: replaceModelPathTokens(LAUNCH_MODEL.artifactPolicy?.paths?.shards)
});

export function buildLaunchModelArtifactUrls({
  baseUrl = globalThis.REPLOID_POOL_MODEL_BASE_URL || BROWSER_RUNTIME_CONFIG.modelBaseUrl || '',
  paths = LAUNCH_MODEL_ARTIFACT_PATHS
} = {}) {
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
  const base = getEnabledPoolModelContract(overrides.modelId) || LAUNCH_MODEL;
  return {
    modelId: base.modelId,
    modelHash: base.modelHash,
    manifestHash: base.manifestHash,
    runtime: base.runtime,
    backend: base.backend,
    ...overrides
  };
}

export function buildLaunchProviderModel(overrides = {}) {
  const base = getEnabledPoolModelContract(overrides.modelId) || LAUNCH_MODEL;
  return {
    ...base,
    ...overrides
  };
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
  SUPPORTED_MODEL_EXECUTION_MODE,
  LAUNCH_MODEL_ARTIFACT_PATHS,
  listPoolModels,
  getPoolModelContract,
  getEnabledPoolModelContract,
  buildLaunchModelArtifactUrls,
  buildLaunchModelRequirements,
  buildLaunchProviderModel,
  isLaunchModelRequirement,
  validateLaunchModelRequirement
};
