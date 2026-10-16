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
