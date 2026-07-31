/**
 * @fileoverview Peer-to-peer control-plane primitives for Reploid model serving.
 */

import {
  calculateReceiptPoints,
  canonicalize,
  exportPublicKey,
  hashJson,
  receiptSigningPayload,
  sha256Hex,
  SIGNATURE_DOMAINS,
  verifyCanonicalSignature
} from './inference-receipt.js';
import {
  DETERMINISTIC_GENERATION_CONFIG,
  FASTEST_RECEIPT_POLICY_ID,
  POOL_CONFIG_VERSION,
  getPolicy
} from './config.js';
import { validatePooldayPolicyClasses } from './policy-router.js';
import {
  LAUNCH_MODEL,
  POOLDAY_MODEL_WORKLOADS,
  buildLaunchModelRequirements,
  buildLaunchProviderModel,
  getPoolModelWorkload,
  modelSupportsPoolWorkload,
  validateLaunchModelRequirement,
  validateProviderModelContract
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
  validateP2PPayload
} from './p2p-payload.js';
import {
  SEQUENCE_PUBLIC_SENSITIVITY,
  isSequenceWorkload,
  normalizeSequenceInput,
  normalizeSequenceRequest,
  validateSequenceRequest
} from './sequence-workload.js';
import { validateSequenceOutputIntegrity } from './sequence-result.js';
import {
  PEER_CONTROL_NETWORK,
  PEER_CONTROL_VERSION,
  PEER_MESSAGE_TYPES,
  createPeerMessage,
  createSignedPeerMessage,
  hashPeerMessage,
  peerMessageSigningPayload,
  requirePeerString as requireString,
  signPeerMessage,
  validatePeerMessage,
  verifyPeerMessage
} from './peer-protocol.js';
import {
  PEER_CONTROL_BUS_VERSION,
  createDataChannelPeerBus,
  createInMemoryPeerBus
} from './peer-transport.js';
import {
  createPeerEventReducer,
  createPeerLedgerEvents
} from './peer-ledger.js';
import {
  agreementFieldForIntent,
  buildPeerRingPlan,
  candidateSortKey,
  intentMaxTokens,
  intentWorkload,
  peerIdForMessage,
  providerAssignmentLimits,
  selectRuntimeCompatibleAdverts
} from './peer-planning.js';
import {
  createPeerPromptPayload,
  createPeerSequencePayload,
  validateInputPayloadForAssignment,
  validatePromptPayloadForAssignment,
  validateSequencePayloadForAssignment
} from './peer-payload.js';
import {
  receiptAgreementValue,
  receiptMatchesAssignment
} from './peer-agreement.js';

export {
  PEER_CONTROL_BUS_VERSION,
  PEER_CONTROL_NETWORK,
  PEER_CONTROL_VERSION,
  PEER_MESSAGE_TYPES,
  createDataChannelPeerBus,
  createInMemoryPeerBus,
  createPeerEventReducer,
  createPeerLedgerEvents,
  createPeerMessage,
  createPeerPromptPayload,
  createPeerSequencePayload,
  createSignedPeerMessage,
  hashPeerMessage,
  peerMessageSigningPayload,
  signPeerMessage,
  validateInputPayloadForAssignment,
  validatePeerMessage,
  validatePromptPayloadForAssignment,
  validateSequencePayloadForAssignment,
  verifyPeerMessage
};

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
  const invalidModel = resolvedModels
    .map((model) => ({ model, validation: validateProviderModelContract(model) }))
    .find(({ validation }) => !validation.ok);
  if (invalidModel) {
    throw new Error(`provider advert model contract is invalid: ${invalidModel.validation.reasons.join('; ')}`);
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
        acceptedPolicyClasses: ['public_text', 'code_help', 'benchmark_eval', 'public_biological_sequence'],
        ...availability
      },
      reputationEvidence
    },
    createdAt,
    expiresAt
  });
}

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
  if (canonicalize(assignment.providerLimits || null) !== canonicalize(advertLimits)) {
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
  if ((assignment.workload || POOLDAY_MODEL_WORKLOADS.sequenceEmbedding) !== intentWorkload(intent)) reasons.push('workload mismatch');
  const requiredModel = intent?.body?.modelRequirements || {};
  const assignmentModel = assignment.model || {};
  if (assignmentModel.id !== requiredModel.modelId) reasons.push('model id mismatch');
  if (assignmentModel.hash !== requiredModel.modelHash) reasons.push('model hash mismatch');
  if (assignmentModel.manifestHash !== requiredModel.manifestHash) reasons.push('manifest hash mismatch');
  if ((assignmentModel.runtime || LAUNCH_MODEL.runtime) !== (requiredModel.runtime || LAUNCH_MODEL.runtime)) reasons.push('runtime mismatch');
  if ((assignmentModel.backend || LAUNCH_MODEL.backend) !== (requiredModel.backend || LAUNCH_MODEL.backend)) reasons.push('backend mismatch');
  if ((assignmentModel.workload || POOLDAY_MODEL_WORKLOADS.sequenceEmbedding) !== (requiredModel.workload || POOLDAY_MODEL_WORKLOADS.sequenceEmbedding)) reasons.push('model workload mismatch');
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
    && modelSupportsPoolWorkload(model, requiredModel.workload || POOLDAY_MODEL_WORKLOADS.sequenceEmbedding)
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
    if (assignment && receipt) {
      reasons.push(...receiptMatchesAssignment(receipt, assignment));

      const providerPublicKey = assignment.providerPublicKey
        || receiptPayload?.body?.providerPublicKey
        || receiptPayload?.publicKey
        || receipt.providerPublicKey;
      if (!providerPublicKey) {
        reasons.push('assignment providerPublicKey is missing for verification');
      } else if (receipt.providerSignature) {
        try {
          const sigOk = await verifyCanonicalSignature(
            receiptSigningPayload(receipt),
            providerPublicKey,
            receipt.providerSignature,
            { domain: SIGNATURE_DOMAINS.providerReceipt }
          );
          if (!sigOk) reasons.push('receipt providerSignature verification failed');
        } catch (err) {
          reasons.push(`receipt providerSignature verification error: ${err.message}`);
        }
      }

      const bodyOutputText = receiptPayload?.body?.outputText;
      if (typeof bodyOutputText === 'string' && bodyOutputText.length > 0) {
        const computedOutputHash = await sha256Hex(bodyOutputText);
        if (receipt.outputHash && computedOutputHash !== receipt.outputHash) {
          reasons.push(`receipt outputHash mismatch with returned outputText (${computedOutputHash} vs ${receipt.outputHash})`);
        }
      }

      const bodyTokenIds = receiptPayload?.body?.tokenIds;
      if (Array.isArray(bodyTokenIds) && bodyTokenIds.length > 0) {
        const computedTokenIdsHash = await sha256Hex(canonicalize(bodyTokenIds));
        if (receipt.tokenIdsHash && computedTokenIdsHash !== receipt.tokenIdsHash) {
          reasons.push(`receipt tokenIdsHash mismatch with returned tokenIds (${computedTokenIdsHash} vs ${receipt.tokenIdsHash})`);
        }
      }

      if (isSequenceWorkload(assignment.workload)) {
        const expectedSequenceResultHash = receipt.sequenceResultHash || receipt.sequence?.resultHash || null;
        if (receiptPayload?.body?.sequenceResultHash !== expectedSequenceResultHash) {
          reasons.push('sequenceResultHash does not match the signed receipt');
        }
        const sequenceValidation = await validateSequenceOutputIntegrity({
          sequenceResult: receiptPayload?.body?.sequenceResult,
          sequenceOutput: receiptPayload?.body?.sequenceOutput,
          expectedResultHash: expectedSequenceResultHash
        });
        reasons.push(...sequenceValidation.reasons);
      }
    }
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
      providerPublicKey: assignment.providerPublicKey || receiptPayload?.body?.providerPublicKey || receipt.providerPublicKey,
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
    const isDuplicate = bucket.some((existing) => (
      existing.providerId === record.providerId ||
      (existing.providerPublicKey && record.providerPublicKey && existing.providerPublicKey === record.providerPublicKey)
    ));
    if (!isDuplicate) {
      bucket.push(record);
      groups.set(record.agreementValue, bucket);
    } else {
      rejectedRecords.push({
        receiptPayload: record.receiptPayload,
        receiptHash: record.receiptHash,
        reasons: ['duplicate provider ID or public key in quorum bucket']
      });
    }
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
