/**
 * @fileoverview Browser policy contract from canonical pool config.
 */

import {
  DETERMINISTIC_GENERATION_CONFIG,
  FASTEST_RECEIPT_POLICY_ID,
  LAUNCH_POLICIES,
  POLICY_IDS,
  getPolicy,
  listPolicies
} from './config.js';
import { validateLaunchModelRequirement } from './model-contract.js';
import {
  POOLDAY_POLICY_CLASSES,
  classifyPooldayPrompt,
  validateGenerationConfig,
  validatePooldayPolicyClasses
} from './policy-validation.js';

export {
  DETERMINISTIC_GENERATION_CONFIG,
  FASTEST_RECEIPT_POLICY_ID,
  LAUNCH_POLICIES,
  POLICY_IDS,
  getPolicy,
  listPolicies,
  POOLDAY_POLICY_CLASSES,
  classifyPooldayPrompt,
  validatePooldayPolicyClasses
};

export const FASTEST_RECEIPT_POLICY = LAUNCH_POLICIES[POLICY_IDS.fastestReceipt];
export const CANARY_AUDITED_POLICY = LAUNCH_POLICIES[POLICY_IDS.canaryAudited];
export const REDUNDANT_AGREEMENT_POLICY = LAUNCH_POLICIES[POLICY_IDS.redundantAgreement];
export const RING_QUORUM_RECEIPT_POLICY = LAUNCH_POLICIES[POLICY_IDS.ringQuorumReceipt];
export function validateDeterministicGenerationConfig(config = {}) {
  return validateGenerationConfig(config, DETERMINISTIC_GENERATION_CONFIG);
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
  if (
    policy
    && request.modelRequirements?.modelId
    && !policy.allowedModels?.includes(request.modelRequirements.modelId)
  ) {
    reasons.push(`model ${request.modelRequirements.modelId} is not allowed by policy ${policyId}`);
  }
  if (policy) reasons.push(...validateDeterministicGenerationConfig(request.generationConfig || {}));
  if (policy) reasons.push(...validateLaunchModelRequirement(request.modelRequirements || {}).reasons);
  if (request.prompt !== undefined || request.policyTags !== undefined) {
    reasons.push(...validatePooldayPolicyClasses(request).reasons);
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
    policyTrustTier: policy.policyTrustTier || policy.trustTier,
    launch: true,
    allowedModels: policy.allowedModels,
    deterministicGenerationConfig: DETERMINISTIC_GENERATION_CONFIG,
    redundancy: policy.redundancy,
    summary: policy.adaptiveRing
      ? 'One to twelve eligible browser providers run the same deterministic assignment in a coordinator-ordered ring; majority matching token/output hashes form the accepted ring receipt.'
      : policy.redundancy > 1
      ? 'Multiple independent browser providers must return matching signed receipts before requester acceptance and split point awards.'
      : 'Single eligible browser provider, exact model identity, deterministic generation, signed assignment-bound receipt, verifier decision, requester acceptance before points.'
  };
}
