/**
 * @fileoverview Browser provider client for fastest-receipt pool jobs.
 */

import { createPoolSdk } from './sdk.js';
import { buildPoolReceipt, createSigningKeyPair, exportPublicKey, hashJson, sha256Hex, signProviderReceipt } from './inference-receipt.js';
import { createDopplerRuntime } from './doppler-runtime.js';
import {
  POOLDAY_MODEL_WORKLOADS,
  buildLaunchProviderModel,
  getPoolModelWorkload,
  modelSupportsPoolWorkload
} from './model-contract.js';
import {
  runtimeHasActiveAdapterRequirement,
  validateAdapterRequirement
} from './adapter-pack.js';
import { validatePublishedAdapterRequirement, verifyAdapterUseApproval } from './adapter-publication.js';
import { acquireAdapterForAssignment, createAdapterRegistry } from './adapter-registry.js';
import { createPoolIdentity } from './identity.js';
import { listPolicies } from './policy-router.js';
import { collectRuntimeProfile } from './runtime-profile.js';
import {
  createSignedProviderAdvert,
  validateInputPayloadForAssignment
} from './peer-control-plane.js';
import { isSequenceWorkload, normalizeSequenceInput } from './sequence-workload.js';
import {
  buildAssignmentCommitmentPayload,
  buildAssignmentRevealPayload
} from './p2p-payload.js';

export function createProviderClient({
  providerId,
  sdk = createPoolSdk(),
  runtime = createDopplerRuntime(),
  keyPair = null,
  identity = createPoolIdentity('provider'),
  adapterRegistry = createAdapterRegistry(),
  fetchAdapterFromPeer = null,
  fetchAdapterFromOrigin = null
} = {}) {
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
    && modelSupportsPoolWorkload(runtimeModel, getPoolModelWorkload(model))
  );

  const assignmentMatchesRuntime = (assignmentModel = {}, runtimeModel = {}) => (
    assignmentModel.id === runtimeModel.modelId
    && assignmentModel.hash === runtimeModel.modelHash
    && assignmentModel.manifestHash === runtimeModel.manifestHash
    && (assignmentModel.runtime || 'doppler') === (runtimeModel.runtime || 'doppler')
    && (assignmentModel.backend || 'browser-webgpu') === (runtimeModel.backend || 'browser-webgpu')
    && modelSupportsPoolWorkload(
      runtimeModel,
      assignmentModel.workload || assignmentModel.requirements?.workload || POOLDAY_MODEL_WORKLOADS.textGeneration
    )
    && runtimeHasActiveAdapterRequirement(
      runtimeModel,
      assignmentModel.requirements?.adapter || assignmentModel.adapter || null
    )
  );

  const resolveRuntimeProfile = async () => {
    if (typeof runtime?.getRuntimeProfile === 'function') {
      return runtime.getRuntimeProfile();
    }
    return collectRuntimeProfile({ runtime });
  };

  const validateAdvertisedAdapterPacks = async (models = [], runtimeModel = {}) => {
    for (const model of models) {
      for (const adapter of model.adapterPacks || []) {
        const validation = validateAdapterRequirement(adapter);
        if (!validation.ok) throw new Error(`Invalid advertised adapter: ${validation.reasons.join('; ')}`);
        if (adapter.publicationHash || adapter.publisherId || adapter.state !== 'active') {
          const published = validatePublishedAdapterRequirement(adapter);
          if (!published.ok) throw new Error(`Invalid published adapter advert: ${published.reasons.join('; ')}`);
        }
        if (adapter.state === 'active' && !runtimeHasActiveAdapterRequirement(runtimeModel, adapter)) {
          throw new Error('Provider cannot advertise an active adapter that is not active in Doppler');
        }
        if (adapter.state === 'cached' && !await adapterRegistry.hasCached(adapter.packHash)) {
          throw new Error('Provider cannot advertise an adapter as cached without verified local bytes');
        }
        if (adapter.state === 'fetchable'
          && typeof fetchAdapterFromPeer !== 'function'
          && typeof fetchAdapterFromOrigin !== 'function'
          && !await adapterRegistry.hasCached(adapter.packHash)) {
          throw new Error('Provider cannot advertise a fetchable adapter without a peer, origin, or cached source');
        }
      }
    }
  };

  const prepareAssignmentAdapter = async (assignment = {}) => {
    const requirement = assignment.adapter || assignment.model?.requirements?.adapter || null;
    const active = typeof runtime?.getActiveAdapterPack === 'function'
      ? runtime.getActiveAdapterPack()
      : null;
    if (!requirement) {
      if (active && typeof runtime?.deactivateAdapterPack === 'function') await runtime.deactivateAdapterPack();
      return null;
    }
    const approval = await verifyAdapterUseApproval(assignment.adapterUseApproval, {
      adapterRequirement: requirement,
      requesterId: assignment.requesterId,
      inputHash: assignment.inputHash,
      modelRequirements: assignment.model?.requirements || assignment.model
    });
    if (!approval.ok) throw new Error(`Adapter use approval rejected: ${approval.reasons.join('; ')}`);
    if (active && runtimeHasActiveAdapterRequirement(runtime.getModelInfo(), requirement)) {
      return {
        ...requirement,
        state: 'active',
        adapterUseApprovalHash: approval.approvalHash,
        artifactSources: active.artifactSources || []
      };
    }
    const artifact = await acquireAdapterForAssignment({
      assignment,
      registry: adapterRegistry,
      fetchFromPeer: fetchAdapterFromPeer,
      fetchFromOrigin: fetchAdapterFromOrigin
    });
    if (!artifact?.pack || !artifact?.bytes) throw new Error('Adapter acquisition returned no verified pack or bytes');
    const bytes = artifact.bytes;
    const fetchUrl = async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const activated = await runtime.activateAdapterPack(artifact.pack, {
      source: artifact.pack.runtimeManifest,
      loadOptions: { fetchUrl },
      artifactSources: artifact.acquisition ? [artifact.acquisition] : []
    });
    return {
      ...requirement,
      ...activated,
      state: 'active',
      publicationHash: requirement.publicationHash,
      publisherId: requirement.publisherId,
      adapterUseApprovalHash: approval.approvalHash,
      artifactSources: artifact.acquisition ? [artifact.acquisition] : []
    };
  };

  const resolveAssignmentInput = async (assignment = {}, {
    inputPayload = null,
    promptPayload = null,
    prompt = null,
    sequence = null
  } = {}) => {
    const workload = assignment.workload || assignment.model?.requirements?.workload || POOLDAY_MODEL_WORKLOADS.textGeneration;
    const payload = inputPayload || promptPayload;
    if (payload) {
      const validation = await validateInputPayloadForAssignment(payload, assignment);
      if (!validation.ok) throw new Error(`invalid WebRTC input payload: ${validation.reasons.join('; ')}`);
      return {
        kind: validation.inputKind,
        value: validation.sequence || validation.prompt
      };
    }
    if (isSequenceWorkload(workload) && sequence !== null && sequence !== undefined) {
      const normalized = normalizeSequenceInput(sequence, assignment.sequenceRequest?.alphabet);
      if (assignment.inputHash && await sha256Hex(normalized) !== assignment.inputHash) {
        throw new Error('assignment inputHash mismatch');
      }
      return { kind: 'sequence', value: normalized };
    }
    if (prompt !== null && prompt !== undefined) {
      const promptText = String(prompt);
      if (assignment.inputHash && await sha256Hex(promptText) !== assignment.inputHash) {
        throw new Error('assignment inputHash mismatch');
      }
      return { kind: 'prompt', value: promptText };
    }
    if (assignment.prompt) return { kind: 'prompt', value: assignment.prompt };
    throw new Error('assignment input must be supplied over a WebRTC input payload');
  };

  const runLocalAssignment = async (assignment, options = {}) => {
    await ensureKeys();
    recordHistory({
      eventType: 'assignment_execution_started',
      assignmentId: assignment.assignmentId,
      jobId: assignment.jobId,
      policyId: assignment.policyId
    });
    let runtimeModel = typeof runtime?.getModelInfo === 'function' ? runtime.getModelInfo() : null;
    if (!modelMatchesRuntime({
      modelId: assignment.model?.id,
      modelHash: assignment.model?.hash,
      manifestHash: assignment.model?.manifestHash,
      runtime: assignment.model?.runtime,
      backend: assignment.model?.backend,
      workload: assignment.model?.workload || assignment.model?.requirements?.workload
    }, runtimeModel || {})) {
      throw new Error('Assignment model identity does not match the loaded Doppler runtime');
    }
    const adapter = await prepareAssignmentAdapter(assignment);
    runtimeModel = typeof runtime?.getModelInfo === 'function' ? runtime.getModelInfo() : runtimeModel;
    if (!assignmentMatchesRuntime(assignment.model || {}, runtimeModel || {})) {
      throw new Error('Assignment adapter identity does not match the active Doppler runtime');
    }
    const input = await resolveAssignmentInput(assignment, options);
    const workload = assignment.workload || assignment.model?.requirements?.workload || getPoolModelWorkload(runtimeModel || {});
    let runtimeExecution;
    if (workload === POOLDAY_MODEL_WORKLOADS.embedding) {
      runtimeExecution = await runtime.embed({ prompt: input.value, assignment });
    } else if (isSequenceWorkload(workload)) {
      runtimeExecution = await runtime.encodeSequence({
        sequence: input.value,
        request: assignment.sequenceRequest,
        assignment
      });
    } else {
      runtimeExecution = await runtime.generate({
        prompt: input.value,
        generationConfig: assignment.generationConfig,
        assignment
      });
    }
    const execution = {
      ...runtimeExecution,
      adapter
    };
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
      inputKind: input.kind,
      ...(input.kind === 'prompt' ? { prompt: input.value } : {}),
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
      await validateAdvertisedAdapterPacks(advertisedModels, runtimeModel);
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
      await validateAdvertisedAdapterPacks(advertisedModels, runtimeModel);
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
    async executePeerAssignment(assignment, options = {}) {
      const result = await runLocalAssignment(assignment, options);
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
    async executeAssignment(assignment, { commitReveal = 'auto', ...inputOptions } = {}) {
      try {
        const { execution, receipt: signedReceipt } = await runLocalAssignment(assignment, inputOptions);
        const commitRevealResult = await runCommitReveal({
          assignment,
          execution,
          receipt: signedReceipt,
          mode: commitReveal
        });
        const result = await sdk.submitReceipt(assignment.assignmentId, {
          outputText: execution.outputText,
          tokenIds: execution.tokenIds || [],
          outputKind: execution.outputKind || assignment.workload || null,
          vectorHash: execution.vectorHash || null,
          embeddingDimensions: execution.embeddingDimensions || null,
          embeddingStats: execution.embeddingStats || null,
          transcript: execution.transcript || {
            outputText: execution.outputText,
            tokenIds: execution.tokenIds || []
          },
          sequenceResultHash: execution.sequenceResultHash || null,
          sequenceResult: execution.sequenceResult || null,
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
    },
    publishAdapter(publication) {
      return adapterRegistry.publish(publication);
    },
    cacheAdapterArtifact(artifact) {
      return adapterRegistry.cache(artifact);
    },
    getAdapterRegistry() {
      return adapterRegistry;
    }
  };
}

export default {
  createProviderClient
};
