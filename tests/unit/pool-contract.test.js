import { describe, expect, it } from 'vitest';

import {
  DETERMINISTIC_GENERATION_CONFIG as SERVER_GENERATION_CONFIG,
  getPolicy,
  validateJobRequest
} from '../../server/pool/policy-router.js';
import { LAUNCH_MODEL as SERVER_LAUNCH_MODEL } from '../../server/pool/model-contract.js';
import { assignJob } from '../../server/pool/scheduler.js';
import { createPoolStore } from '../../server/pool/store.js';
import {
  DETERMINISTIC_GENERATION_CONFIG as BROWSER_GENERATION_CONFIG,
  validatePolicyRequest
} from '../../self/pool/policy-router.js';
import {
  LAUNCH_MODEL as BROWSER_LAUNCH_MODEL,
  buildLaunchModelArtifactUrls
} from '../../self/pool/model-contract.js';
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
    expect(missingRuntime.reasons).toContain('model requirements do not match the launch model identity');

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
    for (let index = 0; index < 5; index += 1) {
      store.registerProvider({
        providerId: `provider_${index}`,
        publicKey: `public_key_${index}`,
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
