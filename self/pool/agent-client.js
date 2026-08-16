/**
 * @fileoverview Agent-facing pool client.
 */

import { createPoolSdk, verifyReceipt } from './sdk.js';
import { buildLaunchModelRequirements } from './model-contract.js';
import {
  buildAcceptanceSummary,
  countersignReceipt,
  createSigningKeyPair,
  exportPublicKey,
  hashJson,
  sha256Hex
} from './inference-receipt.js';
import { DETERMINISTIC_GENERATION_CONFIG, FASTEST_RECEIPT_POLICY_ID, getPolicy } from './policy-router.js';
import { createPoolIdentity } from './identity.js';
import { createAdapterUseApproval } from './adapter-publication.js';
import {
  createPeerLedgerEvents,
  createPeerPromptPayload,
  createPeerSequencePayload,
  createSignedJobIntent
} from './peer-control-plane.js';
import {
  SEQUENCE_DISCLOSURE,
  isSequenceWorkload,
  normalizeSequenceInput,
  normalizeSequenceRequest
} from './sequence-workload.js';

export function createAgentClient({ agentId, pointBudget = 0, sdk = createPoolSdk(), identity = createPoolIdentity('agent') } = {}) {
  let keyPair = null;
  let agentPublicKey = null;
  let activeAgentId = agentId;
  const ensureKeys = async () => {
    if (!keyPair) keyPair = identity ? await identity.getSigningKeyPair() : await createSigningKeyPair();
    if (!agentPublicKey) agentPublicKey = await exportPublicKey(keyPair.publicKey);
    return keyPair;
  };
  const ensureAgentId = async () => {
    if (!activeAgentId) activeAgentId = identity ? await identity.getRoleId() : null;
    if (!activeAgentId) throw new Error('agentId is required');
    return activeAgentId;
  };
  const ensureIdentityClaims = async () => {
    if (!identity?.getParticipationProfile || !identity?.getRoleProof) {
      return { participationProfile: null, identityProof: null };
    }
    const participationProfile = await identity.getParticipationProfile();
    return {
      participationProfile,
      identityProof: await identity.getRoleProof({ participationProfile })
    };
  };
  return {
    get agentId() {
      return activeAgentId;
    },
    pointBudget,
    async submitJob(request) {
      const keys = await ensureKeys();
      const resolvedAgentId = await ensureAgentId();
      const policyId = request?.policyId || FASTEST_RECEIPT_POLICY_ID;
      const policy = getPolicy(policyId);
      const modelRequirements = buildLaunchModelRequirements(request?.modelRequirements || {});
      if (isSequenceWorkload(modelRequirements.workload)) {
        throw new Error('Use submitSequenceJob() so raw sequence input remains on the WebRTC data channel');
      }
      const inputHash = await sha256Hex(request?.prompt || '');
      const adapterUseApproval = modelRequirements.adapter
        ? await createAdapterUseApproval({
          adapterRequirement: modelRequirements.adapter,
          requesterId: resolvedAgentId,
          requesterPublicKey: agentPublicKey,
          privateKey: keys.privateKey,
          inputHash,
          modelRequirements
        })
        : null;
      return sdk.submitJob({
        ...request,
        requesterId: resolvedAgentId,
        requesterPublicKey: agentPublicKey,
        policyId,
        verificationLevel: policy?.verificationLevel || 'signed_receipt',
        modelRequirements,
        adapterUseApproval,
        ...await ensureIdentityClaims(),
        generationConfig: {
          ...DETERMINISTIC_GENERATION_CONFIG,
          ...(request?.generationConfig || {})
        },
        maxPointSpend: request?.maxPointSpend ?? (pointBudget > 0 ? pointBudget : null)
      });
    },
    async submitSequenceJob({
      sequence,
      sequenceRequest = null,
      policyId = FASTEST_RECEIPT_POLICY_ID,
      modelRequirements = {},
      generationConfig = {},
      maxPointSpend = null
    } = {}) {
      const keys = await ensureKeys();
      const resolvedAgentId = await ensureAgentId();
      const policy = getPolicy(policyId);
      let resolvedModelRequirements = buildLaunchModelRequirements(modelRequirements);
      if (!isSequenceWorkload(resolvedModelRequirements.workload)) {
        throw new Error('submitSequenceJob() requires a biological sequence model workload');
      }
      const normalizedSequence = normalizeSequenceInput(
        sequence,
        sequenceRequest?.alphabet || resolvedModelRequirements.sequence?.alphabet
      );
      const inputHash = await sha256Hex(normalizedSequence);
      const resolvedSequenceRequest = normalizeSequenceRequest(sequenceRequest || {}, {
        workload: resolvedModelRequirements.workload,
        sequenceHash: inputHash,
        sequenceLength: normalizedSequence.length,
        model: resolvedModelRequirements
      });
      resolvedModelRequirements = {
        ...resolvedModelRequirements,
        sequenceRequest: resolvedSequenceRequest
      };
      const adapterUseApproval = resolvedModelRequirements.adapter
        ? await createAdapterUseApproval({
          adapterRequirement: resolvedModelRequirements.adapter,
          requesterId: resolvedAgentId,
          requesterPublicKey: agentPublicKey,
          privateKey: keys.privateKey,
          inputHash,
          modelRequirements: resolvedModelRequirements
        })
        : null;
      return sdk.submitJob({
        requesterId: resolvedAgentId,
        requesterPublicKey: agentPublicKey,
        prompt: null,
        inputKind: 'sequence',
        inputHash,
        inputTransport: 'webrtc_datachannel',
        inputDisclosure: SEQUENCE_DISCLOSURE,
        sequenceRequest: resolvedSequenceRequest,
        sequenceRequestHash: await hashJson(resolvedSequenceRequest),
        policyId,
        verificationLevel: policy?.verificationLevel || 'signed_receipt',
        modelRequirements: resolvedModelRequirements,
        adapterUseApproval,
        ...await ensureIdentityClaims(),
        generationConfig: {
          ...DETERMINISTIC_GENERATION_CONFIG,
          ...generationConfig
        },
        maxPointSpend: maxPointSpend ?? (pointBudget > 0 ? pointBudget : null)
      });
    },
    async createPeerJobIntent({
      prompt,
      sequence,
      sequenceRequest = null,
      policyId = FASTEST_RECEIPT_POLICY_ID,
      modelRequirements = {},
      generationConfig = {},
      maxPointSpend = null
    } = {}) {
      const keys = await ensureKeys();
      const resolvedAgentId = await ensureAgentId();
      return createSignedJobIntent({
        requesterId: resolvedAgentId,
        requesterPublicKey: agentPublicKey,
        privateKey: keys.privateKey,
        prompt,
        sequence,
        sequenceRequest,
        ...await ensureIdentityClaims(),
        policyId,
        modelRequirements: buildLaunchModelRequirements(modelRequirements),
        generationConfig: {
          ...DETERMINISTIC_GENERATION_CONFIG,
          ...generationConfig
        },
        maxPointSpend: maxPointSpend ?? (pointBudget > 0 ? pointBudget : null)
      });
    },
    async createPeerPromptPayload({ assignment, prompt, toPeerId = assignment?.providerId } = {}) {
      await ensureKeys();
      const resolvedAgentId = await ensureAgentId();
      return createPeerPromptPayload({
        assignment,
        prompt,
        fromPeerId: resolvedAgentId,
        toPeerId
      });
    },
    async createPeerSequencePayload({ assignment, sequence, toPeerId = assignment?.providerId } = {}) {
      await ensureKeys();
      const resolvedAgentId = await ensureAgentId();
      return createPeerSequencePayload({
        assignment,
        sequence,
        fromPeerId: resolvedAgentId,
        toPeerId
      });
    },
    async createPeerReceiptAcceptance({ receiptHash, accepted = true, agreement = null, receiptHashes = null } = {}) {
      const keys = await ensureKeys();
      const resolvedAgentId = await ensureAgentId();
      const acceptedReceiptHashes = receiptHashes || agreement?.receiptHashes || (receiptHash ? [receiptHash] : []);
      return countersignReceipt({
        receiptHash: receiptHash || agreement?.receiptHash,
        requesterId: resolvedAgentId,
        accepted,
        jobId: agreement?.jobId || null,
        policyId: agreement?.policyId || null,
        policyConfigVersion: agreement?.policyConfigVersion || null,
        policyConfigHash: agreement?.policyConfigHash || null,
        agreementHash: agreement?.agreementHash || null,
        pointSpend: agreement?.pointSpend ?? null,
        providerPoints: agreement?.providerPoints || null,
        receiptHashes: acceptedReceiptHashes
      }, keys.privateKey);
    },
    async createPeerLedgerEvents({ agreement } = {}) {
      const keys = await ensureKeys();
      const resolvedAgentId = await ensureAgentId();
      return createPeerLedgerEvents({
        agreement,
        requesterId: resolvedAgentId,
        requesterPublicKey: agentPublicKey,
        privateKey: keys.privateKey
      });
    },
    pollJob(jobId) {
      return sdk.pollJob(jobId);
    },
    verifyReceipt,
    async acceptReceipt(receiptHash, accepted = true) {
      const keys = await ensureKeys();
      const resolvedAgentId = await ensureAgentId();
      let acceptanceSummary = null;
      if (accepted === true) {
        const receiptRecord = await sdk.getReceipt(receiptHash);
        const jobResponse = await sdk.pollJob(receiptRecord.jobId);
        const job = jobResponse.job || jobResponse;
        const receiptHashes = Array.isArray(job?.agreement?.receiptHashes) && job.agreement.status === 'accepted'
          ? job.agreement.receiptHashes
          : [receiptHash];
        const receiptRecords = await Promise.all(receiptHashes.map((currentReceiptHash) => sdk.getReceipt(currentReceiptHash)));
        acceptanceSummary = await buildAcceptanceSummary({ job, receiptHash, receiptRecords });
      }
      const acceptance = await countersignReceipt({
        receiptHash,
        requesterId: resolvedAgentId,
        accepted,
        ...(acceptanceSummary || {})
      }, keys.privateKey);
      return sdk.acceptReceipt(receiptHash, {
        ...acceptance
      });
    }
  };
}

export default {
  createAgentClient
};
