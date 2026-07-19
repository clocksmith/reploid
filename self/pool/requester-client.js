/**
 * @fileoverview Browser requester client for fastest-receipt pool jobs.
 */

import { createPoolSdk } from './sdk.js';
import { buildAcceptanceSummary, countersignReceipt, createSigningKeyPair, exportPublicKey, sha256Hex } from './inference-receipt.js';
import { buildLaunchModelRequirements } from './model-contract.js';
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
  adapterRequirementFromPack,
  verifyAdapterPack
} from './adapter-pack.js';

export function createRequesterClient({ requesterId, sdk = createPoolSdk(), keyPair = null, identity = createPoolIdentity('requester') } = {}) {
  let activeKeyPair = keyPair;
  let requesterPublicKey = null;
  let activeRequesterId = requesterId;
  const ensureKeys = async () => {
    if (!activeKeyPair) activeKeyPair = identity ? await identity.getSigningKeyPair() : await createSigningKeyPair();
    if (!requesterPublicKey) requesterPublicKey = await exportPublicKey(activeKeyPair.publicKey);
    return activeKeyPair;
  };
  const ensureRequesterId = async () => {
    if (!activeRequesterId) activeRequesterId = identity ? await identity.getRoleId() : null;
    if (!activeRequesterId) throw new Error('requesterId is required');
    return activeRequesterId;
  };
  const ensureIdentityClaims = async () => {
    if (!identity?.getParticipationProfile || !identity?.getRoleProof) return {
      participationProfile: null,
      identityProof: null
    };
    const participationProfile = await identity.getParticipationProfile();
    return {
      participationProfile,
      identityProof: await identity.getRoleProof({ participationProfile })
    };
  };
  return {
    async submitAdapterJob({ adapterPack, modelRequirements = {}, ...request } = {}) {
      const verification = await verifyAdapterPack(adapterPack, { requirePromoted: true });
      if (!verification.ok) throw new Error(`Adapter pack rejected: ${verification.reasons.join('; ')}`);
      return this.submitJob({
        ...request,
        modelRequirements: {
          ...modelRequirements,
          modelId: adapterPack.baseModel.modelId,
          modelHash: adapterPack.baseModel.modelHash,
          manifestHash: adapterPack.baseModel.manifestHash,
          adapter: adapterRequirementFromPack(adapterPack)
        }
      });
    },
    async createPeerAdapterJobIntent({ adapterPack, modelRequirements = {}, ...request } = {}) {
      const verification = await verifyAdapterPack(adapterPack, { requirePromoted: true });
      if (!verification.ok) throw new Error(`Adapter pack rejected: ${verification.reasons.join('; ')}`);
      return this.createPeerJobIntent({
        ...request,
        modelRequirements: {
          ...modelRequirements,
          modelId: adapterPack.baseModel.modelId,
          modelHash: adapterPack.baseModel.modelHash,
          manifestHash: adapterPack.baseModel.manifestHash,
          adapter: adapterRequirementFromPack(adapterPack)
        }
      });
    },
    async submitJob({ prompt, policyId = FASTEST_RECEIPT_POLICY_ID, modelRequirements = {}, generationConfig = {}, maxPointSpend = null }) {
      const keys = await ensureKeys();
      const resolvedRequesterId = await ensureRequesterId();
      const policy = getPolicy(policyId);
      const resolvedModelRequirements = buildLaunchModelRequirements(modelRequirements);
      const inputHash = await sha256Hex(prompt);
      const adapterUseApproval = resolvedModelRequirements.adapter
        ? await createAdapterUseApproval({
          adapterRequirement: resolvedModelRequirements.adapter,
          requesterId: resolvedRequesterId,
          requesterPublicKey,
          privateKey: keys.privateKey,
          inputHash,
          modelRequirements: resolvedModelRequirements
        })
        : null;
      const identityClaims = await ensureIdentityClaims();
      return sdk.submitJob({
        requesterId: resolvedRequesterId,
        requesterPublicKey,
        prompt,
        policyId,
        modelRequirements: resolvedModelRequirements,
        adapterUseApproval,
        ...identityClaims,
        generationConfig: {
          ...DETERMINISTIC_GENERATION_CONFIG,
          ...generationConfig
        },
        maxPointSpend,
        verificationLevel: policy?.verificationLevel || 'signed_receipt'
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
      const resolvedRequesterId = await ensureRequesterId();
      const identityClaims = await ensureIdentityClaims();
      return createSignedJobIntent({
        requesterId: resolvedRequesterId,
        requesterPublicKey,
        privateKey: keys.privateKey,
        ...identityClaims,
        prompt,
        sequence,
        sequenceRequest,
        policyId,
        modelRequirements: buildLaunchModelRequirements(modelRequirements),
        generationConfig: {
          ...DETERMINISTIC_GENERATION_CONFIG,
          ...generationConfig
        },
        maxPointSpend
      });
    },
    createPeerSequenceJobIntent(options = {}) {
      return this.createPeerJobIntent(options);
    },
    async createPeerPromptPayload({ assignment, prompt, toPeerId = assignment?.providerId } = {}) {
      await ensureKeys();
      const resolvedRequesterId = await ensureRequesterId();
      return createPeerPromptPayload({
        assignment,
        prompt,
        fromPeerId: resolvedRequesterId,
        toPeerId
      });
    },
    async createPeerSequencePayload({ assignment, sequence, toPeerId = assignment?.providerId } = {}) {
      await ensureKeys();
      const resolvedRequesterId = await ensureRequesterId();
      return createPeerSequencePayload({
        assignment,
        sequence,
        fromPeerId: resolvedRequesterId,
        toPeerId
      });
    },
    async createPeerReceiptAcceptance({ receiptHash, accepted = true, agreement = null, receiptHashes = null } = {}) {
      const keys = await ensureKeys();
      const resolvedRequesterId = await ensureRequesterId();
      const acceptedReceiptHashes = receiptHashes || agreement?.receiptHashes || (receiptHash ? [receiptHash] : []);
      return countersignReceipt({
        receiptHash: receiptHash || agreement?.receiptHash,
        requesterId: resolvedRequesterId,
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
      const resolvedRequesterId = await ensureRequesterId();
      return createPeerLedgerEvents({
        agreement,
        requesterId: resolvedRequesterId,
        requesterPublicKey,
        privateKey: keys.privateKey
      });
    },
    pollJob(jobId) {
      return sdk.pollJob(jobId);
    },
    async acceptReceipt(receiptHash, accepted = true) {
      const keys = await ensureKeys();
      const resolvedRequesterId = await ensureRequesterId();
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
        requesterId: resolvedRequesterId,
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
  createRequesterClient
};
