/**
 * @fileoverview Browser requester client for fastest-receipt pool jobs.
 */

import { createPoolSdk } from './sdk.js';
import { buildAcceptanceSummary, countersignReceipt, createSigningKeyPair, exportPublicKey } from './inference-receipt.js';
import { buildLaunchModelRequirements } from './model-contract.js';
import { DETERMINISTIC_GENERATION_CONFIG, FASTEST_RECEIPT_POLICY_ID, getPolicy } from './policy-router.js';
import { createPoolIdentity } from './identity.js';
import {
  createPeerLedgerEvents,
  createPeerPromptPayload,
  createSignedJobIntent
} from './peer-control-plane.js';

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
  return {
    async submitJob({ prompt, policyId = FASTEST_RECEIPT_POLICY_ID, modelRequirements = {}, generationConfig = {}, maxPointSpend = null }) {
      await ensureKeys();
      const resolvedRequesterId = await ensureRequesterId();
      const policy = getPolicy(policyId);
      return sdk.submitJob({
        requesterId: resolvedRequesterId,
        requesterPublicKey,
        prompt,
        policyId,
        modelRequirements: buildLaunchModelRequirements(modelRequirements),
        generationConfig: {
          ...DETERMINISTIC_GENERATION_CONFIG,
          ...generationConfig
        },
        maxPointSpend,
        verificationLevel: policy?.verificationLevel || 'signed_receipt'
      });
    },
    async createPeerJobIntent({ prompt, policyId = FASTEST_RECEIPT_POLICY_ID, modelRequirements = {}, generationConfig = {}, maxPointSpend = null } = {}) {
      const keys = await ensureKeys();
      const resolvedRequesterId = await ensureRequesterId();
      return createSignedJobIntent({
        requesterId: resolvedRequesterId,
        requesterPublicKey,
        privateKey: keys.privateKey,
        prompt,
        policyId,
        modelRequirements: buildLaunchModelRequirements(modelRequirements),
        generationConfig: {
          ...DETERMINISTIC_GENERATION_CONFIG,
          ...generationConfig
        },
        maxPointSpend
      });
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
