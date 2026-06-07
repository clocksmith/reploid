import { describe, expect, it } from 'vitest';

import {
  DETERMINISTIC_GENERATION_CONFIG as SERVER_GENERATION_CONFIG,
  validateJobRequest
} from '../../server/pool/policy-router.js';
import { LAUNCH_MODEL as SERVER_LAUNCH_MODEL } from '../../server/pool/model-contract.js';
import {
  DETERMINISTIC_GENERATION_CONFIG as BROWSER_GENERATION_CONFIG,
  validatePolicyRequest
} from '../../self/pool/policy-router.js';
import { LAUNCH_MODEL as BROWSER_LAUNCH_MODEL } from '../../self/pool/model-contract.js';
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
});
