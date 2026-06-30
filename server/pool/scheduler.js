/**
 * @fileoverview Policy-aware pool scheduler.
 */

import { hashJson, sha256Hex } from './hash.js';
import { quorumForRingSize as configuredQuorumForRingSize } from './config.js';
import {
  deriveProviderAdmission,
  effectiveTrustTierForRingAdmissions,
  findHomogeneousProviderGroup,
  runtimeProfileBucketKey,
  selectDiverseProviderGroup,
  validateRuntimeProfileForPolicy
} from './runtime-profile.js';

const ASSIGNMENT_EXPIRY_MS = 120000;
const PROVIDER_HEARTBEAT_STALE_MS = 45000;
const MAX_RING_SIZE = 12;
const REASSIGNABLE_ACTIVE_ASSIGNMENT_STATUSES = new Set([
  'assigned',
  'running',
  'commit_submitted',
  'reveal_open',
  'reveal_submitted'
]);

const selectModel = (provider, job = {}) => {
  const models = provider.models || [];
  const requirements = job.modelRequirements || {};
  const requestedModel = requirements.modelId;
  const requestedModelHash = requirements.modelHash;
  const requestedManifestHash = requirements.manifestHash;
  const requestedRuntime = requirements.runtime;
  const requestedBackend = requirements.backend;
  if (!requestedModel || !requestedModelHash || !requestedManifestHash) return null;
  return models.find((model) => {
    if (model.modelId !== requestedModel) return false;
    if (model.modelHash !== requestedModelHash) return false;
    if (model.manifestHash !== requestedManifestHash) return false;
    if (requestedRuntime && model.runtime !== requestedRuntime) return false;
    if (requestedBackend && model.backend !== requestedBackend) return false;
    return true;
  }) || null;
};

const providerAcceptsPolicy = (provider, policyId) => {
  const policies = provider.availability?.acceptedPolicies || [];
  return policies.length === 0 || policies.includes(policyId);
};

const reputationAllowsPolicy = (reputation = {}, policy = {}) => {
  if (reputation.routingBlocked) return false;
  if (Number(reputation.score || 0) < Number(policy.minProviderReputation || 0)) return false;
  if (!policy.requireCanaryEligibleProvider) return true;
  const passed = Number(reputation.passedCanaries || 0);
  const failed = Number(reputation.failedCanaries || 0);
  return passed >= Number(policy.minPassedCanaries || 1) && passed > failed;
};

const providerHeartbeatFresh = (provider = {}) => {
  const heartbeatAt = Date.parse(provider.heartbeatAt || provider.registeredAt || '');
  return Number.isFinite(heartbeatAt) && Date.now() - heartbeatAt <= PROVIDER_HEARTBEAT_STALE_MS;
};

const excludedProviderIdsForJob = (job = {}) => new Set([
  ...(Array.isArray(job.excludedProviderIds) ? job.excludedProviderIds : []),
  ...(Array.isArray(job.rejectedProviderIds) ? job.rejectedProviderIds : []),
  ...(Array.isArray(job.timedOutProviderIds) ? job.timedOutProviderIds : [])
].filter(Boolean));

const eligibleProviders = async (providers = [], job = {}, policy = {}, store) => {
  const eligible = [];
  const excludedProviderIds = excludedProviderIdsForJob(job);
  for (const provider of providers) {
    const reputation = await store?.getReputation?.(provider.providerId);
    const model = selectModel(provider, job);
    if (excludedProviderIds.has(provider.providerId)) continue;
    if (provider.status !== 'available') continue;
    if (!providerHeartbeatFresh(provider)) continue;
    if (!providerAcceptsPolicy(provider, job.policyId)) continue;
    if (!model) continue;
    if (!reputationAllowsPolicy(reputation, policy)) continue;
    const runtimeProfileReasons = validateRuntimeProfileForPolicy(provider, policy);
    if (runtimeProfileReasons.length > 0) continue;
    const admission = deriveProviderAdmission({ provider, reputation, policy });
    if (!admission.allowed) continue;
    if (policy.agreementMode === 'ring_quorum' && !admission.ringEligible) continue;
    eligible.push({
      provider,
      model,
      reputation,
      admission,
      runtimeProfileBucket: runtimeProfileBucketKey({ provider, model, profile: undefined })
    });
  }
  eligible.sort((left, right) => Number(right.reputation?.points || 0) - Number(left.reputation?.points || 0));
  return eligible;
};

const clampRingSize = (value) => Math.max(1, Math.min(MAX_RING_SIZE, Number(value || 1)));

const quorumForRingSize = (ringSize, policy = {}) => {
  return configuredQuorumForRingSize(ringSize, policy);
};

const assignmentAttemptIdForJob = (job = {}) => Math.max(1, Number(job.assignmentAttempts || 0) || 1);

const ringAttemptIdForJob = (job = {}, assignmentAttemptId) => (
  `ring_attempt_${job.jobId}_${assignmentAttemptId}`
);

const deriveRingSeed = ({ job, policy, inputHash, generationConfigHash, providerIds }) => hashJson({
  schema: 'reploid.ring-seed/v1',
  jobId: job.jobId,
  policyId: policy.policyId,
  inputHash,
  generationConfigHash,
  providerIds: [...providerIds].sort()
});

const orderRingCandidates = ({ candidates, ringSeed }) => [...candidates].sort((left, right) => {
  const leftKey = sha256Hex(`${ringSeed}:${left.provider.providerId}`);
  const rightKey = sha256Hex(`${ringSeed}:${right.provider.providerId}`);
  return leftKey.localeCompare(rightKey);
});

const buildRingPlan = ({ job, policy, candidates, inputHash, generationConfigHash, assignmentAttemptId }) => {
  const providerIds = candidates.map((candidate) => candidate.provider.providerId);
  const ringSeed = deriveRingSeed({ job, policy, inputHash, generationConfigHash, providerIds });
  const ordered = orderRingCandidates({ candidates, ringSeed });
  const orderedProviderIds = ordered.map((candidate) => candidate.provider.providerId);
  const ringSize = orderedProviderIds.length;
  const requiredAgreement = quorumForRingSize(ringSize, policy);
  const ringAttemptId = ringAttemptIdForJob(job, assignmentAttemptId);
  const effectiveTrustTier = effectiveTrustTierForRingAdmissions({
    ringSize,
    policy,
    admissions: ordered.map((candidate) => candidate.admission)
  });
  const runtimeProfileBuckets = Array.from(new Set(ordered.map((candidate) => candidate.runtimeProfileBucket).filter(Boolean)));
  const admissionLanes = ordered.map((candidate) => candidate.admission?.laneId || null);
  const layout = {
    schema: 'reploid.ring-layout/v1',
    policyId: policy.policyId,
    determinismProfileId: policy.determinismProfileId || null,
    ringPhaseProtocolId: policy.ringPhaseProtocolId || null,
    providerAdmissionPolicyId: policy.providerAdmissionPolicyId || null,
    assignmentAttemptId,
    ringAttemptId,
    ringSize,
    requiredAgreement,
    agreementField: policy.agreementField || 'tokenIdsHash',
    providerIds: orderedProviderIds,
    runtimeProfileBuckets,
    admissionLanes,
    ringSeed
  };
  const layoutHash = hashJson(layout);
  return {
    ringId: `ring_${layoutHash.replace(/^sha256:/, '').slice(0, 16)}`,
    ringSeed,
    ringAttemptId,
    ringSize,
    requiredAgreement,
    effectiveTrustTier,
    agreementField: layout.agreementField,
    determinismProfileId: layout.determinismProfileId,
    ringPhaseProtocolId: layout.ringPhaseProtocolId,
    providerAdmissionPolicyId: layout.providerAdmissionPolicyId,
    runtimeProfileBuckets,
    admissionLanes,
    providerIds: orderedProviderIds,
    layout,
    layoutHash,
    candidates: ordered
  };
};

const buildAssignmentInput = ({ job, provider, model, policy, inputHash, generationConfigHash, groupSize, requiredAgreement = groupSize, assignmentAttemptId, ring = null, admission = null }) => ({
  jobId: job.jobId,
  requesterId: job.requesterId,
  providerId: provider.providerId,
  modelId: model.modelId,
  policyId: policy.policyId,
  policyConfigVersion: job.policyConfigVersion || null,
  policyConfigHash: job.policyConfigHash || null,
  inputHash,
  generationConfigHash,
  verificationLevel: policy.verificationLevel,
  trustTier: ring?.effectiveTrustTier || policy.trustTier,
  policyTrustTier: policy.policyTrustTier || policy.trustTier,
  assignmentAttemptId,
  ringAttemptId: ring?.ringAttemptId || null,
  runtimeProfileHash: provider.runtimeProfileHash || null,
  runtimeProfileBucket: ring?.runtimeProfileBuckets?.[0] || null,
  providerAdmission: ring ? {
    policyId: ring.providerAdmissionPolicyId || null,
    laneId: admission?.laneId || provider.admissionLane || null,
    earningsCapPerAcceptance: admission?.lane?.earningsCapPerAcceptance ?? null,
    maxEffectiveTrustTier: admission?.lane?.maxEffectiveTrustTier || null
  } : null,
  redundancyGroupSize: groupSize,
  requiredAgreement,
  expiresAt: new Date(Date.now() + ASSIGNMENT_EXPIRY_MS).toISOString(),
  prompt: job.prompt,
  generationConfig: job.generationConfig,
  auditId: job.auditId || null,
  ring,
  model: {
    id: model.modelId,
    hash: model.modelHash,
    manifestHash: model.manifestHash,
    runtime: model.runtime || 'doppler',
    backend: model.backend || 'browser-webgpu',
    requirements: job.modelRequirements || {}
  }
});

const cancelPreviousActiveAssignments = async ({ store, job }) => {
  const previousAssignmentIds = Array.isArray(job.assignmentIds) ? job.assignmentIds : [];
  for (const assignmentId of previousAssignmentIds) {
    const assignment = await store.getAssignment?.(assignmentId);
    if (!assignment || !REASSIGNABLE_ACTIVE_ASSIGNMENT_STATUSES.has(assignment.status)) continue;
    await store.updateAssignment(assignment.assignmentId, {
      status: 'canceled',
      canceledReason: 'job_reassigned',
      canceledAt: new Date().toISOString()
    });
    if (assignment.providerId) await store.setProviderStatus?.(assignment.providerId, 'available');
  }
};

export async function assignJob({ store, job, policy }) {
  await cancelPreviousActiveAssignments({ store, job });
  const providers = await eligibleProviders(await store.listProviders(), job, policy, store);
  const adaptiveRing = policy.adaptiveRing === true;
  const minProviders = adaptiveRing ? clampRingSize(policy.minRingSize || 1) : Number(policy.redundancy || 1);
  const maxProviders = adaptiveRing ? Math.min(MAX_RING_SIZE, clampRingSize(policy.maxRingSize || MAX_RING_SIZE)) : minProviders;
  if (providers.length < minProviders) {
    return {
      ok: false,
      reason: policy.requireCanaryEligibleProvider ? 'no_canary_eligible_browser_provider' : 'not_enough_eligible_browser_providers',
      requiredProviders: minProviders,
      eligibleProviders: providers.length
    };
  }

  const inputHash = sha256Hex(job.prompt);
  const generationConfigHash = hashJson(job.generationConfig || {});
  const assignmentAttemptId = assignmentAttemptIdForJob(job);
  const candidatePool = adaptiveRing
    ? selectDiverseProviderGroup({
      candidates: findHomogeneousProviderGroup({ candidates: providers, policy }),
      policy,
      maxProviders
    })
    : providers;
  if (candidatePool.length < minProviders) {
    return {
      ok: false,
      reason: adaptiveRing
        ? 'not_enough_hardware_homogeneous_admitted_browser_providers'
        : 'not_enough_eligible_browser_providers',
      requiredProviders: minProviders,
      eligibleProviders: candidatePool.length
    };
  }
  const selected = candidatePool.slice(0, Math.min(maxProviders, candidatePool.length));
  const ringPlan = adaptiveRing
    ? buildRingPlan({ job, policy, candidates: selected, inputHash, generationConfigHash, assignmentAttemptId })
    : null;
  const selectedCandidates = ringPlan?.candidates || selected;
  const providerCount = selectedCandidates.length;
  const requiredAgreement = adaptiveRing ? ringPlan.requiredAgreement : providerCount;
  const assignments = [];
  for (const [index, candidate] of selectedCandidates.entries()) {
    const ring = ringPlan ? {
      ringId: ringPlan.ringId,
      ringSeed: ringPlan.ringSeed,
      ringAttemptId: ringPlan.ringAttemptId,
      ringSize: ringPlan.ringSize,
      requiredAgreement: ringPlan.requiredAgreement,
      effectiveTrustTier: ringPlan.effectiveTrustTier,
      agreementField: ringPlan.agreementField,
      determinismProfileId: ringPlan.determinismProfileId,
      ringPhaseProtocolId: ringPlan.ringPhaseProtocolId,
      providerAdmissionPolicyId: ringPlan.providerAdmissionPolicyId,
      runtimeProfileBucket: ringPlan.runtimeProfileBuckets[0] || null,
      runtimeProfileBuckets: ringPlan.runtimeProfileBuckets,
      admissionLane: candidate.admission?.laneId || null,
      layoutHash: ringPlan.layoutHash,
      providerIds: ringPlan.providerIds,
      providerIndex: index,
      predecessorId: ringPlan.providerIds[(index - 1 + ringPlan.ringSize) % ringPlan.ringSize],
      successorId: ringPlan.providerIds[(index + 1) % ringPlan.ringSize]
    } : null;
    assignments.push(await store.createAssignment(buildAssignmentInput({
      job,
      provider: candidate.provider,
      model: candidate.model,
      policy,
      inputHash,
      generationConfigHash,
      groupSize: providerCount,
      requiredAgreement,
      assignmentAttemptId,
      ring,
      admission: candidate.admission || null
    })));
  }

  const assignmentIds = assignments.map((assignment) => assignment.assignmentId);
  const providerIds = assignments.map((assignment) => assignment.providerId);
  await store.updateJob(job.jobId, {
    status: 'assigned',
    assignmentId: assignmentIds[0],
    assignmentIds,
    providerId: providerIds[0],
    providerIds,
    inputHash,
    generationConfigHash,
    assignmentAttempts: assignmentAttemptId,
    assignmentAttemptId,
    ringAttemptId: ringPlan?.ringAttemptId || null,
    redundancyRequired: requiredAgreement,
    providerCount,
    trustTier: ringPlan?.effectiveTrustTier || policy.trustTier,
    policyTrustTier: policy.policyTrustTier || policy.trustTier,
    effectiveTrustTier: ringPlan?.effectiveTrustTier || policy.trustTier,
    ring: ringPlan ? {
      ringId: ringPlan.ringId,
      ringSeed: ringPlan.ringSeed,
      ringAttemptId: ringPlan.ringAttemptId,
      ringSize: ringPlan.ringSize,
      requiredAgreement: ringPlan.requiredAgreement,
      effectiveTrustTier: ringPlan.effectiveTrustTier,
      agreementField: ringPlan.agreementField,
      determinismProfileId: ringPlan.determinismProfileId,
      ringPhaseProtocolId: ringPlan.ringPhaseProtocolId,
      providerAdmissionPolicyId: ringPlan.providerAdmissionPolicyId,
      runtimeProfileBucket: ringPlan.runtimeProfileBuckets[0] || null,
      runtimeProfileBuckets: ringPlan.runtimeProfileBuckets,
      admissionLanes: ringPlan.admissionLanes,
      layoutHash: ringPlan.layoutHash,
      providerIds: ringPlan.providerIds
    } : null,
    agreement: requiredAgreement > 1 ? {
      status: 'pending',
      mode: adaptiveRing ? 'ring_quorum' : 'redundant',
      providerCount,
      requiredProviders: requiredAgreement,
      requiredAgreement,
      agreementField: policy.agreementField || 'tokenIdsHash'
    } : null
  });
  return {
    ok: true,
    assignment: assignments[0],
    assignments,
    providers: selectedCandidates.map((candidate) => candidate.provider),
    ring: ringPlan ? {
      ringId: ringPlan.ringId,
      ringAttemptId: ringPlan.ringAttemptId,
      ringSize: ringPlan.ringSize,
      requiredAgreement: ringPlan.requiredAgreement,
      effectiveTrustTier: ringPlan.effectiveTrustTier,
      layoutHash: ringPlan.layoutHash,
      providerIds: ringPlan.providerIds
    } : null
  };
}

export default {
  assignJob
};
