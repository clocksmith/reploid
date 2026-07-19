/**
 * @fileoverview Peer-to-peer control-plane primitives for Reploid model serving.
 */

import {
  calculateReceiptPoints,
  exportPublicKey,
  hashJson,
  sha256Hex,
  SIGNATURE_DOMAINS,
  signCanonical,
  verifyCanonicalSignature
} from './inference-receipt.js';
import {
  DETERMINISTIC_GENERATION_CONFIG,
  FASTEST_RECEIPT_POLICY_ID,
  POOL_CONFIG_VERSION,
  effectiveTrustTierForRingSize,
  getLedgerReasons,
  getPolicy,
  quorumForRingSize
} from './config.js';
import { validatePooldayPolicyClasses } from './policy-router.js';
import {
  LAUNCH_MODEL,
  POOLDAY_MODEL_WORKLOADS,
  buildLaunchModelRequirements,
  buildLaunchProviderModel,
  getPoolModelWorkload,
  modelSupportsPoolWorkload,
  validateLaunchModelRequirement
} from './model-contract.js';
import { modelSupportsAdapterRequirement } from './adapter-pack.js';
import {
  compareProviderRouteCandidates,
  evaluateProviderRouteCandidate,
  sealArtifactRouteDecision
} from './artifact-router.js';
import {
  PARTICIPATION_CAPABILITIES
} from './participation-profile.js';
import { verifyPoolIdentityClaims } from './identity-claims.js';
import {
  createAdapterUseApproval,
  validatePublishedAdapterRequirement,
  verifyAdapterUseApproval
} from './adapter-publication.js';
import {
  P2P_PAYLOAD_TYPES,
  createP2PPayload,
  hashP2PPayload,
  validateP2PPayload
} from './p2p-payload.js';
import {
  SEQUENCE_PUBLIC_SENSITIVITY,
  agreementFieldForWorkload,
  isSequenceWorkload,
  normalizeSequenceInput,
  normalizeSequenceRequest,
  validateSequenceRequest
} from './sequence-workload.js';

export const PEER_CONTROL_VERSION = 'reploid_peer_control/v1';
export const PEER_CONTROL_BUS_VERSION = 'reploid_peer_control_bus/v1';
export const PEER_CONTROL_NETWORK = 'poolday';

export const PEER_MESSAGE_TYPES = Object.freeze({
  JOB_INTENT: 'job_intent',
  PROVIDER_ADVERT: 'provider_advert',
  ASSIGNMENT_CLAIM: 'assignment_claim',
  COMMITMENT: 'commitment',
  REVEAL: 'reveal',
  EXECUTION_RESULT: 'execution_result',
  RECEIPT: 'receipt',
  ACCEPTANCE: 'acceptance',
  POINTS_EVENT: 'points_event',
  REPUTATION_EVENT: 'reputation_event',
  HEARTBEAT: 'heartbeat'
});

const MESSAGE_TYPES = new Set(Object.values(PEER_MESSAGE_TYPES));

const requireString = (value, label) => {
  const normalized = String(value || '').trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
};

const optionalString = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const stripUndefined = (value) => {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .map(([key, child]) => [key, stripUndefined(child)])
  );
};

const randomNonce = () => (
  globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
);

export function peerMessageSigningPayload(message = {}) {
  const { signature, messageHash, ...payload } = message || {};
  return stripUndefined(payload);
}

export function createPeerMessage({
  type,
  fromPeerId,
  publicKey,
  toPeerId = null,
  body = {},
  createdAt = new Date().toISOString(),
  expiresAt = null,
  nonce = randomNonce(),
  causalRefs = []
} = {}) {
  if (!MESSAGE_TYPES.has(type)) throw new TypeError('peer message type is not allowed');
  return stripUndefined({
    peerControlVersion: PEER_CONTROL_VERSION,
    network: PEER_CONTROL_NETWORK,
    type,
    fromPeerId: requireString(fromPeerId, 'fromPeerId'),
    toPeerId: optionalString(toPeerId),
    publicKey: requireString(publicKey, 'publicKey'),
    body: body || {},
    createdAt,
    expiresAt,
    nonce: requireString(nonce, 'nonce'),
    causalRefs: Array.isArray(causalRefs) ? causalRefs.filter(Boolean) : []
  });
}

export function validatePeerMessage(message = {}) {
  const reasons = [];
  if (message.peerControlVersion !== PEER_CONTROL_VERSION) reasons.push('peerControlVersion mismatch');
  if (message.network !== PEER_CONTROL_NETWORK) reasons.push('peer control network mismatch');
  if (!MESSAGE_TYPES.has(message.type)) reasons.push('peer message type is not allowed');
  for (const field of ['fromPeerId', 'publicKey', 'createdAt', 'nonce']) {
    if (!String(message[field] || '').trim()) reasons.push(`${field} is required`);
  }
  if (!message.body || typeof message.body !== 'object' || Array.isArray(message.body)) {
    reasons.push('body must be an object');
  }
  if (message.expiresAt && Date.parse(message.expiresAt) <= Date.now()) {
    reasons.push('peer message expired');
  }
  return {
    ok: reasons.length === 0,
    reasons
  };
}

export async function hashPeerMessage(message = {}) {
  return hashJson(peerMessageSigningPayload(message));
}

export async function signPeerMessage(message = {}, privateKey) {
  if (!privateKey) throw new TypeError('privateKey is required');
  const validation = validatePeerMessage(message);
  if (!validation.ok) throw new Error(validation.reasons.join('; '));
  const unsigned = peerMessageSigningPayload(message);
  return {
    ...unsigned,
    messageHash: await hashJson(unsigned),
    signature: await signCanonical(unsigned, privateKey, { domain: SIGNATURE_DOMAINS.peerMessage })
  };
}

export async function createSignedPeerMessage({ privateKey, ...message } = {}) {
  return signPeerMessage(createPeerMessage(message), privateKey);
}

export async function verifyPeerMessage(message = {}) {
  const reasons = [];
  const validation = validatePeerMessage(message);
  reasons.push(...validation.reasons);
  const messageHash = await hashPeerMessage(message);
  if (message.messageHash !== messageHash) reasons.push('messageHash mismatch');
  if (!message.signature) {
    reasons.push('signature is required');
  } else if (message.publicKey) {
    try {
      const ok = await verifyCanonicalSignature(
        peerMessageSigningPayload(message),
        message.publicKey,
        message.signature,
        { domain: SIGNATURE_DOMAINS.peerMessage }
      );
      if (!ok) reasons.push('signature invalid');
    } catch (error) {
      reasons.push(`signature verification failed: ${error.message}`);
    }
  }
  return {
    ok: reasons.length === 0,
    messageHash,
    reasons
  };
}

export async function createSignedJobIntent({
  requesterId,
  requesterPublicKey,
  privateKey,
  participationProfile = null,
  identityProof = null,
  prompt,
  sequence,
  sequenceRequest = null,
  policyId = FASTEST_RECEIPT_POLICY_ID,
  modelRequirements = {},
  generationConfig = {},
  policyTags = [],
  maxPointSpend = null,
  createdAt,
  expiresAt = null
} = {}) {
  const resolvedRequesterId = requireString(requesterId, 'requesterId');
  let resolvedModelRequirements = buildLaunchModelRequirements(modelRequirements);
  const workload = resolvedModelRequirements.workload || getPoolModelWorkload(resolvedModelRequirements);
  const sequenceWorkload = isSequenceWorkload(workload);
  const resolvedInput = sequenceWorkload
    ? normalizeSequenceInput(sequence, sequenceRequest?.alphabet)
    : requireString(prompt, 'prompt');
  const inputHash = await sha256Hex(resolvedInput);
  const resolvedSequenceRequest = sequenceWorkload
    ? normalizeSequenceRequest(sequenceRequest || {}, {
      workload,
      sequenceHash: inputHash,
      sequenceLength: resolvedInput.length
    })
    : null;
  if (resolvedSequenceRequest) {
    resolvedModelRequirements = {
      ...resolvedModelRequirements,
      sequenceRequest: resolvedSequenceRequest
    };
  }
  const resolvedGenerationConfig = {
    ...DETERMINISTIC_GENERATION_CONFIG,
    ...generationConfig
  };
  const policy = getPolicy(policyId);
  if (!policy) throw new Error(`Unsupported pool policy: ${policyId}`);
  const policyClassValidation = sequenceWorkload
    ? {
      ok: resolvedSequenceRequest.sensitivity === SEQUENCE_PUBLIC_SENSITIVITY,
      reasons: resolvedSequenceRequest.sensitivity === SEQUENCE_PUBLIC_SENSITIVITY
        ? []
        : ['public Poolday providers accept only sequences explicitly classified as public'],
      classification: {
        classes: ['public_biological_sequence'],
        blockedClasses: [],
        publicProviderSafe: resolvedSequenceRequest.sensitivity === SEQUENCE_PUBLIC_SENSITIVITY,
        explicitTags: policyTags
      }
    }
    : validatePooldayPolicyClasses({ prompt: resolvedInput, policyTags });
  if (!policyClassValidation.ok) throw new Error(policyClassValidation.reasons.join('; '));
  if (resolvedSequenceRequest) {
    const sequenceValidation = validateSequenceRequest(resolvedSequenceRequest, {
      model: null
    });
    if (!sequenceValidation.ok) throw new Error(sequenceValidation.reasons.join('; '));
  }
  const modelValidation = validateLaunchModelRequirement(resolvedModelRequirements);
  if (!modelValidation.ok) {
    throw new Error(modelValidation.reasons.join('; '));
  }
  const generationConfigHash = await hashJson(resolvedGenerationConfig);
  const adapterUseApproval = resolvedModelRequirements.adapter
    ? await createAdapterUseApproval({
      adapterRequirement: resolvedModelRequirements.adapter,
      requesterId: resolvedRequesterId,
      requesterPublicKey,
      privateKey,
      inputHash,
      modelRequirements: resolvedModelRequirements
    })
    : null;
  const intentBody = {
    schema: 'reploid.peer.job_intent/v1',
    requesterId: resolvedRequesterId,
    participationProfile,
    identityProof,
    policyId,
    policyConfigVersion: POOL_CONFIG_VERSION,
    inputHash,
    inputKind: sequenceWorkload ? 'sequence' : 'prompt',
    inputTransport: 'webrtc_datachannel',
    inputDisclosure: 'selected_providers_only',
    promptTransport: sequenceWorkload ? null : 'webrtc_datachannel',
    promptDisclosure: sequenceWorkload ? null : 'selected_providers_only',
    workload,
    sequenceRequest: resolvedSequenceRequest,
    modelRequirements: resolvedModelRequirements,
    adapterUseApproval,
    generationConfig: resolvedGenerationConfig,
    generationConfigHash,
    policyClasses: policyClassValidation.classification.classes,
    policyTags,
    maxPointSpend
  };
  const message = await createSignedPeerMessage({
    type: PEER_MESSAGE_TYPES.JOB_INTENT,
    fromPeerId: resolvedRequesterId,
    publicKey: requesterPublicKey,
    privateKey,
    body: intentBody,
    createdAt,
    expiresAt
  });
  return {
    intent: message,
    intentHash: message.messageHash,
    inputHash,
    ...(sequenceWorkload ? { sequence: resolvedInput } : { prompt: resolvedInput }),
    inputKind: intentBody.inputKind,
    inputTransport: intentBody.inputTransport,
    promptTransport: intentBody.promptTransport
  };
}

export async function createSignedProviderAdvert({
  providerId,
  providerPublicKey,
  privateKey,
  participationProfile = null,
  identityProof = null,
  models = null,
  runtimeProfile = null,
  runtimeProfileHash = null,
  availability = {},
  reputationEvidence = {},
  createdAt,
  expiresAt = null
} = {}) {
  const resolvedProviderId = requireString(providerId, 'providerId');
  const resolvedModels = Array.isArray(models) && models.length > 0
    ? models
    : [buildLaunchProviderModel()];
  if (!resolvedModels.some((model) => validateLaunchModelRequirement(model).ok)) {
    throw new Error('provider advert must include an enabled launch model contract');
  }
  for (const model of resolvedModels) {
    for (const adapter of model.adapterPacks || []) {
      const validation = validatePublishedAdapterRequirement(adapter);
      if (!validation.ok) throw new Error(`invalid provider adapter advert: ${validation.reasons.join('; ')}`);
    }
  }
  return createSignedPeerMessage({
    type: PEER_MESSAGE_TYPES.PROVIDER_ADVERT,
    fromPeerId: resolvedProviderId,
    publicKey: providerPublicKey,
    privateKey,
    body: {
      schema: 'reploid.peer.provider_advert/v1',
      providerId: resolvedProviderId,
      participationProfile,
      identityProof,
      models: resolvedModels,
      runtimeProfile,
      runtimeProfileHash,
      availability: {
        maxConcurrentJobs: 1,
        maxTokensPerJob: 128,
        acceptedPolicies: [FASTEST_RECEIPT_POLICY_ID],
        acceptedPolicyClasses: ['public_text', 'code_help', 'benchmark_eval'],
        ...availability
      },
      reputationEvidence
    },
    createdAt,
    expiresAt
  });
}

const peerIdForMessage = (message = {}) => (
  message.body?.providerId || message.body?.requesterId || message.fromPeerId
);

export async function verifyPeerRoleClaims(message = {}, {
  role,
  requiredCapability
} = {}) {
  return verifyPoolIdentityClaims({
    participationProfile: message.body?.participationProfile || null,
    identityProof: message.body?.identityProof || null,
    role,
    roleId: peerIdForMessage(message),
    rolePublicKey: message.publicKey,
    requiredCapability
  });
}

const advertSupportsIntent = (advert = {}, intent = {}, policy = {}) => {
  const body = advert.body || {};
  const acceptedPolicies = body.availability?.acceptedPolicies || [];
  const acceptsPolicy = acceptedPolicies.length === 0 || acceptedPolicies.includes(intent.body?.policyId);
  const models = body.models || [];
  return acceptsPolicy
    && models.some((model) => (
      model.modelId === intent.body?.modelRequirements?.modelId
      && model.modelHash === intent.body?.modelRequirements?.modelHash
      && model.manifestHash === intent.body?.modelRequirements?.manifestHash
      && model.runtime === intent.body?.modelRequirements?.runtime
      && model.backend === intent.body?.modelRequirements?.backend
      && modelSupportsPoolWorkload(model, intentWorkload(intent))
      && modelSupportsAdapterRequirement(model, intent.body?.modelRequirements?.adapter || null)
    ))
    && (!policy.requireRuntimeProfileHash || !!body.runtimeProfileHash);
};

const advertRuntimeProfileHashValid = async (advert = {}) => {
  const body = advert.body || {};
  if (!body.runtimeProfile || !body.runtimeProfileHash) return true;
  return await hashJson(body.runtimeProfile) === body.runtimeProfileHash;
};

const selectRuntimeCompatibleAdverts = ({ verifiedAdverts = [], policy = {}, minProviders = 1, maxProviders = verifiedAdverts.length } = {}) => {
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

const candidateSortKey = async ({ intentHash, advert }) => hashJson({
  intentHash,
  providerId: peerIdForMessage(advert),
  runtimeProfileHash: advert.body?.runtimeProfileHash || null,
  publicKey: advert.publicKey
});

const ringAttemptIdFor = (intentHash, assignmentAttemptId = 1) => (
  `peer_ring_attempt_${intentHash.replace(/^sha256:/, '').slice(0, 16)}_${assignmentAttemptId}`
);

const intentWorkload = (intent = {}) => (
  intent.body?.workload
  || intent.body?.modelRequirements?.workload
  || intent.body?.modelRequirements?.workloadType
  || POOLDAY_MODEL_WORKLOADS.textGeneration
);

const intentMaxTokens = (intent = {}) => Math.max(0, Number(
  intent.body?.generationConfig?.maxOutputTokens
    ?? intent.body?.generationConfig?.maxTokens
    ?? 0
));

const providerAssignmentLimits = (advert = {}) => {
  const availability = advert.body?.availability || {};
  return {
    maxConcurrentJobs: Number(availability.maxConcurrentJobs || 1),
    maxTokensPerJob: Number(availability.maxTokensPerJob || 0),
    storageBudgetMiB: Number(availability.storageBudgetMiB || 0),
    bandwidthBudgetMbps: Number(availability.bandwidthBudgetMbps || 0)
  };
};

const agreementFieldForIntent = (intent = {}, policy = {}) => {
  const workload = intentWorkload(intent);
  const workloadField = agreementFieldForWorkload(workload);
  return workloadField === 'tokenIdsHash'
    ? (policy.agreementField || workloadField)
    : workloadField;
};

const buildPeerRingPlan = async ({ intent, intentHash, candidates, policy, assignmentAttemptId = 1 }) => {
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
};

export async function buildPeerAssignmentPlan({
  jobIntent,
  providerAdverts = [],
  assignmentAttemptId = 1
} = {}) {
  const intent = jobIntent?.intent || jobIntent;
  const intentVerification = await verifyPeerMessage(intent);
  if (!intentVerification.ok) {
    return {
      ok: false,
      reason: 'invalid_job_intent',
      reasons: intentVerification.reasons,
      assignments: []
    };
  }
  const policyId = intent.body?.policyId || FASTEST_RECEIPT_POLICY_ID;
  const policy = getPolicy(policyId);
  if (!policy) {
    return {
      ok: false,
      reason: 'unsupported_policy',
      assignments: []
    };
  }
  const requesterIdentity = await verifyPeerRoleClaims(intent, {
    role: 'requester',
    requiredCapability: PARTICIPATION_CAPABILITIES.requestInference
  });
  if (!requesterIdentity.ok) {
    return {
      ok: false,
      reason: 'invalid_requester_identity',
      reasons: requesterIdentity.reasons,
      assignments: []
    };
  }
  if (intent.body?.modelRequirements?.adapter) {
    const approval = await verifyAdapterUseApproval(intent.body?.adapterUseApproval, {
      adapterRequirement: intent.body.modelRequirements.adapter,
      requesterId: intent.body.requesterId,
      inputHash: intent.body.inputHash,
      modelRequirements: intent.body.modelRequirements
    });
    if (!approval.ok) {
      return {
        ok: false,
        reason: 'invalid_adapter_use_approval',
        reasons: approval.reasons,
        assignments: []
      };
    }
  }
  const verifiedAdverts = [];
  const routeCandidates = [];
  for (const advert of providerAdverts) {
    const verification = await verifyPeerMessage(advert);
    const providerIdentity = verification.ok
      ? await verifyPeerRoleClaims(advert, {
        role: 'provider',
        requiredCapability: PARTICIPATION_CAPABILITIES.provideInference
      })
      : { ok: false };
    const runtimeProfileValid = await advertRuntimeProfileHashValid(advert)
      && (!policy.requireRuntimeProfileHash || Boolean(advert.body?.runtimeProfileHash));
    const sortKey = await candidateSortKey({ intentHash: intentVerification.messageHash, advert });
    const routeCandidate = evaluateProviderRouteCandidate({
      advert,
      intent,
      messageValid: verification.ok && advert.type === PEER_MESSAGE_TYPES.PROVIDER_ADVERT,
      identityValid: providerIdentity.ok,
      runtimeProfileValid,
      tieBreaker: sortKey
    });
    routeCandidates.push(routeCandidate);
    if (routeCandidate.eligible && advertSupportsIntent(advert, intent, policy)) {
      verifiedAdverts.push({ advert, verification, sortKey, routeCandidate });
    }
  }
  verifiedAdverts.sort((left, right) => (
    compareProviderRouteCandidates(left.routeCandidate, right.routeCandidate)
    || left.sortKey.localeCompare(right.sortKey)
  ));
  const adaptiveRing = policy.adaptiveRing === true;
  const minProviders = adaptiveRing ? Math.max(1, Number(policy.minRingSize || 1)) : Math.max(1, Number(policy.redundancy || 1));
  const maxProviders = adaptiveRing ? Math.max(minProviders, Number(policy.maxRingSize || minProviders)) : minProviders;
  if (verifiedAdverts.length < minProviders) {
    return {
      ok: false,
      reason: 'not_enough_peer_providers',
      requiredProviders: minProviders,
      eligibleProviders: verifiedAdverts.length,
      routeCandidates,
      assignments: []
    };
  }
  const compatibleSelection = selectRuntimeCompatibleAdverts({
    verifiedAdverts,
    policy,
    minProviders,
    maxProviders
  });
  if (!compatibleSelection.ok) {
    return {
      ok: false,
      reason: 'not_enough_runtime_compatible_peer_providers',
      requiredProviders: minProviders,
      eligibleProviders: verifiedAdverts.length,
      compatibleProviders: compatibleSelection.compatibleProviders || 0,
      routeCandidates,
      assignments: []
    };
  }
  const selected = compatibleSelection.selected;
  const ringPlan = adaptiveRing
    ? await buildPeerRingPlan({
      intent,
      intentHash: intentVerification.messageHash,
      candidates: selected,
      policy,
      assignmentAttemptId
    })
    : null;
  const selectedCandidates = ringPlan?.candidates || selected;
  const routeDecision = await sealArtifactRouteDecision({
    intentHash: intentVerification.messageHash,
    policyId,
    modelRequirements: intent.body.modelRequirements,
    candidates: routeCandidates,
    selectedProviderIds: selectedCandidates.map((candidate) => peerIdForMessage(candidate.advert))
  });
  const providerCount = selectedCandidates.length;
  const requiredAgreement = ringPlan?.requiredAgreement || providerCount;
  const jobId = `peer_job_${intentVerification.messageHash.replace(/^sha256:/, '').slice(0, 16)}`;
  const assignments = [];
  const workload = intentWorkload(intent);
  const assignmentAgreementField = agreementFieldForIntent(intent, policy);
  const sequenceRequestHash = intent.body.sequenceRequest
    ? await hashJson(intent.body.sequenceRequest)
    : null;
  for (const [index, candidate] of selectedCandidates.entries()) {
    const providerId = peerIdForMessage(candidate.advert);
    const providerAdvertHash = candidate.advert.messageHash;
    const providerParticipationProfileHash = candidate.advert.body?.participationProfile?.profileHash || null;
    const providerLimits = providerAssignmentLimits(candidate.advert);
    const assignmentHash = await hashJson({
      schema: 'reploid.peer.assignment/v1',
      intentHash: intentVerification.messageHash,
      providerId,
      assignmentAttemptId,
      routeDecisionHash: routeDecision.decisionHash,
      providerAdvertHash,
      providerParticipationProfileHash,
      providerLimits
    });
    assignments.push({
      schema: 'reploid.peer.assignment/v1',
      assignmentId: `peer_assignment_${assignmentHash.replace(/^sha256:/, '').slice(0, 16)}`,
      assignmentHash,
      routeDecisionHash: routeDecision.decisionHash,
      providerAdvertHash,
      providerParticipationProfileHash,
      providerLimits,
      jobId,
      intentHash: intentVerification.messageHash,
      requesterId: intent.body.requesterId,
      providerId,
      providerPublicKey: candidate.advert.publicKey,
      policyId,
      policyConfigVersion: intent.body.policyConfigVersion || POOL_CONFIG_VERSION,
      policyConfigHash: intent.body.policyConfigHash || null,
      maxPointSpend: intent.body.maxPointSpend ?? null,
      inputHash: intent.body.inputHash,
      workload,
      outputKind: workload,
      agreementField: ringPlan || assignmentAgreementField !== 'tokenIdsHash'
        ? assignmentAgreementField
        : undefined,
      inputKind: intent.body.inputKind || 'prompt',
      inputTransport: intent.body.inputTransport || intent.body.promptTransport || 'webrtc_datachannel',
      sequenceRequest: intent.body.sequenceRequest || null,
      sequenceRequestHash,
      promptTransport: isSequenceWorkload(workload) ? null : 'webrtc_datachannel',
      requiresInputPayload: true,
      requiresPromptPayload: !isSequenceWorkload(workload),
      generationConfigHash: intent.body.generationConfigHash,
      generationConfig: intent.body.generationConfig,
      verificationLevel: policy.verificationLevel,
      trustTier: ringPlan?.effectiveTrustTier || policy.trustTier,
      policyTrustTier: policy.policyTrustTier || policy.trustTier,
      assignmentAttemptId,
      redundancyGroupSize: providerCount,
      requiredAgreement,
      model: {
        id: intent.body.modelRequirements.modelId,
        hash: intent.body.modelRequirements.modelHash,
        manifestHash: intent.body.modelRequirements.manifestHash,
        runtime: intent.body.modelRequirements.runtime || LAUNCH_MODEL.runtime,
        backend: intent.body.modelRequirements.backend || LAUNCH_MODEL.backend,
        workload,
        executionMode: intent.body.modelRequirements.executionMode || null,
        requirements: intent.body.modelRequirements
      },
      adapter: intent.body.modelRequirements.adapter || null,
      adapterUseApproval: intent.body.adapterUseApproval || null,
      runtimeProfileHash: candidate.advert.body?.runtimeProfileHash || null,
      ring: ringPlan ? {
        ringId: ringPlan.ringId,
        ringSeed: ringPlan.ringSeed,
        ringAttemptId: ringPlan.ringAttemptId,
        ringSize: ringPlan.ringSize,
        requiredAgreement: ringPlan.requiredAgreement,
        effectiveTrustTier: ringPlan.effectiveTrustTier,
        agreementField: ringPlan.agreementField,
        layoutHash: ringPlan.layoutHash,
        providerIds: ringPlan.providerIds,
        providerIndex: index,
        predecessorId: ringPlan.providerIds[(index - 1 + ringPlan.ringSize) % ringPlan.ringSize],
        successorId: ringPlan.providerIds[(index + 1) % ringPlan.ringSize]
      } : null
    });
  }
  return {
    ok: true,
    intentHash: intentVerification.messageHash,
    jobId,
    assignments,
    assignment: assignments[0] || null,
    providers: selectedCandidates.map((candidate) => candidate.advert),
    routeDecision,
    ring: ringPlan ? {
      ringId: ringPlan.ringId,
      ringAttemptId: ringPlan.ringAttemptId,
      ringSize: ringPlan.ringSize,
      requiredAgreement: ringPlan.requiredAgreement,
      effectiveTrustTier: ringPlan.effectiveTrustTier,
      agreementField: ringPlan.agreementField,
      layoutHash: ringPlan.layoutHash,
      providerIds: ringPlan.providerIds
    } : null
  };
}

export async function createPeerPromptPayload({ assignment, prompt, fromPeerId, toPeerId } = {}) {
  const resolvedPrompt = requireString(prompt, 'prompt');
  const payload = createP2PPayload({
    type: P2P_PAYLOAD_TYPES.PROMPT,
    assignmentId: assignment?.assignmentId,
    jobId: assignment?.jobId,
    fromPeerId,
    toPeerId,
    body: {
      prompt: resolvedPrompt,
      inputHash: await sha256Hex(resolvedPrompt),
      generationConfigHash: assignment?.generationConfigHash || null,
      policyId: assignment?.policyId || null,
      intentHash: assignment?.intentHash || null,
      model: assignment?.model || null
    }
  });
  return {
    ...payload,
    payloadHash: await hashP2PPayload(payload)
  };
}

export async function createPeerSequencePayload({ assignment, sequence, fromPeerId, toPeerId } = {}) {
  const request = assignment?.sequenceRequest || assignment?.model?.requirements?.sequenceRequest || null;
  const requestValidation = validateSequenceRequest(request || {});
  if (!requestValidation.ok) throw new Error(requestValidation.reasons.join('; '));
  const resolvedSequence = normalizeSequenceInput(sequence, request.alphabet);
  const inputHash = await sha256Hex(resolvedSequence);
  if (inputHash !== request.sequenceHash || (assignment?.inputHash && inputHash !== assignment.inputHash)) {
    throw new Error('sequence inputHash mismatch');
  }
  const payload = createP2PPayload({
    type: P2P_PAYLOAD_TYPES.INPUT,
    assignmentId: assignment?.assignmentId,
    jobId: assignment?.jobId,
    fromPeerId,
    toPeerId,
    body: {
      inputKind: 'sequence',
      sequence: resolvedSequence,
      inputHash,
      sequenceRequest: request,
      generationConfigHash: assignment?.generationConfigHash || null,
      policyId: assignment?.policyId || null,
      intentHash: assignment?.intentHash || null,
      model: assignment?.model || null
    }
  });
  return {
    ...payload,
    payloadHash: await hashP2PPayload(payload)
  };
}

export async function validatePromptPayloadForAssignment(payload = {}, assignment = {}) {
  const reasons = [];
  const validation = validateP2PPayload(payload);
  reasons.push(...validation.reasons);
  if (payload.type !== P2P_PAYLOAD_TYPES.PROMPT) reasons.push('payload type must be prompt');
  if (payload.assignmentId !== assignment.assignmentId) reasons.push('assignmentId mismatch');
  if (payload.jobId !== assignment.jobId) reasons.push('jobId mismatch');
  if (!payload.body?.prompt) reasons.push('prompt is required');
  const promptHash = payload.body?.prompt ? await sha256Hex(payload.body.prompt) : null;
  if (payload.body?.inputHash !== promptHash) reasons.push('prompt payload inputHash mismatch');
  if (assignment.inputHash && payload.body?.inputHash !== assignment.inputHash) reasons.push('assignment inputHash mismatch');
  if (assignment.generationConfigHash && payload.body?.generationConfigHash !== assignment.generationConfigHash) {
    reasons.push('generationConfigHash mismatch');
  }
  return {
    ok: reasons.length === 0,
    reasons,
    prompt: payload.body?.prompt || null,
    inputHash: payload.body?.inputHash || null
  };
}

export async function validateSequencePayloadForAssignment(payload = {}, assignment = {}) {
  const reasons = [];
  const validation = validateP2PPayload(payload);
  reasons.push(...validation.reasons);
  if (payload.type !== P2P_PAYLOAD_TYPES.INPUT) reasons.push('payload type must be input');
  if (payload.assignmentId !== assignment.assignmentId) reasons.push('assignmentId mismatch');
  if (payload.jobId !== assignment.jobId) reasons.push('jobId mismatch');
  if (payload.body?.inputKind !== 'sequence') reasons.push('inputKind must be sequence');
  if (!payload.body?.sequence) reasons.push('sequence is required');
  const request = assignment.sequenceRequest || assignment.model?.requirements?.sequenceRequest || null;
  const requestValidation = validateSequenceRequest(request || {});
  reasons.push(...requestValidation.reasons);
  let sequence = null;
  try {
    sequence = payload.body?.sequence ? normalizeSequenceInput(payload.body.sequence, request?.alphabet) : null;
  } catch (error) {
    reasons.push(error.message);
  }
  const inputHash = sequence ? await sha256Hex(sequence) : null;
  if (payload.body?.inputHash !== inputHash) reasons.push('sequence payload inputHash mismatch');
  if (assignment.inputHash && payload.body?.inputHash !== assignment.inputHash) reasons.push('assignment inputHash mismatch');
  if (request?.sequenceHash && payload.body?.inputHash !== request.sequenceHash) reasons.push('sequence request hash mismatch');
  if (request?.sequenceLength && sequence?.length !== request.sequenceLength) reasons.push('sequence length mismatch');
  if (await hashJson(payload.body?.sequenceRequest || null) !== await hashJson(request)) reasons.push('sequence request mismatch');
  if (assignment.generationConfigHash && payload.body?.generationConfigHash !== assignment.generationConfigHash) {
    reasons.push('generationConfigHash mismatch');
  }
  return {
    ok: reasons.length === 0,
    reasons,
    inputKind: 'sequence',
    sequence,
    inputHash
  };
}

export async function validateInputPayloadForAssignment(payload = {}, assignment = {}) {
  const workload = assignment.workload
    || assignment.model?.workload
    || assignment.model?.requirements?.workload
    || POOLDAY_MODEL_WORKLOADS.textGeneration;
  if (isSequenceWorkload(workload)) return validateSequencePayloadForAssignment(payload, assignment);
  const result = await validatePromptPayloadForAssignment(payload, assignment);
  return {
    ...result,
    inputKind: 'prompt'
  };
}

export async function validatePeerAssignmentForIntentAndAdvert({
  assignment = {},
  jobIntent,
  providerAdvert
} = {}) {
  const reasons = [];
  const intent = jobIntent?.intent || jobIntent;
  const intentVerification = await verifyPeerMessage(intent);
  const advertVerification = await verifyPeerMessage(providerAdvert);
  if (!intentVerification.ok) reasons.push(...intentVerification.reasons.map((reason) => `intent: ${reason}`));
  if (!advertVerification.ok) reasons.push(...advertVerification.reasons.map((reason) => `advert: ${reason}`));
  const advertProviderId = providerAdvert?.body?.providerId || providerAdvert?.fromPeerId || null;
  const requesterIdentity = await verifyPeerRoleClaims(intent, {
    role: 'requester',
    requiredCapability: PARTICIPATION_CAPABILITIES.requestInference
  });
  const providerIdentity = await verifyPeerRoleClaims(providerAdvert, {
    role: 'provider',
    requiredCapability: PARTICIPATION_CAPABILITIES.provideInference
  });
  reasons.push(...requesterIdentity.reasons.map((reason) => `requester identity: ${reason}`));
  reasons.push(...providerIdentity.reasons.map((reason) => `provider identity: ${reason}`));
  if (!assignment.assignmentId) reasons.push('assignmentId is required');
  if (!assignment.jobId) reasons.push('jobId is required');
  if (assignment.intentHash !== intentVerification.messageHash) reasons.push('intentHash mismatch');
  if (assignment.requesterId !== intent?.body?.requesterId) reasons.push('requesterId mismatch');
  if (assignment.providerId !== advertProviderId) reasons.push('providerId mismatch');
  if (!String(assignment.routeDecisionHash || '').startsWith('sha256:')) reasons.push('routeDecisionHash is required');
  if (assignment.providerAdvertHash !== advertVerification.messageHash) reasons.push('providerAdvertHash mismatch');
  const profileHash = providerAdvert?.body?.participationProfile?.profileHash || null;
  if ((assignment.providerParticipationProfileHash || null) !== profileHash) {
    reasons.push('provider participation profile hash mismatch');
  }
  const advertLimits = providerAssignmentLimits(providerAdvert);
  if (JSON.stringify(assignment.providerLimits || null) !== JSON.stringify(advertLimits)) {
    reasons.push('provider limits mismatch');
  }
  const expectedAssignmentHash = await hashJson({
    schema: 'reploid.peer.assignment/v1',
    intentHash: intentVerification.messageHash,
    providerId: advertProviderId,
    assignmentAttemptId: assignment.assignmentAttemptId,
    routeDecisionHash: assignment.routeDecisionHash,
    providerAdvertHash: advertVerification.messageHash,
    providerParticipationProfileHash: profileHash,
    providerLimits: advertLimits
  });
  if (assignment.assignmentHash !== expectedAssignmentHash) reasons.push('assignmentHash mismatch');
  if (assignment.inputHash !== intent?.body?.inputHash) reasons.push('inputHash mismatch');
  if (assignment.generationConfigHash !== intent?.body?.generationConfigHash) reasons.push('generationConfigHash mismatch');
  if (intentMaxTokens(intent) > advertLimits.maxTokensPerJob) reasons.push('provider token limit exceeded');
  if ((assignment.workload || POOLDAY_MODEL_WORKLOADS.textGeneration) !== intentWorkload(intent)) reasons.push('workload mismatch');
  const requiredModel = intent?.body?.modelRequirements || {};
  const assignmentModel = assignment.model || {};
  if (assignmentModel.id !== requiredModel.modelId) reasons.push('model id mismatch');
  if (assignmentModel.hash !== requiredModel.modelHash) reasons.push('model hash mismatch');
  if (assignmentModel.manifestHash !== requiredModel.manifestHash) reasons.push('manifest hash mismatch');
  if ((assignmentModel.runtime || LAUNCH_MODEL.runtime) !== (requiredModel.runtime || LAUNCH_MODEL.runtime)) reasons.push('runtime mismatch');
  if ((assignmentModel.backend || LAUNCH_MODEL.backend) !== (requiredModel.backend || LAUNCH_MODEL.backend)) reasons.push('backend mismatch');
  if ((assignmentModel.workload || POOLDAY_MODEL_WORKLOADS.textGeneration) !== (requiredModel.workload || POOLDAY_MODEL_WORKLOADS.textGeneration)) reasons.push('model workload mismatch');
  if (requiredModel.adapter) {
    const approval = await verifyAdapterUseApproval(assignment.adapterUseApproval, {
      adapterRequirement: requiredModel.adapter,
      requesterId: assignment.requesterId,
      inputHash: assignment.inputHash,
      modelRequirements: requiredModel
    });
    reasons.push(...approval.reasons.map((reason) => `adapter use approval: ${reason}`));
    if (assignment.adapter?.packHash !== requiredModel.adapter.packHash) reasons.push('assignment adapter pack hash mismatch');
    if (assignment.adapter?.publicationHash !== requiredModel.adapter.publicationHash) reasons.push('assignment adapter publication hash mismatch');
  } else if (assignment.adapter) {
    reasons.push('assignment declares an adapter absent from the intent');
  }
  const advertModels = providerAdvert?.body?.models || [];
  const advertHasModel = advertModels.some((model) => (
    model.modelId === requiredModel.modelId
    && model.modelHash === requiredModel.modelHash
    && model.manifestHash === requiredModel.manifestHash
    && (model.runtime || LAUNCH_MODEL.runtime) === (requiredModel.runtime || LAUNCH_MODEL.runtime)
    && (model.backend || LAUNCH_MODEL.backend) === (requiredModel.backend || LAUNCH_MODEL.backend)
    && modelSupportsPoolWorkload(model, requiredModel.workload || POOLDAY_MODEL_WORKLOADS.textGeneration)
  ));
  if (!advertHasModel) reasons.push('provider advert does not support assignment model');
  const acceptedPolicies = providerAdvert?.body?.availability?.acceptedPolicies || [];
  if (acceptedPolicies.length > 0 && !acceptedPolicies.includes(assignment.policyId)) {
    reasons.push('provider advert does not accept assignment policy');
  }
  const routeCandidate = evaluateProviderRouteCandidate({
    advert: providerAdvert,
    intent,
    messageValid: advertVerification.ok,
    identityValid: providerIdentity.ok,
    runtimeProfileValid: await advertRuntimeProfileHashValid(providerAdvert)
  });
  reasons.push(...routeCandidate.rejectionReasons.map((reason) => `provider route: ${reason}`));
  return {
    ok: reasons.length === 0,
    reasons,
    intentHash: intentVerification.messageHash,
    providerId: advertProviderId
  };
}

const receiptAgreementValue = (receipt = {}, agreementField = 'tokenIdsHash') => {
  if (receipt[agreementField]) return receipt[agreementField];
  if (agreementField === 'tokenIdsHash') return receipt.tokenIdsHash || null;
  if (agreementField === 'outputHash') return receipt.outputHash || null;
  if (agreementField === 'vectorHash') return receipt.vectorHash || null;
  return null;
};

const receiptMatchesAssignment = (receipt = {}, assignment = {}) => {
  const reasons = [];
  if (receipt.assignmentId !== assignment.assignmentId) reasons.push('receipt assignmentId mismatch');
  if (receipt.routeDecisionHash !== assignment.routeDecisionHash) reasons.push('receipt routeDecisionHash mismatch');
  if (receipt.jobId !== assignment.jobId) reasons.push('receipt jobId mismatch');
  if (receipt.requesterId !== assignment.requesterId) reasons.push('receipt requesterId mismatch');
  if (receipt.providerId !== assignment.providerId) reasons.push('receipt providerId mismatch');
  if (receipt.policyId !== assignment.policyId) reasons.push('receipt policyId mismatch');
  if (receipt.inputHash !== assignment.inputHash) reasons.push('receipt inputHash mismatch');
  if (receipt.generationConfigHash !== assignment.generationConfigHash) reasons.push('receipt generationConfigHash mismatch');
  if (receipt.model?.id !== assignment.model?.id) reasons.push('receipt model id mismatch');
  if (receipt.model?.hash !== assignment.model?.hash) reasons.push('receipt model hash mismatch');
  if (receipt.model?.manifestHash !== assignment.model?.manifestHash) reasons.push('receipt manifest hash mismatch');
  if ((receipt.model?.runtime || LAUNCH_MODEL.runtime) !== (assignment.model?.runtime || LAUNCH_MODEL.runtime)) reasons.push('receipt runtime mismatch');
  if ((receipt.model?.backend || LAUNCH_MODEL.backend) !== (assignment.model?.backend || LAUNCH_MODEL.backend)) reasons.push('receipt backend mismatch');
  if ((receipt.model?.workload || POOLDAY_MODEL_WORKLOADS.textGeneration)
    !== (assignment.model?.workload || POOLDAY_MODEL_WORKLOADS.textGeneration)) reasons.push('receipt workload mismatch');
  const expectedAdapter = assignment.adapter || assignment.model?.requirements?.adapter || null;
  const actualAdapter = receipt.adapter || null;
  if (!expectedAdapter && actualAdapter) reasons.push('receipt declares an adapter absent from the assignment');
  if (expectedAdapter && !actualAdapter) reasons.push('receipt adapter identity missing');
  if (expectedAdapter && actualAdapter) {
    for (const field of [
      'schema',
      'packHash',
      'adapterId',
      'adapterSha256',
      'baseModelId',
      'baseModelHash',
      'baseManifestHash',
      'humanPromotionReceiptHash',
      'dopplerParityReceiptHash',
      'gammaSelectionReceiptHash',
      'publicationHash',
      'publisherId'
    ]) {
      if (actualAdapter[field] !== expectedAdapter[field]) reasons.push(`receipt adapter ${field} mismatch`);
    }
    if (actualAdapter.adapterUseApprovalHash !== assignment.adapterUseApproval?.approvalHash) {
      reasons.push('receipt adapter use approval hash mismatch');
    }
    if (actualAdapter.state !== 'active') reasons.push('receipt adapter was not active');
    if (!Array.isArray(actualAdapter.artifactSources) || actualAdapter.artifactSources.length === 0) {
      reasons.push('receipt adapter acquisition source evidence missing');
    } else if (!actualAdapter.artifactSources.some((source) => (
      ['cache', 'peer', 'origin'].includes(source?.source)
      && source?.packHash === expectedAdapter.packHash
      && source?.adapterSha256 === expectedAdapter.adapterSha256
    ))) {
      reasons.push('receipt adapter acquisition source evidence mismatch');
    }
  }
  if (!receipt.providerSignature) reasons.push('receipt providerSignature is required');
  if (receipt.signatureDomain !== SIGNATURE_DOMAINS.providerReceipt) reasons.push('receipt signature domain mismatch');
  if (!receipt.outputHash) reasons.push('receipt outputHash is required');
  const workload = assignment.workload || assignment.model?.workload || assignment.model?.requirements?.workload || POOLDAY_MODEL_WORKLOADS.textGeneration;
  const agreementField = agreementFieldForWorkload(workload);
  if (!receipt[agreementField]) reasons.push(`receipt ${agreementField} is required`);
  if (isSequenceWorkload(workload)) {
    if (receipt.sequence?.requestHash !== assignment.sequenceRequestHash) reasons.push('receipt sequence request hash mismatch');
    if (receipt.sequence?.sequenceHash !== assignment.inputHash) reasons.push('receipt sequence input hash mismatch');
  }
  return reasons;
};

export async function buildPeerReceiptAgreement({
  plan,
  receiptPayloads = []
} = {}) {
  if (!Array.isArray(plan?.assignments) || plan.assignments.length === 0) {
    throw new TypeError('plan.assignments is required');
  }
  const assignmentsById = new Map(plan.assignments.map((assignment) => [assignment.assignmentId, assignment]));
  const requiredAgreement = Math.max(1, Number(plan.ring?.requiredAgreement || plan.assignment?.requiredAgreement || 1));
  const agreementField = plan.ring?.agreementField || plan.assignment?.agreementField || 'tokenIdsHash';
  const policy = getPolicy(plan.assignment?.policyId || plan.assignments[0]?.policyId);
  const pointMultiplier = Number(policy?.pointCostMultiplier || 1);
  const maxPointSpend = plan.assignment?.maxPointSpend ?? plan.assignments[0]?.maxPointSpend ?? null;
  const validRecords = [];
  const rejectedRecords = [];
  for (const receiptPayload of receiptPayloads) {
    const validation = validateP2PPayload(receiptPayload);
    const reasons = [...validation.reasons];
    if (receiptPayload?.type !== P2P_PAYLOAD_TYPES.RECEIPT) reasons.push('payload type must be receipt');
    const assignment = assignmentsById.get(receiptPayload?.assignmentId);
    if (!assignment) reasons.push('assignment not in plan');
    const receipt = receiptPayload?.body?.receipt || null;
    if (!receipt) reasons.push('receipt body is required');
    if (assignment && receipt) reasons.push(...receiptMatchesAssignment(receipt, assignment));
    const receiptHash = receipt ? await hashJson(receipt) : null;
    if (receiptPayload?.body?.receiptHash && receiptPayload.body.receiptHash !== receiptHash) {
      reasons.push('receiptHash mismatch');
    }
    const agreementValue = receipt ? receiptAgreementValue(receipt, agreementField) : null;
    if (!agreementValue) reasons.push(`${agreementField} is required for agreement`);
    if (reasons.length > 0) {
      rejectedRecords.push({
        receiptPayload,
        receiptHash,
        reasons
      });
      continue;
    }
    validRecords.push({
      assignment,
      receiptPayload,
      receipt,
      receiptHash,
      providerId: assignment.providerId,
      agreementValue,
      outputHash: receipt.outputHash,
      tokenIdsHash: receipt.tokenIdsHash,
      vectorHash: receipt.vectorHash || null,
      sequenceResultHash: receipt.sequenceResultHash || null
    });
  }
  const groups = new Map();
  for (const record of validRecords) {
    const bucket = groups.get(record.agreementValue) || [];
    bucket.push(record);
    groups.set(record.agreementValue, bucket);
  }
  const rankedGroups = [...groups.entries()]
    .map(([agreementValue, records]) => [agreementValue, records.sort((left, right) => left.providerId.localeCompare(right.providerId))])
    .sort((left, right) => {
      if (right[1].length !== left[1].length) return right[1].length - left[1].length;
      return String(left[0]).localeCompare(String(right[0]));
    });
  const [agreementValue, acceptedRecords = []] = rankedGroups[0] || [null, []];
  const accepted = acceptedRecords.length >= requiredAgreement;
  const acceptedSlice = acceptedRecords.slice(0, accepted ? acceptedRecords.length : 0);
  const providerPoints = acceptedSlice.map((record) => ({
    receiptHash: record.receiptHash,
    providerId: record.providerId,
    points: calculateReceiptPoints({
      receiptHash: record.receiptHash,
      providerId: record.providerId,
      receipt: record.receipt
    }, { multiplier: pointMultiplier })
  }));
  const pointSpend = providerPoints.reduce((sum, entry) => sum + entry.points, 0);
  const spendLimitExceeded = maxPointSpend !== null && Number.isFinite(Number(maxPointSpend)) && pointSpend > Number(maxPointSpend);
  const acceptedWithSpend = accepted && !spendLimitExceeded;
  const rejectionReasons = spendLimitExceeded
    ? [`point spend ${pointSpend} exceeds maxPointSpend ${Number(maxPointSpend)}`]
    : [];
  const baseAgreement = {
    schema: 'reploid.peer.receipt_agreement/v1',
    status: acceptedWithSpend ? 'accepted' : 'rejected',
    mode: plan.ring ? 'ring_quorum' : (plan.assignment?.redundancyGroupSize > 1 ? 'redundant' : 'single'),
    jobId: plan.jobId || plan.assignment?.jobId || null,
    intentHash: plan.intentHash || plan.assignment?.intentHash || null,
    policyId: plan.assignment?.policyId || acceptedSlice[0]?.assignment?.policyId || null,
    policyConfigVersion: plan.assignment?.policyConfigVersion || acceptedSlice[0]?.assignment?.policyConfigVersion || null,
    policyConfigHash: plan.assignment?.policyConfigHash || acceptedSlice[0]?.assignment?.policyConfigHash || null,
    agreementField,
    agreementValue,
    requiredAgreement,
    providerCount: validRecords.length,
    acceptedProviderCount: acceptedSlice.length,
    providerIds: acceptedSlice.map((record) => record.providerId),
    receiptHashes: acceptedSlice.map((record) => record.receiptHash),
    receiptHash: acceptedSlice[0]?.receiptHash || null,
    outputHash: acceptedSlice[0]?.outputHash || null,
    tokenIdsHash: acceptedSlice[0]?.tokenIdsHash || null,
    vectorHash: acceptedSlice[0]?.vectorHash || null,
    sequenceResultHash: acceptedSlice[0]?.sequenceResultHash || null,
    effectiveTrustTier: plan.ring?.effectiveTrustTier || plan.assignment?.trustTier || null,
    ring: plan.ring || null,
    maxPointSpend,
    pointSpend,
    providerPoints,
    rejectionReasons
  };
  return {
    ...baseAgreement,
    agreementHash: await hashJson(baseAgreement),
    accepted: acceptedWithSpend,
    acceptedRecords: acceptedSlice,
    validRecords,
    rejectedRecords
  };
}

export async function createPeerLedgerEvents({
  agreement,
  requesterId,
  requesterPublicKey,
  privateKey
} = {}) {
  if (!agreement?.accepted) return [];
  const resolvedRequesterId = requireString(requesterId, 'requesterId');
  const resolvedPublicKey = requireString(requesterPublicKey, 'requesterPublicKey');
  const reasons = getLedgerReasons(agreement.mode || 'single');
  const messages = [];
  for (const entry of agreement.providerPoints || []) {
    messages.push(await createSignedPeerMessage({
      type: PEER_MESSAGE_TYPES.POINTS_EVENT,
      fromPeerId: resolvedRequesterId,
      publicKey: resolvedPublicKey,
      privateKey,
      body: {
        schema: 'reploid.peer.points_event/v1',
        agreementHash: agreement.agreementHash,
        receiptHash: entry.receiptHash,
        userId: entry.providerId,
        providerId: entry.providerId,
        points: entry.points,
        direction: 'credit',
        reason: reasons.award || 'accepted_receipt'
      }
    }));
    messages.push(await createSignedPeerMessage({
      type: PEER_MESSAGE_TYPES.REPUTATION_EVENT,
      fromPeerId: resolvedRequesterId,
      publicKey: resolvedPublicKey,
      privateKey,
      body: {
        schema: 'reploid.peer.reputation_event/v1',
        agreementHash: agreement.agreementHash,
        receiptHash: entry.receiptHash,
        providerId: entry.providerId,
        acceptedReceipts: 1,
        rejectedReceipts: 0,
        timeouts: 0,
        points: entry.points,
        reason: reasons.award || 'accepted_receipt'
      }
    }));
  }
  if (agreement.pointSpend > 0) {
    messages.push(await createSignedPeerMessage({
      type: PEER_MESSAGE_TYPES.POINTS_EVENT,
      fromPeerId: resolvedRequesterId,
      publicKey: resolvedPublicKey,
      privateKey,
      body: {
        schema: 'reploid.peer.points_event/v1',
        agreementHash: agreement.agreementHash,
        receiptHash: agreement.receiptHash || null,
        userId: resolvedRequesterId,
        points: -agreement.pointSpend,
        direction: 'debit',
        reason: reasons.spend || 'accepted_receipt_spend'
      }
    }));
  }
  return messages;
}

export function createPeerEventReducer() {
  return {
    reduce(messages = []) {
      const points = new Map();
      const reputation = new Map();
      const seen = new Set();
      const ordered = [...messages].sort((left, right) => String(left.messageHash || '').localeCompare(String(right.messageHash || '')));
      for (const message of ordered) {
        const dedupeKey = message.messageHash || `${message.type}:${message.body?.agreementHash || ''}:${message.body?.receiptHash || ''}:${message.body?.userId || message.body?.providerId || ''}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        if (message.type === PEER_MESSAGE_TYPES.POINTS_EVENT) {
          const userId = message.body?.userId;
          if (!userId) continue;
          points.set(userId, Number(points.get(userId) || 0) + Number(message.body?.points || 0));
        }
        if (message.type === PEER_MESSAGE_TYPES.REPUTATION_EVENT) {
          const providerId = message.body?.providerId;
          if (!providerId) continue;
          const current = reputation.get(providerId) || { providerId, acceptedReceipts: 0, rejectedReceipts: 0, timeouts: 0, points: 0 };
          reputation.set(providerId, {
            ...current,
            acceptedReceipts: current.acceptedReceipts + Number(message.body?.acceptedReceipts || 0),
            rejectedReceipts: current.rejectedReceipts + Number(message.body?.rejectedReceipts || 0),
            timeouts: current.timeouts + Number(message.body?.timeouts || 0),
            points: current.points + Number(message.body?.points || 0)
          });
        }
      }
      return {
        points: Object.fromEntries(points),
        reputation: Object.fromEntries(reputation)
      };
    }
  };
}

export function createDataChannelPeerBus(dataChannel) {
  if (!dataChannel || typeof dataChannel.send !== 'function') {
    throw new TypeError('dataChannel with send() is required');
  }
  const listeners = new Set();
  const handleMessage = (event) => {
    let envelope = event?.data;
    if (typeof envelope === 'string') {
      try {
        envelope = JSON.parse(envelope);
      } catch {
        return;
      }
    }
    if (envelope?.peerControlBusVersion !== PEER_CONTROL_BUS_VERSION || !envelope.message) return;
    for (const listener of listeners) listener(envelope.message);
  };
  if (typeof dataChannel.addEventListener === 'function') {
    dataChannel.addEventListener('message', handleMessage);
  } else {
    const previous = dataChannel.onmessage;
    dataChannel.onmessage = (event) => {
      if (typeof previous === 'function') previous.call(dataChannel, event);
      handleMessage(event);
    };
  }
  return Object.freeze({
    send(message) {
      dataChannel.send(JSON.stringify({
        peerControlBusVersion: PEER_CONTROL_BUS_VERSION,
        message
      }));
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
}

export function createInMemoryPeerBus() {
  const listeners = new Set();
  return Object.freeze({
    send(message) {
      for (const listener of listeners) listener(message);
    },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });
}

export function createPeerControlPlane({
  peerId,
  publicKey,
  privateKey,
  bus = createInMemoryPeerBus(),
  verifyIncoming = true
} = {}) {
  const localPeerId = requireString(peerId, 'peerId');
  const messages = new Map();
  const byType = new Map();
  const nonceIndex = new Map();
  let unsubscribe = null;

  const indexMessage = (message) => {
    messages.set(message.messageHash, message);
    const bucket = byType.get(message.type) || [];
    if (!bucket.some((entry) => entry.messageHash === message.messageHash)) bucket.push(message);
    byType.set(message.type, bucket);
  };

  const ingest = async (message) => {
    const verification = verifyIncoming ? await verifyPeerMessage(message) : { ok: true, messageHash: message.messageHash, reasons: [] };
    if (!verification.ok) {
      return {
        ok: false,
        reason: 'invalid_peer_message',
        verification
      };
    }
    const nonceKey = `${message.fromPeerId}:${message.nonce}`;
    const priorHash = nonceIndex.get(nonceKey);
    if (priorHash && priorHash !== verification.messageHash) {
      return {
        ok: false,
        reason: 'peer_message_nonce_reuse',
        verification: {
          ...verification,
          reasons: ['peer message nonce already used by different payload']
        }
      };
    }
    nonceIndex.set(nonceKey, verification.messageHash);
    if (messages.has(verification.messageHash)) {
      return {
        ok: true,
        duplicate: true,
        messageHash: verification.messageHash,
        message: messages.get(verification.messageHash)
      };
    }
    indexMessage({ ...message, messageHash: verification.messageHash });
    return {
      ok: true,
      messageHash: verification.messageHash,
      message: messages.get(verification.messageHash)
    };
  };

  const publish = async (type, body = {}, options = {}) => {
    const signed = await createSignedPeerMessage({
      type,
      fromPeerId: localPeerId,
      toPeerId: options.toPeerId || null,
      publicKey,
      privateKey,
      body,
      expiresAt: options.expiresAt || null,
      causalRefs: options.causalRefs || []
    });
    indexMessage(signed);
    bus.send(signed);
    return signed;
  };

  return Object.freeze({
    start() {
      if (!unsubscribe) unsubscribe = bus.subscribe((message) => {
        void ingest(message);
      });
      return this;
    },
    stop() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
    },
    ingest,
    publish,
    async publishJobIntent({ prompt, sequence, sequenceRequest, policyId, modelRequirements, generationConfig, maxPointSpend } = {}) {
      const result = await createSignedJobIntent({
        requesterId: localPeerId,
        requesterPublicKey: publicKey,
        privateKey,
        prompt,
        sequence,
        sequenceRequest,
        policyId,
        modelRequirements,
        generationConfig,
        maxPointSpend
      });
      indexMessage(result.intent);
      bus.send(result.intent);
      return result;
    },
    publishProviderAdvert(options = {}) {
      return createSignedProviderAdvert({
        providerId: localPeerId,
        providerPublicKey: publicKey,
        privateKey,
        ...options
      }).then((advert) => {
        indexMessage(advert);
        bus.send(advert);
        return advert;
      });
    },
    buildAssignmentPlan(jobIntent) {
      return buildPeerAssignmentPlan({
        jobIntent,
        providerAdverts: byType.get(PEER_MESSAGE_TYPES.PROVIDER_ADVERT) || []
      });
    },
    messages: () => Array.from(messages.values()),
    messagesByType: (type) => [...(byType.get(type) || [])],
    reduceEvents: () => createPeerEventReducer().reduce(Array.from(messages.values()))
  });
}

export async function exportPeerPublicKey(keyPair) {
  if (!keyPair?.publicKey) throw new TypeError('keyPair.publicKey is required');
  return exportPublicKey(keyPair.publicKey);
}

export default {
  PEER_CONTROL_VERSION,
  PEER_CONTROL_BUS_VERSION,
  PEER_CONTROL_NETWORK,
  PEER_MESSAGE_TYPES,
  peerMessageSigningPayload,
  createPeerMessage,
  validatePeerMessage,
  hashPeerMessage,
  signPeerMessage,
  createSignedPeerMessage,
  verifyPeerMessage,
  createSignedJobIntent,
  createSignedProviderAdvert,
  buildPeerAssignmentPlan,
  createPeerPromptPayload,
  createPeerSequencePayload,
  validatePromptPayloadForAssignment,
  validateSequencePayloadForAssignment,
  validateInputPayloadForAssignment,
  validatePeerAssignmentForIntentAndAdvert,
  buildPeerReceiptAgreement,
  createPeerLedgerEvents,
  createPeerEventReducer,
  createDataChannelPeerBus,
  createInMemoryPeerBus,
  createPeerControlPlane,
  exportPeerPublicKey
};
