/**
 * @fileoverview Agent-facing pool client.
 */

import { createPoolSdk, verifyReceipt } from './sdk.js';
import { buildLaunchModelRequirements } from './model-contract.js';
import { buildAcceptanceSummary, countersignReceipt, createSigningKeyPair, exportPublicKey } from './inference-receipt.js';
import { DETERMINISTIC_GENERATION_CONFIG, FASTEST_RECEIPT_POLICY_ID, getPolicy } from './policy-router.js';
import { createPoolIdentity } from './identity.js';
import {
  createPeerLedgerEvents,
  createPeerPromptPayload,
  createSignedJobIntent
} from './peer-control-plane.js';

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
  return {
    get agentId() {
      return activeAgentId;
    },
    pointBudget,
    async submitJob(request) {
      await ensureKeys();
      const resolvedAgentId = await ensureAgentId();
      const policyId = request?.policyId || FASTEST_RECEIPT_POLICY_ID;
      const policy = getPolicy(policyId);
      return sdk.submitJob({
        ...request,
        requesterId: resolvedAgentId,
        requesterPublicKey: agentPublicKey,
        policyId,
        verificationLevel: policy?.verificationLevel || 'signed_receipt',
        modelRequirements: buildLaunchModelRequirements(request?.modelRequirements || {}),
        generationConfig: {
          ...DETERMINISTIC_GENERATION_CONFIG,
          ...(request?.generationConfig || {})
        },
        maxPointSpend: request?.maxPointSpend ?? (pointBudget > 0 ? pointBudget : null)
      });
    },
    async createPeerJobIntent({ prompt, policyId = FASTEST_RECEIPT_POLICY_ID, modelRequirements = {}, generationConfig = {}, maxPointSpend = null } = {}) {
      const keys = await ensureKeys();
      const resolvedAgentId = await ensureAgentId();
      return createSignedJobIntent({
        requesterId: resolvedAgentId,
        requesterPublicKey: agentPublicKey,
        privateKey: keys.privateKey,
        prompt,
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
