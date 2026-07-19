import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BROWSER_RUNTIME_CONFIG as SERVER_BROWSER_RUNTIME_CONFIG } from '../../server/pool/config.js';
import {
  DETERMINISTIC_GENERATION_CONFIG as SERVER_GENERATION_CONFIG,
  getPolicy,
  validateJobRequest
} from '../../server/pool/policy-router.js';
import {
  LAUNCH_MODEL as SERVER_LAUNCH_MODEL,
  getEnabledPoolModelContract as getServerEnabledPoolModelContract
} from '../../server/pool/model-contract.js';
import { assignJob } from '../../server/pool/scheduler.js';
import { createPoolStore } from '../../server/pool/store.js';
import { runtimeProfileHash as serverRuntimeProfileHash } from '../../server/pool/runtime-profile.js';
import {
  BROWSER_RUNTIME_CONFIG as BROWSER_BROWSER_RUNTIME_CONFIG,
  DETERMINISTIC_GENERATION_CONFIG as BROWSER_GENERATION_CONFIG
} from '../../self/pool/config.js';
import { validatePolicyRequest } from '../../self/pool/policy-router.js';
import {
  LAUNCH_MODEL as BROWSER_LAUNCH_MODEL,
  POOLDAY_MODEL_WORKLOADS,
  buildLaunchModelArtifactUrls,
  buildLaunchModelRequirements,
  getEnabledPoolModelContract as getBrowserEnabledPoolModelContract,
  validateModelRuntimeCapabilities
} from '../../self/pool/model-contract.js';
import { buildModelArtifactUrls } from '../../self/pool/model-artifacts.js';
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

const QWEN_MODEL_ID = 'qwen-3-5-0-8b-q4k-ehaf16';
const QWEN_EMBEDDING_MODEL_ID = 'qwen-3-embedding-0-6b-q4k-ehf16-af32';
const GEMMA3_270M_MODEL_ID = 'gemma-3-270m-it-q4k-ehf16-af32';
const GEMMA4_INT4_PLE_MODEL_ID = 'gemma-4-e2b-it-q4k-ehf16-af32-int4ple';
const deploymentEnv = JSON.parse(readFileSync('deploy/env.production.json', 'utf8'));
const cloudRunService = readFileSync('deploy/cloud-run-service.yaml', 'utf8');

const modelRequirementsFor = (model) => ({
  modelId: model.modelId,
  modelHash: model.modelHash,
  manifestHash: model.manifestHash,
  runtime: model.runtime,
  backend: model.backend
});

describe('pool launch contract', () => {
  it('uses Qwen 0.8B as the browser and server launch model', () => {
    expect(SERVER_LAUNCH_MODEL.modelId).toBe(QWEN_MODEL_ID);
    expect(BROWSER_LAUNCH_MODEL.modelId).toBe(QWEN_MODEL_ID);
    expect(BROWSER_LAUNCH_MODEL).toEqual(SERVER_LAUNCH_MODEL);
    expect(SERVER_LAUNCH_MODEL.label).toBe('Qwen 3.5 0.8B');
    expect(SERVER_LAUNCH_MODEL.dopplerLoadRef).toBe(QWEN_MODEL_ID);
  });

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
    expect(ringPolicy.policy.maxRingSize).toBe(12);
    expect(SERVER_GENERATION_CONFIG).toMatchObject({
      mode: 'greedy',
      temperature: 0,
      topK: 1,
      topP: 1,
      seed: '0000000000000000',
      useChatTemplate: false
    });
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

  it('accepts Qwen 0.8B as an enabled Poolday model contract', () => {
    const serverModel = getServerEnabledPoolModelContract(QWEN_MODEL_ID);
    const browserModel = getBrowserEnabledPoolModelContract(QWEN_MODEL_ID);
    expect(serverModel).toMatchObject({
      modelId: QWEN_MODEL_ID,
      modelHash: 'sha256:fab133e49d6dc67912fc3a087222ec44ca1941d9b7bc36c60cb1379863a6dd4f',
      manifestHash: 'sha256:c1564f7422cfb05f5404d7602b3531188de11b7f8409430b6671fe66431cc88b',
      tokenizerHash: 'sha256:8fc3b6de02de5a8e21d3867aba335e2d9a3c2263201f55daaed1feab3541bea4',
      runtime: 'doppler',
      backend: 'browser-webgpu',
      enabled: true
    });
    expect(serverModel.runtimeCompatibility).toMatchObject({
      requiredWebGpuFeatures: [],
      fallbackStatus: 'doppler_0_4_9_manifest_capability_remap',
      capabilityFallbacks: [
        expect.objectContaining({
          whenMissingWebGpuFeatures: ['shader-f16'],
          runtime: 'doppler-gpu@0.4.11',
          transform: 'widenToF32Activations',
          prefillProjectionKernel: 'fused_matmul_q4_batched_multicol_shared.wgsl',
          kvDtype: 'f32',
          status: 'supported'
        })
      ]
    });
    expect(browserModel).toEqual(serverModel);

    for (const policyId of ['fastest_receipt', 'canary_audited', 'redundant_agreement', 'ring_quorum_receipt']) {
      expect(getPolicy(policyId).allowedModels).toContain(QWEN_MODEL_ID);
    }

    const serverResult = validateJobRequest(makeJob({
      modelRequirements: modelRequirementsFor(serverModel)
    }));
    expect(serverResult.ok).toBe(true);

    const browserResult = validatePolicyRequest({
      modelRequirements: modelRequirementsFor(browserModel),
      generationConfig: { ...BROWSER_GENERATION_CONFIG }
    });
    expect(browserResult.ok).toBe(true);

    expect(validateModelRuntimeCapabilities(browserModel, {
      hasWebGPU: true,
      features: ['shader-f16']
    }).ok).toBe(true);
    const noF16 = validateModelRuntimeCapabilities(browserModel, {
      hasWebGPU: true,
      features: []
    });
    expect(noF16.ok).toBe(true);
    expect(noF16.missingFeatures).toEqual([]);
    expect(noF16.fallbackStatus).toBe('doppler_0_4_9_manifest_capability_remap');

    expect(buildModelArtifactUrls(browserModel)).toEqual({
      root: 'https://huggingface.co/Clocksmith/rdrr/resolve/f58f1d0b58641c84e7ea50d13fea0dd4dc91389a/models/qwen-3-5-0-8b-q4k-ehaf16',
      manifest: 'https://huggingface.co/Clocksmith/rdrr/resolve/f58f1d0b58641c84e7ea50d13fea0dd4dc91389a/models/qwen-3-5-0-8b-q4k-ehaf16/manifest.json',
      tokenizer: 'https://huggingface.co/Clocksmith/rdrr/resolve/f58f1d0b58641c84e7ea50d13fea0dd4dc91389a/models/qwen-3-5-0-8b-q4k-ehaf16/tokenizer.json',
      shards: 'https://huggingface.co/Clocksmith/rdrr/resolve/f58f1d0b58641c84e7ea50d13fea0dd4dc91389a/models/qwen-3-5-0-8b-q4k-ehaf16/'
    });
  });

  it('accepts Gemma 4 E2B INT4 PLE as an enabled Poolday model contract', () => {
    const serverModel = getServerEnabledPoolModelContract(GEMMA4_INT4_PLE_MODEL_ID);
    const browserModel = getBrowserEnabledPoolModelContract(GEMMA4_INT4_PLE_MODEL_ID);
    expect(serverModel).toMatchObject({
      modelId: GEMMA4_INT4_PLE_MODEL_ID,
      modelHash: 'sha256:7575f4e89b3938a3ca4f8d7fc50fb46d4cfbd1d4dcc3b6ed62b6fb53424678ea',
      manifestHash: 'sha256:512d6e16602071cccff4cbe576bf3b2c20bd43fd32aefc271db4bb95cc9c7f17',
      tokenizerHash: 'sha256:4453a86456cdf02b3c8f79091ffda7ca017619ff5da495b9eda12141d5793962',
      runtime: 'doppler',
      backend: 'browser-webgpu',
      enabled: true
    });
    expect(serverModel.label).toBe('Gemma 4 E2B INT4 PLE');
    expect(serverModel.dopplerLoadRef).toBe(GEMMA4_INT4_PLE_MODEL_ID);
    expect(browserModel).toEqual(serverModel);

    for (const policyId of ['fastest_receipt', 'canary_audited', 'redundant_agreement', 'ring_quorum_receipt']) {
      expect(getPolicy(policyId).allowedModels).toContain(GEMMA4_INT4_PLE_MODEL_ID);
    }

    expect(validateJobRequest(makeJob({
      modelRequirements: modelRequirementsFor(serverModel)
    }))).toMatchObject({ ok: true });
    expect(validatePolicyRequest({
      modelRequirements: modelRequirementsFor(browserModel),
      generationConfig: { ...BROWSER_GENERATION_CONFIG }
    })).toMatchObject({ ok: true });

    expect(buildModelArtifactUrls(browserModel)).toEqual({
      root: 'https://huggingface.co/Clocksmith/rdrr/resolve/16256bf16dc8f92b8fe5105b07628cef91587f0a/models/gemma-4-e2b-it-q4k-ehf16-af32-int4ple',
      manifest: 'https://huggingface.co/Clocksmith/rdrr/resolve/16256bf16dc8f92b8fe5105b07628cef91587f0a/models/gemma-4-e2b-it-q4k-ehf16-af32-int4ple/manifest.json',
      tokenizer: 'https://huggingface.co/Clocksmith/rdrr/resolve/16256bf16dc8f92b8fe5105b07628cef91587f0a/models/gemma-4-e2b-it-q4k-ehf16-af32-int4ple/tokenizer.json',
      shards: 'https://huggingface.co/Clocksmith/rdrr/resolve/16256bf16dc8f92b8fe5105b07628cef91587f0a/models/gemma-4-e2b-it-q4k-ehf16-af32-int4ple/'
    });
  });

  it('binds enabled Gemma 3 270M to its immutable hosted artifact', () => {
    const serverModel = getServerEnabledPoolModelContract(GEMMA3_270M_MODEL_ID);
    const browserModel = getBrowserEnabledPoolModelContract(GEMMA3_270M_MODEL_ID);
    expect(serverModel).toMatchObject({
      modelId: GEMMA3_270M_MODEL_ID,
      modelHash: 'sha256:c41b842878dbae11b1d6a052b193b0307c7c1518c41f00df99992f51f9a86fff',
      manifestHash: 'sha256:230104df762ff394095326d8e9fa4dc144d431bbd61ad5139e1030e66836ab78',
      tokenizerHash: 'sha256:be6955513a2509d69d18e82180c2a477ad99358d15212fb81d957566d8186075',
      runtime: 'doppler',
      backend: 'browser-webgpu',
      enabled: true
    });
    expect(browserModel).toEqual(serverModel);
    expect(buildModelArtifactUrls(browserModel)).toEqual({
      root: 'https://huggingface.co/Clocksmith/rdrr/resolve/a8591b20bce7c22d75becde1315482e76ff85fc9/models/gemma-3-270m-it-q4k-ehf16-af32',
      manifest: 'https://huggingface.co/Clocksmith/rdrr/resolve/a8591b20bce7c22d75becde1315482e76ff85fc9/models/gemma-3-270m-it-q4k-ehf16-af32/manifest.json',
      tokenizer: 'https://huggingface.co/Clocksmith/rdrr/resolve/a8591b20bce7c22d75becde1315482e76ff85fc9/models/gemma-3-270m-it-q4k-ehf16-af32/tokenizer.json',
      shards: 'https://huggingface.co/Clocksmith/rdrr/resolve/a8591b20bce7c22d75becde1315482e76ff85fc9/models/gemma-3-270m-it-q4k-ehf16-af32/'
    });
  });

  it('accepts Qwen3 Embedding 0.6B as an explicit embedding workload contract', () => {
    const serverModel = getServerEnabledPoolModelContract(QWEN_EMBEDDING_MODEL_ID);
    const browserModel = getBrowserEnabledPoolModelContract(QWEN_EMBEDDING_MODEL_ID);
    expect(serverModel).toMatchObject({
      modelId: QWEN_EMBEDDING_MODEL_ID,
      modelHash: 'sha256:ef89c72fdf91f6d256d6247604217590b67f9a689f693abe64d77d91598d10a3',
      manifestHash: 'sha256:95112b473292836b92b030d984af6b5aaf8917add6b3d0575c9217dabe3bd0d5',
      tokenizerHash: 'sha256:fc0c640dde6fe5c2892af6be480ac6728483fefba8bddb5e3bbeab523201666d',
      workload: POOLDAY_MODEL_WORKLOADS.embedding,
      executionMode: 'full_model_browser_embedding',
      embeddingDimensions: 1024,
      enabled: true
    });
    expect(browserModel).toEqual(serverModel);

    const browserRequirements = buildLaunchModelRequirements({ modelId: QWEN_EMBEDDING_MODEL_ID });
    expect(browserRequirements).toMatchObject({
      workload: POOLDAY_MODEL_WORKLOADS.embedding,
      executionMode: 'full_model_browser_embedding'
    });
    expect(validatePolicyRequest({
      modelRequirements: browserRequirements,
      generationConfig: { ...BROWSER_GENERATION_CONFIG }
    })).toMatchObject({ ok: true });

    expect(validateJobRequest(makeJob({
      modelRequirements: {
        modelId: serverModel.modelId,
        modelHash: serverModel.modelHash,
        manifestHash: serverModel.manifestHash,
        runtime: serverModel.runtime,
        backend: serverModel.backend,
        workload: serverModel.workload,
        executionMode: serverModel.executionMode
      }
    }))).toMatchObject({ ok: true });

    expect(buildModelArtifactUrls(browserModel)).toEqual({
      root: 'https://huggingface.co/Clocksmith/rdrr/resolve/049000f49325dca7db2ed2c9de2c8881bd0f4603/models/qwen-3-embedding-0-6b-q4k-ehf16-af32',
      manifest: 'https://huggingface.co/Clocksmith/rdrr/resolve/049000f49325dca7db2ed2c9de2c8881bd0f4603/models/qwen-3-embedding-0-6b-q4k-ehf16-af32/manifest.json',
      tokenizer: 'https://huggingface.co/Clocksmith/rdrr/resolve/049000f49325dca7db2ed2c9de2c8881bd0f4603/models/qwen-3-embedding-0-6b-q4k-ehf16-af32/tokenizer.json',
      shards: 'https://huggingface.co/Clocksmith/rdrr/resolve/049000f49325dca7db2ed2c9de2c8881bd0f4603/models/qwen-3-embedding-0-6b-q4k-ehf16-af32/'
    });
  });

  it('rejects split-model requirements until the runtime exposes model partition execution', () => {
    const modelRequirements = {
      modelId: BROWSER_LAUNCH_MODEL.modelId,
      modelHash: BROWSER_LAUNCH_MODEL.modelHash,
      manifestHash: BROWSER_LAUNCH_MODEL.manifestHash,
      runtime: BROWSER_LAUNCH_MODEL.runtime,
      backend: BROWSER_LAUNCH_MODEL.backend,
      executionMode: 'model_split',
      splitPlan: {
        kind: 'tensor_parallel',
        partitions: 2
      }
    };
    const browserResult = validatePolicyRequest({
      modelRequirements,
      generationConfig: { ...BROWSER_GENERATION_CONFIG }
    });
    const serverResult = validateJobRequest(makeJob({ modelRequirements }));

    expect(browserResult.ok).toBe(false);
    expect(serverResult.ok).toBe(false);
    expect(browserResult.reasons).toContain('modelRequirements.executionMode model_split is not supported; only full_model_browser_local is supported');
    expect(browserResult.reasons).toContain('modelRequirements.splitPlan is not supported by browser peer-room execution');
    expect(serverResult.reasons).toContain('modelRequirements.executionMode model_split is not supported; only full_model_browser_local is supported');
    expect(serverResult.reasons).toContain('modelRequirements.splitPlan is not supported by browser peer-room execution');
  });

  it('keeps browser runtime deployment config aligned across server and browser', () => {
    expect(BROWSER_BROWSER_RUNTIME_CONFIG).toEqual(SERVER_BROWSER_RUNTIME_CONFIG);
    expect(BROWSER_BROWSER_RUNTIME_CONFIG.dopplerModuleUrl).toBe('https://esm.sh/doppler-gpu@0.4.11/src/client/doppler-api.js?bundle');
    expect(BROWSER_BROWSER_RUNTIME_CONFIG.dopplerKernelBaseUrl).toBe('https://esm.sh/doppler-gpu@0.4.11/src/gpu/kernels');
    expect(BROWSER_BROWSER_RUNTIME_CONFIG.modelBaseUrl).toBe('https://huggingface.co/Clocksmith/rdrr/resolve/f58f1d0b58641c84e7ea50d13fea0dd4dc91389a/models');

    for (const env of [deploymentEnv.runtimeEnv, deploymentEnv.browserEnv]) {
      expect(env.REPLOID_DOPPLER_MODULE_URL).toBe(BROWSER_BROWSER_RUNTIME_CONFIG.dopplerModuleUrl);
      expect(env.REPLOID_DOPPLER_KERNEL_BASE_URL).toBe(BROWSER_BROWSER_RUNTIME_CONFIG.dopplerKernelBaseUrl);
    }
    expect(cloudRunService).toContain(`value: "${BROWSER_BROWSER_RUNTIME_CONFIG.dopplerModuleUrl}"`);
    expect(cloudRunService).toContain(`value: "${BROWSER_BROWSER_RUNTIME_CONFIG.dopplerKernelBaseUrl}"`);
    expect(cloudRunService).not.toContain('doppler-api.browser.js');
  });

  it('keeps offloaded artifact URLs separate from receipt identity fields', () => {
    const artifactUrls = buildLaunchModelArtifactUrls({
      baseUrl: 'https://models.example/reploid/'
    });

    expect(artifactUrls).toEqual({
      transport: 'offloaded_content_addressed',
      cache: 'browser_opfs',
      manifestUrl: 'https://models.example/reploid/manifest.json',
      tokenizerUrl: 'https://models.example/reploid/tokenizer.json',
      shardBaseUrl: 'https://models.example/reploid/'
    });
    expect(SERVER_LAUNCH_MODEL.artifactPolicy.identityFields).toEqual([
      'modelId',
      'modelHash',
      'manifestHash',
      'tokenizerHash',
      'artifactIdentity',
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

  it('builds a capped twelve-provider majority ring for ring quorum jobs', async () => {
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
    for (let index = 0; index < 14; index += 1) {
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
    expect(result.assignments).toHaveLength(12);
    expect(result.ring.ringSize).toBe(12);
    expect(result.ring.requiredAgreement).toBe(7);
    expect(result.ring.effectiveTrustTier).toBe('T4_max_ring_quorum_receipt');
    expect(result.ring.ringId).toBe(`ring_${result.ring.layoutHash.replace(/^sha256:/, '').slice(0, 16)}`);
    expect(new Set(result.ring.providerIds).size).toBe(12);
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
    expect(effectiveTrustTierForRingSize(12, ringPolicy)).toBe('T4_max_ring_quorum_receipt');
  });
});
