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

export {
  DETERMINISTIC_GENERATION_CONFIG,
  FASTEST_RECEIPT_POLICY_ID,
  LAUNCH_POLICIES,
  POLICY_IDS,
  getPolicy,
  listPolicies
};

export const FASTEST_RECEIPT_POLICY = LAUNCH_POLICIES[POLICY_IDS.fastestReceipt];
export const CANARY_AUDITED_POLICY = LAUNCH_POLICIES[POLICY_IDS.canaryAudited];
export const REDUNDANT_AGREEMENT_POLICY = LAUNCH_POLICIES[POLICY_IDS.redundantAgreement];
export const RING_QUORUM_RECEIPT_POLICY = LAUNCH_POLICIES[POLICY_IDS.ringQuorumReceipt];
export const POOLDAY_POLICY_CLASSES = Object.freeze({
  publicText: 'public_text',
  codeHelp: 'code_help',
  benchmarkEval: 'benchmark_eval',
  pii: 'pii',
  secrets: 'secrets',
  medicalPrivate: 'medical_private',
  illegalContent: 'illegal_content'
});

const BLOCKED_PUBLIC_PROVIDER_CLASSES = new Set([
  POOLDAY_POLICY_CLASSES.pii,
  POOLDAY_POLICY_CLASSES.secrets,
  POOLDAY_POLICY_CLASSES.medicalPrivate,
  POOLDAY_POLICY_CLASSES.illegalContent
]);

export function classifyPooldayPrompt(prompt = '') {
  const text = String(prompt || '');
  const classes = new Set([POOLDAY_POLICY_CLASSES.publicText]);
  if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)) classes.add(POOLDAY_POLICY_CLASSES.pii);
  if (/\b(api[_-]?key|secret|password|private[_-]?key|token)\b\s*[:=]/i.test(text)) classes.add(POOLDAY_POLICY_CLASSES.secrets);
  if (/\b(sk-[a-z0-9]{12,}|AIza[0-9A-Za-z_-]{20,})\b/.test(text)) classes.add(POOLDAY_POLICY_CLASSES.secrets);
  if (/\b(patient|diagnosis|medical record|prescription)\b/i.test(text)) classes.add(POOLDAY_POLICY_CLASSES.medicalPrivate);
  if (/\b(malware|credential theft|phishing kit|exploit chain)\b/i.test(text)) classes.add(POOLDAY_POLICY_CLASSES.illegalContent);
  return Object.freeze({
    classes: [...classes],
    blockedClasses: [...classes].filter((policyClass) => BLOCKED_PUBLIC_PROVIDER_CLASSES.has(policyClass)),
    publicProviderSafe: [...classes].every((policyClass) => !BLOCKED_PUBLIC_PROVIDER_CLASSES.has(policyClass))
  });
}

export function validatePooldayPolicyClasses(request = {}) {
  const reasons = [];
  const classification = classifyPooldayPrompt(request.prompt || '');
  const explicitTags = Array.isArray(request.policyTags) ? request.policyTags.map(String) : [];
  const blockedTags = explicitTags.filter((tag) => BLOCKED_PUBLIC_PROVIDER_CLASSES.has(tag));
  if (classification.blockedClasses.length > 0) {
    reasons.push(`prompt policy classes are not allowed for public browser providers: ${classification.blockedClasses.join(', ')}`);
  }
  if (blockedTags.length > 0) {
    reasons.push(`policyTags are not allowed for public browser providers: ${blockedTags.join(', ')}`);
  }
  return {
    ok: reasons.length === 0,
    reasons,
    classification: {
      ...classification,
      explicitTags
    }
  };
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
