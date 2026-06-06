/**
 * @fileoverview Single-provider fastest-receipt scheduler.
 */

import { hashJson, sha256Hex } from './hash.js';

const pickProvider = (providers = [], job = {}) => providers.find((provider) => {
  const policies = provider.availability?.acceptedPolicies || [];
  const models = provider.models || [];
  const acceptsPolicy = policies.length === 0 || policies.includes(job.policyId);
  const requestedModel = job.modelRequirements?.modelId;
  const hasModel = !requestedModel || models.some((model) => model.modelId === requestedModel || model.modelId === 'v0_default');
  return provider.status === 'available' && acceptsPolicy && hasModel;
});

export async function assignJob({ store, job, policy }) {
  const provider = pickProvider(store.listProviders(), job);
  if (!provider) {
    return {
      ok: false,
      reason: 'no_eligible_browser_provider'
    };
  }
  const inputHash = sha256Hex(job.prompt);
  const generationConfigHash = hashJson(job.generationConfig || {});
  const model = provider.models?.[0] || { modelId: job.modelRequirements?.modelId || 'v0_default' };
  const assignment = store.createAssignment({
    jobId: job.jobId,
    requesterId: job.requesterId,
    providerId: provider.providerId,
    modelId: model.modelId,
    policyId: policy.policyId,
    inputHash,
    generationConfigHash,
    verificationLevel: policy.verificationLevel,
    prompt: job.prompt,
    generationConfig: job.generationConfig,
    model: {
      id: model.modelId,
      hash: model.modelHash || 'sha256:unknown',
      manifestHash: model.manifestHash || 'sha256:unknown',
      runtime: model.runtime || 'doppler',
      backend: model.backend || 'browser-webgpu'
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
