/**
 * @fileoverview Evidence-first provider and artifact routing for Poolday.
 */

import { modelSupportsAdapterRequirement } from './adapter-pack.js';
import { hashJson } from './inference-receipt.js';
import {
  POOLDAY_MODEL_WORKLOADS,
  getPoolModelWorkload,
  modelSupportsPoolWorkload
} from './model-contract.js';
import {
  PARTICIPATION_CAPABILITIES,
  participationAllows
} from './participation-profile.js';

export const ARTIFACT_ROUTE_DECISION_SCHEMA = 'reploid.pool.artifact-route-decision/v1';
export const ARTIFACT_LIFECYCLE = Object.freeze([
  'candidate',
  'bytes_verified',
  'runtime_qualified',
  'capability_verified',
  'domain_approved',
  'routable',
  'revoked'
]);

const ADAPTER_SOURCE_PRIORITY = Object.freeze({
  active: 0,
  cached: 1,
  fetchable: 2,
  missing: 9
});

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = (value, fallback = 0) => Math.max(0, Math.min(1, finite(value, fallback)));
const requestedTokenCount = (intent = {}) => Math.max(0, finite(
  intent.body?.generationConfig?.maxOutputTokens
    ?? intent.body?.generationConfig?.maxTokens,
  0
));

const workloadForIntent = (intent = {}) => (
  intent.body?.workload
  || intent.body?.modelRequirements?.workload
  || intent.body?.modelRequirements?.workloadType
  || POOLDAY_MODEL_WORKLOADS.textGeneration
);

const exactModelReasons = (model = {}, requirement = {}, workload = POOLDAY_MODEL_WORKLOADS.textGeneration) => {
  const reasons = [];
  if (model.modelId !== requirement.modelId) reasons.push('model_id_mismatch');
  if (model.modelHash !== requirement.modelHash) reasons.push('model_hash_mismatch');
  if (model.manifestHash !== requirement.manifestHash) reasons.push('manifest_hash_mismatch');
  if ((model.runtime || 'doppler') !== (requirement.runtime || 'doppler')) reasons.push('runtime_mismatch');
  if ((model.backend || 'browser-webgpu') !== (requirement.backend || 'browser-webgpu')) {
    reasons.push('backend_mismatch');
  }
  if (!modelSupportsPoolWorkload(model, workload)) reasons.push('workload_unsupported');
  if (!modelSupportsAdapterRequirement(model, requirement.adapter || null)) {
    reasons.push('adapter_requirement_unavailable');
  }
  return reasons;
};

const matchingModel = (advert = {}, intent = {}) => {
  const requirement = intent.body?.modelRequirements || {};
  const workload = workloadForIntent(intent);
  let closest = null;
  let closestReasons = null;
  for (const model of advert.body?.models || []) {
    const reasons = exactModelReasons(model, requirement, workload);
    if (reasons.length === 0) return { model, reasons: [] };
    if (!closestReasons || reasons.length < closestReasons.length) {
      closest = model;
      closestReasons = reasons;
    }
  }
  return { model: closest, reasons: closestReasons || ['model_not_advertised'] };
};

const adapterStateFor = (model = {}, requirement = null) => {
  if (!requirement) return 'active';
  const candidate = (model.adapterPacks || []).find((adapter) => (
    adapter.packHash === requirement.packHash
    && adapter.adapterSha256 === requirement.adapterSha256
    && adapter.publicationHash === requirement.publicationHash
  ));
  return candidate?.state || 'missing';
};

const evidenceScore = (advert = {}) => {
  const evidence = advert.body?.reputationEvidence || {};
  return Math.max(
    clamp01(evidence.reliabilityScore, 0),
    clamp01(evidence.canaryPassRate, 0),
    clamp01(evidence.acceptanceRate, 0)
  );
};

export function deriveAdapterLifecycle(requirement = null, { revoked = false } = {}) {
  if (revoked) return 'revoked';
  if (!requirement) return 'routable';
  const hasBytes = String(requirement.adapterSha256 || '').startsWith('sha256:');
  const runtimeQualified = hasBytes
    && String(requirement.dopplerParityReceiptHash || '').startsWith('sha256:');
  const capabilityVerified = runtimeQualified
    && String(requirement.gammaSelectionReceiptHash || '').startsWith('sha256:');
  const domainApproved = capabilityVerified
    && String(requirement.humanPromotionReceiptHash || '').startsWith('sha256:');
  const published = domainApproved
    && String(requirement.publicationHash || '').startsWith('sha256:')
    && Boolean(requirement.publisherId);
  if (published && ['active', 'cached', 'fetchable'].includes(requirement.state)) return 'routable';
  if (domainApproved) return 'domain_approved';
  if (capabilityVerified) return 'capability_verified';
  if (runtimeQualified) return 'runtime_qualified';
  if (hasBytes) return 'bytes_verified';
  return 'candidate';
}

export function evaluateProviderRouteCandidate({
  advert,
  intent,
  messageValid = true,
  identityValid = true,
  runtimeProfileValid = true,
  tieBreaker = ''
} = {}) {
  const providerId = advert?.body?.providerId || advert?.fromPeerId || null;
  const rejectionReasons = [];
  if (!messageValid) rejectionReasons.push('message_signature_invalid');
  if (!identityValid) rejectionReasons.push('participation_identity_invalid');
  if (!runtimeProfileValid) rejectionReasons.push('runtime_profile_hash_invalid');
  const profile = advert?.body?.participationProfile || null;
  if (profile && !participationAllows(profile, PARTICIPATION_CAPABILITIES.provideInference)) {
    rejectionReasons.push('provider_mode_disallows_inference');
  }
  const availability = advert?.body?.availability || {};
  const signedLimits = profile?.limits || {};
  for (const [advertField, profileField, reason] of [
    ['maxConcurrentJobs', 'maxConcurrentJobs', 'advertised_concurrency_exceeds_signed_profile'],
    ['maxTokensPerJob', 'maxTokensPerJob', 'advertised_token_limit_exceeds_signed_profile'],
    ['storageBudgetMiB', 'storageBudgetMiB', 'advertised_storage_exceeds_signed_profile'],
    ['bandwidthBudgetMbps', 'bandwidthBudgetMbps', 'advertised_bandwidth_exceeds_signed_profile']
  ]) {
    if (profile && finite(availability[advertField], 0) > finite(signedLimits[profileField], 0)) {
      rejectionReasons.push(reason);
    }
  }
  const acceptedPolicies = availability.acceptedPolicies || [];
  if (acceptedPolicies.length > 0 && !acceptedPolicies.includes(intent?.body?.policyId)) {
    rejectionReasons.push('policy_not_accepted');
  }
  if (availability.acceptingJobs === false) rejectionReasons.push('provider_not_accepting_jobs');
  const maxConcurrentJobs = Math.max(1, finite(availability.maxConcurrentJobs, 1));
  const activeJobs = Math.max(0, finite(availability.activeJobs, 0));
  if (activeJobs >= maxConcurrentJobs) rejectionReasons.push('provider_capacity_exhausted');
  const maxTokensPerJob = Math.max(0, Math.min(
    finite(availability.maxTokensPerJob, Number.MAX_SAFE_INTEGER),
    finite(signedLimits.maxTokensPerJob, Number.MAX_SAFE_INTEGER)
  ));
  if (requestedTokenCount(intent) > maxTokensPerJob) rejectionReasons.push('job_token_limit_exceeded');
  const match = matchingModel(advert || {}, intent || {});
  rejectionReasons.push(...match.reasons);
  const adapterRequirement = intent?.body?.modelRequirements?.adapter || null;
  const adapterState = adapterStateFor(match.model || {}, adapterRequirement);
  const lifecycle = deriveAdapterLifecycle(adapterRequirement);
  if (adapterRequirement && lifecycle !== 'routable') rejectionReasons.push(`adapter_${lifecycle}`);
  const transferBytes = adapterRequirement && adapterState === 'fetchable'
    ? Math.max(0, finite(
      adapterRequirement.bytes,
      availability.adapterTransferBytes ?? availability.transferBytes ?? Number.MAX_SAFE_INTEGER
    ))
    : 0;
  const storageBudgetBytes = Math.max(0, Math.min(
    finite(availability.storageBudgetMiB, Number.MAX_SAFE_INTEGER),
    finite(signedLimits.storageBudgetMiB, Number.MAX_SAFE_INTEGER)
  )) * 1024 * 1024;
  if (adapterRequirement && adapterState === 'fetchable' && transferBytes > storageBudgetBytes) {
    rejectionReasons.push('adapter_storage_budget_exceeded');
  }
  const bandwidthMbps = Math.max(1, Math.min(
    finite(availability.bandwidthBudgetMbps, Number.MAX_SAFE_INTEGER),
    finite(signedLimits.bandwidthBudgetMbps, Number.MAX_SAFE_INTEGER)
  ));
  const transferMs = transferBytes > 0
    ? (transferBytes * 8 * 1000) / (bandwidthMbps * 1_000_000)
    : 0;
  const score = Object.freeze({
    adapterSource: ADAPTER_SOURCE_PRIORITY[adapterState] ?? ADAPTER_SOURCE_PRIORITY.missing,
    capacityLoad: activeJobs / maxConcurrentJobs,
    evidencePenalty: 1 - evidenceScore(advert),
    transferBytes,
    transferMs,
    expectedLatencyMs: Math.max(0, finite(availability.expectedLatencyMs, Number.MAX_SAFE_INTEGER)),
    pointCost: Math.max(0, finite(availability.pointCost, Number.MAX_SAFE_INTEGER)),
    tieBreaker: String(tieBreaker || providerId || '')
  });
  return Object.freeze({
    providerId,
    eligible: rejectionReasons.length === 0,
    rejectionReasons: Object.freeze([...new Set(rejectionReasons)]),
    modelId: match.model?.modelId || null,
    adapterPackHash: adapterRequirement?.packHash || null,
    adapterLifecycle: lifecycle,
    artifactSourcePlan: adapterRequirement
      ? ({ active: 'active_runtime', cached: 'verified_cache', fetchable: 'peer_then_origin' }[adapterState] || 'unavailable')
      : 'provider_loaded_model',
    score
  });
}

export function compareProviderRouteCandidates(left = {}, right = {}) {
  for (const field of [
    'adapterSource',
    'capacityLoad',
    'evidencePenalty',
    'transferMs',
    'transferBytes',
    'expectedLatencyMs',
    'pointCost'
  ]) {
    const difference = finite(left.score?.[field], Number.MAX_SAFE_INTEGER)
      - finite(right.score?.[field], Number.MAX_SAFE_INTEGER);
    if (difference !== 0) return difference;
  }
  return String(left.score?.tieBreaker || '').localeCompare(String(right.score?.tieBreaker || ''));
}

export async function sealArtifactRouteDecision({
  intentHash,
  policyId,
  modelRequirements,
  candidates = [],
  selectedProviderIds = [],
  createdAt = new Date().toISOString()
} = {}) {
  const decision = {
    schema: ARTIFACT_ROUTE_DECISION_SCHEMA,
    intentHash,
    policyId,
    model: {
      modelId: modelRequirements?.modelId || null,
      modelHash: modelRequirements?.modelHash || null,
      manifestHash: modelRequirements?.manifestHash || null,
      workload: getPoolModelWorkload(modelRequirements || {})
    },
    adapter: modelRequirements?.adapter ? {
      packHash: modelRequirements.adapter.packHash,
      publicationHash: modelRequirements.adapter.publicationHash,
      lifecycle: deriveAdapterLifecycle(modelRequirements.adapter)
    } : null,
    candidates: [...candidates].sort((left, right) => (
      String(left.providerId || '').localeCompare(String(right.providerId || ''))
    )).map((candidate) => ({
      providerId: candidate.providerId,
      eligible: candidate.eligible,
      rejectionReasons: candidate.rejectionReasons,
      adapterLifecycle: candidate.adapterLifecycle,
      artifactSourcePlan: candidate.artifactSourcePlan,
      score: candidate.score
    })),
    selectedProviderIds: [...selectedProviderIds],
    createdAt
  };
  const { createdAt: recordedAt, ...identity } = decision;
  return Object.freeze({
    ...identity,
    createdAt: recordedAt,
    decisionHash: await hashJson(identity)
  });
}

export default {
  ARTIFACT_ROUTE_DECISION_SCHEMA,
  ARTIFACT_LIFECYCLE,
  deriveAdapterLifecycle,
  evaluateProviderRouteCandidate,
  compareProviderRouteCandidates,
  sealArtifactRouteDecision
};
