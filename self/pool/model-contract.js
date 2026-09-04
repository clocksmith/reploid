/**
 * @fileoverview Launch model identity contract from canonical pool config.
 */

import { BROWSER_RUNTIME_CONFIG, LAUNCH_MODEL, MODEL_CATALOG } from './config.js';
import { buildModelArtifactUrls } from './model-artifacts.js';
import { validateExecutablePack } from './executable-pack.js';
import {
  modelIdentityMatchesAdapterRequirement,
  modelSupportsAdapterRequirement,
  validateAdapterRequirement
} from './adapter-pack.js';
import {
  SEQUENCE_EXECUTION_MODE,
  SEQUENCE_WORKLOADS,
  isSequenceWorkload,
  validateSequenceRequest
} from './sequence-workload.js';

export { modelSupportsAdapterRequirement };

export { LAUNCH_MODEL, MODEL_CATALOG };

export const POOLDAY_MODEL_WORKLOADS = Object.freeze({
  sequenceEmbedding: SEQUENCE_WORKLOADS.embedding,
  sequenceMaskedLogits: SEQUENCE_WORKLOADS.maskedLogits
});
export const SUPPORTED_MODEL_EXECUTION_MODES = Object.freeze({
  sequence: SEQUENCE_EXECUTION_MODE
});
export const SUPPORTED_MODEL_EXECUTION_MODE = SUPPORTED_MODEL_EXECUTION_MODES.sequence;

export const isProteinPoolModel = (model = {}) => (
  model.sequence?.alphabet === 'amino_acid'
  && isSequenceWorkload(getPoolModelWorkload(model))
);

export const isBiologicalSequencePoolModel = (model = {}) => (
  ['amino_acid', 'nucleotide'].includes(model.sequence?.alphabet)
  && isSequenceWorkload(getPoolModelWorkload(model))
);

export const ENABLED_MODEL_CATALOG = Object.freeze(
  MODEL_CATALOG.filter((model) => (
    model.enabled !== false
    && model.modelHash
    && model.manifestHash
    && isBiologicalSequencePoolModel(model)
  ))
);

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

const stableContractValue = (value) => {
  if (Array.isArray(value)) return value.map(stableContractValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableContractValue(value[key])]))
};

export function listPoolModels({ enabledOnly = false, workload = null, alphabet = null } = {}) {
  const source = enabledOnly ? ENABLED_MODEL_CATALOG : MODEL_CATALOG.filter(isBiologicalSequencePoolModel);
  return source.filter((model) => (
    (!workload || modelSupportsPoolWorkload(model, workload))
    && (!alphabet || model.sequence?.alphabet === alphabet)
  ));
}

export function getPoolModelContract(modelId = LAUNCH_MODEL.modelId) {
  return MODEL_CATALOG.find((model) => model.modelId === modelId && isBiologicalSequencePoolModel(model)) || null;
}

export function getEnabledPoolModelContract(modelId = LAUNCH_MODEL.modelId) {
  return ENABLED_MODEL_CATALOG.find((model) => model.modelId === modelId) || null;
}

/**
 * Admission check for evidence that claims to come from a selectable Poolday
 * model. A self-consistent contract is not enough: its complete exact key must
 * be the key of a currently enabled catalog entry.
 */
export function validateEnabledPoolModelContract(model = {}) {
  const modelId = model.modelId || model.id || '';
  const enabled = getEnabledPoolModelContract(modelId);
  const reasons = [];
  if (!enabled) {
    reasons.push('model contract is not a currently enabled Poolday model');
  } else if (exactModelContractKey(model) !== exactModelContractKey(enabled)) {
    reasons.push('model contract does not exactly match the enabled Poolday catalog contract');
  }
  return {
    ok: reasons.length === 0,
    reasons,
    modelId,
    enabledModelContractKey: enabled ? exactModelContractKey(enabled) : null,
    observedModelContractKey: exactModelContractKey(model)
  };
}

export function getPoolModelWorkload(model = {}) {
  return model.workload
    || model.workloadType
    || model.modelType
    || (Array.isArray(model.workloads) ? model.workloads[0] : null)
    || POOLDAY_MODEL_WORKLOADS.sequenceEmbedding;
}

export function getPoolModelWorkloads(model = {}) {
  const declared = Array.isArray(model.workloads)
    ? model.workloads
    : (Array.isArray(model.requirements?.workloads) ? model.requirements.workloads : []);
  return [...new Set([getPoolModelWorkload(model), ...declared].filter(Boolean))];
}

export function modelSupportsPoolWorkload(model = {}, workload) {
  return isBiologicalSequencePoolModel(model) && getPoolModelWorkloads(model).includes(workload);
}

export function exactModelContractKey(model = {}, {
  workload = getPoolModelWorkload(model),
  dimensions = model.embeddingDimensions || model.dimensions || model.requirements?.embeddingDimensions || 0
} = {}) {
  const identity = model.artifactIdentity || model.requirements?.artifactIdentity || {};
  return JSON.stringify(stableContractValue({
    modelId: model.modelId || model.id || '',
    modelHash: model.modelHash || model.hash || '',
    manifestHash: model.manifestHash || '',
    tokenizerHash: model.tokenizerHash || identity.tokenizerHash || '',
    artifactIdentity: identity,
    ...(model.executablePack ? { executablePack: model.executablePack } : {}),
    runtime: model.runtime || '',
    backend: model.backend || '',
    workload: workload || '',
    executionMode: getPoolModelExecutionMode(model, workload) || '',
    dimensions: Number(dimensions || 0),
    contextLength: Number(model.contextLength || model.requirements?.contextLength || 0),
    quantization: model.quantization || model.dtype || '',
    sequence: model.sequence || model.requirements?.sequence || {},
    runtimeCompatibility: model.runtimeCompatibility || model.requirements?.runtimeCompatibility || {},
    runtimeContract: model.runtimeContract || model.requirements?.runtimeContract || {},
    outputs: model.outputs || model.requirements?.outputs || {},
    license: model.license || model.requirements?.license || {},
    claimBoundary: model.admission?.claimBoundary || model.requirements?.admission?.claimBoundary || ''
  }));
}

export function getPoolModelExecutionMode(model = {}, workload = getPoolModelWorkload(model)) {
  const declaredModes = model.executionModes || model.requirements?.executionModes || {};
  if (declaredModes[workload]) return declaredModes[workload];
  if (workload === getPoolModelWorkload(model) && (model.executionMode || model.execution)) {
    return model.executionMode || model.execution;
  }
  return SUPPORTED_MODEL_EXECUTION_MODES.sequence;
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
  const workload = overrides.workload || overrides.workloadType || getPoolModelWorkload(base);
  return {
    // Requests carry the entire frozen contract. A checkpoint tuple is not
    // sufficient to route, compare, sign, or later reproduce an execution.
    ...base,
    workload,
    executionMode: getPoolModelExecutionMode(base, workload),
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
  return !!model && exactModelContractKey(requirements) === exactModelContractKey(model);
}

const validateEnabledModelRequirement = (requirements = {}, {
  requireSequenceRequest = true
} = {}) => {
  const reasons = [];
  const model = getEnabledPoolModelContract(requirements.modelId);
  if (requirements.executablePack !== undefined) reasons.push(...validateExecutablePack(requirements.executablePack).reasons);
  if (!model || !isLaunchModelRequirement(requirements)) {
    reasons.push('model requirements do not match an enabled model contract');
  }
  const workload = requirements.workload || requirements.workloadType || null;
  const expectedWorkload = model ? getPoolModelWorkload(model) : POOLDAY_MODEL_WORKLOADS.sequenceEmbedding;
  const resolvedWorkload = workload || expectedWorkload;
  const executionMode = requirements.executionMode || requirements.execution || null;
  const expectedExecutionMode = model ? getPoolModelExecutionMode(model, resolvedWorkload) : SUPPORTED_MODEL_EXECUTION_MODE;
  if (executionMode && executionMode !== expectedExecutionMode) {
    reasons.push(`modelRequirements.executionMode ${executionMode} is not supported; only ${expectedExecutionMode} is supported`);
  }
  if (model && !executionMode && expectedExecutionMode !== SUPPORTED_MODEL_EXECUTION_MODE) {
    reasons.push(`modelRequirements.executionMode ${expectedExecutionMode} is required for ${requirements.modelId}`);
  }
  if (model && !isBiologicalSequencePoolModel(model)) {
    reasons.push('selected model is not a supported biological-sequence model');
  }
  if (workload && model && !modelSupportsPoolWorkload(model, workload)) {
    reasons.push(`modelRequirements.workload ${workload} is not supported for ${requirements.modelId || 'selected model'}; supported workloads: ${getPoolModelWorkloads(model).join(', ')}`);
  }
  if (requireSequenceRequest && isSequenceWorkload(resolvedWorkload)) {
    reasons.push(...validateSequenceRequest(requirements.sequenceRequest || {}, { model }).reasons);
  }
  for (const field of UNSUPPORTED_MODEL_SPLIT_FIELDS) {
    const value = requirements[field];
    if (value !== undefined && value !== null && value !== false) {
      reasons.push(`modelRequirements.${field} is not supported by browser peer-room execution`);
    }
  }
  if (requirements.adapter) {
    reasons.push(...validateAdapterRequirement(requirements.adapter).reasons);
    if (model && !modelIdentityMatchesAdapterRequirement(model, requirements.adapter)) {
      reasons.push('adapter requirement does not match the selected exact base-model identity');
    }
  }
  return {
    ok: reasons.length === 0,
    reasons
  };
};

export function validateLaunchModelRequirement(requirements = {}) {
  return validateEnabledModelRequirement(requirements, {
    requireSequenceRequest: true
  });
}

export function validateProviderModelContract(requirements = {}) {
  return validateEnabledModelRequirement(requirements, {
    requireSequenceRequest: false
  });
}

export default {
  LAUNCH_MODEL,
  MODEL_CATALOG,
  ENABLED_MODEL_CATALOG,
  POOLDAY_MODEL_WORKLOADS,
  SUPPORTED_MODEL_EXECUTION_MODES,
  SUPPORTED_MODEL_EXECUTION_MODE,
  LAUNCH_MODEL_ARTIFACT_PATHS,
  listPoolModels,
  getPoolModelContract,
  getEnabledPoolModelContract,
  getPoolModelWorkload,
  getPoolModelWorkloads,
  modelSupportsPoolWorkload,
  isProteinPoolModel,
  isBiologicalSequencePoolModel,
  exactModelContractKey,
  getPoolModelExecutionMode,
  buildLaunchModelArtifactUrls,
  buildLaunchModelRequirements,
  buildLaunchProviderModel,
  getModelRequiredWebGpuFeatures,
  isLaunchModelRequirement,
  validateModelRuntimeCapabilities,
  validateLaunchModelRequirement,
  validateProviderModelContract,
  modelSupportsAdapterRequirement
};
