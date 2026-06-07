import { describe, expect, it } from 'vitest';

import {
  DETERMINISTIC_GENERATION_CONFIG as SERVER_GENERATION_CONFIG,
  getPolicy,
  validateJobRequest
} from '../../server/pool/policy-router.js';
import { LAUNCH_MODEL as SERVER_LAUNCH_MODEL } from '../../server/pool/model-contract.js';
import { assignJob } from '../../server/pool/scheduler.js';
import { createPoolStore } from '../../server/pool/store.js';
import { runtimeProfileHash as serverRuntimeProfileHash } from '../../server/pool/runtime-profile.js';
import {
  DETERMINISTIC_GENERATION_CONFIG as BROWSER_GENERATION_CONFIG,
  validatePolicyRequest
} from '../../self/pool/policy-router.js';
import {
  LAUNCH_MODEL as BROWSER_LAUNCH_MODEL,
  buildLaunchModelArtifactUrls
} from '../../self/pool/model-contract.js';
import {
  buildRuntimeProfile
} from '../../self/pool/runtime-profile.js';
import { verifyReceipt as verifyBrowserReceipt } from '../../self/pool/sdk.js';

const makeJob = (overrides = {}) => ({
  requesterId: 'requester_test',
  requesterPublicKey: 'public-key',
  prompt: 'test prompt',
  policyId: 'fastest_receipt',
  modelRequirements: {
    modelId: SERVER_LAUNCH_MODEL.modelId,
    modelHash: SERVER_LAUNCH_MODEL.modelHash,
    manifestHash: SERVER_LAUNCH_MODEL.manifestHash,
    runtime: SERVER_LAUNCH_MODEL.runtime,
    backend: SERVER_LAUNCH_MODEL.backend
  },
  generationConfig: { ...SERVER_GENERATION_CONFIG },
  ...overrides
});

describe('pool launch contract', () => {
  it('accepts only the exact server launch model and generation config', () => {
    expect(validateJobRequest(makeJob()).ok).toBe(true);

    const missingRuntime = validateJobRequest(makeJob({
      modelRequirements: {
        modelId: SERVER_LAUNCH_MODEL.modelId,
        modelHash: SERVER_LAUNCH_MODEL.modelHash,
        manifestHash: SERVER_LAUNCH_MODEL.manifestHash,
        backend: SERVER_LAUNCH_MODEL.backend
      }
    }));
    expect(missingRuntime.ok).toBe(false);
    expect(missingRuntime.reasons).toContain('modelRequirements.runtime is required');
    expect(missingRuntime.reasons).toContain('model requirements do not match an enabled model contract');

    const extraConfig = validateJobRequest(makeJob({
      generationConfig: {
        ...SERVER_GENERATION_CONFIG,
        stop: ['extra']
      }
    }));
    expect(extraConfig.ok).toBe(false);
    expect(extraConfig.reasons).toContain('generationConfig.stop is not allowed');

    const ringPolicy = validateJobRequest(makeJob({ policyId: 'ring_quorum_receipt' }));
    expect(ringPolicy.ok).toBe(true);
    expect(ringPolicy.policy.adaptiveRing).toBe(true);
    expect(ringPolicy.policy.maxRingSize).toBe(4);
  });

  it('keeps browser policy validation aligned with the server launch contract', () => {
    const result = validatePolicyRequest({
      modelRequirements: {
        modelId: BROWSER_LAUNCH_MODEL.modelId,
        modelHash: BROWSER_LAUNCH_MODEL.modelHash,
        manifestHash: BROWSER_LAUNCH_MODEL.manifestHash,
        runtime: BROWSER_LAUNCH_MODEL.runtime,
        backend: BROWSER_LAUNCH_MODEL.backend
      },
      generationConfig: { ...BROWSER_GENERATION_CONFIG }
    });
    expect(result.ok).toBe(true);

    const missingBackend = validatePolicyRequest({
      modelRequirements: {
        modelId: BROWSER_LAUNCH_MODEL.modelId,
        modelHash: BROWSER_LAUNCH_MODEL.modelHash,
        manifestHash: BROWSER_LAUNCH_MODEL.manifestHash,
        runtime: BROWSER_LAUNCH_MODEL.runtime
      },
      generationConfig: { ...BROWSER_GENERATION_CONFIG }
    });
    expect(missingBackend.ok).toBe(false);
    expect(missingBackend.reasons).toContain('modelRequirements.backend is required');
  });

  it('keeps offloaded artifact URLs separate from receipt identity fields', () => {
    const artifactUrls = buildLaunchModelArtifactUrls({
      baseUrl: 'https://models.example/reploid/'
    });

    expect(artifactUrls).toEqual({
      transport: 'offloaded_content_addressed',
      cache: 'browser_opfs',
      manifestUrl: `https://models.example/reploid/${BROWSER_LAUNCH_MODEL.modelId}/${BROWSER_LAUNCH_MODEL.manifestHash}/manifest.json`,
      tokenizerUrl: `https://models.example/reploid/${BROWSER_LAUNCH_MODEL.modelId}/${BROWSER_LAUNCH_MODEL.manifestHash}/tokenizer.json`,
      shardBaseUrl: `https://models.example/reploid/${BROWSER_LAUNCH_MODEL.modelId}/${BROWSER_LAUNCH_MODEL.manifestHash}/shards/`
    });
    expect(SERVER_LAUNCH_MODEL.artifactPolicy.identityFields).toEqual([
      'modelId',
      'modelHash',
      'manifestHash',
      'runtime',
      'backend'
    ]);
  });

  it('returns machine-readable local verifier errors for malformed keys', async () => {
    const result = await verifyBrowserReceipt(
      {
        providerSignature: 'not-base64',
        outputHash: 'sha256:not-used'
      },
      'not-a-public-key'
    );
    expect(result.ok).toBe(false);
    expect(result.reasons.some((reason) => reason.startsWith('provider signature verification failed:'))).toBe(true);
  });

  it('builds a capped majority ring for ring quorum jobs', async () => {
    const store = createPoolStore();
    const runtimeProfile = buildRuntimeProfile({
      modelInfo: {
        modelId: SERVER_LAUNCH_MODEL.modelId,
        modelHash: SERVER_LAUNCH_MODEL.modelHash,
        manifestHash: SERVER_LAUNCH_MODEL.manifestHash,
        runtime: SERVER_LAUNCH_MODEL.runtime,
        backend: SERVER_LAUNCH_MODEL.backend
      },
      runtimeInfo: {
        runtime: SERVER_LAUNCH_MODEL.runtime,
        backend: SERVER_LAUNCH_MODEL.backend,
        publicApi: 'generate',
        profile: { implementation: 'test-runtime' },
        kernelProfileHash: 'sha256:test-kernel'
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
        limits: { maxBufferSize: 1024 },
        shaderProfile: 'test-shader'
      },
      browserProfile: {
        userAgent: 'test-browser',
        family: 'test-browser',
        majorVersion: '1',
        platform: 'test-platform',
        brands: ['Test:1'],
        mobile: false
      }
    });
    const runtimeProfileHash = serverRuntimeProfileHash(runtimeProfile);
    for (let index = 0; index < 5; index += 1) {
      store.registerProvider({
        providerId: `provider_${index}`,
        publicKey: `public_key_${index}`,
        runtimeProfile,
        runtimeProfileHash,
        models: [{
          modelId: SERVER_LAUNCH_MODEL.modelId,
          modelHash: SERVER_LAUNCH_MODEL.modelHash,
          manifestHash: SERVER_LAUNCH_MODEL.manifestHash,
          runtime: SERVER_LAUNCH_MODEL.runtime,
          backend: SERVER_LAUNCH_MODEL.backend
        }],
        availability: {
          acceptedPolicies: ['ring_quorum_receipt']
        }
      });
      store.updateReputation(`provider_${index}`, {
        acceptedReceipts: 3,
        rejectedReceipts: 0,
        timeouts: 0,
        admissionLane: 'trusted_browser_provider',
        ringEligible: true
      });
    }
    const job = store.createJob({
      ...makeJob({ policyId: 'ring_quorum_receipt' }),
      trustTier: 'T4_ring_quorum_receipt'
    });
    const result = await assignJob({ store, job, policy: getPolicy('ring_quorum_receipt') });
    expect(result.ok).toBe(true);
    expect(result.assignments).toHaveLength(4);
    expect(result.ring.ringSize).toBe(4);
    expect(result.ring.requiredAgreement).toBe(3);
    expect(result.ring.effectiveTrustTier).toBe('T4_max_ring_quorum_receipt');
    expect(result.ring.ringId).toBe(`ring_${result.ring.layoutHash.replace(/^sha256:/, '').slice(0, 16)}`);
    expect(new Set(result.ring.providerIds).size).toBe(4);
    expect(result.assignments.every((assignment) => assignment.ring.layoutHash === result.ring.layoutHash)).toBe(true);
    expect(result.assignments.every((assignment) => assignment.trustTier === result.ring.effectiveTrustTier)).toBe(true);
    expect(result.assignments.every((assignment) => assignment.ring.ringAttemptId === result.ring.ringAttemptId)).toBe(true);
    const assignedJob = store.getJob(job.jobId);
    expect(assignedJob.trustTier).toBe(result.ring.effectiveTrustTier);
    expect(assignedJob.policyTrustTier).toBe('T4_ring_quorum_receipt');
  });
});

describe('pool hybrid p2p payload contract', () => {
  it('accepts only versioned pool payload types', async () => {
    const { createP2PPayload, P2P_PAYLOAD_TYPES, validateP2PPayload } = await import('../../self/pool/p2p-payload.js');
    const payload = createP2PPayload({
      type: P2P_PAYLOAD_TYPES.PROMPT,
      assignmentId: 'assignment_1',
      jobId: 'job_1',
      fromPeerId: 'requester_1',
      toPeerId: 'provider_1',
      body: { inputHash: 'sha256:test' }
    });
    expect(validateP2PPayload(payload).ok).toBe(true);
    expect(() => createP2PPayload({
      type: 'model-shard',
      assignmentId: 'assignment_1',
      jobId: 'job_1',
      fromPeerId: 'requester_1'
    })).toThrow('P2P payload type is not allowed');
  });
});

describe('pool config as code contract', () => {
  it('keeps server and browser pool config aligned and valid', async () => {
    const serverConfig = await import('../../server/pool/config.js');
    const browserConfig = await import('../../self/pool/config.js');

    expect(serverConfig.validatePoolConfig().ok).toBe(true);
    expect(browserConfig.validatePoolConfig().ok).toBe(true);
    expect(browserConfig.POOL_CONFIG_VERSION).toBe(serverConfig.POOL_CONFIG_VERSION);
    expect(browserConfig.LAUNCH_MODEL).toEqual(serverConfig.LAUNCH_MODEL);
    expect(browserConfig.DETERMINISTIC_GENERATION_CONFIG).toEqual(serverConfig.DETERMINISTIC_GENERATION_CONFIG);
    expect(browserConfig.listPolicies()).toEqual(serverConfig.listPolicies());
  });

  it('declares trust, transport, and ledger promises before product code can claim them', async () => {
    const { POOL_CONFIG, getLedgerReasons, getPolicy, effectiveTrustTierForRingSize } = await import('../../server/pool/config.js');

    expect(POOL_CONFIG.forbiddenClaims).toContain('trustless');
    expect(POOL_CONFIG.activeTransportMode).toBe('hybrid_p2p_anchor');
    expect(POOL_CONFIG.transportModes.hybrid_p2p_anchor.signalingAllowedTypes).toEqual([
      'offer',
      'answer',
      'ice-candidate',
      'close',
      'ping'
    ]);
    expect(POOL_CONFIG.transportModes.hybrid_p2p_anchor.forbiddenSignalPayloads).toContain('modelShard');
    expect(getLedgerReasons('ring_quorum').award).toBe('ring_quorum_receipt_accepted');
    expect(getLedgerReasons('ring_quorum').spend).toBe('ring_quorum_receipt_spend');
    expect(POOL_CONFIG.determinismProfiles.activeProfileId).toBe('strict_hash_same_runtime_profile');
    expect(POOL_CONFIG.determinismProfiles.profiles.strict_hash_same_runtime_profile.allowToleranceAcceptance).toBe(false);
    expect(POOL_CONFIG.ringPhaseProtocols.activeProtocolId).toBe('commit_reveal_v1');
    expect(POOL_CONFIG.ringPhaseProtocols.protocols.commit_reveal_v1.requireRevealBeforeReceipt).toBe(true);
    expect(POOL_CONFIG.providerAdmissionPolicies.activePolicyId).toBe('tiered_browser_provider_v1');
    expect(POOL_CONFIG.stateModes.activeModeId).toBe('direct_firestore_projection_v1');

    const ringPolicy = getPolicy('ring_quorum_receipt');
    expect(ringPolicy.trustTier).toBe('adaptive_T1_to_T4_ring_quorum_receipt');
    expect(ringPolicy.determinismProfileId).toBe('strict_hash_same_runtime_profile');
    expect(ringPolicy.ringPhaseProtocolId).toBe('commit_reveal_v1');
    expect(ringPolicy.providerAdmissionPolicyId).toBe('tiered_browser_provider_v1');
    expect(effectiveTrustTierForRingSize(1, ringPolicy)).toBe('T1_ring_baseline');
    expect(effectiveTrustTierForRingSize(4, ringPolicy)).toBe('T4_max_ring_quorum_receipt');
  });
});
