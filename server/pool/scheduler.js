/**
 * @fileoverview Single-provider fastest-receipt scheduler.
 */

import { hashJson, sha256Hex } from './hash.js';

const selectModel = (provider, job = {}) => {
  const models = provider.models || [];
  const requirements = job.modelRequirements || {};
  const requestedModel = requirements.modelId;
  const requestedModelHash = requirements.modelHash;
  const requestedManifestHash = requirements.manifestHash;
  const requestedRuntime = requirements.runtime;
  const requestedBackend = requirements.backend;
  if (!requestedModel || !requestedModelHash || !requestedManifestHash) return null;
  return models.find((model) => {
    if (model.modelId !== requestedModel) return false;
    if (model.modelHash !== requestedModelHash) return false;
    if (model.manifestHash !== requestedManifestHash) return false;
    if (requestedRuntime && model.runtime !== requestedRuntime) return false;
    if (requestedBackend && model.backend !== requestedBackend) return false;
    return true;
  }) || null;
};

const pickProvider = (providers = [], job = {}, store) => providers.find((provider) => {
  const reputation = store?.getReputation?.(provider.providerId);
  if (reputation?.routingBlocked) return false;
  const policies = provider.availability?.acceptedPolicies || [];
  const acceptsPolicy = policies.length === 0 || policies.includes(job.policyId);
  const hasModel = !!selectModel(provider, job);
  return provider.status === 'available' && acceptsPolicy && hasModel;
});

export async function assignJob({ store, job, policy }) {
  const provider = pickProvider(store.listProviders(), job, store);
  if (!provider) {
    return {
      ok: false,
      reason: 'no_eligible_browser_provider'
    };
  }
  const inputHash = sha256Hex(job.prompt);
  const generationConfigHash = hashJson(job.generationConfig || {});
  const model = selectModel(provider, job);
  if (!model) {
    return {
      ok: false,
      reason: 'requested_model_not_available'
    };
  }
  const assignment = store.createAssignment({
    jobId: job.jobId,
    requesterId: job.requesterId,
    providerId: provider.providerId,
    modelId: model.modelId,
    policyId: policy.policyId,
    inputHash,
    generationConfigHash,
    verificationLevel: policy.verificationLevel,
    expiresAt: new Date(Date.now() + 120000).toISOString(),
    prompt: job.prompt,
    generationConfig: job.generationConfig,
    model: {
      id: model.modelId,
      hash: model.modelHash,
      manifestHash: model.manifestHash,
      runtime: model.runtime || 'doppler',
      backend: model.backend || 'browser-webgpu',
      requirements: job.modelRequirements || {}
    }
  });
  store.updateJob(job.jobId, {
    status: 'assigned',
    assignmentId: assignment.assignmentId,
    providerId: provider.providerId,
    inputHash,
    generationConfigHash
  });
  return { ok: true, assignment, provider };
}

export default {
  assignJob
};
