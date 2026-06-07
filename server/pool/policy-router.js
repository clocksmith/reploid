/**
 * @fileoverview Server-side pool policy contract.
 */

import { LAUNCH_MODEL, isLaunchModelRequirement } from './model-contract.js';

export const POLICY_IDS = Object.freeze({
  fastestReceipt: 'fastest_receipt',
  canaryAudited: 'canary_audited',
  redundantAgreement: 'redundant_agreement',
  ringQuorumReceipt: 'ring_quorum_receipt'
});

export const DETERMINISTIC_GENERATION_CONFIG = Object.freeze({
  mode: 'greedy',
  temperature: 0,
  topK: 1,
  topP: 1,
  maxOutputTokens: 128,
  seed: '0000000000000000'
});

const BASE_POLICY = Object.freeze({
  allowedModels: [LAUNCH_MODEL.modelId],
  minProviderReputation: 0,
  maxQueueDepth: 100,
  maxInputTokens: 1024,
  maxOutputTokens: 128,
  requireProgramBundle: false,
  allowFallbackModel: false,
  allowServerProvider: false,
  allowBrowserProvider: true,
  pointCostMultiplier: 1,
  deterministicGenerationConfig: DETERMINISTIC_GENERATION_CONFIG
});

export const FASTEST_RECEIPT_POLICY = Object.freeze({
  ...BASE_POLICY,
  policyId: POLICY_IDS.fastestReceipt,
  verificationLevel: 'signed_receipt',
  trustTier: 'T1_signed_receipt',
  redundancy: 1,
  requireCanaryEligibleProvider: false
});

export const CANARY_AUDITED_POLICY = Object.freeze({
  ...BASE_POLICY,
  policyId: POLICY_IDS.canaryAudited,
  verificationLevel: 'canary_audited',
  trustTier: 'T2_canary_audited',
  redundancy: 1,
  requireCanaryEligibleProvider: true,
  minPassedCanaries: 1
});

export const REDUNDANT_AGREEMENT_POLICY = Object.freeze({
  ...BASE_POLICY,
  policyId: POLICY_IDS.redundantAgreement,
  verificationLevel: 'redundant_agreement',
  trustTier: 'T3_redundant_agreement',
  redundancy: 2,
  requireCanaryEligibleProvider: false,
  requireMatchingOutputHash: true,
  requireMatchingTokenIdsHash: true
});

export const RING_QUORUM_RECEIPT_POLICY = Object.freeze({
  ...BASE_POLICY,
  policyId: POLICY_IDS.ringQuorumReceipt,
  verificationLevel: 'ring_quorum_receipt',
  trustTier: 'T4_ring_quorum_receipt',
  redundancy: 1,
  adaptiveRing: true,
  minRingSize: 1,
  maxRingSize: 4,
  quorum: 'majority',
  agreementField: 'tokenIdsHash',
  requireMatchingOutputHash: true,
  requireMatchingTokenIdsHash: true,
  requireProviderSignatures: true,
  requireRingCommitment: true,
  requireDeterministicGeneration: true,
  requireExactModelIdentity: true,
  requireCanaryEligibleProvider: false
});

export const POLICIES = Object.freeze({
  [POLICY_IDS.fastestReceipt]: FASTEST_RECEIPT_POLICY,
  [POLICY_IDS.canaryAudited]: CANARY_AUDITED_POLICY,
  [POLICY_IDS.redundantAgreement]: REDUNDANT_AGREEMENT_POLICY,
  [POLICY_IDS.ringQuorumReceipt]: RING_QUORUM_RECEIPT_POLICY
});

export function getPolicy(policyId = POLICY_IDS.fastestReceipt) {
  return POLICIES[policyId] || null;
}

export function listPolicies() {
  return Object.values(POLICIES);
}

export function validateDeterministicGenerationConfig(config = {}) {
  const reasons = [];
  const allowedKeys = new Set(Object.keys(DETERMINISTIC_GENERATION_CONFIG));
  for (const [key, expected] of Object.entries(DETERMINISTIC_GENERATION_CONFIG)) {
    if (config[key] !== expected) reasons.push(`generationConfig.${key} must be ${expected}`);
  }
  for (const key of Object.keys(config || {})) {
    if (!allowedKeys.has(key)) reasons.push(`generationConfig.${key} is not allowed`);
  }
  return reasons;
}

export function validateJobRequest(request = {}) {
  const policyId = request.policyId || POLICY_IDS.fastestReceipt;
  const policy = getPolicy(policyId);
  const reasons = [];
  if (!policy) reasons.push(`Unsupported pool policy: ${policyId}`);
  if (!request.requesterId) reasons.push('requesterId is required');
  if (!request.prompt) reasons.push('prompt is required');
  if (!request.requesterPublicKey) reasons.push('requesterPublicKey is required');
  if (!request.modelRequirements?.modelId) reasons.push('modelRequirements.modelId is required');
  if (!request.modelRequirements?.modelHash) reasons.push('modelRequirements.modelHash is required');
  if (!request.modelRequirements?.manifestHash) reasons.push('modelRequirements.manifestHash is required');
  if (!request.modelRequirements?.runtime) reasons.push('modelRequirements.runtime is required');
  if (!request.modelRequirements?.backend) reasons.push('modelRequirements.backend is required');
  if (policy) reasons.push(...validateDeterministicGenerationConfig(request.generationConfig || {}));
  if (policy && !isLaunchModelRequirement(request.modelRequirements || {})) {
    reasons.push('model requirements do not match the launch model identity');
  }
  return {
    ok: reasons.length === 0,
    policy,
    policyId,
    reasons
  };
}

export default {
  POLICY_IDS,
  DETERMINISTIC_GENERATION_CONFIG,
  FASTEST_RECEIPT_POLICY,
  CANARY_AUDITED_POLICY,
  REDUNDANT_AGREEMENT_POLICY,
  RING_QUORUM_RECEIPT_POLICY,
  POLICIES,
  getPolicy,
  listPolicies,
  validateDeterministicGenerationConfig,
  validateJobRequest
};
