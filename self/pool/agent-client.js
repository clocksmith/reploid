/**
 * @fileoverview Agent-facing pool client.
 */

import { createPoolSdk, verifyReceipt } from './sdk.js';
import { buildLaunchModelRequirements } from './model-contract.js';
import { countersignReceipt, createSigningKeyPair, exportPublicKey } from './inference-receipt.js';
import { DETERMINISTIC_GENERATION_CONFIG, FASTEST_RECEIPT_POLICY_ID, getPolicy } from './policy-router.js';
import { createPoolIdentity } from './identity.js';

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
    pollJob(jobId) {
      return sdk.pollJob(jobId);
    },
    verifyReceipt,
    async acceptReceipt(receiptHash, accepted = true) {
      const keys = await ensureKeys();
      const resolvedAgentId = await ensureAgentId();
      const acceptance = await countersignReceipt({ receiptHash, requesterId: resolvedAgentId, accepted }, keys.privateKey);
      return sdk.acceptReceipt(receiptHash, {
        ...acceptance
      });
    }
  };
}

export default {
  createAgentClient
};
