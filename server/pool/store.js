/**
 * @fileoverview In-memory store for the Reploid pool coordinator.
 */

import crypto from 'crypto';
import { assertPoolStoreContract } from './store-contract.js';
import {
  buildAcceptanceClaimPatch,
  buildAssignmentClaimPatch,
  buildAssignmentExpirationPatch,
  buildAssignmentStartPatch,
  buildExpiredAssignmentJobPatch as buildSharedExpiredAssignmentJobPatch,
  EXPIRABLE_ASSIGNMENT_STATUSES,
  selectNextAssignmentForProvider
} from './coordinator-transitions.js';
import {
  createReputationSeedEvent,
  hasLegacyReputationEvidence,
  projectProviderReputation,
  reputationEventIdFor
} from './reputation-projection.js';
import {
  attachRelayPage,
  compareRelayCursors,
  cursorForRelayRecord,
  isAfterRelayCursor,
  normalizeRelayCursor
} from './relay-cursor.js';

const makeId = (prefix) => `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
const nowIso = () => new Date().toISOString();
const rejectRelayIdConflict = (kind) => {
  const error = new Error(`${kind} id is already bound to a different relay payload`);
  error.code = 'relay_id_conflict';
  throw error;
};
const resolveIdempotentRelay = (existing, incoming, kind) => {
  if (!existing) return null;
  if (existing.idempotencyHash && incoming.idempotencyHash === existing.idempotencyHash) return existing;
  return rejectRelayIdConflict(kind);
};
const toEpochMs = (value) => {
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  const signalingRelaySequences = new Map();
  const signalingMessageById = new Map();
  const peerRoomMessages = new Map();
  const peerRoomRelaySequences = new Map();
  const peerRoomMessageById = new Map();
  const adapterPublications = new Map();
  const adapterCanaryPublications = new Map();
  const researchRecords = new Map();
  const rateLimits = new Map();

  const api = {
    kind: 'memory',
    consumeRateLimit({
      key,
      maxRequests = 30,
      bucketMs = 10000,
      now = Date.now()
    } = {}) {
      const normalizedKey = String(key || 'unknown');
      const bucketStart = Math.floor(Number(now) / bucketMs) * bucketMs;
      const bucketKey = `${normalizedKey}:${bucketStart}`;
      const previous = rateLimits.get(bucketKey) || {
        count: 0,
        resetAt: bucketStart + bucketMs
      };
      const count = previous.count + 1;
      rateLimits.set(bucketKey, { count, resetAt: previous.resetAt });
      if (rateLimits.size > 10000) {
        for (const [candidateKey, candidate] of rateLimits) {
          if (candidate.resetAt <= now) rateLimits.delete(candidateKey);
        }
      }
      return {
        allowed: count <= maxRequests,
        count,
        limit: maxRequests,
        resetAt: previous.resetAt
      };
    },
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
        && EXPIRABLE_ASSIGNMENT_STATUSES.includes(assignment.status)
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
      const patch = buildAssignmentClaimPatch(job);
      if (!patch) return null;
      Object.assign(job, patch, { updatedAt: nowIso() });
      return job;
    },
    claimJobForAcceptance(jobId) {
      const job = jobs.get(jobId);
      const patch = buildAcceptanceClaimPatch(job);
      if (!patch) return null;
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
      const assignment = selectNextAssignmentForProvider(Array.from(assignments.values()), providerId);
      const patch = buildAssignmentStartPatch(assignment, nowIso());
      if (!patch) return null;
      Object.assign(assignment, patch);
      assignment.updatedAt = nowIso();
      return assignment;
    },
    nextPendingAssignmentForProvider(providerId) {
      const assignment = selectNextAssignmentForProvider(Array.from(assignments.values()), providerId);
      return assignment ? { ...assignment } : null;
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
        if (!EXPIRABLE_ASSIGNMENT_STATUSES.includes(assignment.status)) continue;
        if (!assignment.expiresAt || Date.parse(assignment.expiresAt) >= now) continue;
        const observedAt = nowIso();
        const expirationPatch = buildAssignmentExpirationPatch(assignment, observedAt);
        if (!expirationPatch) continue;
        Object.assign(assignment, expirationPatch, { updatedAt: observedAt });
        expired.push(assignment);
        const job = jobs.get(assignment.jobId);
        if (job) {
          const patch = buildSharedExpiredAssignmentJobPatch({
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
            reasons: [assignment.failureReason]
          });
          this.appendLedger({
            eventType: 'points_penalized',
            reason: 'assignment_timeout',
            assignmentId: assignment.assignmentId,
            providerId: assignment.providerId,
            requesterId: assignment.requesterId,
            userId: assignment.providerId,
            points: -1,
            evidence: {
              failureReason: assignment.failureReason,
              expiredFromStatus: assignment.expiredFromStatus
            }
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
      const signalId = message.id || makeId('signal');
      const messageKey = `${sessionId}:${signalId}`;
      const existing = signalingMessageById.get(messageKey);
      const prior = resolveIdempotentRelay(existing, message, 'signal');
      if (prior) return prior;
      const relaySequence = (signalingRelaySequences.get(sessionId) || 0) + 1;
      const saved = {
        ...message,
        sessionId,
        id: signalId,
        relaySequence,
        createdAt: message.createdAt || Date.now(),
        receivedAt: nowIso()
      };
      const messages = signalingMessages.get(sessionId) || [];
      messages.push(saved);
      signalingMessages.set(sessionId, messages);
      signalingRelaySequences.set(sessionId, relaySequence);
      signalingMessageById.set(messageKey, saved);
      signalingSessions.set(sessionId, { ...session, updatedAt: nowIso() });
      return saved;
    },
    listSignalMessages(sessionId, { after = 0, afterId = '', afterSequence = null, peerId = null, limit = 100 } = {}) {
      const cursor = normalizeRelayCursor({ after, afterId, afterSequence });
      const messages = [];
      let nextCursor = null;
      const ordered = (signalingMessages.get(sessionId) || [])
        .filter((message) => isAfterRelayCursor(message, cursor, 'id'))
        .sort((left, right) => compareRelayCursors(
          cursorForRelayRecord(left, 'id'),
          cursorForRelayRecord(right, 'id')
        ));
      for (const message of ordered) {
        nextCursor = cursorForRelayRecord(message, 'id');
        if (message.expiresAt && toEpochMs(message.expiresAt) < Date.now()) continue;
        if (peerId && message.fromPeerId === peerId) continue;
        if (peerId && message.toPeerId && message.toPeerId !== peerId) continue;
        messages.push(message);
        if (messages.length >= Number(limit || 100)) break;
      }
      return attachRelayPage(messages, nextCursor);
    },
    appendPeerRoomMessage(roomId, message = {}) {
      const resolvedRoomId = String(roomId || '').trim();
      if (!resolvedRoomId) return null;
      const relayId = message.relayId || makeId('peer_room');
      const messageKey = `${resolvedRoomId}:${relayId}`;
      const existing = peerRoomMessageById.get(messageKey);
      const prior = resolveIdempotentRelay(existing, message, 'peer room relay');
      if (prior) return prior;
      const relaySequence = (peerRoomRelaySequences.get(resolvedRoomId) || 0) + 1;
      const saved = {
        ...message,
        roomId: resolvedRoomId,
        relayId,
        relaySequence,
        fromPeerId: message.fromPeerId || null,
        createdAt: Number(message.createdAt || Date.now()),
        expiresAt: message.expiresAt || null,
        receivedAt: nowIso()
      };
      const messages = peerRoomMessages.get(resolvedRoomId) || [];
      messages.push(saved);
      peerRoomMessages.set(resolvedRoomId, messages);
      peerRoomRelaySequences.set(resolvedRoomId, relaySequence);
      peerRoomMessageById.set(messageKey, saved);
      return saved;
    },
    listPeerRoomMessages(roomId, {
      after = 0,
      afterId = '',
      afterSequence = null,
      notBefore = 0,
      peerId = null,
      limit = 100
    } = {}) {
      const cursor = normalizeRelayCursor({
        after: Math.max(Number(after || 0), Number(notBefore || 0)),
        afterId,
        afterSequence
      });
      const messages = [];
      let nextCursor = null;
      const ordered = (peerRoomMessages.get(String(roomId || '').trim()) || [])
        .filter((message) => isAfterRelayCursor(message, cursor, 'relayId'))
        .sort((left, right) => compareRelayCursors(
          cursorForRelayRecord(left, 'relayId'),
          cursorForRelayRecord(right, 'relayId')
        ));
      for (const message of ordered) {
        nextCursor = cursorForRelayRecord(message, 'relayId');
        if (message.expiresAt && toEpochMs(message.expiresAt) < Date.now()) continue;
        if (peerId && message.fromPeerId === peerId) continue;
        messages.push(message);
        if (messages.length >= Number(limit || 100)) break;
      }
      return attachRelayPage(messages, nextCursor);
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
    saveResearchRecord(record = {}) {
      if (!record.recordHash) throw new Error('research recordHash is required');
      const existing = researchRecords.get(record.recordHash);
      if (existing) return existing;
      const saved = structuredClone(record);
      researchRecords.set(record.recordHash, saved);
      return structuredClone(saved);
    },
    getResearchRecord(recordHash) {
      const record = researchRecords.get(recordHash);
      return record ? structuredClone(record) : null;
    },
    listResearchRecords({ roomId = null, kind = null, limit = 1000 } = {}) {
      return Array.from(researchRecords.values())
        .filter((record) => (!roomId || record.roomId === roomId) && (!kind || record.kind === kind))
        .sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')))
        .slice(-Math.max(1, Math.min(1000, Number(limit || 1000))))
        .map((record) => structuredClone(record));
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
        researchRecords: researchRecords.size,
        researchRecordKinds: countBy(Array.from(researchRecords.values()), 'kind'),
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
  return assertPoolStoreContract(api);
}

export const poolStore = createPoolStore();

export default poolStore;
