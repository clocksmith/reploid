/**
 * @fileoverview In-memory store for the Reploid pool coordinator.
 */

import crypto from 'crypto';
import {
  createReputationSeedEvent,
  hasLegacyReputationEvidence,
  projectProviderReputation,
  reputationEventIdFor
} from './reputation-projection.js';

const makeId = (prefix) => `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
const nowIso = () => new Date().toISOString();
const toEpochMs = (value) => {
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const canClaimJobForAssignment = (job = {}) => job.status === 'queued'
  || (job.retryable === true && ['failed', 'receipt_rejected', 'redundant_disagreement', 'ring_quorum_disagreement'].includes(job.status));
const finalReceiptStatuses = new Set(['receipt_verified', 'accepted', 'acceptance_processing', 'rejected_by_requester']);
const expirableAssignmentStatuses = new Set(['assigned', 'running', 'commit_submitted', 'reveal_open', 'reveal_submitted']);

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
    const agreementValue = matchingGroup[0].receipt?.[agreementField] || matchingGroup[0].receipt?.tokenIdsHash || null;
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
        tokenIdsHash: matchingGroup[0].receipt?.tokenIdsHash,
        vectorHash: matchingGroup[0].receipt?.vectorHash || null,
        agreementValue
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

export function createPoolStore() {
  const providers = new Map();
  const providerSessions = new Map();
  const jobs = new Map();
  const assignments = new Map();
  const receipts = new Map();
  const receiptAcceptances = new Map();
  const commitmentEvents = new Map();
  const revealEvents = new Map();
  const poolEvents = [];
  const pointsLedger = [];
  const reputationState = new Map();
  const auditChallenges = new Map();
  const signalingSessions = new Map();
  const signalingMessages = new Map();
  const peerRoomMessages = new Map();
  const adapterPublications = new Map();
  const adapterCanaryPublications = new Map();

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
        && expirableAssignmentStatuses.has(assignment.status)
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
        if (!expirableAssignmentStatuses.has(assignment.status)) continue;
        if (!assignment.expiresAt || Date.parse(assignment.expiresAt) >= now) continue;
        assignment.status = 'expired';
        assignment.updatedAt = nowIso();
        expired.push(assignment);
        const job = jobs.get(assignment.jobId);
        if (job) {
          const patch = buildExpiredAssignmentJobPatch({
            job,
            assignment,
            receiptRecords: Array.from(receipts.values())
          });
          if (patch) Object.assign(job, patch, { updatedAt: nowIso() });
        }
        if (assignment.providerId && providers.has(assignment.providerId)) {
          providers.get(assignment.providerId).status = 'available';
          this.appendReputationEvent({
            type: 'timeout',
            category: 'reputation',
            providerId: assignment.providerId,
            assignmentId: assignment.assignmentId,
            jobId: assignment.jobId,
            reasons: ['assignment expired before completion']
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
    saveAssignmentCommitment(assignmentId, commitment = {}) {
      const saved = {
        ...commitment,
        assignmentId,
        commitmentId: commitment.commitmentId || makeId('commitment'),
        createdAt: commitment.createdAt || nowIso(),
        updatedAt: nowIso()
      };
      commitmentEvents.set(assignmentId, saved);
      return saved;
    },
    getAssignmentCommitment(assignmentId) {
      return commitmentEvents.get(assignmentId) || null;
    },
    listCommitmentsForJob(jobId) {
      return Array.from(commitmentEvents.values()).filter((commitment) => commitment.jobId === jobId);
    },
    saveAssignmentReveal(assignmentId, reveal = {}) {
      const saved = {
        ...reveal,
        assignmentId,
        revealId: reveal.revealId || makeId('reveal'),
        createdAt: reveal.createdAt || nowIso(),
        updatedAt: nowIso()
      };
      revealEvents.set(assignmentId, saved);
      return saved;
    },
    getAssignmentReveal(assignmentId) {
      return revealEvents.get(assignmentId) || null;
    },
    listRevealsForJob(jobId) {
      return Array.from(revealEvents.values()).filter((reveal) => reveal.jobId === jobId);
    },
    appendPoolEvent(event = {}) {
      const saved = {
        eventId: event.eventId || makeId('pool_event'),
        ...event,
        createdAt: event.createdAt || nowIso()
      };
      poolEvents.push(saved);
      return saved;
    },
    listPoolEventsForJob(jobId) {
      return poolEvents.filter((event) => event.jobId === jobId);
    },
    listPoolEventsForProvider(providerId) {
      return poolEvents.filter((event) => event.providerId === providerId && event.category === 'reputation');
    },
    appendReputationEvent(event = {}) {
      const providerId = event.providerId;
      if (!providerId) throw new Error('reputation event providerId is required');
      const current = this.getReputation(providerId);
      let events = this.listPoolEventsForProvider(providerId);
      if (events.length === 0 && hasLegacyReputationEvidence(current)) {
        this.appendPoolEvent(createReputationSeedEvent(providerId, current));
      }
      const eventId = event.eventId || reputationEventIdFor(event);
      this.appendPoolEvent({
        ...event,
        ...(eventId ? { eventId } : {}),
        category: 'reputation'
      });
      events = this.listPoolEventsForProvider(providerId);
      return this.updateReputation(providerId, projectProviderReputation(providerId, events, current));
    },
    createSignalingSession(input = {}) {
      const sessionId = input.sessionId || makeId('signal_session');
      const saved = {
        ...input,
        sessionId,
        participantIds: Array.from(new Set((input.participantIds || []).filter(Boolean))),
        createdAt: input.createdAt || nowIso(),
        updatedAt: nowIso(),
        expiresAt: input.expiresAt || new Date(Date.now() + 10 * 60 * 1000).toISOString()
      };
      signalingSessions.set(sessionId, saved);
      if (!signalingMessages.has(sessionId)) signalingMessages.set(sessionId, []);
      return saved;
    },
    getSignalingSession(sessionId) {
      return signalingSessions.get(sessionId) || null;
    },
    appendSignalMessage(sessionId, message = {}) {
      const session = signalingSessions.get(sessionId);
      if (!session) return null;
      const saved = {
        ...message,
        sessionId,
        id: message.id || makeId('signal'),
        createdAt: message.createdAt || Date.now(),
        receivedAt: nowIso()
      };
      const messages = signalingMessages.get(sessionId) || [];
      messages.push(saved);
      signalingMessages.set(sessionId, messages);
      signalingSessions.set(sessionId, { ...session, updatedAt: nowIso() });
      return saved;
    },
    listSignalMessages(sessionId, { after = 0, peerId = null, limit = 100 } = {}) {
      const minCreatedAt = Number(after || 0);
      return (signalingMessages.get(sessionId) || []).filter((message) => {
        if (Number(message.createdAt || 0) <= minCreatedAt) return false;
        if (message.expiresAt && toEpochMs(message.expiresAt) < Date.now()) return false;
        if (peerId && message.fromPeerId === peerId) return false;
        if (peerId && message.toPeerId && message.toPeerId !== peerId) return false;
        return true;
      }).slice(0, Number(limit || 100));
    },
    appendPeerRoomMessage(roomId, message = {}) {
      const resolvedRoomId = String(roomId || '').trim();
      if (!resolvedRoomId) return null;
      const saved = {
        ...message,
        roomId: resolvedRoomId,
        relayId: message.relayId || makeId('peer_room'),
        fromPeerId: message.fromPeerId || null,
        createdAt: Number(message.createdAt || Date.now()),
        expiresAt: message.expiresAt || null,
        receivedAt: nowIso()
      };
      const messages = peerRoomMessages.get(resolvedRoomId) || [];
      messages.push(saved);
      peerRoomMessages.set(resolvedRoomId, messages);
      return saved;
    },
    listPeerRoomMessages(roomId, { after = 0, peerId = null, limit = 100 } = {}) {
      const minCreatedAt = Number(after || 0);
      return (peerRoomMessages.get(String(roomId || '').trim()) || []).filter((message) => {
        if (Number(message.createdAt || 0) <= minCreatedAt) return false;
        if (message.expiresAt && toEpochMs(message.expiresAt) < Date.now()) return false;
        if (peerId && message.fromPeerId === peerId) return false;
        return true;
      }).slice(0, Number(limit || 100));
    },
    listPeerRooms({ limit = 50 } = {}) {
      const rooms = [];
      for (const [roomId, messages] of peerRoomMessages.entries()) {
        const liveMessages = messages.filter((message) => !message.expiresAt || toEpochMs(message.expiresAt) >= Date.now());
        if (liveMessages.length === 0) continue;
        const peers = new Set(liveMessages.map((message) => message.fromPeerId).filter(Boolean));
        rooms.push({
          roomId,
          messageCount: liveMessages.length,
          peerCount: peers.size,
          lastMessageAt: Math.max(...liveMessages.map((message) => Number(message.createdAt || 0)))
        });
      }
      return rooms
        .sort((left, right) => Number(right.lastMessageAt || 0) - Number(left.lastMessageAt || 0))
        .slice(0, Number(limit || 50));
    },
    saveAdapterPublication(publication = {}) {
      const packHash = publication.packHash;
      if (!packHash) throw new Error('adapter publication packHash is required');
      const saved = {
        ...publication,
        createdAt: publication.createdAt || nowIso(),
        updatedAt: nowIso()
      };
      adapterPublications.set(packHash, saved);
      return saved;
    },
    getAdapterPublication(packHash) {
      return adapterPublications.get(packHash) || null;
    },
    listAdapterPublications({ capability = null, publisherId = null, visibility = null } = {}) {
      return Array.from(adapterPublications.values()).filter((publication) => (
        publication.revoked !== true
        && (!capability || publication.capabilities?.includes(capability))
        && (!publisherId || publication.publisher?.publisherId === publisherId)
        && (!visibility || publication.visibility === visibility)
      ));
    },
    revokeAdapterPublication(packHash, revocation) {
      const publication = adapterPublications.get(packHash);
      if (!publication) return null;
      const saved = { ...publication, revoked: true, revocation, updatedAt: nowIso() };
      adapterPublications.set(packHash, saved);
      return saved;
    },
    saveAdapterCanaryPublication(publication = {}) {
      const publicationHash = publication.publicationHash;
      if (!publicationHash) throw new Error('adapter canary publicationHash is required');
      const saved = {
        ...publication,
        storedAt: publication.storedAt || nowIso()
      };
      adapterCanaryPublications.set(publicationHash, saved);
      return saved;
    },
    getAdapterCanaryPublication(publicationHash) {
      return adapterCanaryPublications.get(publicationHash) || null;
    },
    listAdapterCanaryPublications({ canaryId = null, publisherId = null } = {}) {
      return Array.from(adapterCanaryPublications.values()).filter((publication) => (
        (!canaryId || publication.canaryId === canaryId)
        && (!publisherId || publication.publisher?.publisherId === publisherId)
      ));
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
      const current = reputationState.get(providerId) || {
        providerId,
        acceptedReceipts: 0,
        rejectedReceipts: 0,
        timeouts: 0,
        points: 0,
        updatedAt: nowIso()
      };
      const events = this.listPoolEventsForProvider(providerId);
      return events.length > 0
        ? projectProviderReputation(providerId, events, current)
        : current;
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
        adapterPublications: adapterPublications.size,
        adapterCanaryPublications: adapterCanaryPublications.size,
        commitments: commitmentEvents.size,
        reveals: revealEvents.size,
        poolEvents: poolEvents.length,
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
