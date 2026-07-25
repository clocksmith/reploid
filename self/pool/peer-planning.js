/**
 * @fileoverview Deterministic provider selection and ring planning for Poolday peers.
 */

import { hashJson } from './inference-receipt.js';
import {
  effectiveTrustTierForRingSize,
  quorumForRingSize
} from './config.js';
import { POOLDAY_MODEL_WORKLOADS } from './model-contract.js';
import { agreementFieldForWorkload } from './sequence-workload.js';

export const peerIdForMessage = (message = {}) => (
  message.body?.providerId || message.body?.requesterId || message.fromPeerId
);

export const selectRuntimeCompatibleAdverts = ({
  verifiedAdverts = [],
  policy = {},
  minProviders = 1,
  maxProviders = verifiedAdverts.length
} = {}) => {
  if (!policy.requireHomogeneousRuntimeProfile) {
    return {
      ok: true,
      selected: verifiedAdverts.slice(0, Math.min(maxProviders, verifiedAdverts.length))
    };
  }
  const groups = new Map();
  for (const candidate of verifiedAdverts) {
    const runtimeProfileHash = candidate.advert.body?.runtimeProfileHash || 'runtime_profile_hash_missing';
    const group = groups.get(runtimeProfileHash) || [];
    group.push(candidate);
    groups.set(runtimeProfileHash, group);
  }
  const rankedGroups = [...groups.entries()]
    .map(([runtimeProfileHash, candidates]) => ({
      runtimeProfileHash,
      candidates,
      firstSortKey: candidates[0]?.sortKey || ''
    }))
    .sort((left, right) => {
      if (right.candidates.length !== left.candidates.length) return right.candidates.length - left.candidates.length;
      const sortCompare = left.firstSortKey.localeCompare(right.firstSortKey);
      return sortCompare || left.runtimeProfileHash.localeCompare(right.runtimeProfileHash);
    });
  const selectedGroup = rankedGroups[0] || null;
  const selected = selectedGroup?.candidates.slice(0, Math.min(maxProviders, selectedGroup.candidates.length)) || [];
  return {
    ok: selected.length >= minProviders,
    selected,
    runtimeProfileHash: selectedGroup?.runtimeProfileHash || null,
    compatibleProviders: selected.length
  };
};

export const candidateSortKey = async ({ intentHash, advert }) => hashJson({
  intentHash,
  providerId: peerIdForMessage(advert),
  runtimeProfileHash: advert.body?.runtimeProfileHash || null,
  publicKey: advert.publicKey
});

const ringAttemptIdFor = (intentHash, assignmentAttemptId = 1) => (
  `peer_ring_attempt_${intentHash.replace(/^sha256:/, '').slice(0, 16)}_${assignmentAttemptId}`
);

export const intentWorkload = (intent = {}) => (
  intent.body?.workload
  || intent.body?.modelRequirements?.workload
  || intent.body?.modelRequirements?.workloadType
  || POOLDAY_MODEL_WORKLOADS.textGeneration
);

export const intentMaxTokens = (intent = {}) => Math.max(0, Number(
  intent.body?.generationConfig?.maxOutputTokens
    ?? intent.body?.generationConfig?.maxTokens
    ?? 0
));

export const providerAssignmentLimits = (advert = {}) => {
  const availability = advert.body?.availability || {};
  return {
    maxConcurrentJobs: Number(availability.maxConcurrentJobs || 1),
    maxTokensPerJob: Number(availability.maxTokensPerJob || 0),
    storageBudgetMiB: Number(availability.storageBudgetMiB || 0),
    bandwidthBudgetMbps: Number(availability.bandwidthBudgetMbps || 0)
  };
};

export const agreementFieldForIntent = (intent = {}, policy = {}) => {
  const workloadField = agreementFieldForWorkload(intentWorkload(intent));
  return workloadField === 'tokenIdsHash'
    ? (policy.agreementField || workloadField)
    : workloadField;
};

export async function buildPeerRingPlan({
  intent,
  intentHash,
  candidates,
  policy,
  assignmentAttemptId = 1
}) {
  const providerIds = candidates.map((candidate) => peerIdForMessage(candidate.advert));
  const ringSeed = await hashJson({
    schema: 'reploid.peer.ring_seed/v1',
    intentHash,
    policyId: policy.policyId,
    providerIds: [...providerIds].sort()
  });
  const orderedWithKeys = await Promise.all(candidates.map(async (candidate) => ({
    ...candidate,
    ringSortKey: await hashJson({ ringSeed, providerId: peerIdForMessage(candidate.advert) })
  })));
  const ordered = orderedWithKeys.sort((left, right) => left.ringSortKey.localeCompare(right.ringSortKey));
  const orderedProviderIds = ordered.map((candidate) => peerIdForMessage(candidate.advert));
  const ringSize = orderedProviderIds.length;
  const requiredAgreement = quorumForRingSize(ringSize, policy);
  const layout = {
    schema: 'reploid.peer.ring_layout/v1',
    intentHash,
    policyId: policy.policyId,
    assignmentAttemptId,
    ringAttemptId: ringAttemptIdFor(intentHash, assignmentAttemptId),
    ringSize,
    requiredAgreement,
    agreementField: agreementFieldForIntent(intent, policy),
    providerIds: orderedProviderIds,
    ringSeed
  };
  const layoutHash = await hashJson(layout);
  return {
    ...layout,
    ringId: `peer_ring_${layoutHash.replace(/^sha256:/, '').slice(0, 16)}`,
    layout,
    layoutHash,
    effectiveTrustTier: effectiveTrustTierForRingSize(ringSize, policy),
    candidates: ordered
  };
}
