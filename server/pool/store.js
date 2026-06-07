/**
 * @fileoverview In-memory store for the Reploid pool coordinator.
 */

import crypto from 'crypto';

const makeId = (prefix) => `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
const nowIso = () => new Date().toISOString();
const canClaimJobForAssignment = (job = {}) => job.status === 'queued'
  || (job.retryable === true && ['failed', 'receipt_rejected', 'redundant_disagreement', 'ring_quorum_disagreement'].includes(job.status));

export function createPoolStore() {
  const providers = new Map();
  const providerSessions = new Map();
  const jobs = new Map();
  const assignments = new Map();
  const receipts = new Map();
  const receiptAcceptances = new Map();
  const pointsLedger = [];
  const reputationState = new Map();
  const auditChallenges = new Map();

  return {
    kind: 'memory',
    registerProvider(input = {}) {
      const providerId = input.providerId || makeId('provider');
      const sessionId = input.sessionId || makeId('session');
      const record = {
        ...input,
        providerId,
        sessionId,
        status: 'available',
        registeredAt: nowIso(),
        heartbeatAt: input.timestamp || nowIso()
      };
      providers.set(providerId, record);
      providerSessions.set(sessionId, {
        providerId,
        sessionId,
        heartbeatAt: record.heartbeatAt,
        status: 'available'
      });
      if (!reputationState.has(providerId)) {
        reputationState.set(providerId, {
          providerId,
          acceptedReceipts: 0,
          rejectedReceipts: 0,
          timeouts: 0,
          points: 0,
          updatedAt: nowIso()
        });
      }
      return record;
    },
    heartbeat({ providerId, sessionId, timestamp = nowIso() } = {}) {
      const provider = providers.get(providerId);
      const session = providerSessions.get(sessionId);
      if (!provider || !session) return null;
      const hasActiveAssignment = Array.from(assignments.values()).some((assignment) => (
        assignment.providerId === providerId
        && (assignment.status === 'assigned' || assignment.status === 'running')
      ));
      const status = hasActiveAssignment ? 'busy' : 'available';
      provider.heartbeatAt = timestamp;
      provider.status = status;
      session.heartbeatAt = timestamp;
      session.status = status;
      return { providerId, sessionId, heartbeatAt: timestamp, status };
    },
    listProviders() {
      return Array.from(providers.values());
    },
    getProvider(providerId) {
      return providers.get(providerId) || null;
    },
    createJob(input = {}) {
      const jobId = input.jobId || makeId('job');
      const record = {
        ...input,
        jobId,
        status: 'queued',
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      jobs.set(jobId, record);
      return record;
    },
    updateJob(jobId, patch = {}) {
      const job = jobs.get(jobId);
      if (!job) return null;
      Object.assign(job, patch, { updatedAt: nowIso() });
      return job;
    },
    listJobs() {
      return Array.from(jobs.values());
    },
    claimJobForAssignment(jobId) {
      const job = jobs.get(jobId);
      if (!job || !canClaimJobForAssignment(job)) return null;
      job.status = 'assignment_processing';
      job.assignmentAttempts = Number(job.assignmentAttempts || 0) + 1;
      job.updatedAt = nowIso();
      return job;
    },
    claimJobForAcceptance(jobId) {
      const job = jobs.get(jobId);
      if (!job) return null;
      if (job.status === 'accepted' || job.status === 'acceptance_processing' || job.status === 'rejected_by_requester') {
        return null;
      }
      job.status = 'acceptance_processing';
      job.updatedAt = nowIso();
      return job;
    },
    getJob(jobId) {
      return jobs.get(jobId) || null;
    },
    createAssignment(input = {}) {
      const assignmentId = input.assignmentId || makeId('assignment');
      const record = {
        ...input,
        assignmentId,
        status: 'assigned',
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      assignments.set(assignmentId, record);
      if (record.providerId && providers.has(record.providerId)) {
        providers.get(record.providerId).status = 'busy';
      }
      return record;
    },
    updateAssignment(assignmentId, patch = {}) {
      const assignment = assignments.get(assignmentId);
      if (!assignment) return null;
      Object.assign(assignment, patch, { updatedAt: nowIso() });
      return assignment;
    },
    getAssignment(assignmentId) {
      return assignments.get(assignmentId) || null;
    },
    nextAssignmentForProvider(providerId) {
      const assignment = Array.from(assignments.values()).find((entry) => (
        entry.providerId === providerId && entry.status === 'assigned'
      )) || null;
      if (!assignment) return null;
      assignment.status = 'running';
      assignment.startedAt = assignment.startedAt || nowIso();
      assignment.updatedAt = nowIso();
      return assignment;
    },
    nextPendingAssignmentForProvider(providerId) {
      return Array.from(assignments.values()).find((assignment) => (
        assignment.providerId === providerId && assignment.status === 'assigned'
      )) || null;
    },
    setProviderStatus(providerId, status) {
      const provider = providers.get(providerId);
      if (!provider) return null;
      provider.status = status;
      provider.updatedAt = nowIso();
      return provider;
    },
    expireStaleAssignments() {
      const expired = [];
      const now = Date.now();
      for (const assignment of assignments.values()) {
        if (assignment.status !== 'assigned' && assignment.status !== 'running') continue;
        if (!assignment.expiresAt || Date.parse(assignment.expiresAt) >= now) continue;
        assignment.status = 'expired';
        assignment.updatedAt = nowIso();
        expired.push(assignment);
        const job = jobs.get(assignment.jobId);
        if (job) {
          Object.assign(job, {
            status: 'failed',
            reason: 'assignment_expired',
            retryable: true,
            timedOutProviderIds: Array.from(new Set([
              ...(Array.isArray(job.timedOutProviderIds) ? job.timedOutProviderIds : []),
              assignment.providerId
            ].filter(Boolean))),
            updatedAt: nowIso()
          });
        }
        if (assignment.providerId && providers.has(assignment.providerId)) {
          providers.get(assignment.providerId).status = 'available';
          const current = this.getReputation(assignment.providerId);
          const timeouts = Number(current.timeouts || 0) + 1;
          this.updateReputation(assignment.providerId, {
            timeouts,
            lastTimeoutAt: nowIso(),
            routingBlocked: current.routingBlocked || timeouts >= 3,
            quarantineReason: timeouts >= 3 ? 'repeated_assignment_timeouts' : current.quarantineReason
          });
          this.appendLedger({
            eventType: 'points_penalized',
            reason: 'assignment_timeout',
            assignmentId: assignment.assignmentId,
            providerId: assignment.providerId,
            requesterId: assignment.requesterId,
            userId: assignment.providerId,
            points: -1
          });
        }
      }
      return expired;
    },
    saveReceipt(receiptHash, record = {}) {
      const saved = {
        ...record,
        receiptHash,
        createdAt: record.createdAt || nowIso(),
        updatedAt: nowIso()
      };
      receipts.set(receiptHash, saved);
      return saved;
    },
    getReceipt(receiptHash) {
      return receipts.get(receiptHash) || null;
    },
    listReceiptsForJob(jobId) {
      return Array.from(receipts.values()).filter((receipt) => receipt.jobId === jobId);
    },
    saveAcceptance(receiptHash, acceptance = {}) {
      const saved = {
        ...acceptance,
        receiptHash,
        createdAt: nowIso()
      };
      receiptAcceptances.set(receiptHash, saved);
      return saved;
    },
    appendLedger(event = {}) {
      const saved = {
        ledgerId: event.ledgerId || makeId('ledger'),
        ...event,
        createdAt: nowIso()
      };
      pointsLedger.push(saved);
      return saved;
    },
    listLedger(userId) {
      return pointsLedger.filter((event) => event.userId === userId || event.providerId === userId || event.requesterId === userId);
    },
    getReputation(providerId) {
      return reputationState.get(providerId) || {
        providerId,
        acceptedReceipts: 0,
        rejectedReceipts: 0,
        timeouts: 0,
        points: 0,
        updatedAt: nowIso()
      };
    },
    updateReputation(providerId, patch = {}) {
      const current = this.getReputation(providerId);
      const next = {
        ...current,
        ...patch,
        updatedAt: nowIso()
      };
      reputationState.set(providerId, next);
      return next;
    },
    createAuditChallenge(input = {}) {
      const auditId = input.auditId || makeId('audit');
      const record = {
        ...input,
        auditId,
        status: input.status || 'pending',
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      auditChallenges.set(auditId, record);
      return record;
    },
    getAuditChallenge(auditId) {
      return auditChallenges.get(auditId) || null;
    },
    updateAuditChallenge(auditId, patch = {}) {
      const audit = auditChallenges.get(auditId);
      if (!audit) return null;
      Object.assign(audit, patch, { updatedAt: nowIso() });
      return audit;
    },
    listAuditChallenges(providerId = null) {
      return Array.from(auditChallenges.values()).filter((audit) => (
        !providerId || audit.providerId === providerId
      ));
    },
    getMetrics() {
      const countBy = (values, field) => values.reduce((acc, item) => {
        const key = item[field] || 'unknown';
        acc[key] = Number(acc[key] || 0) + 1;
        return acc;
      }, {});
      const providerValues = Array.from(providers.values());
      const jobValues = Array.from(jobs.values());
      const assignmentValues = Array.from(assignments.values());
      const receiptValues = Array.from(receipts.values());
      const reputationValues = Array.from(reputationState.values());
      return {
        providers: providerValues.length,
        providerStatus: countBy(providerValues, 'status'),
        jobs: jobValues.length,
        jobStatus: countBy(jobValues, 'status'),
        assignments: assignmentValues.length,
        assignmentStatus: countBy(assignmentValues, 'status'),
        receipts: receiptValues.length,
        verifierAcceptedReceipts: receiptValues.filter((receipt) => receipt.verifierDecision?.accepted).length,
        pointsEvents: pointsLedger.length,
        auditChallenges: auditChallenges.size,
        routingBlockedProviders: reputationValues.filter((reputation) => reputation.routingBlocked).length,
        generatedAt: nowIso()
      };
    }
  };
}

export const poolStore = createPoolStore();

export default poolStore;
