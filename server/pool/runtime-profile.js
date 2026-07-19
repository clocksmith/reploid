/**
 * @fileoverview Runtime profile and provider admission helpers for pool scheduling.
 */

import {
  effectiveTrustTierForRingSize,
  getDeterminismProfile,
  getProviderAdmissionPolicy
} from './config.js';
import { hashJson } from './hash.js';

const trustRank = (tierId = '') => {
  const match = String(tierId || '').match(/^T(\d+)/);
  return match ? Number(match[1]) : 1;
};

const getPath = (source = {}, path = '') => path.split('.').reduce((current, key) => (
  current && Object.prototype.hasOwnProperty.call(current, key) ? current[key] : null
), source);

const setPath = (target, path, value) => {
  const parts = path.split('.');
  let current = target;
  while (parts.length > 1) {
    const key = parts.shift();
    current[key] = current[key] || {};
    current = current[key];
  }
  current[parts[0]] = value ?? null;
};

const providerAcceptedPolicies = (provider = {}) => (
  Array.isArray(provider.availability?.acceptedPolicies) ? provider.availability.acceptedPolicies : []
);

export function runtimeProfileHash(runtimeProfile = {}) {
  return hashJson(runtimeProfile || {});
}

export function providerRequestsRing(provider = {}) {
  const accepted = providerAcceptedPolicies(provider);
  return accepted.length === 0 || accepted.includes('ring_quorum_receipt');
}

export function normalizeRuntimeProfileSource({ provider = {}, model = null } = {}) {
  const profile = provider.runtimeProfile || {};
  return {
    model: {
      modelId: model?.modelId || provider.models?.[0]?.modelId || null,
      modelHash: model?.modelHash || provider.models?.[0]?.modelHash || null,
      manifestHash: model?.manifestHash || provider.models?.[0]?.manifestHash || null,
      runtime: model?.runtime || provider.models?.[0]?.runtime || null,
      backend: model?.backend || provider.models?.[0]?.backend || null
    },
    browser: profile.browser || {},
    webgpu: profile.webgpu || provider.device || {},
    doppler: profile.doppler || {},
    runtimeProfileHash: provider.runtimeProfileHash || null
  };
}

export function runtimeProfileBucketKey({ provider = {}, model = null, profile = getDeterminismProfile() } = {}) {
  const source = normalizeRuntimeProfileSource({ provider, model });
  const bucket = {};
  for (const field of profile?.bucketFields || []) {
    setPath(bucket, field, getPath(source, field));
  }
  return hashJson({
    schema: 'reploid.runtime-profile-bucket/v1',
    profileId: profile?.profileId || null,
    bucket
  });
}

export function validateRuntimeProfileForPolicy(provider = {}, policy = {}) {
  const reasons = [];
  const profile = policy.determinismProfileId
    ? getDeterminismProfile(policy.determinismProfileId)
    : null;
  const requiresProfile = policy.requireRuntimeProfile === true || profile?.requireRuntimeProfile === true;
  if (!requiresProfile) return reasons;
  if (!provider.runtimeProfile || typeof provider.runtimeProfile !== 'object') {
    reasons.push('runtimeProfile is required for this policy');
  }
  if (!provider.runtimeProfileHash) {
    reasons.push('runtimeProfileHash is required for this policy');
  } else if (provider.runtimeProfile && runtimeProfileHash(provider.runtimeProfile) !== provider.runtimeProfileHash) {
    reasons.push('runtimeProfileHash does not match runtimeProfile');
  }
  return reasons;
}

export function deriveProviderAdmission({ provider = {}, reputation = {}, policy = {} } = {}) {
  const admissionPolicy = getProviderAdmissionPolicy(policy.providerAdmissionPolicyId);
  const lanes = admissionPolicy?.lanes || {};
  const trustedLane = lanes.trusted_browser_provider;
  const defaultLaneId = admissionPolicy?.defaultLane || 'new_provider_quarantine';
  const providerLane = reputation.admissionLane || null;
  let laneId = providerLane || defaultLaneId;
  const acceptedReceipts = Number(reputation.acceptedReceipts || 0);
  const rejectedReceipts = Number(reputation.rejectedReceipts || 0);
  const timeouts = Number(reputation.timeouts || 0);
  if (provider.routingBlocked || reputation.routingBlocked || provider.quarantineReason || reputation.quarantineReason) {
    laneId = 'quarantined_provider';
  } else if (trustedLane
    && acceptedReceipts >= Number(trustedLane.minAcceptedReceipts || 0)
    && rejectedReceipts <= Number(trustedLane.maxRejectedReceipts ?? Number.MAX_SAFE_INTEGER)
    && timeouts <= Number(trustedLane.maxTimeouts ?? Number.MAX_SAFE_INTEGER)) {
    laneId = 'trusted_browser_provider';
  }
  const lane = lanes[laneId] || lanes[defaultLaneId] || {
    laneId,
    allowAssignments: true,
    allowRingParticipation: true,
    maxProvidersPerRingCluster: 1,
    maxEffectiveTrustTier: 'T1_signed_receipt'
  };
  return {
    policyId: admissionPolicy?.policyId || null,
    laneId,
    lane,
    allowed: lane.allowAssignments !== false,
    ringEligible: lane.allowRingParticipation !== false,
    reasons: lane.allowAssignments === false ? ['provider admission lane does not allow assignments'] : []
  };
}

export function clusterKeysForProvider({ provider = {}, admission = null } = {}) {
  const policy = getProviderAdmissionPolicy(admission?.policyId);
  const fields = policy?.diversity?.clusterFields || [];
  const keys = [];
  for (const field of fields) {
    if (field === 'runtimeProfileBucket') continue;
    const value = provider[field] || provider.runtimeProfile?.[field] || null;
    if (value) keys.push(`${field}:${value}`);
  }
  if (keys.length === 0) keys.push(`providerId:${provider.providerId}`);
  return keys;
}

export function capTrustTierForAdmission(tierId, admissions = []) {
  let current = tierId || 'T1_signed_receipt';
  for (const admission of admissions) {
    const cap = admission?.lane?.maxEffectiveTrustTier;
    if (cap && trustRank(cap) < trustRank(current)) current = cap;
  }
  return current;
}

export function findHomogeneousProviderGroup({ candidates = [], policy = {} } = {}) {
  const profile = getDeterminismProfile(policy.determinismProfileId);
  if (!profile?.requireHomogeneousRing) return candidates;
  const groups = new Map();
  for (const candidate of candidates) {
    const bucket = runtimeProfileBucketKey({ provider: candidate.provider, model: candidate.model, profile });
    const existing = groups.get(bucket) || [];
    existing.push({ ...candidate, runtimeProfileBucket: bucket });
    groups.set(bucket, existing);
  }
  return Array.from(groups.values()).sort((left, right) => right.length - left.length)[0] || [];
}

export function selectDiverseProviderGroup({ candidates = [], policy = {}, maxProviders = candidates.length } = {}) {
  const selected = [];
  const usedClusterKeys = new Set();
  for (const candidate of candidates) {
    const admission = candidate.admission || deriveProviderAdmission({ provider: candidate.provider, reputation: candidate.reputation, policy });
    if (!admission.allowed || (policy.agreementMode === 'ring_quorum' && !admission.ringEligible)) continue;
    const clusterKeys = clusterKeysForProvider({ provider: candidate.provider, admission });
    if (clusterKeys.some((key) => usedClusterKeys.has(key))) continue;
    for (const key of clusterKeys) usedClusterKeys.add(key);
    selected.push({ ...candidate, admission, clusterKeys });
    if (selected.length >= maxProviders) break;
  }
  return selected;
}

export function effectiveTrustTierForRingAdmissions({ ringSize, policy, admissions = [] } = {}) {
  return capTrustTierForAdmission(effectiveTrustTierForRingSize(ringSize, policy), admissions);
}

export default {
  runtimeProfileHash,
  providerRequestsRing,
  normalizeRuntimeProfileSource,
  runtimeProfileBucketKey,
  validateRuntimeProfileForPolicy,
  deriveProviderAdmission,
  clusterKeysForProvider,
  capTrustTierForAdmission,
  findHomogeneousProviderGroup,
  selectDiverseProviderGroup,
  effectiveTrustTierForRingAdmissions
};
