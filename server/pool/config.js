/**
 * @fileoverview Canonical server pool config helpers.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hashJson } from './hash.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, '..', '..', 'self', 'pool', 'pool-config.json');
const poolConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

export const POOL_CONFIG = deepFreeze({ ...poolConfig });
export const POOL_CONFIG_VERSION = POOL_CONFIG.configVersion;
export const POOL_CONFIG_HASH = hashJson(POOL_CONFIG);
export const POLICY_IDS = Object.freeze({
  fastestReceipt: 'fastest_receipt',
  canaryAudited: 'canary_audited',
  redundantAgreement: 'redundant_agreement',
  ringQuorumReceipt: 'ring_quorum_receipt'
});
export const LAUNCH_MODEL = Object.freeze({ ...POOL_CONFIG.launchModel });
export const DETERMINISTIC_GENERATION_CONFIG = Object.freeze({ ...POOL_CONFIG.generationConfig });
export const POLICIES = deepFreeze({ ...POOL_CONFIG.policies });
export const DETERMINISM_PROFILES = deepFreeze({ ...POOL_CONFIG.determinismProfiles?.profiles });
export const RING_PHASE_PROTOCOLS = deepFreeze({ ...POOL_CONFIG.ringPhaseProtocols?.protocols });
export const PROVIDER_ADMISSION_POLICIES = deepFreeze({ ...POOL_CONFIG.providerAdmissionPolicies?.policies });
export const STATE_MODES = deepFreeze({ ...POOL_CONFIG.stateModes?.modes });

export function getPoolConfig() {
  return POOL_CONFIG;
}

export function getPolicy(policyId = POLICY_IDS.fastestReceipt) {
  return POLICIES[policyId] || null;
}

export function listPolicies() {
  return Object.values(POLICIES);
}

export function getTrustTier(tierId) {
  return POOL_CONFIG.trustTiers?.[tierId] || null;
}

export function getActiveTransportMode() {
  return POOL_CONFIG.transportModes?.[POOL_CONFIG.activeTransportMode] || null;
}

export function getDeterminismProfile(profileId = POOL_CONFIG.determinismProfiles?.activeProfileId) {
  return POOL_CONFIG.determinismProfiles?.profiles?.[profileId] || null;
}

export function getRingPhaseProtocol(protocolId = POOL_CONFIG.ringPhaseProtocols?.activeProtocolId) {
  return POOL_CONFIG.ringPhaseProtocols?.protocols?.[protocolId] || null;
}

export function getProviderAdmissionPolicy(policyId = POOL_CONFIG.providerAdmissionPolicies?.activePolicyId) {
  return POOL_CONFIG.providerAdmissionPolicies?.policies?.[policyId] || null;
}

export function getStateMode(modeId = POOL_CONFIG.stateModes?.activeModeId) {
  return POOL_CONFIG.stateModes?.modes?.[modeId] || null;
}

export function getLedgerReasons(mode = 'single') {
  return POOL_CONFIG.ledgerReasons?.[mode] || POOL_CONFIG.ledgerReasons?.single || {};
}

export function effectiveTrustTierForRingSize(ringSize, policy = getPolicy(POLICY_IDS.ringQuorumReceipt)) {
  const key = String(Math.max(1, Number(ringSize || 1)));
  return policy?.effectiveTrustByRingSize?.[key] || policy?.trustTier || 'T1_signed_receipt';
}

export function quorumForRingSize(ringSize, policy = getPolicy(POLICY_IDS.ringQuorumReceipt)) {
  const size = Math.max(1, Number(ringSize || 1));
  if (Number.isInteger(policy?.requiredAgreeingProviders)) {
    return Math.max(1, Math.min(size, Number(policy.requiredAgreeingProviders)));
  }
  if (policy?.quorum === 'all') return size;
  return Math.floor(size / 2) + 1;
}

const requireField = (value, path, reasons) => {
  if (value === undefined || value === null || String(value).trim?.() === '') reasons.push(`${path} is required`);
};

export function validatePoolConfig(config = POOL_CONFIG) {
  const reasons = [];
  requireField(config.schema, 'schema', reasons);
  requireField(config.configVersion, 'configVersion', reasons);
  for (const field of ['modelId', 'modelHash', 'manifestHash', 'runtime', 'backend', 'dopplerLoadRef']) {
    requireField(config.launchModel?.[field], `launchModel.${field}`, reasons);
  }
  for (const [policyId, policy] of Object.entries(config.policies || {})) {
    if (policy.policyId !== policyId) reasons.push(`policies.${policyId}.policyId must match key`);
    if (!policy.allowedModels?.includes(config.launchModel?.modelId)) reasons.push(`policies.${policyId}.allowedModels must include launch model`);
    if (policy.allowFallbackModel !== false) reasons.push(`policies.${policyId}.allowFallbackModel must be false`);
    if (policy.allowServerProvider !== false) reasons.push(`policies.${policyId}.allowServerProvider must be false`);
    if (policy.allowBrowserProvider !== true) reasons.push(`policies.${policyId}.allowBrowserProvider must be true`);
    if (policy.agreementMode === 'ring_quorum') {
      requireField(policy.minRingSize, `policies.${policyId}.minRingSize`, reasons);
      requireField(policy.maxRingSize, `policies.${policyId}.maxRingSize`, reasons);
      requireField(policy.quorum, `policies.${policyId}.quorum`, reasons);
      requireField(policy.agreementField, `policies.${policyId}.agreementField`, reasons);
      for (let size = Number(policy.minRingSize || 1); size <= Number(policy.maxRingSize || 1); size += 1) {
        requireField(policy.effectiveTrustByRingSize?.[String(size)], `policies.${policyId}.effectiveTrustByRingSize.${size}`, reasons);
      }
    }
    const ledgerReasons = config.ledgerReasons?.[policy.agreementMode || 'single'];
    if (!ledgerReasons?.award) reasons.push(`ledgerReasons.${policy.agreementMode || 'single'}.award is required`);
    if (!ledgerReasons?.spend) reasons.push(`ledgerReasons.${policy.agreementMode || 'single'}.spend is required`);
  }
  const transport = config.transportModes?.[config.activeTransportMode];
  if (!transport) reasons.push('activeTransportMode must reference transportModes');
  if (transport?.signalingAllowedTypes?.some((type) => !['offer', 'answer', 'ice-candidate', 'close', 'ping'].includes(type))) {
    reasons.push('active transport signalingAllowedTypes contains unsafe type');
  }
  const activeDeterminism = config.determinismProfiles?.profiles?.[config.determinismProfiles?.activeProfileId];
  if (!activeDeterminism) reasons.push('determinismProfiles.activeProfileId must reference determinismProfiles.profiles');
  if (activeDeterminism?.allowToleranceAcceptance) reasons.push('active determinism profile must not allow tolerance acceptance');
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
  const activeAdmissionPolicy = config.providerAdmissionPolicies?.policies?.[config.providerAdmissionPolicies?.activePolicyId];
  if (!activeAdmissionPolicy) reasons.push('providerAdmissionPolicies.activePolicyId must reference providerAdmissionPolicies.policies');
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
    if (policy.requireProviderAdmission !== true) reasons.push(`policies.${policyId}.requireProviderAdmission must be true`);
  }
  return {
    ok: reasons.length === 0,
    reasons
  };
}

export default {
  POOL_CONFIG,
  POOL_CONFIG_VERSION,
  POOL_CONFIG_HASH,
  POLICY_IDS,
  LAUNCH_MODEL,
  DETERMINISTIC_GENERATION_CONFIG,
  POLICIES,
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
};
