import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { BROWSER_RUNTIME_CONFIG as SERVER_BROWSER_RUNTIME_CONFIG } from '../../server/pool/config.js';
import { getPolicy, validateJobRequest } from '../../server/pool/policy-router.js';
import {
  LAUNCH_MODEL as SERVER_LAUNCH_MODEL,
  getEnabledPoolModelContract as getServerEnabledPoolModelContract
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
  getEnabledPoolModelContract as getBrowserEnabledPoolModelContract,
  listPoolModels,
  validateLaunchModelRequirement,
  validateModelRuntimeCapabilities
} from '../../self/pool/model-contract.js';
import { verifyReceipt as verifyBrowserReceipt } from '../../self/pool/sdk.js';
import {
  DOPPLER_KERNEL_BASE_URL,
  DOPPLER_MODULE_URL
} from '../../self/config/doppler-local-models.js';

const PROTEIN_MODEL_ID = 'esm2-t12-35m-ur50d-f32-af32';
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
    includeLogits: false
  }
});

describe('Poolday protein-only contract', () => {
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

  it('exposes only the enabled protein model to browser and server consumers', () => {
    const browserModel = getBrowserEnabledPoolModelContract(PROTEIN_MODEL_ID);
    const serverModel = getServerEnabledPoolModelContract(PROTEIN_MODEL_ID);
    expect(browserModel).toEqual(serverModel);
    expect(listPoolModels({ enabledOnly: true })).toEqual([browserModel]);
    expect(getBrowserEnabledPoolModelContract(RETIRED_TEXT_MODEL_ID)).toBeNull();
    expect(getServerEnabledPoolModelContract(RETIRED_TEXT_MODEL_ID)).toBeNull();
    expect(listPoolModels()).toEqual([browserModel]);
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
