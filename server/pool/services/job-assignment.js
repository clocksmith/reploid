/**
 * @fileoverview Pool job assignment and audit scheduling application service.
 */

import { attachAuditAssignment } from '../audits.js';
import { getPolicy } from '../policy-router.js';
import { assignJob } from '../scheduler.js';

export async function scheduleAuditExecution({ store, provider, model, audit }) {
  const policyId = audit.policyId || 'fastest_receipt';
  const job = await store.createJob({
    requesterId: 'coordinator_audit',
    requesterPublicKey: null,
    prompt: audit.prompt,
    policyId,
    modelRequirements: audit.modelRequirements,
    generationConfig: audit.generationConfig,
    verificationLevel: 'audit',
    trustTier: 'T2_canary_audited',
    auditId: audit.auditId,
    auditKind: audit.kind
  });
  const assignment = await store.createAssignment({
    jobId: job.jobId,
    requesterId: job.requesterId,
    providerId: provider.providerId,
    modelId: model.modelId,
    policyId,
    inputHash: audit.inputHash,
    generationConfigHash: audit.generationConfigHash,
    verificationLevel: 'audit',
    trustTier: 'T2_canary_audited',
    auditId: audit.auditId,
    auditKind: audit.kind,
    expiresAt: new Date(Date.now() + 120000).toISOString(),
    prompt: audit.prompt,
    generationConfig: audit.generationConfig,
    model: {
      id: model.modelId,
      hash: model.modelHash,
      manifestHash: model.manifestHash,
      runtime: model.runtime,
      backend: model.backend,
      requirements: audit.modelRequirements
    }
  });
  await attachAuditAssignment({
    store,
    auditId: audit.auditId,
    assignmentId: assignment.assignmentId,
    providerId: provider.providerId
  });
  await store.updateJob(job.jobId, {
    status: 'assigned',
    assignmentId: assignment.assignmentId,
    assignmentIds: [assignment.assignmentId],
    providerId: provider.providerId,
    providerIds: [provider.providerId],
    inputHash: audit.inputHash,
    generationConfigHash: audit.generationConfigHash
  });
  return {
    audit: await store.getAuditChallenge(audit.auditId),
    job: await store.getJob(job.jobId),
    assignment
  };
}

export async function assignQueuedJobs({ store, limit = 5 } = {}) {
  if (typeof store.listJobs !== 'function') return [];
  const jobs = await store.listJobs();
  const canRetry = (job = {}) => job.status === 'queued'
    || (job.retryable === true && ['failed', 'receipt_rejected', 'redundant_disagreement', 'ring_quorum_disagreement'].includes(job.status));
  const queued = jobs
    .filter(canRetry)
    .slice(0, limit);
  const results = [];
  for (const job of queued) {
    const claimedJob = typeof store.claimJobForAssignment === 'function'
      ? await store.claimJobForAssignment(job.jobId)
      : job;
    if (!claimedJob) continue;
    const policy = getPolicy(claimedJob.policyId);
    if (!policy) {
      await store.updateJob(claimedJob.jobId, {
        status: 'failed',
        reason: 'unsupported_policy',
        retryable: false
      });
      results.push({ jobId: claimedJob.jobId, ok: false, reason: 'unsupported_policy' });
      continue;
    }
    const assignmentResult = await assignJob({ store, job: claimedJob, policy });
    if (!assignmentResult.ok) {
      await store.updateJob(claimedJob.jobId, {
        status: 'queued',
        assignmentBlockedReason: assignmentResult.reason,
        requiredProviders: assignmentResult.requiredProviders,
        eligibleProviders: assignmentResult.eligibleProviders
      });
    }
    results.push({ jobId: claimedJob.jobId, ...assignmentResult });
  }
  return results;
}
