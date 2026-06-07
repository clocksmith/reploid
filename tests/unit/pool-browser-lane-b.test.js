import { describe, expect, it } from 'vitest';

import { createProviderClient } from '../../self/pool/provider-client.js';
import { buildCommitmentHash } from '../../server/pool/commit-reveal.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';
import { LAUNCH_MODEL } from '../../self/pool/model-contract.js';
import {
  buildAssignmentCommitmentPayload,
  buildAssignmentRevealPayload
} from '../../self/pool/p2p-payload.js';
import {
  RUNTIME_PROFILE_VERSION,
  buildRuntimeProfile,
  hashRuntimeProfile
} from '../../self/pool/runtime-profile.js';

const runtimeModel = () => ({
  modelId: LAUNCH_MODEL.modelId,
  modelHash: LAUNCH_MODEL.modelHash,
  manifestHash: LAUNCH_MODEL.manifestHash,
  runtime: LAUNCH_MODEL.runtime,
  backend: LAUNCH_MODEL.backend,
  contextLength: LAUNCH_MODEL.contextLength,
  quantization: LAUNCH_MODEL.quantization
});

const assignmentModel = () => ({
  id: LAUNCH_MODEL.modelId,
  hash: LAUNCH_MODEL.modelHash,
  manifestHash: LAUNCH_MODEL.manifestHash,
  runtime: LAUNCH_MODEL.runtime,
  backend: LAUNCH_MODEL.backend
});

const assignment = () => ({
  assignmentId: 'assignment_lane_b',
  jobId: 'job_lane_b',
  requesterId: 'requester_lane_b',
  providerId: 'provider_lane_b',
  policyId: 'ring_quorum_receipt',
  assignmentAttemptId: 1,
  ringAttemptId: 'ring_attempt_1',
  inputHash: 'sha256:input',
  generationConfigHash: 'sha256:generation',
  verificationLevel: 'ring_quorum_receipt',
  prompt: 'test prompt',
  generationConfig: {
    mode: 'greedy',
    temperature: 0,
    topK: 1,
    topP: 1,
    maxOutputTokens: 8,
    seed: '0000000000000000'
  },
  model: assignmentModel(),
  ring: {
    ringId: 'ring_test',
    ringAttemptId: 'ring_attempt_1',
    phaseProtocol: 'commit_reveal_v1'
  }
});

const fakeRuntime = () => ({
  isReady: () => true,
  getModelInfo: () => runtimeModel(),
  getRuntimeInfo: () => ({
    runtime: LAUNCH_MODEL.runtime,
    backend: LAUNCH_MODEL.backend,
    publicApi: 'generate',
    profile: { implementation: 'test' }
  }),
  getDeviceInfo: async () => ({
    hasWebGPU: true,
    probeStatus: 'ok',
    adapterInfo: {
      vendor: 'test-vendor',
      architecture: 'test-arch',
      device: 'test-device',
      description: 'test adapter'
    },
    features: ['shader-f16'],
    limits: { maxBufferSize: 1024 },
    hasF16: true,
    hasSubgroups: false,
    maxBufferSize: 1024
  }),
  getRuntimeProfile: async () => {
    const runtimeProfile = buildRuntimeProfile({
      modelInfo: runtimeModel(),
      runtimeInfo: {
        runtime: LAUNCH_MODEL.runtime,
        backend: LAUNCH_MODEL.backend,
        publicApi: 'generate',
        profile: { implementation: 'test' }
      },
      deviceInfo: {
        hasWebGPU: true,
        probeStatus: 'ok',
        adapterInfo: {
          vendor: 'test-vendor',
          architecture: 'test-arch',
          device: 'test-device',
          description: 'test adapter'
        },
        features: ['shader-f16'],
        limits: { maxBufferSize: 1024 }
      },
      browserProfile: {
        userAgent: 'test-browser',
        platform: 'test-platform',
        brands: ['Test:1'],
        mobile: false,
        language: 'en-US'
      }
    });
    return {
      runtimeProfile,
      runtimeProfileHash: await hashRuntimeProfile(runtimeProfile)
    };
  },
  generate: async () => ({
    outputText: 'test output',
    tokenIds: [11, 22, 33],
    transcript: {
      outputText: 'test output',
      tokenIds: [11, 22, 33]
    },
    tokenCounts: {
      input: 2,
      output: 3
    },
    timing: {
      startedAt: '2026-06-07T00:00:00.000Z',
      completedAt: '2026-06-07T00:00:01.000Z'
    },
    status: 'completed'
  })
});

describe('pool browser Lane B contract', () => {
  it('builds stable runtime profile evidence for browser provider registration', async () => {
    const runtimeProfile = buildRuntimeProfile({
      modelInfo: runtimeModel(),
      runtimeInfo: {
        runtime: LAUNCH_MODEL.runtime,
        backend: LAUNCH_MODEL.backend,
        publicApi: 'generate'
      },
      deviceInfo: {
        hasWebGPU: true,
        probeStatus: 'ok',
        adapterInfo: { vendor: 'test-vendor' },
        features: ['shader-f16']
      },
      browserProfile: {
        userAgent: 'test-browser',
        platform: 'test-platform',
        brands: ['Test:1'],
        mobile: false
      }
    });
    const runtimeProfileHash = await hashRuntimeProfile(runtimeProfile);

    expect(runtimeProfile.profileVersion).toBe(RUNTIME_PROFILE_VERSION);
    expect(runtimeProfile.model.modelId).toBe(LAUNCH_MODEL.modelId);
    expect(runtimeProfile.webgpu.hasF16).toBe(true);
    expect(runtimeProfileHash).toMatch(/^sha256:/);
  });

  it('sends runtimeProfile and runtimeProfileHash during provider registration', async () => {
    let registrationPayload = null;
    const sdk = {
      registerProvider(payload) {
        registrationPayload = payload;
        return {
          ...payload,
          sessionId: 'session_lane_b'
        };
      }
    };
    const keyPair = await createSigningKeyPair();
    const provider = createProviderClient({
      providerId: 'provider_lane_b',
      sdk,
      runtime: fakeRuntime(),
      keyPair,
      identity: null
    });

    await provider.register({});

    expect(registrationPayload.runtimeProfile.profileVersion).toBe(RUNTIME_PROFILE_VERSION);
    expect(registrationPayload.runtimeProfileHash).toMatch(/^sha256:/);
    expect(registrationPayload.device.runtimeProfileHash).toBe(registrationPayload.runtimeProfileHash);
  });

  it('executes assignment through commitment, reveal, and receipt submission', async () => {
    const calls = [];
    const sdk = {
      registerProvider(payload) {
        return {
          ...payload,
          sessionId: 'session_lane_b'
        };
      },
      submitAssignmentCommitment(assignmentId, payload) {
        calls.push({ type: 'commit', assignmentId, payload });
        return {
          phase: 'reveal_open',
          revealOpen: true
        };
      },
      submitAssignmentReveal(assignmentId, payload) {
        calls.push({ type: 'reveal', assignmentId, payload });
        return {
          ok: true,
          phase: 'reveal_accepted'
        };
      },
      submitReceipt(assignmentId, payload) {
        calls.push({ type: 'receipt', assignmentId, payload });
        return {
          verifierDecision: {
            accepted: true,
            receiptHash: 'sha256:receipt'
          },
          receipt: {
            receiptHash: 'sha256:receipt'
          }
        };
      },
      reportAssignmentFailure() {
        throw new Error('failure report should not run');
      }
    };
    const keyPair = await createSigningKeyPair();
    const provider = createProviderClient({
      providerId: 'provider_lane_b',
      sdk,
      runtime: fakeRuntime(),
      keyPair,
      identity: null
    });
    await provider.register({});

    const result = await provider.executeAssignment(assignment(), {
      commitReveal: 'required'
    });

    expect(calls.map((call) => call.type)).toEqual(['commit', 'reveal', 'receipt']);
    expect(calls[0].payload.commitmentHash).toMatch(/^sha256:/);
    expect(calls[0].payload.policyId).toBe('ring_quorum_receipt');
    expect(calls[0].payload.assignmentAttemptId).toBe(1);
    expect(calls[0].payload.receiptHash).toMatch(/^sha256:/);
    expect(calls[1].payload.commitmentHash).toBe(calls[0].payload.commitmentHash);
    expect(calls[1].payload.outputText).toBe('test output');
    expect(calls[2].payload.receipt.verification.runtimeProfileHash).toBeTruthy();
    expect(calls[2].payload.receipt.providerSignature).toBeTruthy();
    expect(result.commitReveal.revealResult.phase).toBe('reveal_accepted');
  });

  it('builds reveal payloads that bind back to the original commitment', async () => {
    const currentAssignment = assignment();
    const execution = {
      outputText: 'test output',
      tokenIds: [11, 22, 33],
      transcript: {
        outputText: 'test output',
        tokenIds: [11, 22, 33]
      }
    };
    const receipt = {
      outputHash: 'sha256:output',
      tokenIdsHash: 'sha256:tokens',
      transcriptHash: 'sha256:transcript'
    };
    const commitment = await buildAssignmentCommitmentPayload({
      assignment: currentAssignment,
      providerId: currentAssignment.providerId,
      execution,
      receipt,
      salt: 'fixed_salt'
    });
    const reveal = await buildAssignmentRevealPayload({
      assignment: currentAssignment,
      providerId: currentAssignment.providerId,
      execution,
      receipt,
      salt: 'fixed_salt',
      commitmentHash: commitment.commitmentHash
    });

    expect(commitment.commitmentHash).toBe(buildCommitmentHash({
      jobId: currentAssignment.jobId,
      assignmentId: currentAssignment.assignmentId,
      ringAttemptId: currentAssignment.ringAttemptId,
      providerId: currentAssignment.providerId,
      outputHash: receipt.outputHash,
      tokenIdsHash: receipt.tokenIdsHash,
      transcriptHash: receipt.transcriptHash,
      salt: 'fixed_salt'
    }));
    expect(reveal.commitmentHash).toBe(commitment.commitmentHash);
    expect(reveal.salt).toBe('fixed_salt');
    expect(reveal.outputHash).toBe(commitment.outputHash);
    expect(reveal.tokenIdsHash).toBe(commitment.tokenIdsHash);
    expect(reveal.transcriptHash).toBe(commitment.transcriptHash);
  });
});
