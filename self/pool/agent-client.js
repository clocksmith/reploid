/**
 * @fileoverview Agent-facing pool client.
 */

import { createPoolSdk, verifyReceipt } from './sdk.js';

export function createAgentClient({ agentId, pointBudget = 0, sdk = createPoolSdk() } = {}) {
  return {
    agentId,
    pointBudget,
    submitJob(request) {
      return sdk.submitJob({
        requesterId: agentId,
        policyId: 'fastest_receipt',
        verificationLevel: 'signed_receipt',
        ...request
      });
    },
    pollJob(jobId) {
      return sdk.pollJob(jobId);
    },
    verifyReceipt,
    acceptReceipt(receiptHash, acceptance) {
      return sdk.acceptReceipt(receiptHash, {
        requesterId: agentId,
        accepted: true,
        ...acceptance
      });
    }
  };
}

export default {
  createAgentClient
};
