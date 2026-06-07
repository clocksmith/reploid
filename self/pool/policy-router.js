/**
 * @fileoverview Fixed policy contracts for the Reploid browser inference pool.
 */

import { LAUNCH_MODEL, isLaunchModelRequirement } from './model-contract.js';

export const POLICY_IDS = Object.freeze({
  fastestReceipt: 'fastest_receipt',
  canaryAudited: 'canary_audited',
  redundantAgreement: 'redundant_agreement',
  ringQuorumReceipt: 'ring_quorum_receipt'
});

export const FASTEST_RECEIPT_POLICY_ID = POLICY_IDS.fastestReceipt;

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
  trustTier: 'T1_signed_receipt',
  verificationLevel: 'signed_receipt',
  redundancy: 1,
  requireCanaryEligibleProvider: false
});

export const CANARY_AUDITED_POLICY = Object.freeze({
  ...BASE_POLICY,
  policyId: POLICY_IDS.canaryAudited,
  trustTier: 'T2_canary_audited',
  verificationLevel: 'canary_audited',
  redundancy: 1,
  requireCanaryEligibleProvider: true,
  minPassedCanaries: 1
});

export const REDUNDANT_AGREEMENT_POLICY = Object.freeze({
  ...BASE_POLICY,
  policyId: POLICY_IDS.redundantAgreement,
  trustTier: 'T3_redundant_agreement',
  verificationLevel: 'redundant_agreement',
  redundancy: 2,
  requireCanaryEligibleProvider: false,
  requireMatchingOutputHash: true,
  requireMatchingTokenIdsHash: true
});

export const RING_QUORUM_RECEIPT_POLICY = Object.freeze({
  ...BASE_POLICY,
  policyId: POLICY_IDS.ringQuorumReceipt,
  trustTier: 'T4_ring_quorum_receipt',
  verificationLevel: 'ring_quorum_receipt',
  redundancy: 1,
  adaptiveRing: true,
  minRingSize: 1,
  maxRingSize: 4,
  quorum: 'majority',
  agreementField: 'tokenIdsHash',
  requireCanaryEligibleProvider: false,
  requireMatchingOutputHash: true,
  requireMatchingTokenIdsHash: true,
  requireProviderSignatures: true,
  requireRingCommitment: true,
  requireDeterministicGeneration: true,
  requireExactModelIdentity: true
});

export const LAUNCH_POLICIES = Object.freeze({
  [POLICY_IDS.fastestReceipt]: FASTEST_RECEIPT_POLICY,
  [POLICY_IDS.canaryAudited]: CANARY_AUDITED_POLICY,
  [POLICY_IDS.redundantAgreement]: REDUNDANT_AGREEMENT_POLICY,
  [POLICY_IDS.ringQuorumReceipt]: RING_QUORUM_RECEIPT_POLICY
});

export function getPolicy(policyId = FASTEST_RECEIPT_POLICY_ID) {
  return LAUNCH_POLICIES[policyId] || null;
}

export function listPolicies() {
  return Object.values(LAUNCH_POLICIES);
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

export function validatePolicyRequest(request = {}) {
  const policyId = request.policyId || FASTEST_RECEIPT_POLICY_ID;
  const policy = getPolicy(policyId);
  const reasons = [];
  if (!policy) reasons.push(`Unsupported pool policy: ${policyId}`);
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

export function describePolicy(policyId = FASTEST_RECEIPT_POLICY_ID) {
  const policy = getPolicy(policyId);
  if (!policy) return null;
  return {
    policyId: policy.policyId,
    trustTier: policy.trustTier,
    launch: true,
    allowedModels: policy.allowedModels,
    deterministicGenerationConfig: policy.deterministicGenerationConfig,
    redundancy: policy.redundancy,
    summary: policy.adaptiveRing
      ? 'One to four eligible browser providers run the same deterministic assignment in a coordinator-ordered ring; majority matching token/output hashes form the accepted ring receipt.'
      : policy.redundancy > 1
      ? 'Multiple independent browser providers must return matching signed receipts before requester acceptance and split point awards.'
      : 'Single eligible browser provider, exact model identity, deterministic generation, signed assignment-bound receipt, verifier decision, requester acceptance before points.'
  };
}
