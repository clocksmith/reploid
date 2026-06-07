/**
 * @fileoverview In-memory store for the Reploid pool coordinator.
 */

import crypto from 'crypto';

const makeId = (prefix) => `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
const nowIso = () => new Date().toISOString();

export function createPoolStore() {
  const providers = new Map();
  const providerSessions = new Map();
  const jobs = new Map();
  const assignments = new Map();
  const receipts = new Map();
  const receiptAcceptances = new Map();
  const pointsLedger = [];
  const reputationState = new Map();

  return {
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
      provider.heartbeatAt = timestamp;
      provider.status = 'available';
      session.heartbeatAt = timestamp;
      session.status = 'available';
      return { providerId, sessionId, heartbeatAt: timestamp, status: 'available' };
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
        if (assignment.status !== 'assigned') continue;
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
            updatedAt: nowIso()
          });
        }
        if (assignment.providerId && providers.has(assignment.providerId)) {
          providers.get(assignment.providerId).status = 'available';
          const current = this.getReputation(assignment.providerId);
          this.updateReputation(assignment.providerId, {
            timeouts: Number(current.timeouts || 0) + 1,
            lastTimeoutAt: nowIso()
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
    }
  };
}

export const poolStore = createPoolStore();

export default poolStore;
