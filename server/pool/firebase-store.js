/**
 * @fileoverview Firestore-backed pool store for Firebase deployment.
 */

import crypto from 'crypto';
import poolStore from './store.js';

const makeId = (prefix) => `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
const nowIso = () => new Date().toISOString();

const COLLECTIONS = Object.freeze({
  providers: 'providers',
  providerSessions: 'provider_sessions',
  jobs: 'jobs',
  assignments: 'assignments',
  receipts: 'receipts',
  receiptAcceptances: 'receipt_acceptances',
  signalingSessions: 'signaling_sessions',
  signalingMessages: 'signaling_messages',
  pointsLedger: 'points_ledger',
  reputationState: 'reputation_state',
  auditChallenges: 'audit_challenges'
});

const stripUndefined = (value) => {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, stripUndefined(entry)])
  );
};

const defaultReputation = (providerId) => ({
  providerId,
  acceptedReceipts: 0,
  rejectedReceipts: 0,
  timeouts: 0,
  points: 0,
  updatedAt: nowIso()
});
const canClaimJobForAssignment = (job = {}) => job.status === 'queued'
  || (job.retryable === true && ['failed', 'receipt_rejected', 'redundant_disagreement', 'ring_quorum_disagreement'].includes(job.status));
const finalReceiptStatuses = new Set(['receipt_verified', 'accepted', 'acceptance_processing', 'rejected_by_requester']);

const agreementModeForJob = (job = {}) => (
  job?.agreement?.mode || (job?.policyId === 'ring_quorum_receipt' ? 'ring_quorum' : 'redundant')
);

const statusForPendingAgreement = (job = {}) => (
  agreementModeForJob(job) === 'ring_quorum' ? 'awaiting_ring_quorum_receipts' : 'awaiting_redundant_receipts'
);

const statusForRejectedAgreement = (job = {}) => (
  agreementModeForJob(job) === 'ring_quorum' ? 'ring_quorum_disagreement' : 'redundant_disagreement'
);

const currentAssignmentSet = (job = {}) => new Set(Array.isArray(job.assignmentIds) ? job.assignmentIds : []);

const assignmentIsCurrent = (assignment = {}, job = {}) => {
  const current = currentAssignmentSet(job);
  if (current.size > 0 && !current.has(assignment.assignmentId)) return false;
  if (job.assignmentAttemptId !== undefined
    && assignment.assignmentAttemptId !== undefined
    && Number(job.assignmentAttemptId) !== Number(assignment.assignmentAttemptId)) {
    return false;
  }
  if (job.ringAttemptId && assignment.ringAttemptId && job.ringAttemptId !== assignment.ringAttemptId) return false;
  return true;
};

const receiptsForCurrentAttempt = (receiptRecords = [], job = {}) => {
  const current = currentAssignmentSet(job);
  return receiptRecords.filter((record) => {
    if (record.jobId !== job.jobId) return false;
    if (current.size > 0 && !current.has(record.assignmentId)) return false;
    if (job.assignmentAttemptId !== undefined
      && record.assignmentAttemptId !== undefined
      && Number(job.assignmentAttemptId) !== Number(record.assignmentAttemptId)) {
      return false;
    }
    if (job.ringAttemptId && record.ringAttemptId && job.ringAttemptId !== record.ringAttemptId) return false;
    return true;
  });
};

const buildExpiredAssignmentJobPatch = ({ job, assignment, receiptRecords = [] } = {}) => {
  if (!job || !assignmentIsCurrent(assignment, job)) return null;
  if (finalReceiptStatuses.has(job.status) || job?.agreement?.status === 'accepted') return null;
  const failedAssignmentIds = Array.from(new Set([
    ...(Array.isArray(job.failedAssignmentIds) ? job.failedAssignmentIds : []),
    assignment.assignmentId
  ].filter(Boolean)));
  const timedOutProviderIds = Array.from(new Set([
    ...(Array.isArray(job.timedOutProviderIds) ? job.timedOutProviderIds : []),
    assignment.providerId
  ].filter(Boolean)));
  const required = Number(job?.agreement?.requiredAgreement || job?.agreement?.requiredProviders || 1);
  if (required <= 1) {
    return {
      status: 'failed',
      reason: 'assignment_expired',
      retryable: true,
      failedAssignmentIds,
      timedOutProviderIds
    };
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
    ...currentReceipts.map((record) => record.assignmentId).filter(Boolean),
    ...failedAssignmentIds
  ]);
  const remainingProviders = Math.max(0, providerCount - blockedAssignmentIds.size);
  const largestGroupSize = Math.max(0, ...Array.from(groups.values()).map((group) => group.length));
  const agreementBase = {
    ...(job.agreement || {}),
    mode: agreementModeForJob(job),
    requiredProviders: required,
    requiredAgreement: required,
    providerCount,
    agreementField,
    acceptedReceipts: acceptedRecords.length,
    rejectedReceipts: rejectedRecords.length,
    failedAssignments: failedAssignmentIds.length,
    remainingProviders,
    receiptHashes: acceptedRecords.map((record) => record.receiptHash),
    rejectedReceiptHashes: rejectedRecords.map((record) => record.receiptHash),
    failedAssignmentIds,
    effectiveTrustTier: job.effectiveTrustTier || job.trustTier
  };
  if (matchingGroup) {
    const receiptHashes = matchingGroup.slice(0, required).map((record) => record.receiptHash);
    return {
      status: 'receipt_verified',
      reason: null,
      retryable: false,
      receiptHash: receiptHashes[0],
      receiptHashes,
      failedAssignmentIds,
      timedOutProviderIds,
      agreement: {
        ...agreementBase,
        status: 'accepted',
        acceptedReceipts: matchingGroup.length,
        receiptHash: receiptHashes[0],
        receiptHashes,
        outputHash: matchingGroup[0].receipt?.outputHash,
        tokenIdsHash: matchingGroup[0].receipt?.tokenIdsHash
      }
    };
  }
  if (largestGroupSize + remainingProviders >= required) {
    return {
      status: statusForPendingAgreement(job),
      reason: 'assignment_expired',
      retryable: false,
      failedAssignmentIds,
      timedOutProviderIds,
      agreement: {
        ...agreementBase,
        status: 'pending',
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
    status: statusForRejectedAgreement(job),
    reason,
    retryable: true,
    failedAssignmentIds,
    timedOutProviderIds,
    agreement: {
      ...agreementBase,
      status: 'rejected',
      reason
    },
    verifierDecision: {
      accepted: false,
      reasons: [reason],
      verifiedAt: nowIso(),
      agreement: {
        ...agreementBase,
        status: 'rejected',
        reason
      }
    }
  };
};

export function createFirestorePoolStore({ firestore, collectionPrefix = '' } = {}) {
  if (!firestore?.collection) {
    throw new Error('Firestore instance with collection() is required');
  }

  const collectionName = (name) => collectionPrefix ? `${collectionPrefix}_${name}` : name;
  const collection = (name) => firestore.collection(collectionName(name));
  const doc = (name, id) => collection(name).doc(id);
  const readDoc = async (name, id) => {
    const snapshot = await doc(name, id).get();
    return snapshot.exists ? snapshot.data() : null;
  };
  const writeDoc = async (name, id, value, options = {}) => {
    const saved = stripUndefined(value);
    await doc(name, id).set(saved, options);
    return saved;
  };
  const listDocs = async (name) => {
    const snapshot = await collection(name).get();
    return snapshot.docs.map((entry) => entry.data());
  };
  const hasActiveAssignment = async (providerId) => {
    if (!providerId) return false;
    const snapshots = await Promise.all(['assigned', 'running'].map((status) => (
      collection(COLLECTIONS.assignments)
        .where('providerId', '==', providerId)
        .where('status', '==', status)
        .limit(1)
        .get()
    )));
    return snapshots.some((snapshot) => !snapshot.empty);
  };

  const api = {
    kind: 'firestore',
    async registerProvider(input = {}) {
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
      const session = {
        providerId,
        sessionId,
        heartbeatAt: record.heartbeatAt,
        status: 'available'
      };
      await Promise.all([
        writeDoc(COLLECTIONS.providers, providerId, record),
        writeDoc(COLLECTIONS.providerSessions, sessionId, session)
      ]);
      const reputation = await readDoc(COLLECTIONS.reputationState, providerId);
      if (!reputation) await writeDoc(COLLECTIONS.reputationState, providerId, defaultReputation(providerId));
      return record;
    },
    async heartbeat({ providerId, sessionId, timestamp = nowIso() } = {}) {
      const provider = await readDoc(COLLECTIONS.providers, providerId);
      const session = await readDoc(COLLECTIONS.providerSessions, sessionId);
      if (!provider || !session) return null;
      const status = await hasActiveAssignment(providerId) ? 'busy' : 'available';
      const providerPatch = { ...provider, heartbeatAt: timestamp, status, updatedAt: nowIso() };
      const sessionPatch = { ...session, heartbeatAt: timestamp, status, updatedAt: nowIso() };
      await Promise.all([
        writeDoc(COLLECTIONS.providers, providerId, providerPatch, { merge: true }),
        writeDoc(COLLECTIONS.providerSessions, sessionId, sessionPatch, { merge: true })
      ]);
      return { providerId, sessionId, heartbeatAt: timestamp, status };
    },
    async listProviders() {
      return listDocs(COLLECTIONS.providers);
    },
    async getProvider(providerId) {
      return readDoc(COLLECTIONS.providers, providerId);
    },
    async createJob(input = {}) {
      const jobId = input.jobId || makeId('job');
      const record = {
        ...input,
        jobId,
        status: 'queued',
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      return writeDoc(COLLECTIONS.jobs, jobId, record);
    },
    async updateJob(jobId, patch = {}) {
      const job = await readDoc(COLLECTIONS.jobs, jobId);
      if (!job) return null;
      const next = { ...job, ...patch, updatedAt: nowIso() };
      return writeDoc(COLLECTIONS.jobs, jobId, next, { merge: true });
    },
    async listJobs() {
      return listDocs(COLLECTIONS.jobs);
    },
    async claimJobForAssignment(jobId) {
      const jobRef = doc(COLLECTIONS.jobs, jobId);
      const claim = async (snapshot, writer = null) => {
        const job = snapshot.exists ? snapshot.data() : null;
        if (!job || !canClaimJobForAssignment(job)) return null;
        const next = {
          ...job,
          status: 'assignment_processing',
          assignmentAttempts: Number(job.assignmentAttempts || 0) + 1,
          updatedAt: nowIso()
        };
        if (writer) writer.set(jobRef, stripUndefined(next), { merge: true });
        return next;
      };
      if (typeof firestore.runTransaction === 'function') {
        return firestore.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(jobRef);
          return claim(snapshot, transaction);
        });
      }
      const snapshot = await jobRef.get();
      const next = await claim(snapshot);
      if (!next) return null;
      await writeDoc(COLLECTIONS.jobs, jobId, next, { merge: true });
      return next;
    },
    async claimJobForAcceptance(jobId) {
      const jobRef = doc(COLLECTIONS.jobs, jobId);
      const claim = async (snapshot, writer = null) => {
        const job = snapshot.exists ? snapshot.data() : null;
        if (!job) return null;
        if (job.status === 'accepted' || job.status === 'acceptance_processing' || job.status === 'rejected_by_requester') {
          return null;
        }
        const next = {
          ...job,
          status: 'acceptance_processing',
          updatedAt: nowIso()
        };
        if (writer) writer.set(jobRef, stripUndefined(next), { merge: true });
        return next;
      };
      if (typeof firestore.runTransaction === 'function') {
        return firestore.runTransaction(async (transaction) => {
          const snapshot = await transaction.get(jobRef);
          return claim(snapshot, transaction);
        });
      }
      const snapshot = await jobRef.get();
      const next = await claim(snapshot);
      if (!next) return null;
      await writeDoc(COLLECTIONS.jobs, jobId, next, { merge: true });
      return next;
    },
    async getJob(jobId) {
      return readDoc(COLLECTIONS.jobs, jobId);
    },
    async createAssignment(input = {}) {
      const assignmentId = input.assignmentId || makeId('assignment');
      const record = {
        ...input,
        assignmentId,
        status: 'assigned',
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      await writeDoc(COLLECTIONS.assignments, assignmentId, record);
      if (record.providerId) await api.setProviderStatus(record.providerId, 'busy');
      return record;
    },
    async updateAssignment(assignmentId, patch = {}) {
      const assignment = await readDoc(COLLECTIONS.assignments, assignmentId);
      if (!assignment) return null;
      const next = { ...assignment, ...patch, updatedAt: nowIso() };
      return writeDoc(COLLECTIONS.assignments, assignmentId, next, { merge: true });
    },
    async getAssignment(assignmentId) {
      return readDoc(COLLECTIONS.assignments, assignmentId);
    },
    async nextAssignmentForProvider(providerId) {
      const snapshot = await collection(COLLECTIONS.assignments)
        .where('providerId', '==', providerId)
        .where('status', '==', 'assigned')
        .limit(1)
        .get();
      if (snapshot.empty) return null;
      const assignmentRef = snapshot.docs[0].ref;
      const claimAssignment = async (snapshotToClaim) => {
        const assignment = snapshotToClaim.exists ? snapshotToClaim.data() : null;
        if (!assignment || assignment.status !== 'assigned') return null;
        const next = {
          ...assignment,
          status: 'running',
          startedAt: assignment.startedAt || nowIso(),
          updatedAt: nowIso()
        };
        return next;
      };
      if (typeof firestore.runTransaction === 'function') {
        return firestore.runTransaction(async (transaction) => {
          const current = await transaction.get(assignmentRef);
          const next = await claimAssignment(current);
          if (!next) return null;
          transaction.set(assignmentRef, stripUndefined(next), { merge: true });
          return next;
        });
      }
      const next = await claimAssignment(snapshot.docs[0]);
      if (!next) return null;
      await writeDoc(COLLECTIONS.assignments, next.assignmentId, next, { merge: true });
      return next;
    },
    async setProviderStatus(providerId, status) {
      const provider = await readDoc(COLLECTIONS.providers, providerId);
      if (!provider) return null;
      const next = { ...provider, status, updatedAt: nowIso() };
      return writeDoc(COLLECTIONS.providers, providerId, next, { merge: true });
    },
    async expireStaleAssignments() {
      const snapshots = await Promise.all(['assigned', 'running'].map((status) => (
        collection(COLLECTIONS.assignments)
          .where('status', '==', status)
          .get()
      )));
      const expired = [];
      const now = Date.now();
      for (const entry of snapshots.flatMap((snapshot) => snapshot.docs)) {
        const assignment = entry.data();
        if (!assignment.expiresAt || Date.parse(assignment.expiresAt) >= now) continue;
        const nextAssignment = { ...assignment, status: 'expired', updatedAt: nowIso() };
        expired.push(nextAssignment);
        await writeDoc(COLLECTIONS.assignments, assignment.assignmentId, nextAssignment, { merge: true });
        const job = assignment.jobId ? await api.getJob(assignment.jobId) : null;
        if (job) {
          const patch = buildExpiredAssignmentJobPatch({
            job,
            assignment,
            receiptRecords: await api.listReceiptsForJob(job.jobId)
          });
          if (patch) await api.updateJob(assignment.jobId, patch);
        }
        if (assignment.providerId) {
          await api.setProviderStatus(assignment.providerId, 'available');
          const current = await api.getReputation(assignment.providerId);
          const timeouts = Number(current.timeouts || 0) + 1;
          await api.updateReputation(assignment.providerId, {
            timeouts,
            lastTimeoutAt: nowIso(),
            routingBlocked: current.routingBlocked || timeouts >= 3,
            quarantineReason: timeouts >= 3 ? 'repeated_assignment_timeouts' : current.quarantineReason
          });
          await api.appendLedger({
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
    async saveReceipt(receiptHash, record = {}) {
      const saved = {
        ...record,
        receiptHash,
        createdAt: record.createdAt || nowIso(),
        updatedAt: nowIso()
      };
      return writeDoc(COLLECTIONS.receipts, receiptHash, saved, { merge: true });
    },
    async getReceipt(receiptHash) {
      return readDoc(COLLECTIONS.receipts, receiptHash);
    },
    async listReceiptsForJob(jobId) {
      const snapshot = await collection(COLLECTIONS.receipts)
        .where('jobId', '==', jobId)
        .get();
      return snapshot.docs.map((entry) => entry.data());
    },
    async saveAcceptance(receiptHash, acceptance = {}) {
      const saved = {
        ...acceptance,
        receiptHash,
        createdAt: nowIso()
      };
      return writeDoc(COLLECTIONS.receiptAcceptances, receiptHash, saved, { merge: true });
    },
    async createSignalingSession(input = {}) {
      const sessionId = input.sessionId || makeId('signal_session');
      const saved = {
        ...input,
        sessionId,
        participantIds: Array.from(new Set((input.participantIds || []).filter(Boolean))),
        createdAt: input.createdAt || nowIso(),
        updatedAt: nowIso(),
        expiresAt: input.expiresAt || new Date(Date.now() + 10 * 60 * 1000).toISOString()
      };
      return writeDoc(COLLECTIONS.signalingSessions, sessionId, saved, { merge: true });
    },
    async getSignalingSession(sessionId) {
      return readDoc(COLLECTIONS.signalingSessions, sessionId);
    },
    async appendSignalMessage(sessionId, message = {}) {
      const session = await api.getSignalingSession(sessionId);
      if (!session) return null;
      const signalId = message.id || makeId('signal');
      const saved = {
        ...message,
        sessionId,
        id: signalId,
        createdAt: message.createdAt || Date.now(),
        receivedAt: nowIso()
      };
      await Promise.all([
        writeDoc(COLLECTIONS.signalingMessages, `${sessionId}_${signalId}`, saved, { merge: true }),
        writeDoc(COLLECTIONS.signalingSessions, sessionId, { ...session, updatedAt: nowIso() }, { merge: true })
      ]);
      return saved;
    },
    async listSignalMessages(sessionId, { after = 0, peerId = null } = {}) {
      const snapshot = await collection(COLLECTIONS.signalingMessages)
        .where('sessionId', '==', sessionId)
        .get();
      const minCreatedAt = Number(after || 0);
      return snapshot.docs
        .map((entry) => entry.data())
        .filter((message) => {
          if (Number(message.createdAt || 0) <= minCreatedAt) return false;
          if (peerId && message.fromPeerId === peerId) return false;
          if (peerId && message.toPeerId && message.toPeerId !== peerId) return false;
          return true;
        })
        .sort((left, right) => Number(left.createdAt || 0) - Number(right.createdAt || 0));
    },
    async appendLedger(event = {}) {
      const ledgerId = event.ledgerId || makeId('ledger');
      const saved = {
        ledgerId,
        ...event,
        createdAt: nowIso()
      };
      return writeDoc(COLLECTIONS.pointsLedger, ledgerId, saved);
    },
    async listLedger(userId) {
      const snapshots = await Promise.all(['userId', 'providerId', 'requesterId'].map((field) => (
        collection(COLLECTIONS.pointsLedger)
          .where(field, '==', userId)
          .get()
      )));
      const events = new Map();
      for (const snapshot of snapshots) {
        for (const entry of snapshot.docs) {
          const event = entry.data();
          events.set(event.ledgerId || entry.id, event);
        }
      }
      return Array.from(events.values());
    },
    async getReputation(providerId) {
      return (await readDoc(COLLECTIONS.reputationState, providerId)) || defaultReputation(providerId);
    },
    async updateReputation(providerId, patch = {}) {
      const current = await api.getReputation(providerId);
      const next = {
        ...current,
        ...patch,
        updatedAt: nowIso()
      };
      return writeDoc(COLLECTIONS.reputationState, providerId, next, { merge: true });
    },
    async createAuditChallenge(input = {}) {
      const auditId = input.auditId || makeId('audit');
      const record = {
        ...input,
        auditId,
        status: input.status || 'pending',
        createdAt: nowIso(),
        updatedAt: nowIso()
      };
      return writeDoc(COLLECTIONS.auditChallenges, auditId, record);
    },
    async getAuditChallenge(auditId) {
      return readDoc(COLLECTIONS.auditChallenges, auditId);
    },
    async updateAuditChallenge(auditId, patch = {}) {
      const audit = await readDoc(COLLECTIONS.auditChallenges, auditId);
      if (!audit) return null;
      const next = {
        ...audit,
        ...patch,
        updatedAt: nowIso()
      };
      return writeDoc(COLLECTIONS.auditChallenges, auditId, next, { merge: true });
    },
    async listAuditChallenges(providerId = null) {
      if (!providerId) return listDocs(COLLECTIONS.auditChallenges);
      const snapshot = await collection(COLLECTIONS.auditChallenges)
        .where('providerId', '==', providerId)
        .get();
      return snapshot.docs.map((entry) => entry.data());
    },
    async getMetrics() {
      const [
        providers,
        jobs,
        assignments,
        receipts,
        ledger,
        audits,
        reputations
      ] = await Promise.all([
        listDocs(COLLECTIONS.providers),
        listDocs(COLLECTIONS.jobs),
        listDocs(COLLECTIONS.assignments),
        listDocs(COLLECTIONS.receipts),
        listDocs(COLLECTIONS.pointsLedger),
        listDocs(COLLECTIONS.auditChallenges),
        listDocs(COLLECTIONS.reputationState)
      ]);
      const countBy = (values, field) => values.reduce((acc, item) => {
        const key = item[field] || 'unknown';
        acc[key] = Number(acc[key] || 0) + 1;
        return acc;
      }, {});
      return {
        providers: providers.length,
        providerStatus: countBy(providers, 'status'),
        jobs: jobs.length,
        jobStatus: countBy(jobs, 'status'),
        assignments: assignments.length,
        assignmentStatus: countBy(assignments, 'status'),
        receipts: receipts.length,
        verifierAcceptedReceipts: receipts.filter((receipt) => receipt.verifierDecision?.accepted).length,
        pointsEvents: ledger.length,
        auditChallenges: audits.length,
        routingBlockedProviders: reputations.filter((reputation) => reputation.routingBlocked).length,
        generatedAt: nowIso()
      };
    }
  };

  return api;
}

export function createFirebaseStore(options = {}) {
  if (!options.firestore) return poolStore;
  return createFirestorePoolStore(options);
}

export default createFirebaseStore;
