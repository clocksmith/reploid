/**
 * @fileoverview Persistence-neutral agreement and receipt lifecycle transitions.
 *
 * These transitions derive coordinator state from durable assignment, receipt,
 * commitment, reveal, and reputation records. They do not make scientific,
 * biological, or hardware-honesty claims.
 */

import { CHALLENGE_AUDIT_KIND, applyCanaryReputation, verifyCanaryResult } from '../audits.js';
import { getLedgerReasons, getRingPhaseProtocol } from '../config.js';
import { revealMatchesCommitment } from '../commit-reveal.js';
import { penalizeProvider } from '../points.js';
import { recordRejectedReceipt } from '../reputation.js';

const activeAssignmentStatuses = new Set(['assigned', 'running', 'commit_submitted', 'reveal_open', 'reveal_submitted']);

export const assignmentMatchesCurrentJobAttempt = (assignment = {}, job = {}) => {
  const currentAssignmentIds = new Set(Array.isArray(job.assignmentIds) ? job.assignmentIds : []);
  if (currentAssignmentIds.size > 0 && !currentAssignmentIds.has(assignment.assignmentId)) return false;
  if (job.assignmentAttemptId !== undefined
    && assignment.assignmentAttemptId !== undefined
    && Number(job.assignmentAttemptId) !== Number(assignment.assignmentAttemptId)) {
    return false;
  }
  if (job.ringAttemptId
    && assignment.ringAttemptId
    && job.ringAttemptId !== assignment.ringAttemptId) {
    return false;
  }
  return true;
};

const currentReceiptsForJob = async (store, job = {}) => {
  const currentAssignmentIds = new Set(Array.isArray(job.assignmentIds) ? job.assignmentIds : []);
  return (await store.listReceiptsForJob(job.jobId)).filter((record) => {
    if (currentAssignmentIds.size > 0 && !currentAssignmentIds.has(record.assignmentId)) return false;
    if (job.assignmentAttemptId !== undefined
      && record.assignmentAttemptId !== undefined
      && Number(job.assignmentAttemptId) !== Number(record.assignmentAttemptId)) {
      return false;
    }
    if (job.ringAttemptId && record.ringAttemptId && job.ringAttemptId !== record.ringAttemptId) return false;
    return true;
  });
};

const currentFailedAssignmentIds = (job = {}) => {
  const currentAssignmentIds = new Set(Array.isArray(job.assignmentIds) ? job.assignmentIds : []);
  return new Set((Array.isArray(job.failedAssignmentIds) ? job.failedAssignmentIds : []).filter((assignmentId) => (
    currentAssignmentIds.size === 0 || currentAssignmentIds.has(assignmentId)
  )));
};

const currentCommitmentsForJob = async (store, job = {}) => {
  if (typeof store.listCommitmentsForJob !== 'function') return [];
  const currentAssignmentIds = new Set(Array.isArray(job.assignmentIds) ? job.assignmentIds : []);
  return (await store.listCommitmentsForJob(job.jobId)).filter((record) => {
    if (currentAssignmentIds.size > 0 && !currentAssignmentIds.has(record.assignmentId)) return false;
    if (job.assignmentAttemptId !== undefined
      && record.assignmentAttemptId !== undefined
      && Number(job.assignmentAttemptId) !== Number(record.assignmentAttemptId)) {
      return false;
    }
    if (job.ringAttemptId && record.ringAttemptId && job.ringAttemptId !== record.ringAttemptId) return false;
    return true;
  });
};

export const currentRevealsForJob = async (store, job = {}) => {
  if (typeof store.listRevealsForJob !== 'function') return [];
  const currentAssignmentIds = new Set(Array.isArray(job.assignmentIds) ? job.assignmentIds : []);
  return (await store.listRevealsForJob(job.jobId)).filter((record) => {
    if (currentAssignmentIds.size > 0 && !currentAssignmentIds.has(record.assignmentId)) return false;
    if (job.assignmentAttemptId !== undefined
      && record.assignmentAttemptId !== undefined
      && Number(job.assignmentAttemptId) !== Number(record.assignmentAttemptId)) {
      return false;
    }
    if (job.ringAttemptId && record.ringAttemptId && job.ringAttemptId !== record.ringAttemptId) return false;
    return true;
  });
};

export const phaseProtocolForAssignment = (assignment = {}) => (
  assignment?.ring?.ringPhaseProtocolId ? getRingPhaseProtocol(assignment.ring.ringPhaseProtocolId) : null
);

export const commitmentBarrierReached = async ({ store, job, assignment } = {}) => {
  const protocol = phaseProtocolForAssignment(assignment);
  if (!protocol) return { reached: true, commitments: [], required: 0 };
  const commitments = await currentCommitmentsForJob(store, job);
  const required = protocol.minCommitments === 'requiredAgreement'
    ? Number(job?.agreement?.requiredAgreement || assignment?.requiredAgreement || 1)
    : Number(protocol.minCommitments || job?.agreement?.requiredAgreement || assignment?.requiredAgreement || 1);
  return {
    reached: commitments.length >= required,
    commitments,
    required
  };
};

export const ensureAgreementCommitRevealReady = async ({ store, job, agreedRecords = [] } = {}) => {
  const reasons = [];
  if (job?.agreement?.mode !== 'ring_quorum') return reasons;
  const protocol = job?.ring?.ringPhaseProtocolId ? getRingPhaseProtocol(job.ring.ringPhaseProtocolId) : null;
  if (!protocol?.requireCommitmentForLedgerAward) return reasons;
  for (const record of agreedRecords) {
    const commitment = await store.getAssignmentCommitment?.(record.assignmentId);
    const reveal = await store.getAssignmentReveal?.(record.assignmentId);
    if (!commitment) reasons.push(`commitment missing for ${record.assignmentId}`);
    if (!reveal) reasons.push(`reveal missing for ${record.assignmentId}`);
    if (commitment && reveal) {
      const match = revealMatchesCommitment({ commitment, reveal });
      if (!match.ok) reasons.push(`reveal commitment mismatch for ${record.assignmentId}`);
    }
  }
  return reasons;
};

export const statusForPendingAgreement = (agreement = {}) => (
  agreement.mode === 'ring_quorum' ? 'awaiting_ring_quorum_receipts' : 'awaiting_redundant_receipts'
);

export const statusForRejectedAgreement = (agreement = {}) => (
  agreement.mode === 'ring_quorum' ? 'ring_quorum_disagreement' : 'redundant_disagreement'
);

const mismatchReasonForAgreement = (agreement = {}) => (
  agreement.mode === 'ring_quorum' ? 'ring quorum mismatch' : 'redundant agreement mismatch'
);

const penaltyReasonForAgreement = (agreement = {}) => (
  getLedgerReasons(agreement.mode || 'redundant').mismatchPenalty || 'receipt_rejected'
);

export const acceptedLedgerReasonForJob = (job = {}, receiptCount = 1) => {
  if (receiptCount <= 1) return getLedgerReasons('single').award || 'accepted_receipt';
  return getLedgerReasons(job?.agreement?.mode || 'redundant').award || 'accepted_receipt';
};

export const spendLedgerReasonForJob = (job = {}, receiptCount = 1) => {
  if (receiptCount <= 1) return getLedgerReasons('single').spend || 'accepted_receipt_spend';
  return getLedgerReasons(job?.agreement?.mode || 'redundant').spend || 'accepted_receipt_spend';
};

const retireSupersededAssignments = async ({ store, job, agreement } = {}) => {
  const currentAssignmentIds = Array.isArray(job?.assignmentIds) ? job.assignmentIds : [];
  if (currentAssignmentIds.length === 0 || agreement?.status !== 'accepted') return [];
  const acceptedReceiptHashes = new Set(Array.isArray(agreement.receiptHashes) ? agreement.receiptHashes : []);
  const receiptRecords = await currentReceiptsForJob(store, job);
  const acceptedAssignmentIds = new Set(receiptRecords
    .filter((record) => acceptedReceiptHashes.has(record.receiptHash))
    .map((record) => record.assignmentId)
    .filter(Boolean));
  const supersededAssignmentIds = [];
  for (const assignmentId of currentAssignmentIds) {
    if (acceptedAssignmentIds.has(assignmentId)) continue;
    const sibling = await store.getAssignment(assignmentId);
    if (!sibling || !activeAssignmentStatuses.has(sibling.status)) continue;
    await store.updateAssignment(assignmentId, {
      status: 'superseded',
      supersededByReceiptHashes: Array.from(acceptedReceiptHashes),
      supersededAt: new Date().toISOString()
    });
    if (sibling.providerId) await store.setProviderStatus(sibling.providerId, 'available');
    supersededAssignmentIds.push(assignmentId);
  }
  return supersededAssignmentIds;
};

export const evaluateAgreement = async ({ store, job, policy }) => {
  const currentAssignmentIds = new Set(Array.isArray(job?.assignmentIds) ? job.assignmentIds : []);
  const receiptRecords = await currentReceiptsForJob(store, job);
  const commitmentRecords = await currentCommitmentsForJob(store, job);
  const revealRecords = await currentRevealsForJob(store, job);
  const acceptedRecords = receiptRecords.filter((record) => record.verifierDecision?.accepted);
  const rejectedRecords = receiptRecords.filter((record) => record.verifierDecision && !record.verifierDecision.accepted);
  const failedAssignmentIds = currentFailedAssignmentIds(job);
  const blockedAssignmentIds = new Set([
    ...receiptRecords.map((record) => record.assignmentId).filter(Boolean),
    ...failedAssignmentIds
  ]);
  const required = Number(job?.agreement?.requiredAgreement || job?.agreement?.requiredProviders || policy.redundancy || 1);
  const providerCount = Number(job?.providerCount || job?.providerIds?.length || required);
  const agreementField = job?.agreement?.agreementField || policy.agreementField || 'tokenIdsHash';
  const mode = job?.agreement?.mode || (policy.adaptiveRing ? 'ring_quorum' : 'redundant');
  const groups = new Map();
  for (const record of acceptedRecords) {
    const primary = record.receipt?.[agreementField] || record.receipt?.tokenIdsHash || '';
    const key = `${primary}::${record.receipt?.outputHash || ''}`;
    const group = groups.get(key) || [];
    group.push(record);
    groups.set(key, group);
  }
  const matchingGroup = Array.from(groups.values()).find((group) => group.length >= required);
  const receiptHashes = acceptedRecords.map((record) => record.receiptHash);
  const rejectedReceiptHashes = rejectedRecords.map((record) => record.receiptHash);
  const failedAssignments = Array.from(failedAssignmentIds);
  const largestGroupSize = Math.max(0, ...Array.from(groups.values()).map((group) => group.length));
  const remainingProviders = Math.max(0, providerCount - blockedAssignmentIds.size);
  const base = {
    mode,
    requiredProviders: required,
    requiredAgreement: required,
    providerCount,
    agreementField,
    acceptedReceipts: acceptedRecords.length,
    rejectedReceipts: rejectedRecords.length,
    commitments: commitmentRecords.length,
    reveals: revealRecords.length,
    commitmentHashes: commitmentRecords.map((record) => record.commitmentHash),
    failedAssignments: failedAssignments.length,
    remainingProviders,
    receiptHashes,
    rejectedReceiptHashes,
    failedAssignmentIds: failedAssignments,
    effectiveTrustTier: job?.effectiveTrustTier || job?.trustTier || policy.trustTier
  };
  if (matchingGroup) {
    const agreementValue = matchingGroup[0].receipt?.[agreementField] || matchingGroup[0].receipt?.tokenIdsHash || null;
    return {
      ...base,
      status: 'accepted',
      acceptedReceipts: matchingGroup.length,
      receiptHash: matchingGroup[0].receiptHash,
      receiptHashes: matchingGroup.slice(0, required).map((record) => record.receiptHash),
      outputHash: matchingGroup[0].receipt?.outputHash,
      tokenIdsHash: matchingGroup[0].receipt?.tokenIdsHash,
      vectorHash: matchingGroup[0].receipt?.vectorHash || null,
      sequenceResultHash: matchingGroup[0].receipt?.sequenceResultHash || null,
      agreementValue
    };
  }
  if (largestGroupSize + remainingProviders >= required) {
    return {
      ...base,
      status: 'pending',
      reason: mode === 'ring_quorum' ? 'waiting for possible ring quorum' : 'waiting for possible redundant agreement'
    };
  }
  return {
    ...base,
    status: 'rejected',
    reason: mode === 'ring_quorum' ? 'ring quorum receipts cannot reach quorum' : 'redundant receipts cannot reach agreement'
  };
};

export const updateJobAfterVerifiedReceipt = async ({ store, assignment, receiptRecord, policy }) => {
  if (assignment.auditId) {
    const canary = await verifyCanaryResult({
      store,
      auditId: assignment.auditId,
      providerId: assignment.providerId,
      outputText: receiptRecord.outputText,
      tokenIds: receiptRecord.tokenIds
    });
    const reputation = await applyCanaryReputation({
      store,
      providerId: assignment.providerId,
      accepted: canary.accepted,
      reasons: canary.reasons,
      kind: canary.audit?.kind,
      auditId: assignment.auditId,
      assignmentId: assignment.assignmentId,
      jobId: assignment.jobId
    });
    const auditFailureReason = canary.audit?.kind === CHALLENGE_AUDIT_KIND
      ? 'challenge_failed'
      : 'canary_failed';
    const penaltyEvent = canary.accepted ? null : await penalizeProvider({
      store,
      providerId: assignment.providerId,
      requesterId: assignment.requesterId,
      receiptHash: receiptRecord.receiptHash,
      assignmentId: assignment.assignmentId,
      reason: auditFailureReason,
      points: -5,
      evidence: { reasons: canary.reasons }
    });
    await store.saveReceipt(receiptRecord.receiptHash, {
      ...receiptRecord,
      canaryDecision: canary,
      reputation,
      penaltyEvent
    });
    await store.updateAssignment(assignment.assignmentId, {
      status: canary.accepted ? 'audit_passed' : 'audit_failed',
      receiptHash: receiptRecord.receiptHash,
      canaryDecision: canary
    });
    await store.updateJob(assignment.jobId, {
      status: canary.accepted ? 'audit_passed' : 'audit_failed',
      receiptHash: receiptRecord.receiptHash,
      outputText: receiptRecord.outputText,
      canaryDecision: canary,
      retryable: !canary.accepted
    });
    return { mode: 'canary', canary, reputation };
  }

  const job = await store.getJob(assignment.jobId);
  if (Number(job?.agreement?.requiredAgreement || policy.redundancy || 1) > 1) {
    const agreement = await evaluateAgreement({ store, job, policy });
    if (agreement.status === 'accepted') {
      const representative = await store.getReceipt(agreement.receiptHash);
      const supersededAssignmentIds = await retireSupersededAssignments({ store, job, agreement });
      await store.updateJob(assignment.jobId, {
        status: 'receipt_verified',
        receiptHash: agreement.receiptHash,
        receiptHashes: agreement.receiptHashes,
        outputText: representative?.outputText || receiptRecord.outputText,
        trustTier: agreement.effectiveTrustTier,
        effectiveTrustTier: agreement.effectiveTrustTier,
        agreement,
        supersededAssignmentIds,
        verifierDecision: { accepted: true, reasons: [], verifiedAt: new Date().toISOString(), agreement }
      });
    } else if (agreement.status === 'rejected') {
      const disagreeingReceipts = await currentReceiptsForJob(store, job);
      const rejectedProviderIds = Array.from(new Set(disagreeingReceipts
        .filter((entry) => entry.verifierDecision?.accepted)
        .map((entry) => entry.providerId)
        .filter(Boolean)
        .concat(Array.isArray(job?.rejectedProviderIds) ? job.rejectedProviderIds : [])));
      for (const record of disagreeingReceipts.filter((entry) => entry.verifierDecision?.accepted)) {
        await recordRejectedReceipt({
          store,
          providerId: record.providerId,
          receiptHash: record.receiptHash,
          assignmentId: record.assignmentId,
          jobId: record.jobId,
          reasons: [mismatchReasonForAgreement(agreement)]
        });
        await penalizeProvider({
          store,
          providerId: record.providerId,
          requesterId: record.requesterId,
          receiptHash: record.receiptHash,
          assignmentId: record.assignmentId,
          reason: penaltyReasonForAgreement(agreement),
          points: -2,
          evidence: { agreement }
        });
      }
      await store.updateJob(assignment.jobId, {
        status: statusForRejectedAgreement(agreement),
        reason: agreement.reason,
        retryable: true,
        receiptHashes: agreement.receiptHashes,
        rejectedReceiptHashes: agreement.rejectedReceiptHashes,
        failedAssignmentIds: agreement.failedAssignmentIds,
        rejectedProviderIds,
        agreement,
        verifierDecision: { accepted: false, reasons: [agreement.reason], verifiedAt: new Date().toISOString(), agreement }
      });
    } else {
      await store.updateJob(assignment.jobId, {
        status: statusForPendingAgreement(agreement),
        receiptHashes: agreement.receiptHashes,
        rejectedReceiptHashes: agreement.rejectedReceiptHashes,
        failedAssignmentIds: agreement.failedAssignmentIds,
        agreement
      });
    }
    return { mode: agreement.mode || 'redundant', agreement };
  }

  await store.updateJob(assignment.jobId, {
    status: 'receipt_verified',
    receiptHash: receiptRecord.receiptHash,
    receiptHashes: [receiptRecord.receiptHash],
    outputText: receiptRecord.outputText,
    verifierDecision: receiptRecord.verifierDecision
  });
  return { mode: 'single' };
};

