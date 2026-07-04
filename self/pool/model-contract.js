/**
 * @fileoverview Launch model identity contract from canonical pool config.
 */

import { BROWSER_RUNTIME_CONFIG, LAUNCH_MODEL, MODEL_CATALOG } from './config.js';
import { buildModelArtifactUrls } from './model-artifacts.js';

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

const sortedFeatureList = (features) => (
  Array.isArray(features)
    ? [...new Set(features.map((feature) => String(feature || '').trim()).filter(Boolean))].sort()
    : []
);

const deviceFeatureSet = (deviceInfo = {}) => {
  const features = new Set(sortedFeatureList(deviceInfo.features));
  if (deviceInfo.hasF16 === true) features.add('shader-f16');
  if (deviceInfo.hasSubgroups === true) features.add('subgroups');
  return features;
};

export function getModelRequiredWebGpuFeatures(model = {}) {
  return sortedFeatureList(
    model.runtimeCompatibility?.requiredWebGpuFeatures
    || model.runtimeCompatibility?.requiredFeatures
    || model.requiredWebGpuFeatures
    || []
  );
}

export function validateModelRuntimeCapabilities(model = {}, deviceInfo = {}) {
  const requiredFeatures = getModelRequiredWebGpuFeatures(model);
  const reasons = [];
  if (model.backend === 'browser-webgpu' && deviceInfo.hasWebGPU === false) {
    reasons.push('WebGPU is required for browser provider execution');
  }
  const features = deviceFeatureSet(deviceInfo);
  const missingFeatures = requiredFeatures.filter((feature) => !features.has(feature));
  if (missingFeatures.length > 0) {
    reasons.push(
      `${model.modelId || 'selected model'} requires WebGPU feature(s): ${missingFeatures.join(', ')}`
    );
  }
  return {
    ok: reasons.length === 0,
    reasons,
    requiredFeatures,
    missingFeatures,
    observedFeatures: [...features].sort(),
    fallbackStatus: model.runtimeCompatibility?.fallbackStatus || null,
    action: model.runtimeCompatibility?.capabilityAction
      || 'Use a browser/GPU runtime with the required WebGPU features, or choose another enabled Poolday model.'
  };
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

export function buildLaunchModelArtifactUrls(options = {}) {
  const hasBaseUrl = Object.hasOwn(options, 'baseUrl');
  const baseUrl = hasBaseUrl
    ? options.baseUrl
    : (
        globalThis.REPLOID_POOL_MODEL_BASE_URL
        || LAUNCH_MODEL.artifactPolicy?.baseUrl
        || BROWSER_RUNTIME_CONFIG.modelBaseUrl
        || ''
      );
  const paths = options.paths || LAUNCH_MODEL_ARTIFACT_PATHS;
  const urls = buildModelArtifactUrls({
    ...LAUNCH_MODEL,
    artifactPolicy: {
      ...(LAUNCH_MODEL.artifactPolicy || {}),
      paths
    }
  }, { baseUrl });
  return {
    transport: LAUNCH_MODEL.artifactPolicy?.transport || 'offloaded_content_addressed',
    cache: LAUNCH_MODEL.artifactPolicy?.cache || 'browser_opfs',
    manifestUrl: urls.manifest,
    tokenizerUrl: urls.tokenizer,
    shardBaseUrl: urls.shards
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
  getModelRequiredWebGpuFeatures,
  isLaunchModelRequirement,
  validateModelRuntimeCapabilities,
  validateLaunchModelRequirement
};
