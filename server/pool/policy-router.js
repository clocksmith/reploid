/**
 * @fileoverview Server-side pool policy contract from canonical config.
 */

import {
  DETERMINISTIC_GENERATION_CONFIG,
  POLICIES,
  POLICY_IDS,
  getPolicy,
  listPolicies
} from './config.js';
import { isLaunchModelRequirement } from './model-contract.js';

export { DETERMINISTIC_GENERATION_CONFIG, POLICIES, POLICY_IDS, getPolicy, listPolicies };

export const FASTEST_RECEIPT_POLICY = POLICIES[POLICY_IDS.fastestReceipt];
export const CANARY_AUDITED_POLICY = POLICIES[POLICY_IDS.canaryAudited];
export const REDUNDANT_AGREEMENT_POLICY = POLICIES[POLICY_IDS.redundantAgreement];
export const RING_QUORUM_RECEIPT_POLICY = POLICIES[POLICY_IDS.ringQuorumReceipt];

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
    reasons.push('model requirements do not match an enabled model contract');
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
