/**
 * @fileoverview Browser requester client for fastest-receipt pool jobs.
 */

import { createPoolSdk } from './sdk.js';
import { countersignReceipt, createSigningKeyPair, exportPublicKey } from './inference-receipt.js';
import { buildLaunchModelRequirements } from './model-contract.js';
import { DETERMINISTIC_GENERATION_CONFIG, FASTEST_RECEIPT_POLICY_ID, getPolicy } from './policy-router.js';
import { createPoolIdentity } from './identity.js';

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
    pollJob(jobId) {
      return sdk.pollJob(jobId);
    },
    async acceptReceipt(receiptHash, accepted = true) {
      const keys = await ensureKeys();
      const resolvedRequesterId = await ensureRequesterId();
      const acceptance = await countersignReceipt({ receiptHash, requesterId: resolvedRequesterId, accepted }, keys.privateKey);
      return sdk.acceptReceipt(receiptHash, {
        ...acceptance
      });
    }
  };
}

export default {
  createRequesterClient
};
