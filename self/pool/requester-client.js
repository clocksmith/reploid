/**
 * @fileoverview Browser requester client for fastest-receipt pool jobs.
 */

import { createPoolSdk } from './sdk.js';
import { countersignReceipt, createSigningKeyPair, exportPublicKey } from './inference-receipt.js';
import { buildLaunchModelRequirements } from './model-contract.js';

export function createRequesterClient({ requesterId, sdk = createPoolSdk(), keyPair = null } = {}) {
  let activeKeyPair = keyPair;
  let requesterPublicKey = null;
  const ensureKeys = async () => {
    if (!activeKeyPair) activeKeyPair = await createSigningKeyPair();
    if (!requesterPublicKey) requesterPublicKey = await exportPublicKey(activeKeyPair.publicKey);
    return activeKeyPair;
  };
  return {
    async submitJob({ prompt, modelRequirements = {}, generationConfig = {} }) {
      await ensureKeys();
      return sdk.submitJob({
        requesterId,
        requesterPublicKey,
        prompt,
        policyId: 'fastest_receipt',
        modelRequirements: buildLaunchModelRequirements(modelRequirements),
        generationConfig: {
          mode: 'greedy',
          temperature: 0,
          topK: 1,
          topP: 1,
          maxOutputTokens: 128,
          ...generationConfig
        },
        verificationLevel: 'signed_receipt'
      });
    },
    pollJob(jobId) {
      return sdk.pollJob(jobId);
    },
    async acceptReceipt(receiptHash, accepted = true) {
      const keys = await ensureKeys();
      const acceptance = await countersignReceipt({ receiptHash, requesterId, accepted }, keys.privateKey);
      return sdk.acceptReceipt(receiptHash, {
        ...acceptance
      });
    }
  };
}

export default {
  createRequesterClient
};
