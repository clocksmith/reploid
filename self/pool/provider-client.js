/**
 * @fileoverview Browser provider client for fastest-receipt pool jobs.
 */

import { createPoolSdk } from './sdk.js';
import { buildPoolReceipt, createSigningKeyPair, exportPublicKey, signProviderReceipt } from './inference-receipt.js';
import { createDopplerRuntime } from './doppler-runtime.js';
import { buildLaunchProviderModel } from './model-contract.js';

export function createProviderClient({ providerId, sdk = createPoolSdk(), runtime = createDopplerRuntime(), keyPair = null } = {}) {
  let activeKeyPair = keyPair;
  let publicKey = null;
  let registration = null;

  const ensureKeys = async () => {
    if (!activeKeyPair) activeKeyPair = await createSigningKeyPair();
    if (!publicKey) publicKey = await exportPublicKey(activeKeyPair.publicKey);
    return activeKeyPair;
  };

  return {
    async register({ models, device = {}, availability = {} }) {
      await ensureKeys();
      registration = await sdk.registerProvider({
        providerId,
        models: Array.isArray(models) && models.length > 0
          ? models
          : [buildLaunchProviderModel()],
        device,
        availability: {
          maxConcurrentJobs: 1,
          maxTokensPerJob: 128,
          acceptedPolicies: ['fastest_receipt'],
          ...availability
        },
        publicKey,
        timestamp: new Date().toISOString()
      });
      return registration;
    },
    heartbeat() {
      if (!registration?.providerId || !registration?.sessionId) {
        throw new Error('Provider is not registered');
      }
      return sdk.heartbeatProvider({
        providerId: registration.providerId,
        sessionId: registration.sessionId,
        timestamp: new Date().toISOString()
      });
    },
    nextAssignment() {
      if (!registration?.providerId) throw new Error('Provider is not registered');
      return sdk.nextAssignment(registration.providerId);
    },
    async executeAssignment(assignment) {
      await ensureKeys();
      const execution = await runtime.generate({
        prompt: assignment.prompt,
        generationConfig: assignment.generationConfig,
        assignment
      });
      const receipt = await buildPoolReceipt({
        assignment,
        provider: registration,
        model: assignment.model || runtime.getModelInfo(),
        runtime: runtime.getRuntimeInfo(),
        execution
      });
      const signedReceipt = await signProviderReceipt(receipt, activeKeyPair.privateKey);
      return sdk.submitReceipt(assignment.assignmentId, {
        outputText: execution.outputText,
        tokenIds: execution.tokenIds || [],
        transcript: execution.transcript || {
          outputText: execution.outputText,
          tokenIds: execution.tokenIds || []
        },
        receipt: signedReceipt
      });
    },
    getPublicKey() {
      return publicKey;
    }
  };
}

export default {
  createProviderClient
};
