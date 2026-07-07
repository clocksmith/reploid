/**
 * @fileoverview Browser provider client for fastest-receipt pool jobs.
 */

import { createPoolSdk } from './sdk.js';
import { buildPoolReceipt, createSigningKeyPair, exportPublicKey, hashJson, sha256Hex, signProviderReceipt } from './inference-receipt.js';
import { createDopplerRuntime } from './doppler-runtime.js';
import { POOLDAY_MODEL_WORKLOADS, buildLaunchProviderModel, getPoolModelWorkload } from './model-contract.js';
import { createPoolIdentity } from './identity.js';
import { listPolicies } from './policy-router.js';
import { collectRuntimeProfile } from './runtime-profile.js';
import {
  createSignedProviderAdvert,
  validatePromptPayloadForAssignment
} from './peer-control-plane.js';
import {
  buildAssignmentCommitmentPayload,
  buildAssignmentRevealPayload
} from './p2p-payload.js';

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
    && getPoolModelWorkload(model) === getPoolModelWorkload(runtimeModel)
  );

  const assignmentMatchesRuntime = (assignmentModel = {}, runtimeModel = {}) => (
    assignmentModel.id === runtimeModel.modelId
    && assignmentModel.hash === runtimeModel.modelHash
    && assignmentModel.manifestHash === runtimeModel.manifestHash
    && (assignmentModel.runtime || 'doppler') === (runtimeModel.runtime || 'doppler')
    && (assignmentModel.backend || 'browser-webgpu') === (runtimeModel.backend || 'browser-webgpu')
    && (assignmentModel.workload || assignmentModel.requirements?.workload || POOLDAY_MODEL_WORKLOADS.textGeneration) === getPoolModelWorkload(runtimeModel)
  );

  const resolveRuntimeProfile = async () => {
    if (typeof runtime?.getRuntimeProfile === 'function') {
      return runtime.getRuntimeProfile();
    }
    return collectRuntimeProfile({ runtime });
  };

  const resolveAssignmentPrompt = async (assignment = {}, { promptPayload = null, prompt = null } = {}) => {
    if (promptPayload) {
      const validation = await validatePromptPayloadForAssignment(promptPayload, assignment);
      if (!validation.ok) throw new Error(`invalid WebRTC prompt payload: ${validation.reasons.join('; ')}`);
      return validation.prompt;
    }
    if (prompt !== null && prompt !== undefined) {
      const promptText = String(prompt);
      if (assignment.inputHash && await sha256Hex(promptText) !== assignment.inputHash) {
        throw new Error('assignment inputHash mismatch');
      }
      return promptText;
    }
    if (assignment.prompt) return assignment.prompt;
    throw new Error('assignment prompt must be supplied over WebRTC prompt payload');
  };

  const runLocalAssignment = async (assignment, { promptPayload = null, prompt = null } = {}) => {
    await ensureKeys();
    recordHistory({
      eventType: 'assignment_execution_started',
      assignmentId: assignment.assignmentId,
      jobId: assignment.jobId,
      policyId: assignment.policyId
    });
    const runtimeModel = typeof runtime?.getModelInfo === 'function' ? runtime.getModelInfo() : null;
    if (!assignmentMatchesRuntime(assignment.model || {}, runtimeModel || {})) {
      throw new Error('Assignment model identity does not match the loaded Doppler runtime');
    }
    const promptText = await resolveAssignmentPrompt(assignment, { promptPayload, prompt });
    const workload = assignment.workload || assignment.model?.requirements?.workload || getPoolModelWorkload(runtimeModel || {});
    const execution = workload === POOLDAY_MODEL_WORKLOADS.embedding
      ? await runtime.embed({
        prompt: promptText,
        assignment
      })
      : await runtime.generate({
        prompt: promptText,
        generationConfig: assignment.generationConfig,
        assignment
      });
    const receipt = await buildPoolReceipt({
      assignment,
      provider: registration || {
        providerId: assignment.providerId,
        publicKey,
        runtimeProfileHash: assignment.runtimeProfileHash || null
      },
      model: assignment.model || runtime.getModelInfo(),
      runtime: runtime.getRuntimeInfo(),
      execution
    });
    return {
      prompt: promptText,
      execution,
      receipt: await signProviderReceipt(receipt, activeKeyPair.privateKey)
    };
  };

  const commitRevealModeFor = (assignment = {}, mode = 'auto') => {
    if (mode === false || mode === 'disabled') return { enabled: false, required: false };
    const coordinatorRequired = assignment.commitRevealRequired === true
      || assignment.phaseProtocol === 'commit_reveal_v1'
      || assignment.ring?.commitRevealRequired === true
      || assignment.ring?.phaseProtocol === 'commit_reveal_v1';
    const ringPolicy = assignment.policyId === 'ring_quorum_receipt' || !!assignment.ring;
    return {
      enabled: mode === 'required' || coordinatorRequired || ringPolicy,
      required: mode === 'required' || coordinatorRequired
    };
  };

  const waitForRevealGate = async ({ assignment, commitmentResult, maxPolls = 5 }) => {
    if (commitmentResult?.revealOpen === true
      || commitmentResult?.phase === 'reveal_open'
      || commitmentResult?.ringPhase === 'reveal_open') {
      return {
        revealOpen: true,
        source: 'commitment_response',
        commitmentResult
      };
    }
    for (let poll = 0; poll < maxPolls; poll += 1) {
      const jobResponse = await sdk.pollJob(assignment.jobId);
      const job = jobResponse?.job || jobResponse;
      if (job?.ringPhase === 'reveal_open' || job?.ringPhase === 'reveal_submitted') {
        return {
          revealOpen: true,
          source: 'job_ring_phase',
          job
        };
      }
      const phase = job?.assignmentPhases?.[assignment.assignmentId]
        || job?.commitReveal?.assignments?.[assignment.assignmentId]
        || null;
      if (phase?.revealOpen === true || phase?.phase === 'reveal_open') {
        return {
          revealOpen: true,
          source: 'job_phase',
          phase,
          job
        };
      }
    }
    return {
      revealOpen: false,
      source: 'poll_limit',
      commitmentResult
    };
  };

  const runCommitReveal = async ({ assignment, execution, receipt, mode = 'auto' }) => {
    const commitReveal = commitRevealModeFor(assignment, mode);
    if (!commitReveal.enabled) {
      return {
        enabled: false,
        required: false
      };
    }
    const providerId = registration?.providerId || assignment.providerId;
    const salt = globalThis.crypto?.randomUUID
      ? `salt_${globalThis.crypto.randomUUID()}`
      : `salt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const commitment = await buildAssignmentCommitmentPayload({
      assignment,
      providerId,
      execution,
      receipt,
      salt
    });
    let commitmentResult = null;
    try {
      commitmentResult = await sdk.submitAssignmentCommitment(assignment.assignmentId, commitment);
    } catch (error) {
      if (!commitReveal.required && (error.status === 404 || error.status === 501)) {
        return {
          enabled: true,
          required: false,
          unsupported: true,
          commitment,
          error: error.message,
          payload: error.payload || null
        };
      }
      throw error;
    }
    const revealGate = await waitForRevealGate({ assignment, commitmentResult });
    if (!revealGate.revealOpen && commitReveal.required) {
      throw new Error('Coordinator did not open reveal phase for required commit-reveal assignment');
    }
    const reveal = await buildAssignmentRevealPayload({
      assignment,
      providerId,
      execution,
      receipt,
      salt,
      commitmentHash: commitment.commitmentHash
    });
    const revealResult = await sdk.submitAssignmentReveal(assignment.assignmentId, reveal);
    return {
      enabled: true,
      required: commitReveal.required,
      commitment,
      commitmentResult,
      revealGate,
      reveal,
      revealResult
    };
  };

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
      const { runtimeProfile, runtimeProfileHash } = await resolveRuntimeProfile();
      registration = await sdk.registerProvider({
        providerId: resolvedProviderId,
        models: advertisedModels,
        runtimeProfile,
        runtimeProfileHash,
        device: {
          ...runtimeDevice,
          ...device,
          runtimeProfileHash
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
    async createPeerProviderAdvert({ models, availability = {}, reputationEvidence = {} } = {}) {
      await ensureKeys();
      const resolvedProviderId = await ensureProviderId();
      if (typeof runtime?.isReady === 'function' && !runtime.isReady()) {
        throw new Error('Doppler browser model must be loaded before provider advert');
      }
      const runtimeModel = typeof runtime?.getModelInfo === 'function' ? runtime.getModelInfo() : null;
      const advertisedModels = Array.isArray(models) && models.length > 0
        ? models
        : [runtimeModel || buildLaunchProviderModel()];
      const advertisedModel = advertisedModels[0] || {};
      if (!runtimeModel?.modelId || !runtimeModel?.modelHash || !runtimeModel?.manifestHash) {
        throw new Error('Loaded Doppler runtime must expose modelId, modelHash, and manifestHash before provider advert');
      }
      if (!advertisedModel.modelId || !modelMatchesRuntime(advertisedModel, runtimeModel)) {
        throw new Error('Loaded Doppler model identity does not match advertised provider model');
      }
      const mismatchedModel = advertisedModels.find((model) => !modelMatchesRuntime(model, runtimeModel));
      if (mismatchedModel) throw new Error('Provider advert cannot advertise models that differ from the loaded Doppler runtime');
      const { runtimeProfile, runtimeProfileHash } = await resolveRuntimeProfile();
      return createSignedProviderAdvert({
        providerId: resolvedProviderId,
        providerPublicKey: publicKey,
        privateKey: activeKeyPair.privateKey,
        models: advertisedModels,
        runtimeProfile,
        runtimeProfileHash,
        availability: {
          maxConcurrentJobs: 1,
          maxTokensPerJob: 128,
          acceptedPolicies: listPolicies().map((policy) => policy.policyId),
          ...availability
        },
        reputationEvidence
      });
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
    async executePeerAssignment(assignment, { promptPayload = null, prompt = null } = {}) {
      const result = await runLocalAssignment(assignment, { promptPayload, prompt });
      const receiptHash = await hashJson(result.receipt);
      recordHistory({
        eventType: 'peer_receipt_created',
        assignmentId: assignment.assignmentId,
        jobId: assignment.jobId,
        policyId: assignment.policyId,
        receiptHash
      });
      return {
        ...result,
        receiptHash,
        transport: 'webrtc_peer_control'
      };
    },
    async executeAssignment(assignment, { commitReveal = 'auto', promptPayload = null, prompt = null } = {}) {
      try {
        const { execution, receipt: signedReceipt } = await runLocalAssignment(assignment, { promptPayload, prompt });
        const commitRevealResult = await runCommitReveal({
          assignment,
          execution,
          receipt: signedReceipt,
          mode: commitReveal
        });
        const result = await sdk.submitReceipt(assignment.assignmentId, {
          outputText: execution.outputText,
          tokenIds: execution.tokenIds || [],
          transcript: execution.transcript || {
            outputText: execution.outputText,
            tokenIds: execution.tokenIds || []
          },
          receipt: signedReceipt
        });
        result.commitReveal = commitRevealResult;
        recordHistory({
          eventType: result?.verifierDecision?.accepted ? 'receipt_verified' : 'receipt_rejected',
          assignmentId: assignment.assignmentId,
          jobId: assignment.jobId,
          policyId: assignment.policyId,
          receiptHash: result?.verifierDecision?.receiptHash || result?.receipt?.receiptHash || null,
          commitReveal: commitRevealResult,
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
