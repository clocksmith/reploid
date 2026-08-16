/**
 * @fileoverview Receipt, failure, acceptance, and receipt-read route registration.
 *
 * Receipt verification establishes bounded execution evidence. It does not
 * establish biological truth, experimental validation, or honest hardware.
 */

export function registerReceiptRoutes(router, {
  store,
  asyncRoute,
  requireBoundRole,
  requireBoundAnyRole,
  getPolicy,
  activeAssignmentStatuses,
  finalizedJobStatuses,
  assignmentMatchesCurrentJobAttempt,
  phaseProtocolForAssignment,
  verifyReceipt,
  updateJobAfterVerifiedReceipt,
  recordRejectedReceipt,
  penalizeProvider,
  evaluateAgreement,
  statusForPendingAgreement,
  statusForRejectedAgreement,
  assignQueuedJobs,
  recoverHostedAssignments,
  buildAcceptanceSummary,
  ensureAgreementCommitRevealReady,
  verifyRequesterAcceptance,
  awardAcceptedReceipt,
  recordAcceptedReceipt,
  chargeRequester,
  acceptedLedgerReasonForJob,
  spendLedgerReasonForJob,
  hasCoordinatorClaim,
  authMatchesRoleId,
  authMatchesAnyRoleId,
  poolConfigVersion,
  poolConfigHash
} = {}) {
  if (!router) throw new Error('receipt routes require an Express router');
  for (const [name, value] of Object.entries({
    asyncRoute,
    requireBoundRole,
    requireBoundAnyRole,
    getPolicy,
    assignmentMatchesCurrentJobAttempt,
    phaseProtocolForAssignment,
    verifyReceipt,
    updateJobAfterVerifiedReceipt,
    recordRejectedReceipt,
    penalizeProvider,
    evaluateAgreement,
    statusForPendingAgreement,
    statusForRejectedAgreement,
    assignQueuedJobs,
    recoverHostedAssignments,
    buildAcceptanceSummary,
    ensureAgreementCommitRevealReady,
    verifyRequesterAcceptance,
    awardAcceptedReceipt,
    recordAcceptedReceipt,
    chargeRequester,
    acceptedLedgerReasonForJob,
    spendLedgerReasonForJob,
    hasCoordinatorClaim,
    authMatchesRoleId,
    authMatchesAnyRoleId
  })) {
    if (typeof value !== 'function') throw new Error(`receipt routes require ${name}`);
  }
  if (!(activeAssignmentStatuses instanceof Set)) throw new Error('receipt routes require active assignment statuses');
  if (!(finalizedJobStatuses instanceof Set)) throw new Error('receipt routes require finalized job statuses');
  const POOL_CONFIG_VERSION = poolConfigVersion;
  const POOL_CONFIG_HASH = poolConfigHash;

  router.post('/assignments/:assignmentId/receipt', asyncRoute(async (req, res) => {
    const pendingAssignment = await store.getAssignment(req.params.assignmentId);
    const entryRecovery = await recoverHostedAssignments({
      store,
      targetJobId: pendingAssignment?.jobId || null
    });
    const assignment = await store.getAssignment(req.params.assignmentId);
    if (!assignment) return res.status(404).json({ error: 'assignment not found' });
    if (!requireBoundRole(req, res, 'provider', assignment.providerId)) return null;
    const policy = getPolicy(assignment.policyId);
    if (!policy) return res.status(400).json({ error: 'assignment policy is no longer supported' });
    if (!activeAssignmentStatuses.has(assignment.status)) {
      return res.status(409).json({
        error: 'assignment is not active',
        assignmentStatus: assignment.status,
        assignmentId: assignment.assignmentId,
        assignmentRecovery: entryRecovery.summary
      });
    }
    const assignmentJob = await store.getJob(assignment.jobId);
    if (!assignmentJob) return res.status(404).json({ error: 'job not found', jobId: assignment.jobId });
    if (!assignmentMatchesCurrentJobAttempt(assignment, assignmentJob)) {
      await store.updateAssignment(assignment.assignmentId, {
        status: 'stale',
        staleReason: 'assignment_attempt_mismatch',
        staleAt: new Date().toISOString()
      });
      await store.setProviderStatus(assignment.providerId, 'available');
      return res.status(409).json({
        error: 'assignment does not match current job attempt',
        assignmentId: assignment.assignmentId,
        assignmentAttemptId: assignment.assignmentAttemptId || null,
        currentAssignmentAttemptId: assignmentJob.assignmentAttemptId || null,
        ringAttemptId: assignment.ringAttemptId || null,
        currentRingAttemptId: assignmentJob.ringAttemptId || null,
        assignmentRecovery: entryRecovery.summary
      });
    }
    if (finalizedJobStatuses.has(assignmentJob.status)) {
      return res.status(409).json({
        error: 'job is already finalized',
        jobId: assignment.jobId,
        jobStatus: assignmentJob.status
      });
    }
    const phaseProtocol = phaseProtocolForAssignment(assignment);
    if (phaseProtocol?.requireRevealBeforeReceipt && assignment.status !== 'reveal_submitted') {
      return res.status(409).json({
        error: 'ring reveal must be submitted before receipt',
        assignmentStatus: assignment.status,
        ringPhase: assignmentJob.ringPhase || null
      });
    }
    const receipt = req.body?.receipt;
    const outputText = req.body?.outputText || '';
    const tokenIds = Array.isArray(req.body?.tokenIds) ? req.body.tokenIds : [];
    const outputKind = req.body?.outputKind || receipt?.outputKind || 'sequence.embedding.v1';
    const vectorHash = req.body?.vectorHash || receipt?.vectorHash || null;
    const sequenceResultHash = req.body?.sequenceResultHash || receipt?.sequenceResultHash || null;
    const sequenceResult = req.body?.sequenceResult || receipt?.sequence || null;
    const transcript = req.body?.transcript || { outputText, tokenIds };
    const provider = await store.getProvider(assignment.providerId);
    const decision = await verifyReceipt({
      store,
      assignment,
      receipt,
      outputText,
      tokenIds,
      vectorHash,
      sequenceResultHash,
      sequenceResult,
      transcript
    });
    const receiptRecord = await store.saveReceipt(decision.receiptHash, {
      assignmentId: assignment.assignmentId,
      jobId: assignment.jobId,
      providerId: assignment.providerId,
      requesterId: assignment.requesterId,
      assignmentAttemptId: assignment.assignmentAttemptId || null,
      ringAttemptId: assignment.ringAttemptId || null,
      policyConfigVersion: assignmentJob.policyConfigVersion || POOL_CONFIG_VERSION,
      policyConfigHash: assignmentJob.policyConfigHash || POOL_CONFIG_HASH,
      effectiveTrustTier: assignment.ring?.effectiveTrustTier || assignment.trustTier || assignmentJob.effectiveTrustTier || assignmentJob.trustTier || null,
      providerAdmission: assignment.providerAdmission || null,
      outputText,
      tokenIds,
      outputKind,
      vectorHash,
      sequenceResultHash,
      sequenceResult,
      embeddingDimensions: req.body?.embeddingDimensions || receipt?.embedding?.dimensions || null,
      embeddingStats: req.body?.embeddingStats || receipt?.embedding?.stats || null,
      transcript,
      receipt,
      providerPublicKey: provider?.publicKey || null,
      verifierDecision: decision
    });
    await store.updateAssignment(assignment.assignmentId, {
      status: decision.accepted ? 'receipt_verified' : 'receipt_rejected',
      receiptHash: decision.receiptHash
    });
    await store.setProviderStatus(assignment.providerId, 'available');

    let routeDecision = null;
    if (assignmentJob.agreement?.status === 'accepted') {
      if (!decision.accepted) {
        await recordRejectedReceipt({
          store,
          providerId: assignment.providerId,
          receiptHash: decision.receiptHash,
          assignmentId: assignment.assignmentId,
          jobId: assignment.jobId,
          reasons: decision.reasons
        });
        await penalizeProvider({
          store,
          providerId: assignment.providerId,
          requesterId: assignment.requesterId,
          receiptHash: decision.receiptHash,
          assignmentId: assignment.assignmentId,
          reason: 'late_non_quorum_receipt_rejected',
          points: -1,
          evidence: { reasons: decision.reasons, agreement: assignmentJob.agreement }
        });
      }
      routeDecision = {
        mode: decision.accepted ? 'late_non_quorum_receipt_ignored' : 'late_non_quorum_receipt_rejected',
        agreement: assignmentJob.agreement
      };
      return res.status(decision.accepted ? 409 : 400).json({ receipt: receiptRecord, verifierDecision: decision, routeDecision });
    }

    if (!decision.accepted) {
      const currentJob = await store.getJob(assignment.jobId);
      const rejectedProviderIds = Array.from(new Set([
        ...(Array.isArray(currentJob?.rejectedProviderIds) ? currentJob.rejectedProviderIds : []),
        assignment.providerId
      ].filter(Boolean)));
      await store.updateJob(assignment.jobId, {
        receiptHash: decision.receiptHash,
        rejectedProviderIds
      });
      await recordRejectedReceipt({
        store,
        providerId: assignment.providerId,
        receiptHash: decision.receiptHash,
        assignmentId: assignment.assignmentId,
        jobId: assignment.jobId,
        reasons: decision.reasons
      });
      await penalizeProvider({
        store,
        providerId: assignment.providerId,
        requesterId: assignment.requesterId,
        receiptHash: decision.receiptHash,
        assignmentId: assignment.assignmentId,
        reason: 'receipt_rejected',
        points: -1,
        evidence: { reasons: decision.reasons }
      });
      const refreshedJob = await store.getJob(assignment.jobId);
      if (Number(refreshedJob?.agreement?.requiredAgreement || policy.redundancy || 1) > 1) {
        const agreement = await evaluateAgreement({ store, job: refreshedJob, policy });
        if (agreement.status === 'rejected') {
          await store.updateJob(assignment.jobId, {
            status: statusForRejectedAgreement(agreement),
            reason: agreement.reason,
            retryable: true,
            receiptHashes: agreement.receiptHashes,
            rejectedReceiptHashes: agreement.rejectedReceiptHashes,
            failedAssignmentIds: agreement.failedAssignmentIds,
            agreement,
            verifierDecision: { accepted: false, reasons: [agreement.reason], verifiedAt: new Date().toISOString(), agreement }
          });
          routeDecision = {
            mode: agreement.mode,
            agreement,
            reassignment: { drained: (await assignQueuedJobs({ store })).length }
          };
        } else {
          await store.updateJob(assignment.jobId, {
            status: statusForPendingAgreement(agreement),
            retryable: false,
            receiptHashes: agreement.receiptHashes,
            rejectedReceiptHashes: agreement.rejectedReceiptHashes,
            failedAssignmentIds: agreement.failedAssignmentIds,
            agreement
          });
          routeDecision = {
            mode: agreement.mode,
            agreement,
            reassignment: { drained: 0 }
          };
        }
      } else {
        await store.updateJob(assignment.jobId, {
          status: 'receipt_rejected',
          outputText,
          verifierDecision: decision,
          retryable: true,
          rejectedProviderIds
        });
        routeDecision = {
          mode: 'receipt_rejected',
          reassignment: { drained: (await assignQueuedJobs({ store })).length }
        };
      }
    } else {
      routeDecision = await updateJobAfterVerifiedReceipt({ store, assignment, receiptRecord, policy });
    }
    return res.status(decision.accepted ? 200 : 400).json({ receipt: receiptRecord, verifierDecision: decision, routeDecision });
  }));

  router.post('/assignments/:assignmentId/failure', asyncRoute(async (req, res) => {
    const pendingAssignment = await store.getAssignment(req.params.assignmentId);
    const entryRecovery = await recoverHostedAssignments({
      store,
      targetJobId: pendingAssignment?.jobId || null
    });
    const assignment = await store.getAssignment(req.params.assignmentId);
    if (!assignment) return res.status(404).json({ error: 'assignment not found' });
    if (!requireBoundRole(req, res, 'provider', assignment.providerId)) return null;
    if (!activeAssignmentStatuses.has(assignment.status)) {
      return res.status(409).json({
        error: 'assignment is not active',
        assignmentStatus: assignment.status,
        assignmentId: assignment.assignmentId,
        assignmentRecovery: entryRecovery.summary
      });
    }
    const currentJob = await store.getJob(assignment.jobId);
    if (!currentJob) return res.status(404).json({ error: 'job not found', jobId: assignment.jobId });
    if (!assignmentMatchesCurrentJobAttempt(assignment, currentJob)) {
      await store.updateAssignment(assignment.assignmentId, {
        status: 'stale',
        staleReason: 'assignment_attempt_mismatch',
        staleAt: new Date().toISOString()
      });
      await store.setProviderStatus(assignment.providerId, 'available');
      return res.status(409).json({
        error: 'assignment does not match current job attempt',
        assignmentId: assignment.assignmentId,
        assignmentAttemptId: assignment.assignmentAttemptId || null,
        currentAssignmentAttemptId: currentJob.assignmentAttemptId || null,
        ringAttemptId: assignment.ringAttemptId || null,
        currentRingAttemptId: currentJob.ringAttemptId || null,
        assignmentRecovery: entryRecovery.summary
      });
    }
    const reason = String(req.body?.reason || 'provider_execution_failed').slice(0, 300);
    const providerFault = req.body?.providerFault !== false;
    const rejectedProviderIds = providerFault
      ? Array.from(new Set([
        ...(Array.isArray(currentJob?.rejectedProviderIds) ? currentJob.rejectedProviderIds : []),
        assignment.providerId
      ].filter(Boolean)))
      : (Array.isArray(currentJob?.rejectedProviderIds) ? currentJob.rejectedProviderIds : []);
    const failedAssignmentIds = Array.from(new Set([
      ...(Array.isArray(currentJob?.failedAssignmentIds) ? currentJob.failedAssignmentIds : []),
      assignment.assignmentId
    ].filter(Boolean)));
    await store.updateAssignment(assignment.assignmentId, {
      status: 'failed',
      failureReason: reason,
      providerFault,
      failedAt: new Date().toISOString()
    });
    await store.updateJob(assignment.jobId, {
      rejectedProviderIds,
      failedAssignmentIds,
      providerFailure: {
        providerId: assignment.providerId,
        assignmentId: assignment.assignmentId,
        reason,
        providerFault
      }
    });
    await store.setProviderStatus(assignment.providerId, 'available');
    let reputation = await store.getReputation(assignment.providerId);
    let penalty = null;
    if (providerFault) {
      reputation = await recordRejectedReceipt({
        store,
        providerId: assignment.providerId,
        assignmentId: assignment.assignmentId,
        jobId: assignment.jobId,
        reasons: [reason]
      });
      penalty = await penalizeProvider({
        store,
        providerId: assignment.providerId,
        requesterId: assignment.requesterId,
        assignmentId: assignment.assignmentId,
        reason: 'provider_execution_failed',
        points: -1,
        evidence: { reason }
      });
    }
    const refreshedJob = await store.getJob(assignment.jobId);
    let routeDecision = null;
    let reassignment = [];
    const policy = getPolicy(assignment.policyId);
    if (policy && Number(refreshedJob?.agreement?.requiredAgreement || policy.redundancy || 1) > 1) {
      const agreement = await evaluateAgreement({ store, job: refreshedJob, policy });
      if (agreement.status === 'rejected') {
        await store.updateJob(assignment.jobId, {
          status: statusForRejectedAgreement(agreement),
          reason: agreement.reason,
          retryable: true,
          receiptHashes: agreement.receiptHashes,
          rejectedReceiptHashes: agreement.rejectedReceiptHashes,
          failedAssignmentIds: agreement.failedAssignmentIds,
          agreement,
          verifierDecision: { accepted: false, reasons: [agreement.reason], verifiedAt: new Date().toISOString(), agreement }
        });
        reassignment = await assignQueuedJobs({ store });
      } else {
        await store.updateJob(assignment.jobId, {
          status: statusForPendingAgreement(agreement),
          reason,
          retryable: false,
          receiptHashes: agreement.receiptHashes,
          rejectedReceiptHashes: agreement.rejectedReceiptHashes,
          failedAssignmentIds: agreement.failedAssignmentIds,
          agreement
        });
      }
      routeDecision = { mode: agreement.mode, agreement };
    } else {
      await store.updateJob(assignment.jobId, {
        status: 'failed',
        reason,
        retryable: true,
        rejectedProviderIds,
        failedAssignmentIds
      });
      reassignment = await assignQueuedJobs({ store });
      routeDecision = { mode: 'provider_execution_failed' };
    }
    return res.json({
      assignment: await store.getAssignment(assignment.assignmentId),
      job: await store.getJob(assignment.jobId),
      reputation,
      penalty,
      routeDecision,
      reassignment: { drained: reassignment.length }
    });
  }));

  router.post('/receipts/:receiptHash/accept', asyncRoute(async (req, res) => {
    const receiptRecord = await store.getReceipt(req.params.receiptHash);
    if (!receiptRecord) return res.status(404).json({ error: 'receipt not found' });
    if (!receiptRecord.verifierDecision?.accepted) {
      return res.status(400).json({ error: 'receipt is not verifier-accepted' });
    }
    const job = await store.getJob(receiptRecord.jobId);
    if (job?.requesterId && !requireBoundAnyRole(req, res, ['requester', 'agent'], job.requesterId)) return null;
    if (job?.status === 'accepted' || job?.status === 'acceptance_processing' || job?.status === 'rejected_by_requester') {
      return res.status(409).json({ error: 'job already finalized', job });
    }
    const acceptancePayload = {
      ...req.body,
      accepted: req.body?.accepted === true,
      requesterId: req.body?.requesterId || receiptRecord.requesterId
    };
    let acceptanceSummary = null;
    if (acceptancePayload.accepted === true) {
      if (job?.agreement && job.agreement.status !== 'accepted') {
        return res.status(409).json({
          error: 'selected policy has not reached an accepted final state',
          agreement: job.agreement
        });
      }
      acceptanceSummary = await buildAcceptanceSummary({
        store,
        job,
        receiptHash: req.params.receiptHash
      });
      if (!acceptanceSummary.receiptHashes.includes(req.params.receiptHash)) {
        return res.status(400).json({ error: 'receipt is not part of the accepted agreement set' });
      }
      if (acceptanceSummary.agreedRecords.length !== acceptanceSummary.receiptHashes.length) {
        return res.status(409).json({
          error: 'accepted agreement set is missing verifier-accepted receipts',
          receiptHashes: acceptanceSummary.receiptHashes
        });
      }
      const commitRevealReasons = await ensureAgreementCommitRevealReady({
        store,
        job,
        agreedRecords: acceptanceSummary.agreedRecords
      });
      if (commitRevealReasons.length > 0) {
        return res.status(409).json({
          error: 'accepted agreement set is missing required commit-reveal evidence',
          reasons: commitRevealReasons
        });
      }
    }
    const acceptanceDecision = await verifyRequesterAcceptance({
      job,
      acceptance: acceptancePayload,
      expectedAcceptance: acceptanceSummary
    });
    if (!acceptanceDecision.accepted) {
      return res.status(400).json({
        error: 'requester acceptance rejected',
        verifierDecision: acceptanceDecision
      });
    }
    if (acceptancePayload.accepted !== true) {
      const acceptance = await store.saveAcceptance(req.params.receiptHash, acceptancePayload);
      await store.saveReceipt(req.params.receiptHash, {
        ...receiptRecord,
        requesterAcceptance: acceptance,
        ledgerEvent: null
      });
      await store.updateJob(receiptRecord.jobId, {
        status: 'rejected_by_requester',
        requesterAcceptance: acceptance
      });
      return res.json({ acceptance, ledgerEvent: null, reputation: await store.getReputation(receiptRecord.providerId) });
    }

    const {
      receiptHashes,
      agreedRecords,
      multiplier,
      totalProviderPoints
    } = acceptanceSummary;
    if (job?.maxPointSpend !== null && job?.maxPointSpend !== undefined && totalProviderPoints > Number(job.maxPointSpend)) {
      return res.status(402).json({
        error: 'accepted result exceeds requester maxPointSpend',
        maxPointSpend: job.maxPointSpend,
        requiredPoints: totalProviderPoints
      });
    }
    if (typeof store.claimJobForAcceptance === 'function') {
      const claimedJob = await store.claimJobForAcceptance(job.jobId);
      if (!claimedJob) {
        return res.status(409).json({ error: 'job acceptance was already claimed', job: await store.getJob(job.jobId) });
      }
    }
    const acceptance = await store.saveAcceptance(req.params.receiptHash, acceptancePayload);
    const ledgerEvents = [];
    const reputations = [];
    for (const agreedRecord of agreedRecords) {
      const ledgerEvent = await awardAcceptedReceipt({
        store,
        receiptRecord: agreedRecord,
        acceptance,
        multiplier,
        points: acceptanceSummary.providerPoints.find((entry) => entry.receiptHash === agreedRecord.receiptHash)?.points,
        reason: acceptedLedgerReasonForJob(job, receiptHashes.length)
      });
      const reputation = await recordAcceptedReceipt({
        store,
        providerId: agreedRecord.providerId,
        receiptHash: agreedRecord.receiptHash,
        points: ledgerEvent.points
      });
      await store.saveReceipt(agreedRecord.receiptHash, {
        ...agreedRecord,
        requesterAcceptance: acceptance,
        ledgerEvent,
        reputation
      });
      ledgerEvents.push(ledgerEvent);
      reputations.push(reputation);
    }
    const requesterSpendEvent = await chargeRequester({
      store,
      requesterId: job.requesterId,
      receiptHash: req.params.receiptHash,
      receiptHashes,
      points: totalProviderPoints,
      acceptance,
      reason: spendLedgerReasonForJob(job, receiptHashes.length)
    });
    await store.updateJob(receiptRecord.jobId, {
      status: 'accepted',
      requesterAcceptance: acceptance,
      ledgerEvents,
      requesterSpendEvent,
      acceptedReceiptHashes: receiptHashes
    });
    return res.json({ acceptance, ledgerEvents, requesterSpendEvent, reputations });
  }));

  router.get('/receipts/:receiptHash', asyncRoute(async (req, res) => {
    const receipt = await store.getReceipt(req.params.receiptHash);
    if (!receipt) return res.status(404).json({ error: 'receipt not found' });
    if (req.poolAuth?.verified && !hasCoordinatorClaim(req.poolAuth)) {
      const participant = authMatchesRoleId(req.poolAuth, 'provider', receipt.providerId)
        || authMatchesAnyRoleId(req.poolAuth, ['requester', 'agent'], receipt.requesterId);
      if (!participant) return res.status(403).json({ error: 'authenticated identity is not a receipt participant' });
    }
    return res.json(receipt);
  }));

}

export default registerReceiptRoutes;
