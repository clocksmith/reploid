/**
 * @fileoverview Pool job assignment and audit scheduling application service.
 */

import { attachAuditAssignment } from '../audits.js';
import { getPolicy } from '../policy-router.js';
import { assignJob } from '../scheduler.js';
import {
  exactModelContractKey,
  getEnabledPoolModelContract,
  getPoolModelExecutionMode,
  getPoolModelWorkload
} from '../model-contract.js';

export async function scheduleAuditExecution({ store, provider, model, audit }) {
  const assignedModel = getEnabledPoolModelContract(model?.modelId);
  if (!assignedModel) throw new Error('audit provider model is not an enabled Poolday model');
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
      ...assignedModel,
      id: assignedModel.modelId,
      hash: assignedModel.modelHash,
      workload: audit.modelRequirements?.workload || getPoolModelWorkload(assignedModel),
      executionMode: getPoolModelExecutionMode(
        assignedModel,
        audit.modelRequirements?.workload || getPoolModelWorkload(assignedModel)
      ),
      exactModelContractKey: exactModelContractKey(assignedModel, {
        workload: audit.modelRequirements?.workload || getPoolModelWorkload(assignedModel)
      }),
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

export async function assignQueuedJobs({ store, limit = 5, prioritizeJobIds = [] } = {}) {
  if (typeof store.listJobs !== 'function') return [];
  const jobs = await store.listJobs();
  const priority = new Set(prioritizeJobIds.filter(Boolean));
  const canRetry = (job = {}) => job.status === 'queued'
    || (job.retryable === true && ['failed', 'receipt_rejected', 'redundant_disagreement', 'ring_quorum_disagreement'].includes(job.status));
  const queued = jobs
    .filter(canRetry)
    .sort((left, right) => (
      Number(priority.has(right.jobId)) - Number(priority.has(left.jobId))
      || String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
      || String(left.jobId || '').localeCompare(String(right.jobId || ''))
    ))
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

/**
 * Expires stale hosted assignments and drains every queued or retryable job.
 * The returned projection distinguishes successful replacements from jobs that
 * remain queued because their policy has no eligible provider set.
 */
export async function recoverHostedAssignments({
  store,
  limit = 5,
  expire = true,
  targetJobId = null
} = {}) {
  const expired = expire ? await store.expireStaleAssignments() : [];
  const prioritizeJobIds = Array.from(new Set([
    targetJobId,
    ...expired.map((assignment) => assignment?.jobId)
  ].filter(Boolean)));
  const assignmentResults = await assignQueuedJobs({ store, limit, prioritizeJobIds });
  return {
    expired,
    assignmentResults,
    summary: {
      expired: expired.length,
      attempted: assignmentResults.length,
      assigned: assignmentResults.filter((result) => result.ok === true).length,
      blocked: assignmentResults.filter((result) => result.ok !== true).length
    }
  };
}
