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
import { freezeOperationPolicy as snapshot } from './pack-operation-policy.js';
import { resolveProviderCapabilitySchema, resolvePeerAssignmentPolicy, validateProviderCapabilities, validateWorkRequirements } from './peer-capabilities.js';

/** Pure projection of already verified advertisements. All time and policy are inputs. */
export async function planOperationProviders({ requirements: workInput, candidates: candidateInput, policy: policyInput,
  capabilitySchema: schemaInput, now, observations }) {
  const requirements = validateWorkRequirements(workInput), schema = resolveProviderCapabilitySchema(schemaInput);
  const policy = resolvePeerAssignmentPolicy(policyInput, schema), candidates = snapshot(candidateInput);
  if (observations !== null) throw new Error('Peer planning: historical selection is disabled by resolved policy');
  if (!Array.isArray(candidates) || candidates.length > policy.maxCandidates || !Number.isSafeInteger(now)) throw new Error('Peer planning: bounded candidates and explicit time required');
  const lexical = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const latest = new Map();
  for (const candidate of candidates) {
    if (!/^sha256:[0-9a-f]{64}$/.test(candidate.providerId) || !/^sha256:[0-9a-f]{64}$/.test(candidate.advertHash)) throw new Error('Peer planning: verified candidate identity required');
    const capability = validateProviderCapabilities(candidate.capabilities, { schema, now });
    const prior = latest.get(candidate.providerId);
    if (!prior || capability.observedAt > prior.capabilities.observedAt
      || (capability.observedAt === prior.capabilities.observedAt && lexical(candidate.advertHash, prior.advertHash) < 0)) latest.set(candidate.providerId, candidate);
  }
  const rows = [...latest.values()].map(candidate => {
    const { capabilities: capability, providerId, advertHash } = candidate, reasons = [];
    const resource = capability.resources;
    const model = capability.models.find(row => row.identity === requirements.modelIdentity);
    const modelRank = model ? policy.modelAvailabilityOrder.indexOf(model.availability) : -1;
    if (modelRank < 0 || (model.availability === 'fetchable' && !policy.allowModelFetching)) reasons.push('model-unavailable');
    if (!requirements.providerIds.includes(providerId)) reasons.push('provider-not-permitted');
    if (!capability.operations.some(row => row.name === requirements.operation.name && row.version === requirements.operation.version)) reasons.push('operation-unavailable');
    if (!capability.inputClasses.includes(requirements.inputClass)) reasons.push('input-class-not-permitted');
    if (now - capability.observedAt > policy.maxObservationAgeMs) reasons.push('stale-observation');
    let adapterRank = 0;
    for (const identity of requirements.adapterIdentities) {
      const adapter = capability.adapters.find(row => row.identity === identity);
      const rank = adapter ? policy.adapterAvailabilityOrder.indexOf(adapter.availability) : -1;
      if (rank < 0 || (adapter.availability === 'fetchable' && !policy.allowAdapterFetching)) reasons.push('adapter-unavailable');
      adapterRank = Math.max(adapterRank, rank);
    }
    if (!requirements.expertIdentities.every(identity => capability.experts.some(row => row.identity === identity
      && row.modelIdentity === requirements.modelIdentity && row.availability === 'resident'))) reasons.push('expert-unavailable');
    const freeGpu = resource.gpuFreeBytes === null ? resource.gpuBudgetBytes : Math.min(resource.gpuBudgetBytes, resource.gpuFreeBytes);
    const freeStorage = resource.storageFreeBytes === null ? resource.storageBudgetBytes : Math.min(resource.storageBudgetBytes, resource.storageFreeBytes);
    if (policy.unknownFreeMemory === 'reject' && (resource.gpuFreeBytes === null || resource.storageFreeBytes === null)) reasons.push('memory-observation-missing');
    if (freeGpu < Math.max(requirements.resources.gpuBytes, policy.minimumFreeGpuBytes)) reasons.push('gpu-budget');
    if (freeStorage < Math.max(requirements.resources.storageBytes, policy.minimumFreeStorageBytes)) reasons.push('storage-budget');
    if (resource.bandwidthBytesPerSecond < Math.max(requirements.resources.bandwidthBytesPerSecond, policy.minimumBandwidthBytesPerSecond)) reasons.push('bandwidth-budget');
    if (policy.requireAvailableSlot && resource.activeJobs >= resource.concurrency) reasons.push('busy');
    for (const key of Object.keys(requirements.limits)) if (!Number.isSafeInteger(candidate.limits?.[key])
      || candidate.limits[key] < requirements.limits[key]) reasons.push(`limit:${key}`);
    return { providerId, advertHash, eligible: reasons.length === 0, reasons,
      metrics: { modelAvailability: modelRank, adapterAvailability: adapterRank, activeJobs: resource.activeJobs,
        queuedJobs: resource.queuedJobs, freeGpuBytes: freeGpu, bandwidthBytesPerSecond: resource.bandwidthBytesPerSecond, providerId },
      unknownMemory: { gpu: resource.gpuFreeBytes === null, storage: resource.storageFreeBytes === null } };
  }).sort((a, b) => lexical(a.providerId, b.providerId));
  const ordered = rows.filter(row => row.eligible).sort((a, b) => {
    for (const { metric, order } of policy.ranking) {
      const difference = lexical(a.metrics[metric], b.metrics[metric]);
      if (difference) return order === 'asc' ? difference : -difference;
    }
    return 0;
  });
  return snapshot({ schema: 'reploid.pool.operation-assignment-plan/v1', policyId: policy.policyId,
    policyDigest: await hashJson(policy), requirementsDigest: await hashJson(requirements), selectedAt: now,
    historyProjectionDigest: null, candidates: rows, orderedProviderIds: ordered.map(row => row.providerId),
    selectedProviderId: ordered[0]?.providerId ?? null });
}

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
  || POOLDAY_MODEL_WORKLOADS.sequenceEmbedding
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
