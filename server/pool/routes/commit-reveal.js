/**
 * @fileoverview Ring commit-reveal route registration.
 *
 * Commitments and reveals are durable coordinator evidence. A valid envelope
 * still does not establish biological truth or qualify a model for promotion.
 */

export function registerCommitRevealRoutes(router, {
  store,
  asyncRoute,
  requireBoundRole,
  assignmentMatchesCurrentJobAttempt,
  phaseProtocolForAssignment,
  currentRevealsForJob,
  commitmentBarrierReached,
  validateCommitmentInput,
  validateRevealInput,
  revealMatchesCommitment,
  buildCommitmentHash,
  recordRejectedReceipt,
  penalizeProvider,
  getPolicy,
  evaluateAgreement,
  statusForPendingAgreement,
  statusForRejectedAgreement,
  poolConfigVersion,
  poolConfigHash
} = {}) {
  if (!router) throw new Error('commit-reveal routes require an Express router');
  for (const [name, value] of Object.entries({
    asyncRoute,
    requireBoundRole,
    assignmentMatchesCurrentJobAttempt,
    phaseProtocolForAssignment,
    currentRevealsForJob,
    commitmentBarrierReached,
    validateCommitmentInput,
    validateRevealInput,
    revealMatchesCommitment,
    buildCommitmentHash,
    recordRejectedReceipt,
    penalizeProvider,
    getPolicy,
    evaluateAgreement,
    statusForPendingAgreement,
    statusForRejectedAgreement
  })) {
    if (typeof value !== 'function') throw new Error(`commit-reveal routes require ${name}`);
  }
  const POOL_CONFIG_VERSION = poolConfigVersion;
  const POOL_CONFIG_HASH = poolConfigHash;

  router.post('/assignments/:assignmentId/commit', asyncRoute(async (req, res) => {
    const assignment = await store.getAssignment(req.params.assignmentId);
    if (!assignment) return res.status(404).json({ error: 'assignment not found' });
    if (!requireBoundRole(req, res, 'provider', assignment.providerId)) return null;
    if (!assignment.ring) return res.status(400).json({ error: 'assignment does not use ring commit-reveal' });
    if (!['assigned', 'running'].includes(assignment.status)) {
      return res.status(409).json({
        error: 'assignment is not in private compute phase',
        assignmentStatus: assignment.status
      });
    }
    const job = await store.getJob(assignment.jobId);
    if (!job) return res.status(404).json({ error: 'job not found', jobId: assignment.jobId });
    if (!assignmentMatchesCurrentJobAttempt(assignment, job)) {
      return res.status(409).json({ error: 'assignment does not match current job attempt' });
    }
    const protocol = phaseProtocolForAssignment(assignment);
    if (!protocol) return res.status(400).json({ error: 'assignment has no configured ring phase protocol' });
    const existingReveals = await currentRevealsForJob(store, job);
    if (protocol.rejectLateCommitmentsAfterRevealOpen && job.ringPhase === 'reveal_open' && existingReveals.length > 0) {
      return res.status(409).json({ error: 'late commitments are rejected after reveal payloads exist' });
    }
    if (await store.getAssignmentCommitment?.(assignment.assignmentId)) {
      return res.status(409).json({ error: 'assignment commitment already submitted' });
    }
    const input = {
      jobId: assignment.jobId,
      assignmentId: assignment.assignmentId,
      ringAttemptId: assignment.ringAttemptId,
      providerId: assignment.providerId,
      commitmentHash: req.body?.commitmentHash || null
    };
    const reasons = validateCommitmentInput(input);
    if (reasons.length > 0) return res.status(400).json({ error: 'invalid commitment', reasons });
    const commitment = await store.saveAssignmentCommitment(assignment.assignmentId, {
      ...input,
      requesterId: assignment.requesterId,
      policyId: assignment.policyId,
      policyConfigVersion: job.policyConfigVersion || POOL_CONFIG_VERSION,
      policyConfigHash: job.policyConfigHash || POOL_CONFIG_HASH,
      assignmentAttemptId: assignment.assignmentAttemptId || null,
      phaseProtocolId: assignment.ring.ringPhaseProtocolId,
      status: 'commit_submitted'
    });
    await store.updateAssignment(assignment.assignmentId, {
      status: 'commit_submitted',
      commitmentHash: commitment.commitmentHash,
      committedAt: new Date().toISOString()
    });
    const barrier = await commitmentBarrierReached({ store, job, assignment });
    const jobPatch = {
      ringPhase: barrier.reached ? 'reveal_open' : 'commit_submitted',
      commitmentHashes: barrier.commitments.map((entry) => entry.commitmentHash),
      agreement: {
        ...(job.agreement || {}),
        commitments: barrier.commitments.length,
        requiredCommitments: barrier.required,
        phase: barrier.reached ? 'reveal_open' : 'commit_submitted'
      }
    };
    if (barrier.reached) {
      for (const entry of barrier.commitments) {
        const committedAssignment = await store.getAssignment(entry.assignmentId);
        if (committedAssignment && committedAssignment.status === 'commit_submitted') {
          await store.updateAssignment(entry.assignmentId, {
            status: 'reveal_open',
            revealOpenedAt: new Date().toISOString()
          });
        }
      }
    }
    await store.updateJob(job.jobId, jobPatch);
    return res.status(201).json({
      commitment,
      ringPhase: jobPatch.ringPhase,
      commitments: barrier.commitments.length,
      requiredCommitments: barrier.required
    });
  }));

  router.post('/assignments/:assignmentId/reveal', asyncRoute(async (req, res) => {
    const assignment = await store.getAssignment(req.params.assignmentId);
    if (!assignment) return res.status(404).json({ error: 'assignment not found' });
    if (!requireBoundRole(req, res, 'provider', assignment.providerId)) return null;
    if (!assignment.ring) return res.status(400).json({ error: 'assignment does not use ring commit-reveal' });
    const job = await store.getJob(assignment.jobId);
    if (!job) return res.status(404).json({ error: 'job not found', jobId: assignment.jobId });
    if (!assignmentMatchesCurrentJobAttempt(assignment, job)) {
      return res.status(409).json({ error: 'assignment does not match current job attempt' });
    }
    if (job.ringPhase !== 'reveal_open' && assignment.status !== 'reveal_open') {
      return res.status(409).json({
        error: 'ring reveal phase is not open',
        ringPhase: job.ringPhase || null,
        assignmentStatus: assignment.status
      });
    }
    const commitment = await store.getAssignmentCommitment?.(assignment.assignmentId);
    if (!commitment) return res.status(409).json({ error: 'assignment commitment missing' });
    if (await store.getAssignmentReveal?.(assignment.assignmentId)) {
      return res.status(409).json({ error: 'assignment reveal already submitted' });
    }
    const revealInput = {
      jobId: assignment.jobId,
      assignmentId: assignment.assignmentId,
      ringAttemptId: assignment.ringAttemptId,
      providerId: assignment.providerId,
      outputHash: req.body?.outputHash || null,
      tokenIdsHash: req.body?.tokenIdsHash || null,
      vectorHash: req.body?.vectorHash || null,
      sequenceResultHash: req.body?.sequenceResultHash || null,
      transcriptHash: req.body?.transcriptHash || null,
      salt: req.body?.salt || null
    };
    const reasons = validateRevealInput(revealInput);
    const match = revealMatchesCommitment({ commitment, reveal: revealInput });
    if (!match.ok) reasons.push('reveal does not match prior commitment');
    if (reasons.length > 0) {
      if (!match.ok) {
        const rejectedProviderIds = Array.from(new Set([
          ...(Array.isArray(job?.rejectedProviderIds) ? job.rejectedProviderIds : []),
          assignment.providerId
        ].filter(Boolean)));
        const failedAssignmentIds = Array.from(new Set([
          ...(Array.isArray(job?.failedAssignmentIds) ? job.failedAssignmentIds : []),
          assignment.assignmentId
        ].filter(Boolean)));
        await store.updateAssignment(assignment.assignmentId, {
          status: 'reveal_rejected',
          failureReason: 'ring_commit_reveal_mismatch',
          revealRejectedAt: new Date().toISOString()
        });
        await store.setProviderStatus(assignment.providerId, 'available');
        await recordRejectedReceipt({
          store,
          providerId: assignment.providerId,
          assignmentId: assignment.assignmentId,
          jobId: assignment.jobId,
          reasons
        });
        await penalizeProvider({
          store,
          providerId: assignment.providerId,
          requesterId: assignment.requesterId,
          assignmentId: assignment.assignmentId,
          reason: 'ring_commit_reveal_mismatch',
          points: -2,
          evidence: { reasons, commitmentCheck: match }
        });
        await store.updateJob(job.jobId, {
          rejectedProviderIds,
          failedAssignmentIds
        });
        const policy = getPolicy(assignment.policyId);
        if (policy) {
          const refreshedJob = await store.getJob(job.jobId);
          const agreement = await evaluateAgreement({ store, job: refreshedJob, policy });
          await store.updateJob(job.jobId, {
            status: agreement.status === 'rejected' ? statusForRejectedAgreement(agreement) : statusForPendingAgreement(agreement),
            reason: agreement.status === 'rejected' ? agreement.reason : 'ring commit-reveal mismatch',
            retryable: agreement.status === 'rejected',
            receiptHashes: agreement.receiptHashes,
            rejectedReceiptHashes: agreement.rejectedReceiptHashes,
            failedAssignmentIds: agreement.failedAssignmentIds,
            agreement,
            verifierDecision: agreement.status === 'rejected'
              ? { accepted: false, reasons: [agreement.reason], verifiedAt: new Date().toISOString(), agreement }
              : undefined
          });
        }
      }
      return res.status(400).json({
        error: 'invalid reveal',
        reasons,
        commitmentCheck: match
      });
    }
    const reveal = await store.saveAssignmentReveal(assignment.assignmentId, {
      ...revealInput,
      requesterId: assignment.requesterId,
      policyId: assignment.policyId,
      policyConfigVersion: job.policyConfigVersion || POOL_CONFIG_VERSION,
      policyConfigHash: job.policyConfigHash || POOL_CONFIG_HASH,
      assignmentAttemptId: assignment.assignmentAttemptId || null,
      phaseProtocolId: assignment.ring.ringPhaseProtocolId,
      commitmentHash: commitment.commitmentHash,
      status: 'reveal_submitted'
    });
    await store.updateAssignment(assignment.assignmentId, {
      status: 'reveal_submitted',
      revealHash: buildCommitmentHash(revealInput),
      revealedAt: new Date().toISOString()
    });
    const reveals = await currentRevealsForJob(store, job);
    await store.updateJob(job.jobId, {
      ringPhase: reveals.length >= Number(job?.agreement?.requiredAgreement || assignment.requiredAgreement || 1)
        ? 'reveal_submitted'
        : 'reveal_open',
      revealHashes: reveals.map((entry) => buildCommitmentHash(entry)),
      agreement: {
        ...(job.agreement || {}),
        reveals: reveals.length,
        phase: reveals.length >= Number(job?.agreement?.requiredAgreement || assignment.requiredAgreement || 1)
          ? 'reveal_submitted'
          : 'reveal_open'
      }
    });
    return res.status(201).json({ reveal });
  }));

}

export default registerCommitRevealRoutes;

