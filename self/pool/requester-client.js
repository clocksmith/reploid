/**
 * @fileoverview Browser requester client for fastest-receipt pool jobs.
 */

import { createPoolSdk } from './sdk.js';
import { countersignReceipt, createSigningKeyPair } from './inference-receipt.js';

export function createRequesterClient({ requesterId, sdk = createPoolSdk(), keyPair = null } = {}) {
  let activeKeyPair = keyPair;
  const ensureKeys = async () => {
    if (!activeKeyPair) activeKeyPair = await createSigningKeyPair();
    return activeKeyPair;
  };
  return {
    submitJob({ prompt, modelRequirements = {}, generationConfig = {} }) {
      return sdk.submitJob({
        requesterId,
        prompt,
        policyId: 'fastest_receipt',
        modelRequirements,
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
      const acceptance = await countersignReceipt({ receiptHash, accepted }, keys.privateKey);
      return sdk.acceptReceipt(receiptHash, {
        requesterId,
        ...acceptance
      });
    }
  };
}

export default {
  createRequesterClient
};
