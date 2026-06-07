/**
 * @fileoverview Server-side launch policy contract.
 */

import { LAUNCH_MODEL, isLaunchModelRequirement } from './model-contract.js';

export const FASTEST_RECEIPT_POLICY = Object.freeze({
  policyId: 'fastest_receipt',
  allowedModels: [LAUNCH_MODEL.modelId],
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

export function getPolicy(policyId = 'fastest_receipt') {
  return policyId === 'fastest_receipt' ? FASTEST_RECEIPT_POLICY : null;
}

export function validateJobRequest(request = {}) {
  const policyId = request.policyId || 'fastest_receipt';
  const policy = getPolicy(policyId);
  const reasons = [];
  if (!policy) reasons.push(`Unsupported launch policy: ${policyId}`);
  if (!request.requesterId) reasons.push('requesterId is required');
  if (!request.prompt) reasons.push('prompt is required');
  if (!request.requesterPublicKey) reasons.push('requesterPublicKey is required');
  if (!request.modelRequirements?.modelId) reasons.push('modelRequirements.modelId is required');
  if (!request.modelRequirements?.modelHash) reasons.push('modelRequirements.modelHash is required');
  if (!request.modelRequirements?.manifestHash) reasons.push('modelRequirements.manifestHash is required');
  if (policy && Number(request.generationConfig?.maxOutputTokens || 0) > policy.maxOutputTokens) {
    reasons.push(`maxOutputTokens exceeds policy limit: ${policy.maxOutputTokens}`);
  }
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
