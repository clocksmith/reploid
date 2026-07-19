import { describe, expect, it } from 'vitest';

import {
  compareProviderRouteCandidates,
  deriveAdapterLifecycle,
  evaluateProviderRouteCandidate,
  sealArtifactRouteDecision
} from '../../self/pool/artifact-router.js';

const hash = (character) => `sha256:${character.repeat(64)}`;
const adapter = (state = 'fetchable') => ({
  schema: 'reploid.pool.adapter-requirement/v1',
  packHash: hash('1'),
  adapterId: 'legal-extract-v1',
  adapterSha256: hash('2'),
  baseModelId: 'qwen',
  baseModelHash: hash('3'),
  baseManifestHash: hash('4'),
  humanPromotionReceiptHash: hash('5'),
  dopplerParityReceiptHash: hash('6'),
  gammaSelectionReceiptHash: hash('7'),
  publicationHash: hash('8'),
  publisherId: 'publisher_a',
  state
});
const intent = (requirement = adapter()) => ({
  body: {
    policyId: 'fastest_receipt',
    workload: 'text_generation',
    generationConfig: { maxOutputTokens: 128 },
    modelRequirements: {
      modelId: 'qwen',
      modelHash: hash('3'),
      manifestHash: hash('4'),
      runtime: 'doppler',
      backend: 'browser-webgpu',
      workload: 'text_generation',
      adapter: requirement
    }
  }
});
const advert = (providerId, state, availability = {}) => ({
  fromPeerId: providerId,
  body: {
    providerId,
    models: [{
      modelId: 'qwen',
      modelHash: hash('3'),
      manifestHash: hash('4'),
      runtime: 'doppler',
      backend: 'browser-webgpu',
      workload: 'text_generation',
      adapterPacks: [{ ...adapter(state), state }]
    }],
    availability: {
      acceptedPolicies: ['fastest_receipt'],
      maxConcurrentJobs: 1,
      activeJobs: 0,
      ...availability
    },
    reputationEvidence: { reliabilityScore: 0.9 }
  }
});

describe('Poolday artifact router', () => {
  it('keeps promotion state distinct from transport availability', () => {
    expect(deriveAdapterLifecycle(adapter('fetchable'))).toBe('routable');
    expect(deriveAdapterLifecycle({ adapterSha256: hash('2') })).toBe('bytes_verified');
    expect(deriveAdapterLifecycle(adapter('fetchable'), { revoked: true })).toBe('revoked');
  });

  it('filters exact identity before preferring active, cached, and fetchable sources', () => {
    const active = evaluateProviderRouteCandidate({ advert: advert('provider_active', 'active'), intent: intent() });
    const cached = evaluateProviderRouteCandidate({ advert: advert('provider_cached', 'cached'), intent: intent() });
    const fetchable = evaluateProviderRouteCandidate({ advert: advert('provider_fetch', 'fetchable'), intent: intent() });
    expect([active, cached, fetchable].every((candidate) => candidate.eligible)).toBe(true);
    expect([fetchable, active, cached].sort(compareProviderRouteCandidates).map((candidate) => candidate.providerId))
      .toEqual(['provider_active', 'provider_cached', 'provider_fetch']);

    const wrongModel = advert('provider_wrong', 'active');
    wrongModel.body.models[0].modelHash = hash('9');
    const rejected = evaluateProviderRouteCandidate({ advert: wrongModel, intent: intent() });
    expect(rejected.eligible).toBe(false);
    expect(rejected.rejectionReasons).toContain('model_hash_mismatch');
  });

  it('rejects jobs and artifact transfers outside signed provider limits', () => {
    const limited = advert('provider_limited', 'fetchable', {
      maxTokensPerJob: 64,
      storageBudgetMiB: 128,
      adapterTransferBytes: 256 * 1024 * 1024
    });
    limited.body.participationProfile = {
      mode: 'contribute',
      capabilities: ['provide_inference'],
      limits: {
        maxConcurrentJobs: 1,
        maxTokensPerJob: 64,
        storageBudgetMiB: 128,
        bandwidthBudgetMbps: 25
      }
    };
    const rejected = evaluateProviderRouteCandidate({ advert: limited, intent: intent() });

    expect(rejected.eligible).toBe(false);
    expect(rejected.rejectionReasons).toContain('job_token_limit_exceeded');
    expect(rejected.rejectionReasons).toContain('adapter_storage_budget_exceeded');
  });

  it('seals a deterministic route decision independent of candidate arrival order', async () => {
    const left = evaluateProviderRouteCandidate({ advert: advert('provider_a', 'cached'), intent: intent() });
    const right = evaluateProviderRouteCandidate({ advert: advert('provider_b', 'fetchable'), intent: intent() });
    const first = await sealArtifactRouteDecision({
      intentHash: hash('a'),
      policyId: 'fastest_receipt',
      modelRequirements: intent().body.modelRequirements,
      candidates: [left, right],
      selectedProviderIds: ['provider_a'],
      createdAt: '2026-07-19T00:00:00.000Z'
    });
    const second = await sealArtifactRouteDecision({
      intentHash: hash('a'),
      policyId: 'fastest_receipt',
      modelRequirements: intent().body.modelRequirements,
      candidates: [right, left],
      selectedProviderIds: ['provider_a'],
      createdAt: '2026-07-19T01:00:00.000Z'
    });
    expect(first.decisionHash).toBe(second.decisionHash);
    expect(first.candidates.map((candidate) => candidate.providerId)).toEqual(['provider_a', 'provider_b']);
  });
});
