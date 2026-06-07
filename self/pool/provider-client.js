/**
 * @fileoverview Browser provider client for fastest-receipt pool jobs.
 */

import { createPoolSdk } from './sdk.js';
import { buildPoolReceipt, createSigningKeyPair, exportPublicKey, signProviderReceipt } from './inference-receipt.js';
import { createDopplerRuntime } from './doppler-runtime.js';
import { buildLaunchProviderModel } from './model-contract.js';
import { createPoolIdentity } from './identity.js';
import { listPolicies } from './policy-router.js';

export function createProviderClient({ providerId, sdk = createPoolSdk(), runtime = createDopplerRuntime(), keyPair = null, identity = createPoolIdentity('provider') } = {}) {
  let activeKeyPair = keyPair;
  let publicKey = null;
  let registration = null;
  let activeProviderId = providerId;
  const history = [];

  const recordHistory = (event) => {
    const saved = {
      ...event,
      recordedAt: new Date().toISOString()
    };
    history.unshift(saved);
    history.splice(50);
    return saved;
  };

  const ensureKeys = async () => {
    if (!activeKeyPair) activeKeyPair = identity ? await identity.getSigningKeyPair() : await createSigningKeyPair();
    if (!publicKey) publicKey = await exportPublicKey(activeKeyPair.publicKey);
    return activeKeyPair;
  };

  const ensureProviderId = async () => {
    if (!activeProviderId) activeProviderId = identity ? await identity.getRoleId() : null;
    if (!activeProviderId) throw new Error('providerId is required');
    return activeProviderId;
  };

  const modelMatchesRuntime = (model = {}, runtimeModel = {}) => (
    model.modelId === runtimeModel.modelId
    && model.modelHash === runtimeModel.modelHash
    && model.manifestHash === runtimeModel.manifestHash
    && (model.runtime || 'doppler') === (runtimeModel.runtime || 'doppler')
    && (model.backend || 'browser-webgpu') === (runtimeModel.backend || 'browser-webgpu')
  );

  const assignmentMatchesRuntime = (assignmentModel = {}, runtimeModel = {}) => (
    assignmentModel.id === runtimeModel.modelId
    && assignmentModel.hash === runtimeModel.modelHash
    && assignmentModel.manifestHash === runtimeModel.manifestHash
    && (assignmentModel.runtime || 'doppler') === (runtimeModel.runtime || 'doppler')
    && (assignmentModel.backend || 'browser-webgpu') === (runtimeModel.backend || 'browser-webgpu')
  );

  return {
    async register({ models, device = {}, availability = {} }) {
      await ensureKeys();
      const resolvedProviderId = await ensureProviderId();
      if (typeof runtime?.isReady === 'function' && !runtime.isReady()) {
        throw new Error('Doppler browser model must be loaded before provider registration');
      }
      const runtimeModel = typeof runtime?.getModelInfo === 'function' ? runtime.getModelInfo() : null;
      const advertisedModels = Array.isArray(models) && models.length > 0
        ? models
        : [runtimeModel || buildLaunchProviderModel()];
      const advertisedModel = advertisedModels[0] || {};
      if (!runtimeModel?.modelId || !runtimeModel?.modelHash || !runtimeModel?.manifestHash) {
        throw new Error('Loaded Doppler runtime must expose modelId, modelHash, and manifestHash before registration');
      }
      if (!advertisedModel.modelId || !modelMatchesRuntime(advertisedModel, runtimeModel)) {
        throw new Error('Loaded Doppler model identity does not match advertised provider model');
      }
      const mismatchedModel = advertisedModels.find((model) => !modelMatchesRuntime(model, runtimeModel));
      if (mismatchedModel) throw new Error('Provider registration cannot advertise models that differ from the loaded Doppler runtime');
      const runtimeDevice = typeof runtime?.getDeviceInfo === 'function'
        ? await runtime.getDeviceInfo()
        : {};
      registration = await sdk.registerProvider({
        providerId: resolvedProviderId,
        models: advertisedModels,
        device: {
          ...runtimeDevice,
          ...device
        },
        availability: {
          maxConcurrentJobs: 1,
          maxTokensPerJob: 128,
          acceptedPolicies: listPolicies().map((policy) => policy.policyId),
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
      recordHistory({
        eventType: 'assignment_execution_started',
        assignmentId: assignment.assignmentId,
        jobId: assignment.jobId,
        policyId: assignment.policyId
      });
      try {
        const runtimeModel = typeof runtime?.getModelInfo === 'function' ? runtime.getModelInfo() : null;
        if (!assignmentMatchesRuntime(assignment.model || {}, runtimeModel || {})) {
          throw new Error('Assignment model identity does not match the loaded Doppler runtime');
        }
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
        const result = await sdk.submitReceipt(assignment.assignmentId, {
          outputText: execution.outputText,
          tokenIds: execution.tokenIds || [],
          transcript: execution.transcript || {
            outputText: execution.outputText,
            tokenIds: execution.tokenIds || []
          },
          receipt: signedReceipt
        });
        recordHistory({
          eventType: result?.verifierDecision?.accepted ? 'receipt_verified' : 'receipt_rejected',
          assignmentId: assignment.assignmentId,
          jobId: assignment.jobId,
          policyId: assignment.policyId,
          receiptHash: result?.verifierDecision?.receiptHash || result?.receipt?.receiptHash || null,
          verifierDecision: result?.verifierDecision || null
        });
        return result;
      } catch (error) {
        if (error.status) {
          recordHistory({
            eventType: 'receipt_submission_failed',
            assignmentId: assignment.assignmentId,
            jobId: assignment.jobId,
            policyId: assignment.policyId,
            status: error.status,
            payload: error.payload || null
          });
          throw error;
        }
        let failureReport = null;
        try {
          failureReport = await sdk.reportAssignmentFailure(assignment.assignmentId, {
            providerId: registration?.providerId || assignment.providerId,
            reason: error.message,
            providerFault: true
          });
        } catch (reportError) {
          failureReport = {
            error: reportError.message,
            payload: reportError.payload || null
          };
        }
        recordHistory({
          eventType: 'assignment_execution_failed',
          assignmentId: assignment.assignmentId,
          jobId: assignment.jobId,
          policyId: assignment.policyId,
          reason: error.message,
          failureReport
        });
        throw error;
      }
    },
    async runWorkerStep() {
      if (!registration?.providerId) throw new Error('Provider is not registered');
      const heartbeat = await this.heartbeat();
      const next = await this.nextAssignment();
      if (!next?.assignment) {
        return {
          status: 'idle',
          heartbeat,
          assignment: null,
          history
        };
      }
      const receiptResult = await this.executeAssignment(next.assignment);
      return {
        status: 'executed_assignment',
        heartbeat,
        assignment: next.assignment,
        receiptResult,
        history
      };
    },
    getRegistration() {
      return registration;
    },
    getHistory() {
      return [...history];
    },
    getPublicKey() {
      return publicKey;
    }
  };
}

export default {
  createProviderClient
};
