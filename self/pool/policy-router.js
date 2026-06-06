/**
 * @fileoverview Fixed launch policy contracts for the Reploid browser inference pool.
 */

export const FASTEST_RECEIPT_POLICY_ID = 'fastest_receipt';

export const FASTEST_RECEIPT_POLICY = Object.freeze({
  policyId: FASTEST_RECEIPT_POLICY_ID,
  allowedModels: ['v0_default'],
  minProviderReputation: 0,
  maxQueueDepth: 100,
  maxInputTokens: 1024,
  maxOutputTokens: 128,
  verificationLevel: 'signed_receipt',
  redundancy: 1,
  requireCanaryEligibleProvider: false,
  requireProgramBundle: false,
  allowFallbackModel: false,
  allowServerProvider: false,
  allowBrowserProvider: true,
  pointCostMultiplier: 1
});

export const LAUNCH_POLICIES = Object.freeze({
  [FASTEST_RECEIPT_POLICY_ID]: FASTEST_RECEIPT_POLICY
});

export function getPolicy(policyId = FASTEST_RECEIPT_POLICY_ID) {
  return LAUNCH_POLICIES[policyId] || null;
}

export function validatePolicyRequest(request = {}) {
  const policyId = request.policyId || FASTEST_RECEIPT_POLICY_ID;
  const policy = getPolicy(policyId);
  const reasons = [];
  if (!policy) reasons.push(`Unsupported launch policy: ${policyId}`);
  if (policy && request.generationConfig?.maxOutputTokens > policy.maxOutputTokens) {
    reasons.push(`maxOutputTokens exceeds policy limit: ${policy.maxOutputTokens}`);
  }
  if (policy && request.modelRequirements?.modelId && !policy.allowedModels.includes('v0_default')) {
    reasons.push('Policy model allowlist is not configured for explicit model routing');
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
    trustTier: 'T1_signed_receipt',
    launch: true,
    summary: 'Single eligible browser provider, signed assignment-bound receipt, verifier decision, requester acceptance before points.'
  };
}
