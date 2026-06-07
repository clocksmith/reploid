/**
 * @fileoverview Agent-facing pool client.
 */

import { createPoolSdk, verifyReceipt } from './sdk.js';
import { buildLaunchModelRequirements } from './model-contract.js';
import { countersignReceipt, createSigningKeyPair, exportPublicKey } from './inference-receipt.js';

export function createAgentClient({ agentId, pointBudget = 0, sdk = createPoolSdk() } = {}) {
  let keyPair = null;
  let agentPublicKey = null;
  const ensureKeys = async () => {
    if (!keyPair) keyPair = await createSigningKeyPair();
    if (!agentPublicKey) agentPublicKey = await exportPublicKey(keyPair.publicKey);
    return keyPair;
  };
  return {
    agentId,
    pointBudget,
    async submitJob(request) {
      await ensureKeys();
      return sdk.submitJob({
        requesterId: agentId,
        requesterPublicKey: agentPublicKey,
        policyId: 'fastest_receipt',
        verificationLevel: 'signed_receipt',
        ...request,
        modelRequirements: buildLaunchModelRequirements(request?.modelRequirements || {})
      });
    },
    pollJob(jobId) {
      return sdk.pollJob(jobId);
    },
    verifyReceipt,
    async acceptReceipt(receiptHash, accepted = true) {
      const keys = await ensureKeys();
      const acceptance = await countersignReceipt({ receiptHash, requesterId: agentId, accepted }, keys.privateKey);
      return sdk.acceptReceipt(receiptHash, {
        ...acceptance
      });
    }
  };
}

export default {
  createAgentClient
};
