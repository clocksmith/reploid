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
import { validateLaunchModelRequirement } from './model-contract.js';
import { hashJson } from './hash.js';
import {
  SEQUENCE_DISCLOSURE,
  SEQUENCE_PUBLIC_SENSITIVITY,
  isSequenceWorkload,
  validateSequenceRequest
} from '../../self/pool/sequence-workload.js';
import {
  POOLDAY_POLICY_CLASSES,
  classifyPooldayPrompt,
  validateGenerationConfig,
  validatePooldayPolicyClasses
} from '../../self/pool/policy-validation.js';

export {
  DETERMINISTIC_GENERATION_CONFIG,
  POLICIES,
  POLICY_IDS,
  getPolicy,
  listPolicies,
  POOLDAY_POLICY_CLASSES,
  classifyPooldayPrompt,
  validatePooldayPolicyClasses
};

export const FASTEST_RECEIPT_POLICY = POLICIES[POLICY_IDS.fastestReceipt];
export const CANARY_AUDITED_POLICY = POLICIES[POLICY_IDS.canaryAudited];
export const REDUNDANT_AGREEMENT_POLICY = POLICIES[POLICY_IDS.redundantAgreement];
export const RING_QUORUM_RECEIPT_POLICY = POLICIES[POLICY_IDS.ringQuorumReceipt];
export function validateDeterministicGenerationConfig(config = {}) {
  return validateGenerationConfig(config, DETERMINISTIC_GENERATION_CONFIG);
}

export function validateJobRequest(request = {}) {
  const policyId = request.policyId || POLICY_IDS.fastestReceipt;
  const policy = getPolicy(policyId);
  const reasons = [];
  const sequenceWorkload = isSequenceWorkload(request.modelRequirements?.workload);
  if (!policy) reasons.push(`Unsupported pool policy: ${policyId}`);
  if (!request.requesterId) reasons.push('requesterId is required');
  if (!request.requesterPublicKey) reasons.push('requesterPublicKey is required');
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
  if (sequenceWorkload) {
    const sequenceRequest = request.sequenceRequest || request.modelRequirements?.sequenceRequest || {};
    if (request.inputKind !== 'sequence') reasons.push('sequence inputKind must be sequence');
    if (request.inputTransport !== 'webrtc_datachannel') {
      reasons.push('sequence inputTransport must be webrtc_datachannel');
    }
    if (request.inputDisclosure !== SEQUENCE_DISCLOSURE) {
      reasons.push(`sequence inputDisclosure must be ${SEQUENCE_DISCLOSURE}`);
    }
    if (request.sequence !== undefined && request.sequence !== null) {
      reasons.push('raw sequence must not be sent to the coordinator job route');
    }
    if (request.prompt !== undefined && request.prompt !== null && request.prompt !== '') {
      reasons.push('sequence jobs must not place raw input in prompt');
    }
    reasons.push(...validateSequenceRequest(sequenceRequest, {
      model: request.modelRequirements
    }).reasons);
    if (request.inputHash !== sequenceRequest.sequenceHash) {
      reasons.push('sequence inputHash must match sequenceRequest.sequenceHash');
    }
    if (request.sequenceRequestHash !== hashJson(sequenceRequest)) {
      reasons.push('sequenceRequestHash must match sequenceRequest');
    }
    if (hashJson(request.modelRequirements?.sequenceRequest || null) !== hashJson(sequenceRequest)) {
      reasons.push('modelRequirements.sequenceRequest must match sequenceRequest');
    }
    if (sequenceRequest.sensitivity !== SEQUENCE_PUBLIC_SENSITIVITY) {
      reasons.push('coordinator sequence assignments require explicit public sensitivity');
    }
  } else if (!request.prompt) {
    reasons.push('prompt is required');
  }
  if (policy) reasons.push(...validateDeterministicGenerationConfig(request.generationConfig || {}));
  if (policy) reasons.push(...validateLaunchModelRequirement(request.modelRequirements || {}).reasons);
  reasons.push(...validatePooldayPolicyClasses({
    ...request,
    prompt: sequenceWorkload ? '' : request.prompt
  }).reasons);
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
  classifyPooldayPrompt,
  validatePooldayPolicyClasses,
  validateJobRequest
};
