import { hashJson, sha256Hex } from "../../../shared/pool/inference-receipt.js";
import {
  DETERMINISTIC_GENERATION_CONFIG,
  FASTEST_RECEIPT_POLICY_ID,
  POOL_CONFIG_VERSION,
  getPolicy
} from '../../../shared/pool/config.js';
import { validatePooldayPolicyClasses } from './policy-router.js';

import { buildLaunchModelRequirements, buildLaunchProviderModel, getPoolModelWorkload, validateLaunchModelRequirement, validateProviderModelContract } from "../../../shared/pool/model-contract.js";

import { verifyPoolIdentityClaims } from './identity-claims.js';
import { createAdapterUseApproval, validatePublishedAdapterRequirement } from "./adapter-publication.js";

import {
  SEQUENCE_PUBLIC_SENSITIVITY,
  isSequenceWorkload,
  normalizeSequenceInput,
  normalizeSequenceRequest,
  validateSequenceRequest
} from '../../../shared/pool/sequence-workload.js';

import { PEER_MESSAGE_TYPES, createSignedPeerMessage, requirePeerString as requireString } from "./peer-protocol.js";

import { peerIdForMessage } from "./peer-planning.js";

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
      sequenceLength: resolvedInput.length,
      model: resolvedModelRequirements
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
