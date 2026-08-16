/**
 * @fileoverview Persistence-neutral decisions for Pool coordinator state.
 *
 * Adapters may differ in atomicity and storage APIs, but must not derive
 * different assignment or agreement outcomes from the same records.
 */

export const EXPIRABLE_ASSIGNMENT_STATUSES = Object.freeze([
  'assigned', 'running', 'commit_submitted', 'reveal_open', 'reveal_submitted'
]);

const finalReceiptStatuses = new Set([
  'receipt_verified', 'accepted', 'acceptance_processing', 'rejected_by_requester'
]);

export const canClaimJobForAssignment = (job = {}) => job.status === 'queued'
  || (job.retryable === true && [
    'failed', 'receipt_rejected', 'redundant_disagreement', 'ring_quorum_disagreement'
  ].includes(job.status));

/**
 * Persistence-neutral job claim transitions. Adapters provide atomic storage,
 * but a memory run and a Firestore run must make the same claim decision.
 */
export const buildAssignmentClaimPatch = (job = {}) => {
  if (!canClaimJobForAssignment(job)) return null;
  return {
    status: 'assignment_processing',
    assignmentAttempts: Number(job.assignmentAttempts || 0)
  };
};

const EXPIRATION_REASON_BY_STATUS = Object.freeze({
  assigned: 'assignment_claim_expired',
  running: 'assignment_execution_expired',
  commit_submitted: 'ring_commit_barrier_expired',
  reveal_open: 'ring_reveal_missed',
  reveal_submitted: 'ring_receipt_missed'
});

export const assignmentExpirationReason = (assignment = {}) => (
  EXPIRATION_REASON_BY_STATUS[assignment.expiredFromStatus || assignment.status]
  || 'assignment_expired'
);

export const buildAssignmentExpirationPatch = (
  assignment = {},
  now = new Date().toISOString()
) => {
  if (!EXPIRABLE_ASSIGNMENT_STATUSES.includes(assignment.status)) return null;
  return {
    status: 'expired',
    expiredFromStatus: assignment.status,
    failureReason: assignmentExpirationReason(assignment),
    expiredAt: now
  };
};

export const canClaimJobForAcceptance = (job = {}) => Boolean(job)
  && !['accepted', 'acceptance_processing', 'rejected_by_requester'].includes(job.status);

export const buildAcceptanceClaimPatch = (job = {}) => {
  if (!canClaimJobForAcceptance(job)) return null;
  return { status: 'acceptance_processing' };
};

/**
 * Adapters may query differently, but must expose the same queued assignment
 * as the next claimable provider dispatch.
 */
export const compareAssignmentDispatchOrder = (left = {}, right = {}) => (
  String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
  || String(left.assignmentId || '').localeCompare(String(right.assignmentId || ''))
);

export const selectNextAssignmentForProvider = (assignments = [], providerId = '') => (
  assignments
    .filter((assignment) => assignment?.providerId === providerId && assignment.status === 'assigned')
    .sort(compareAssignmentDispatchOrder)[0] || null
);

export const buildAssignmentStartPatch = (assignment = {}, now = new Date().toISOString()) => {
  if (!assignment || assignment.status !== 'assigned') return null;
  return { status: 'running', startedAt: assignment.startedAt || now };
};

export const agreementModeForJob = (job = {}) => (
  job?.agreement?.mode || (job?.policyId === 'ring_quorum_receipt' ? 'ring_quorum' : 'redundant')
);

const pendingStatusFor = (job = {}) => (
  agreementModeForJob(job) === 'ring_quorum' ? 'awaiting_ring_quorum_receipts' : 'awaiting_redundant_receipts'
);

const rejectedStatusFor = (job = {}) => (
  agreementModeForJob(job) === 'ring_quorum' ? 'ring_quorum_disagreement' : 'redundant_disagreement'
);

const currentAssignmentSet = (job = {}) => new Set(Array.isArray(job.assignmentIds) ? job.assignmentIds : []);

export const assignmentIsCurrent = (assignment = {}, job = {}) => {
  const current = currentAssignmentSet(job);
  if (current.size > 0 && !current.has(assignment.assignmentId)) return false;
  if (job.assignmentAttemptId !== undefined && assignment.assignmentAttemptId !== undefined
    && Number(job.assignmentAttemptId) !== Number(assignment.assignmentAttemptId)) return false;
  return !(job.ringAttemptId && assignment.ringAttemptId && job.ringAttemptId !== assignment.ringAttemptId);
};

export const receiptsForCurrentAttempt = (receiptRecords = [], job = {}) => {
  const current = currentAssignmentSet(job);
  return receiptRecords.filter((record) => {
    if (record.jobId !== job.jobId) return false;
    if (current.size > 0 && !current.has(record.assignmentId)) return false;
    if (job.assignmentAttemptId !== undefined && record.assignmentAttemptId !== undefined
      && Number(job.assignmentAttemptId) !== Number(record.assignmentAttemptId)) return false;
    return !(job.ringAttemptId && record.ringAttemptId && job.ringAttemptId !== record.ringAttemptId);
  });
};

export const buildExpiredAssignmentJobPatch = ({
  job, assignment, receiptRecords = [], now = new Date().toISOString()
} = {}) => {
  if (!job || !assignmentIsCurrent(assignment, job)) return null;
  if (finalReceiptStatuses.has(job.status) || job?.agreement?.status === 'accepted') return null;
  const failedAssignmentIds = Array.from(new Set([
    ...(Array.isArray(job.failedAssignmentIds) ? job.failedAssignmentIds : []), assignment.assignmentId
  ].filter(Boolean)));
  const timedOutProviderIds = Array.from(new Set([
    ...(Array.isArray(job.timedOutProviderIds) ? job.timedOutProviderIds : []), assignment.providerId
  ].filter(Boolean)));
  const failureReason = assignment.failureReason || assignmentExpirationReason(assignment);
  const assignmentFailure = {
    schema: 'poolday.assignment_failure/v1',
    kind: 'expiration',
    assignmentId: assignment.assignmentId,
    assignmentAttemptId: assignment.assignmentAttemptId || job.assignmentAttemptId || null,
    ringAttemptId: assignment.ringAttemptId || null,
    providerId: assignment.providerId || null,
    expiredFromStatus: assignment.expiredFromStatus || assignment.status || null,
    reason: failureReason,
    observedAt: assignment.expiredAt || now
  };
  const assignmentFailures = [
    ...(Array.isArray(job.assignmentFailures)
      ? job.assignmentFailures.filter((entry) => entry?.assignmentId !== assignment.assignmentId)
      : []),
    assignmentFailure
  ];
  const failurePatch = {
    failedAssignmentIds,
    timedOutProviderIds,
    lastAssignmentFailure: assignmentFailure,
    assignmentFailures
  };
  const required = Number(job?.agreement?.requiredAgreement || job?.agreement?.requiredProviders || 1);
  if (required <= 1) {
    return { status: 'failed', reason: failureReason, retryable: true, ...failurePatch };
  }

  const currentReceipts = receiptsForCurrentAttempt(receiptRecords, job);
  const acceptedRecords = currentReceipts.filter((record) => record.verifierDecision?.accepted);
  const rejectedRecords = currentReceipts.filter((record) => record.verifierDecision && !record.verifierDecision.accepted);
  const agreementField = job?.agreement?.agreementField || 'tokenIdsHash';
  const groups = new Map();
  for (const record of acceptedRecords) {
    const key = `${record.receipt?.[agreementField] || record.receipt?.tokenIdsHash || ''}::${record.receipt?.outputHash || ''}`;
    const group = groups.get(key) || [];
    group.push(record);
    groups.set(key, group);
  }
  const matchingGroup = Array.from(groups.values()).find((group) => group.length >= required);
  const providerCount = Number(job?.providerCount || job?.providerIds?.length || job?.assignmentIds?.length || required);
  const blockedAssignmentIds = new Set([
    ...currentReceipts.map((record) => record.assignmentId).filter(Boolean), ...failedAssignmentIds
  ]);
  const remainingProviders = Math.max(0, providerCount - blockedAssignmentIds.size);
  const largestGroupSize = Math.max(0, ...Array.from(groups.values()).map((group) => group.length));
  const agreementBase = {
    ...(job.agreement || {}), mode: agreementModeForJob(job), requiredProviders: required,
    requiredAgreement: required, providerCount, agreementField, acceptedReceipts: acceptedRecords.length,
    rejectedReceipts: rejectedRecords.length, failedAssignments: failedAssignmentIds.length, remainingProviders,
    receiptHashes: acceptedRecords.map((record) => record.receiptHash),
    rejectedReceiptHashes: rejectedRecords.map((record) => record.receiptHash),
    failedAssignmentIds, effectiveTrustTier: job.effectiveTrustTier || job.trustTier
  };
  if (matchingGroup) {
    const receiptHashes = matchingGroup.slice(0, required).map((record) => record.receiptHash);
    const agreementValue = matchingGroup[0].receipt?.[agreementField] || matchingGroup[0].receipt?.tokenIdsHash || null;
    return {
      status: 'receipt_verified', reason: null, retryable: false, receiptHash: receiptHashes[0], receiptHashes,
      ...failurePatch,
      agreement: {
        ...agreementBase, status: 'accepted', acceptedReceipts: matchingGroup.length, receiptHash: receiptHashes[0],
        receiptHashes, outputHash: matchingGroup[0].receipt?.outputHash,
        tokenIdsHash: matchingGroup[0].receipt?.tokenIdsHash,
        vectorHash: matchingGroup[0].receipt?.vectorHash || null, agreementValue
      }
    };
  }
  if (largestGroupSize + remainingProviders >= required) {
    return {
      status: pendingStatusFor(job), reason: failureReason, retryable: false,
      ...failurePatch,
      agreement: {
        ...agreementBase, status: 'pending',
        reason: agreementModeForJob(job) === 'ring_quorum'
          ? 'waiting for possible ring quorum after assignment expiration'
          : 'waiting for possible redundant agreement after assignment expiration'
      }
    };
  }
  const reason = agreementModeForJob(job) === 'ring_quorum'
    ? 'ring quorum receipts cannot reach quorum after assignment expiration'
    : 'redundant receipts cannot reach agreement after assignment expiration';
  return {
    status: rejectedStatusFor(job), reason, retryable: true, ...failurePatch,
    agreement: { ...agreementBase, status: 'rejected', reason },
    verifierDecision: {
      accepted: false, reasons: [reason], verifiedAt: now,
      agreement: { ...agreementBase, status: 'rejected', reason }
    }
  };
};
