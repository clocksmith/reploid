import { canonicalize, hashJson } from "../../../shared/pool/inference-receipt.js";
import { FASTEST_RECEIPT_POLICY_ID, POOL_CONFIG_VERSION, getPolicy } from "../../../shared/pool/config.js";

import { sealPeerAssignmentIdentity } from './peer-assignment.js';
import { LAUNCH_MODEL, POOLDAY_MODEL_WORKLOADS, exactModelContractKey, getEnabledPoolModelContract, getPoolModelExecutionMode, modelSupportsPoolWorkload } from "../../../shared/pool/model-contract.js";
import { advertSupportsModel } from './peer-model-match.js';
import {
  compareProviderRouteCandidates,
  evaluateProviderRouteCandidate,
  sealArtifactRouteDecision
} from './artifact-router.js';
import {
  PARTICIPATION_CAPABILITIES
} from '../../../shared/pool/participation-profile.js';

import { verifyAdapterUseApproval } from "./adapter-publication.js";

import { isSequenceWorkload } from "../../../shared/pool/sequence-workload.js";

import { PEER_MESSAGE_TYPES, verifyPeerMessage } from "./peer-protocol.js";

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

import { verifyPeerRoleClaims } from "./peer-signed-claims.js";

const advertSupportsIntent = (advert = {}, intent = {}, policy = {}) => {
  const body = advert.body || {};
  const acceptedPolicies = body.availability?.acceptedPolicies || [];
  const acceptsPolicy = acceptedPolicies.length === 0 || acceptedPolicies.includes(intent.body?.policyId);
  return acceptsPolicy
    && advertSupportsModel(advert, intent.body?.modelRequirements, intentWorkload(intent))
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
  const assignedModel = getEnabledPoolModelContract(intent.body?.modelRequirements?.modelId);
  if (!assignedModel || !modelSupportsPoolWorkload(assignedModel, workload)) {
    return {
      ok: false,
      reason: 'model_contract_not_enabled_for_workload',
      assignments: []
    };
  }
  const assignmentAgreementField = agreementFieldForIntent(intent, policy);
  const sequenceRequestHash = intent.body.sequenceRequest
    ? await hashJson(intent.body.sequenceRequest)
    : null;
  for (const [index, candidate] of selectedCandidates.entries()) {
    const providerId = peerIdForMessage(candidate.advert);
    const providerAdvertHash = candidate.advert.messageHash;
    const providerParticipationProfileHash = candidate.advert.body?.participationProfile?.profileHash || null;
    const providerLimits = providerAssignmentLimits(candidate.advert);
    const { assignmentHash, assignmentId } = await sealPeerAssignmentIdentity({
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
      assignmentId,
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
        ...assignedModel,
        id: assignedModel.modelId,
        hash: assignedModel.modelHash,
        workload,
        executionMode: getPoolModelExecutionMode(assignedModel, workload),
        exactModelContractKey: exactModelContractKey(assignedModel, { workload }),
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
  const { assignmentHash: expectedAssignmentHash } = await sealPeerAssignmentIdentity({
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
  const enabledModel = getEnabledPoolModelContract(requiredModel.modelId);
  if (assignmentModel.id !== requiredModel.modelId) reasons.push('model id mismatch');
  if (assignmentModel.hash !== requiredModel.modelHash) reasons.push('model hash mismatch');
  if (assignmentModel.manifestHash !== requiredModel.manifestHash) reasons.push('manifest hash mismatch');
  if ((assignmentModel.runtime || LAUNCH_MODEL.runtime) !== (requiredModel.runtime || LAUNCH_MODEL.runtime)) reasons.push('runtime mismatch');
  if ((assignmentModel.backend || LAUNCH_MODEL.backend) !== (requiredModel.backend || LAUNCH_MODEL.backend)) reasons.push('backend mismatch');
  if ((assignmentModel.workload || POOLDAY_MODEL_WORKLOADS.sequenceEmbedding) !== (requiredModel.workload || POOLDAY_MODEL_WORKLOADS.sequenceEmbedding)) reasons.push('model workload mismatch');
  if (!enabledModel) {
    reasons.push('assignment model is not an enabled Poolday model');
  } else {
    const expectedModelContractKey = exactModelContractKey(enabledModel, {
      workload: intentWorkload(intent)
    });
    if (assignmentModel.exactModelContractKey !== expectedModelContractKey) {
      reasons.push('assignment exact model contract key mismatch');
    }
    if (exactModelContractKey(assignmentModel) !== expectedModelContractKey) {
      reasons.push('assignment model fields do not match the enabled exact model contract');
    }
  }
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
  const advertHasModel = advertSupportsModel(providerAdvert, requiredModel,
    requiredModel.workload || POOLDAY_MODEL_WORKLOADS.sequenceEmbedding);
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
