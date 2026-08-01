/**
 * @fileoverview Environment-neutral Poolday configuration contract.
 */

export const POLICY_IDS = Object.freeze({
  fastestReceipt: 'fastest_receipt',
  canaryAudited: 'canary_audited',
  redundantAgreement: 'redundant_agreement',
  ringQuorumReceipt: 'ring_quorum_receipt'
});

const cloneValue = (value) => {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneValue(child)])
  );
};

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

const requireField = (value, path, reasons) => {
  if (value === undefined || value === null || String(value).trim?.() === '') {
    reasons.push(`${path} is required`);
  }
};

const isProteinPoolModel = (model = {}) => (
  model.sequence?.alphabet === 'amino_acid'
  && String(model.workload || model.workloadType || model.modelType || '')
    .startsWith('sequence.')
);

const isBiologicalSequencePoolModel = (model = {}) => (
  ['amino_acid', 'nucleotide'].includes(model.sequence?.alphabet)
  && String(model.workload || model.workloadType || model.modelType || '')
    .startsWith('sequence.')
);

const validateSequenceModelContract = (model, index, reasons) => {
  const path = `modelCatalog.${index}`;
  for (const field of [
    'modelId',
    'modelHash',
    'manifestHash',
    'tokenizerHash',
    'contextLength',
    'embeddingDimensions',
    'quantization',
    'runtime',
    'backend',
    'dopplerLoadRef'
  ]) {
    requireField(model?.[field], `${path}.${field}`, reasons);
  }
  for (const field of [
    'sourceCheckpointId',
    'sourceRepo',
    'sourceRevision',
    'weightPackId',
    'weightPackHash',
    'shardSetHash',
    'manifestVariantId',
    'conversionConfigDigest',
    'materializationProfile',
    'artifactCompleteness'
  ]) {
    requireField(model?.artifactIdentity?.[field], `${path}.artifactIdentity.${field}`, reasons);
  }
  for (const field of [
    'alphabet',
    'maxSequenceLength',
    'normalization',
    'canonicalSymbols',
    'pooledEmbedding'
  ]) {
    requireField(model?.sequence?.[field], `${path}.sequence.${field}`, reasons);
  }
  requireField(model?.sequence?.coordinates?.mapping, `${path}.sequence.coordinates.mapping`, reasons);
  requireField(model?.runtimeContract?.minimumDopplerVersion, `${path}.runtimeContract.minimumDopplerVersion`, reasons);
  requireField(model?.runtimeContract?.executionSchema, `${path}.runtimeContract.executionSchema`, reasons);
  requireField(model?.runtimeContract?.kernelPathId, `${path}.runtimeContract.kernelPathId`, reasons);
  requireField(model?.license?.sourceRevision, `${path}.license.sourceRevision`, reasons);
  requireField(model?.license?.admission, `${path}.license.admission`, reasons);
  requireField(model?.license?.productUse, `${path}.license.productUse`, reasons);
  requireField(model?.admission?.pooldayState, `${path}.admission.pooldayState`, reasons);
  requireField(model?.admission?.nodeWebGpu, `${path}.admission.nodeWebGpu`, reasons);
  requireField(model?.admission?.browserWebGpu, `${path}.admission.browserWebGpu`, reasons);
  requireField(model?.admission?.scientificFitness, `${path}.admission.scientificFitness`, reasons);
  if (!Array.isArray(model?.license?.sourceTerms) || model.license.sourceTerms.length === 0) {
    reasons.push(`${path}.license.sourceTerms must contain at least one frozen source term`);
  }
  if (model?.enabled !== false) {
    if (model.license?.admission !== 'approved') {
      reasons.push(`${path}.license.admission must be approved before enabling the model`);
    }
    if (!['qualified', 'enabled_release_receipt_required'].includes(model.admission?.browserWebGpu)) {
      reasons.push(`${path}.admission.browserWebGpu must be qualified before enabling the model`);
    }
    if (model.admission?.scientificFitness === 'missing') {
      reasons.push(`${path}.admission.scientificFitness cannot be missing for an enabled model`);
    }
  }
};

export function validatePoolConfigValue(config = {}) {
  const reasons = [];
  const modelCatalog = Array.isArray(config.modelCatalog) ? config.modelCatalog : [];
  const launchModel = typeof config.launchModelId === 'string'
    ? modelCatalog.find((model) => model.modelId === config.launchModelId)
    : config.launchModel;
  requireField(config.schema, 'schema', reasons);
  requireField(config.configVersion, 'configVersion', reasons);
  for (const field of ['modelId', 'modelHash', 'manifestHash', 'runtime', 'backend', 'dopplerLoadRef']) {
    requireField(launchModel?.[field], `launchModel.${field}`, reasons);
  }
  if (!isProteinPoolModel(launchModel)) reasons.push('launchModel must be a protein sequence model');
  modelCatalog.forEach((model, index) => {
    if (isBiologicalSequencePoolModel(model)) validateSequenceModelContract(model, index, reasons);
    if (model.enabled !== false && !isBiologicalSequencePoolModel(model)) {
      reasons.push(`enabled model ${model.modelId || 'unknown'} must be a biological sequence model`);
    }
  });
  requireField(config.browserRuntime?.dopplerModuleUrl, 'browserRuntime.dopplerModuleUrl', reasons);
  requireField(config.browserRuntime?.dopplerKernelBaseUrl, 'browserRuntime.dopplerKernelBaseUrl', reasons);
  requireField(config.browserRuntime?.modelBaseUrl, 'browserRuntime.modelBaseUrl', reasons);

  for (const [policyId, policy] of Object.entries(config.policies || {})) {
    if (policy.policyId !== policyId) reasons.push(`policies.${policyId}.policyId must match key`);
    if (!policy.allowedModels?.includes(launchModel?.modelId)) {
      reasons.push(`policies.${policyId}.allowedModels must include launch model`);
    }
    if (policy.allowFallbackModel !== false) reasons.push(`policies.${policyId}.allowFallbackModel must be false`);
    if (policy.allowServerProvider !== false) reasons.push(`policies.${policyId}.allowServerProvider must be false`);
    if (policy.allowBrowserProvider !== true) reasons.push(`policies.${policyId}.allowBrowserProvider must be true`);
    if (policy.agreementMode === 'ring_quorum') {
      requireField(policy.minRingSize, `policies.${policyId}.minRingSize`, reasons);
      requireField(policy.maxRingSize, `policies.${policyId}.maxRingSize`, reasons);
      requireField(policy.quorum, `policies.${policyId}.quorum`, reasons);
      requireField(policy.agreementField, `policies.${policyId}.agreementField`, reasons);
      for (let size = Number(policy.minRingSize || 1); size <= Number(policy.maxRingSize || 1); size += 1) {
        requireField(
          policy.effectiveTrustByRingSize?.[String(size)],
          `policies.${policyId}.effectiveTrustByRingSize.${size}`,
          reasons
        );
      }
    }
    const ledgerReasons = config.ledgerReasons?.[policy.agreementMode || 'single'];
    if (!ledgerReasons?.award) reasons.push(`ledgerReasons.${policy.agreementMode || 'single'}.award is required`);
    if (!ledgerReasons?.spend) reasons.push(`ledgerReasons.${policy.agreementMode || 'single'}.spend is required`);
  }

  const transport = config.transportModes?.[config.activeTransportMode];
  if (!transport) reasons.push('activeTransportMode must reference transportModes');
  if (transport?.signalingAllowedTypes?.some((type) => (
    !['offer', 'answer', 'ice-candidate', 'close', 'ping'].includes(type)
  ))) {
    reasons.push('active transport signalingAllowedTypes contains unsafe type');
  }

  const activeDeterminism = config.determinismProfiles?.profiles?.[config.determinismProfiles?.activeProfileId];
  if (!activeDeterminism) reasons.push('determinismProfiles.activeProfileId must reference determinismProfiles.profiles');
  if (activeDeterminism?.allowToleranceAcceptance) {
    reasons.push('active determinism profile must not allow tolerance acceptance');
  }
  if (activeDeterminism?.requireRuntimeProfile && !activeDeterminism?.requireRuntimeProfileHash) {
    reasons.push('active determinism profile requiring runtimeProfile must also require runtimeProfileHash');
  }

  const activeRingProtocol = config.ringPhaseProtocols?.protocols?.[config.ringPhaseProtocols?.activeProtocolId];
  if (!activeRingProtocol) reasons.push('ringPhaseProtocols.activeProtocolId must reference ringPhaseProtocols.protocols');
  if (activeRingProtocol && activeRingProtocol.requireRevealBeforeReceipt !== true) {
    reasons.push('active ring phase protocol must require reveal before receipt');
  }
  if (activeRingProtocol && activeRingProtocol.requireCommitmentForLedgerAward !== true) {
    reasons.push('active ring phase protocol must require commitment for ledger award');
  }

  const activeAdmissionPolicy = config.providerAdmissionPolicies?.policies?.[
    config.providerAdmissionPolicies?.activePolicyId
  ];
  if (!activeAdmissionPolicy) {
    reasons.push('providerAdmissionPolicies.activePolicyId must reference providerAdmissionPolicies.policies');
  }
  if (!activeAdmissionPolicy?.lanes?.[activeAdmissionPolicy?.defaultLane]) {
    reasons.push('active provider admission policy defaultLane must reference lanes');
  }

  const activeStateMode = config.stateModes?.modes?.[config.stateModes?.activeModeId];
  if (!activeStateMode) reasons.push('stateModes.activeModeId must reference stateModes.modes');
  if (!activeStateMode?.appendOnlyCollections?.includes('commitment_events')) {
    reasons.push('active state mode must declare commitment_events collection');
  }
  if (!activeStateMode?.appendOnlyCollections?.includes('reveal_events')) {
    reasons.push('active state mode must declare reveal_events collection');
  }

  for (const [policyId, policy] of Object.entries(config.policies || {})) {
    if (policy.agreementMode !== 'ring_quorum') continue;
    if (!config.determinismProfiles?.profiles?.[policy.determinismProfileId]) {
      reasons.push(`policies.${policyId}.determinismProfileId must reference determinismProfiles`);
    }
    if (!config.ringPhaseProtocols?.protocols?.[policy.ringPhaseProtocolId]) {
      reasons.push(`policies.${policyId}.ringPhaseProtocolId must reference ringPhaseProtocols`);
    }
    if (!config.providerAdmissionPolicies?.policies?.[policy.providerAdmissionPolicyId]) {
      reasons.push(`policies.${policyId}.providerAdmissionPolicyId must reference providerAdmissionPolicies`);
    }
    if (!config.stateModes?.modes?.[policy.stateModeId]) {
      reasons.push(`policies.${policyId}.stateModeId must reference stateModes`);
    }
    if (policy.requireCommitReveal !== true) reasons.push(`policies.${policyId}.requireCommitReveal must be true`);
    if (policy.requireRuntimeProfile !== true) reasons.push(`policies.${policyId}.requireRuntimeProfile must be true`);
    if (policy.requireProviderAdmission !== true) {
      reasons.push(`policies.${policyId}.requireProviderAdmission must be true`);
    }
  }

  return {
    ok: reasons.length === 0,
    reasons
  };
}

export function createPoolConfigContract(config, { hashJson = null } = {}) {
  const POOL_CONFIG = deepFreeze(cloneValue(config || {}));
  const POOL_CONFIG_VERSION = POOL_CONFIG.configVersion;
  const POOL_CONFIG_HASH = typeof hashJson === 'function' ? hashJson(POOL_CONFIG) : null;
  const FASTEST_RECEIPT_POLICY_ID = POLICY_IDS.fastestReceipt;
  const MODEL_CATALOG = deepFreeze(cloneValue(
    POOL_CONFIG.modelCatalog || [POOL_CONFIG.launchModel]
  ));
  const LAUNCH_MODEL = deepFreeze(cloneValue(
    (typeof POOL_CONFIG.launchModelId === 'string'
      ? MODEL_CATALOG.find((model) => model.modelId === POOL_CONFIG.launchModelId)
      : null)
    || POOL_CONFIG.launchModel
    || {}
  ));
  const DETERMINISTIC_GENERATION_CONFIG = deepFreeze(cloneValue(POOL_CONFIG.generationConfig || {}));
  const BROWSER_RUNTIME_CONFIG = deepFreeze(cloneValue(POOL_CONFIG.browserRuntime || {}));
  const POLICIES = deepFreeze(cloneValue(POOL_CONFIG.policies || {}));
  const DETERMINISM_PROFILES = deepFreeze(cloneValue(POOL_CONFIG.determinismProfiles?.profiles || {}));
  const RING_PHASE_PROTOCOLS = deepFreeze(cloneValue(POOL_CONFIG.ringPhaseProtocols?.protocols || {}));
  const PROVIDER_ADMISSION_POLICIES = deepFreeze(cloneValue(
    POOL_CONFIG.providerAdmissionPolicies?.policies || {}
  ));
  const STATE_MODES = deepFreeze(cloneValue(POOL_CONFIG.stateModes?.modes || {}));

  const getPoolConfig = () => POOL_CONFIG;
  const getPolicy = (policyId = FASTEST_RECEIPT_POLICY_ID) => POLICIES[policyId] || null;
  const listPolicies = () => Object.values(POLICIES);
  const getTrustTier = (tierId) => POOL_CONFIG.trustTiers?.[tierId] || null;
  const getActiveTransportMode = () => POOL_CONFIG.transportModes?.[POOL_CONFIG.activeTransportMode] || null;
  const getDeterminismProfile = (
    profileId = POOL_CONFIG.determinismProfiles?.activeProfileId
  ) => POOL_CONFIG.determinismProfiles?.profiles?.[profileId] || null;
  const getRingPhaseProtocol = (
    protocolId = POOL_CONFIG.ringPhaseProtocols?.activeProtocolId
  ) => POOL_CONFIG.ringPhaseProtocols?.protocols?.[protocolId] || null;
  const getProviderAdmissionPolicy = (
    policyId = POOL_CONFIG.providerAdmissionPolicies?.activePolicyId
  ) => POOL_CONFIG.providerAdmissionPolicies?.policies?.[policyId] || null;
  const getStateMode = (
    modeId = POOL_CONFIG.stateModes?.activeModeId
  ) => POOL_CONFIG.stateModes?.modes?.[modeId] || null;
  const getLedgerReasons = (
    mode = 'single'
  ) => POOL_CONFIG.ledgerReasons?.[mode] || POOL_CONFIG.ledgerReasons?.single || {};
  const effectiveTrustTierForRingSize = (
    ringSize,
    policy = getPolicy(POLICY_IDS.ringQuorumReceipt)
  ) => {
    const key = String(Math.max(1, Number(ringSize || 1)));
    return policy?.effectiveTrustByRingSize?.[key] || policy?.trustTier || 'T1_signed_receipt';
  };
  const quorumForRingSize = (
    ringSize,
    policy = getPolicy(POLICY_IDS.ringQuorumReceipt)
  ) => {
    const size = Math.max(1, Number(ringSize || 1));
    if (Number.isInteger(policy?.requiredAgreeingProviders)) {
      return Math.max(1, Math.min(size, Number(policy.requiredAgreeingProviders)));
    }
    if (policy?.quorum === 'all') return size;
    return Math.floor(size / 2) + 1;
  };
  const validatePoolConfig = (candidate = POOL_CONFIG) => validatePoolConfigValue(candidate);

  return Object.freeze({
    POOL_CONFIG,
    POOL_CONFIG_VERSION,
    POOL_CONFIG_HASH,
    POLICY_IDS,
    FASTEST_RECEIPT_POLICY_ID,
    LAUNCH_MODEL,
    MODEL_CATALOG,
    DETERMINISTIC_GENERATION_CONFIG,
    BROWSER_RUNTIME_CONFIG,
    POLICIES,
    LAUNCH_POLICIES: POLICIES,
    DETERMINISM_PROFILES,
    RING_PHASE_PROTOCOLS,
    PROVIDER_ADMISSION_POLICIES,
    STATE_MODES,
    getPoolConfig,
    getPolicy,
    listPolicies,
    getTrustTier,
    getActiveTransportMode,
    getDeterminismProfile,
    getRingPhaseProtocol,
    getProviderAdmissionPolicy,
    getStateMode,
    getLedgerReasons,
    effectiveTrustTierForRingSize,
    quorumForRingSize,
    validatePoolConfig
  });
}

export default {
  POLICY_IDS,
  createPoolConfigContract,
  validatePoolConfigValue
};
