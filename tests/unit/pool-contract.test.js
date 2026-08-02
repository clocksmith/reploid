import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BROWSER_RUNTIME_CONFIG as SERVER_BROWSER_RUNTIME_CONFIG } from '../../server/pool/config.js';
import { getPolicy, validateJobRequest } from '../../server/pool/policy-router.js';
import {
  LAUNCH_MODEL as SERVER_LAUNCH_MODEL,
  exactModelContractKey as exactServerModelContractKey,
  getEnabledPoolModelContract as getServerEnabledPoolModelContract,
  validateLaunchModelRequirement as validateServerLaunchModelRequirement
} from '../../server/pool/model-contract.js';
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
  exactModelContractKey,
  getEnabledPoolModelContract as getBrowserEnabledPoolModelContract,
  getPoolModelContract,
  listPoolModels,
  validateEnabledPoolModelContract,
  validateLaunchModelRequirement,
  validateModelRuntimeCapabilities
} from '../../self/pool/model-contract.js';
import { verifyReceipt as verifyBrowserReceipt } from '../../self/pool/sdk.js';
import {
  DOPPLER_KERNEL_BASE_URL,
  DOPPLER_MODULE_URL
} from '../../self/config/doppler-local-models.js';

const PROTEIN_MODEL_ID = 'esm2-t12-35m-ur50d-f32-af32';
const AMPLIFY_MODEL_ID = 'amplify-120m-f16-af32';
const ESMC_MODEL_ID = 'esmc-300m-f32-af32';
const NUCLEOTIDE_MODEL_ID = 'nucleotide-transformer-v2-50m-f32-af32';
const RETIRED_TEXT_MODEL_ID = 'qwen-3-5-0-8b-q4k-ehaf16';
const deploymentEnv = JSON.parse(readFileSync('deploy/env.production.json', 'utf8'));
const cloudRunService = readFileSync('deploy/cloud-run-service.yaml', 'utf8');

const proteinRequirements = () => buildLaunchModelRequirements({
  sequenceRequest: {
    schema: 'reploid.pool.sequence_request/v1',
    workload: POOLDAY_MODEL_WORKLOADS.sequenceEmbedding,
    alphabet: 'amino_acid',
    sequenceHash: `sha256:${'0'.repeat(64)}`,
    sequenceLength: 22,
    disclosure: 'selected_providers_only',
    sensitivity: 'public',
    includeTokenEmbeddings: false,
    includeLogits: false,
    coordinateSystem: 'zero_based_sequence_index',
    sequenceIndices: [],
    tokenIndices: []
  }
});

describe('Poolday protein-first sequence model contract', () => {
  it('selects ESM-2 as the browser and server launch model', () => {
    expect(SERVER_LAUNCH_MODEL.modelId).toBe(PROTEIN_MODEL_ID);
    expect(BROWSER_LAUNCH_MODEL).toEqual(SERVER_LAUNCH_MODEL);
    expect(BROWSER_LAUNCH_MODEL).toMatchObject({
      workload: POOLDAY_MODEL_WORKLOADS.sequenceEmbedding,
      executionMode: 'full_model_browser_sequence',
      sequence: { alphabet: 'amino_acid' },
      artifactIdentity: { modalitySet: ['protein_sequence'] }
    });
  });

  it('uses the same exact-model identity and requirement decision in both environments', () => {
    const requirements = proteinRequirements();
    expect(exactServerModelContractKey(SERVER_LAUNCH_MODEL)).toBe(exactModelContractKey(BROWSER_LAUNCH_MODEL));
    expect(validateServerLaunchModelRequirement(requirements)).toEqual(
      validateLaunchModelRequirement(requirements)
    );
  });

  it('exposes only ESM-2 for execution while retaining four isolated declared model contracts', () => {
    const browserModel = getBrowserEnabledPoolModelContract(PROTEIN_MODEL_ID);
    const serverModel = getServerEnabledPoolModelContract(PROTEIN_MODEL_ID);
    expect(browserModel).toEqual(serverModel);
    expect(listPoolModels({ enabledOnly: true })).toEqual([browserModel]);
    expect(getBrowserEnabledPoolModelContract(RETIRED_TEXT_MODEL_ID)).toBeNull();
    expect(getServerEnabledPoolModelContract(RETIRED_TEXT_MODEL_ID)).toBeNull();
    expect(listPoolModels().map((model) => model.modelId)).toEqual([
      PROTEIN_MODEL_ID,
      AMPLIFY_MODEL_ID,
      ESMC_MODEL_ID,
      NUCLEOTIDE_MODEL_ID
    ]);
    expect(listPoolModels().filter((model) => model.enabled !== false)).toEqual([browserModel]);
  });

  it('keeps every model in its own exact-contract coordinate system', () => {
    const models = listPoolModels();
    const keys = models.map((model) => exactModelContractKey(model));

    expect(new Set(keys).size).toBe(models.length);
    expect(keys.every((key) => {
      const contract = JSON.parse(key);
      return contract.claimBoundary
        && contract.runtimeContract
        && contract.sequence
        && contract.artifactIdentity;
    })).toBe(true);
    expect(exactModelContractKey(getPoolModelContract(AMPLIFY_MODEL_ID))).not.toBe(
      exactModelContractKey(getPoolModelContract(ESMC_MODEL_ID))
    );
    const amplify = getPoolModelContract(AMPLIFY_MODEL_ID);
    expect(exactModelContractKey({ ...amplify, admission: {
      ...amplify.admission,
      claimBoundary: 'A changed claim boundary must create a new exact contract identity.'
    } })).not.toBe(exactModelContractKey(amplify));
    expect(exactModelContractKey({ ...amplify, runtimeContract: {
      ...amplify.runtimeContract,
      kernelPathId: 'different-execution-graph'
    } })).not.toBe(exactModelContractKey(amplify));
  });

  it('accepts exact public protein peer requirements', () => {
    const requirements = proteinRequirements();
    expect(validateLaunchModelRequirement(requirements)).toMatchObject({ ok: true });
    expect(validatePolicyRequest({
      modelRequirements: requirements,
      generationConfig: { ...BROWSER_GENERATION_CONFIG }
    })).toMatchObject({ ok: true });
  });

  it('rejects retired text-model and non-protein workload requirements', () => {
    const requirements = proteinRequirements();
    expect(validateLaunchModelRequirement({
      ...requirements,
      modelId: RETIRED_TEXT_MODEL_ID
    }).ok).toBe(false);
    expect(validateLaunchModelRequirement({
      ...requirements,
      workload: 'text_generation'
    }).ok).toBe(false);
  });

  it('rejects fully identified candidate models until their independent promotion gates pass', () => {
    const candidate = getPoolModelContract(AMPLIFY_MODEL_ID);
    const requirements = proteinRequirements();
    expect(validateLaunchModelRequirement({
      ...requirements,
      modelId: candidate.modelId,
      modelHash: candidate.modelHash,
      manifestHash: candidate.manifestHash,
      tokenizerHash: candidate.tokenizerHash,
      runtime: candidate.runtime,
      backend: candidate.backend
    })).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['model requirements do not match an enabled model contract'])
    });
  });

  it('requires published research evidence to bind the complete enabled catalog contract', () => {
    const enabled = getPoolModelContract(PROTEIN_MODEL_ID);
    const candidate = getPoolModelContract(AMPLIFY_MODEL_ID);
    expect(validateEnabledPoolModelContract(enabled)).toMatchObject({ ok: true });
    expect(validateEnabledPoolModelContract({ ...enabled, runtimeContract: {
      ...enabled.runtimeContract,
      kernelPathId: 'different-execution-graph'
    } })).toMatchObject({
      ok: false,
      reasons: ['model contract does not exactly match the enabled Poolday catalog contract']
    });
    expect(validateEnabledPoolModelContract(candidate)).toMatchObject({
      ok: false,
      reasons: ['model contract is not a currently enabled Poolday model']
    });
  });

  it('keeps sequence work out of the coordinator prompt route', () => {
    const result = validateJobRequest({
      requesterId: 'requester_test',
      requesterPublicKey: 'public-key',
      prompt: 'MKTIIALSYIFCLVFADYKDDD',
      policyId: 'fastest_receipt',
      modelRequirements: proteinRequirements(),
      generationConfig: { ...BROWSER_GENERATION_CONFIG }
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('biological sequence jobs require the peer-room WebRTC input lane');
  });

  it('limits every policy to ESM-2', () => {
    for (const policyId of ['fastest_receipt', 'canary_audited', 'redundant_agreement', 'ring_quorum_receipt']) {
      expect(getPolicy(policyId).allowedModels).toEqual([PROTEIN_MODEL_ID]);
    }
  });

  it('pins launch artifacts independently of their delivery URL', () => {
    expect(buildLaunchModelArtifactUrls({ baseUrl: 'https://models.example/reploid/' })).toEqual({
      transport: 'offloaded_content_addressed',
      cache: 'browser_opfs',
      manifestUrl: 'https://models.example/reploid/manifest.json',
      tokenizerUrl: 'https://models.example/reploid/tokenizer.json',
      shardBaseUrl: 'https://models.example/reploid/'
    });
  });

  it('keeps browser runtime deployment config aligned across server and browser', () => {
    expect(BROWSER_BROWSER_RUNTIME_CONFIG).toEqual(SERVER_BROWSER_RUNTIME_CONFIG);
    expect(BROWSER_BROWSER_RUNTIME_CONFIG.dopplerModuleUrl).toBe(DOPPLER_MODULE_URL);
    expect(BROWSER_BROWSER_RUNTIME_CONFIG.dopplerKernelBaseUrl).toBe(DOPPLER_KERNEL_BASE_URL);
    for (const env of [deploymentEnv.runtimeEnv, deploymentEnv.browserEnv]) {
      expect(env.REPLOID_DOPPLER_MODULE_URL).toBe(BROWSER_BROWSER_RUNTIME_CONFIG.dopplerModuleUrl);
      expect(env.REPLOID_DOPPLER_KERNEL_BASE_URL).toBe(BROWSER_BROWSER_RUNTIME_CONFIG.dopplerKernelBaseUrl);
    }
    expect(cloudRunService).toContain(`value: "${BROWSER_BROWSER_RUNTIME_CONFIG.dopplerModuleUrl}"`);
    expect(cloudRunService).toContain(`value: "${BROWSER_BROWSER_RUNTIME_CONFIG.dopplerKernelBaseUrl}"`);
  });

  it('reports missing WebGPU capability directly', () => {
    expect(validateModelRuntimeCapabilities(BROWSER_LAUNCH_MODEL, {
      hasWebGPU: false,
      features: []
    })).toMatchObject({ ok: false, reasons: ['WebGPU is required for browser provider execution'] });
  });

  it('returns machine-readable local verifier errors for malformed keys', async () => {
    const result = await verifyBrowserReceipt(
      { providerSignature: 'not-base64', outputHash: 'sha256:not-used' },
      'not-a-public-key'
    );
    expect(result.ok).toBe(false);
    expect(result.reasons.some((reason) => reason.startsWith('provider signature verification failed:'))).toBe(true);
  });
});
