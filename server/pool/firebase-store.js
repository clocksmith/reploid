/**
 * @fileoverview Firestore-backed pool store for Firebase deployment.
 */

import crypto from 'crypto';
import poolStore from './store.js';
import { assertPoolStoreContract } from './store-contract.js';
import {
  buildExpiredAssignmentJobPatch as buildSharedExpiredAssignmentJobPatch,
  canClaimJobForAssignment as canClaimSharedJobForAssignment,
  EXPIRABLE_ASSIGNMENT_STATUSES
} from './coordinator-transitions.js';
import {
  createReputationSeedEvent,
  hasLegacyReputationEvidence,
  projectProviderReputation,
  reputationEventIdFor
} from './reputation-projection.js';
import {
  attachRelayPage,
  cursorForRelayRecord,
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

const COLLECTIONS = Object.freeze({
  providers: 'providers',
  providerSessions: 'provider_sessions',
  jobs: 'jobs',
  assignments: 'assignments',
  receipts: 'receipts',
  receiptAcceptances: 'receipt_acceptances',
  commitmentEvents: 'commitment_events',
  revealEvents: 'reveal_events',
  poolEvents: 'pool_events',
  signalingSessions: 'signaling_sessions',
  signalingMessages: 'signaling_messages',
  signalingRelaySequences: 'signaling_relay_sequences',
  peerRoomMessages: 'peer_room_messages',
  peerRoomRelaySequences: 'peer_room_relay_sequences',
  pointsLedger: 'points_ledger',
  reputationState: 'reputation_state',
  auditChallenges: 'audit_challenges',
  adapterPublications: 'adapter_publications',
  adapterCanaryPublications: 'adapter_canary_publications',
  researchRecords: 'research_records',
  rateLimits: 'rate_limits'
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
    const snapshots = await Promise.all(expirableAssignmentStatuses.map((status) => (
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
    async consumeRateLimit({
      key,
      maxRequests = 30,
      bucketMs = 10000,
      now = Date.now()
    } = {}) {
      const normalizedKey = String(key || 'unknown');
      const bucketStart = Math.floor(Number(now) / bucketMs) * bucketMs;
      const resetAt = bucketStart + bucketMs;
      const bucketId = crypto
        .createHash('sha256')
        .update(`${normalizedKey}:${bucketStart}`)
        .digest('hex');
      const bucketRef = doc(COLLECTIONS.rateLimits, bucketId);
      const consume = async (transaction = null) => {
        const snapshot = transaction
          ? await transaction.get(bucketRef)
          : await bucketRef.get();
        const current = snapshot.exists ? Number(snapshot.data()?.count || 0) : 0;
        const count = current + 1;
        const record = {
          bucketId,
          keyHash: crypto.createHash('sha256').update(normalizedKey).digest('hex'),
          count,
          limit: maxRequests,
          bucketStart,
          resetAt,
          expiresAt: new Date(resetAt + bucketMs).toISOString(),
          updatedAt: nowIso()
        };
        if (transaction) transaction.set(bucketRef, record);
        else await bucketRef.set(record);
        return {
          allowed: count <= maxRequests,
          count,
          limit: maxRequests,
          resetAt
        };
      };
      if (typeof firestore.runTransaction === 'function') {
        return firestore.runTransaction((transaction) => consume(transaction));
      }
      return consume();
    },
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
        if (!job || !canClaimSharedJobForAssignment(job)) return null;
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
    async nextPendingAssignmentForProvider(providerId) {
      const snapshot = await collection(COLLECTIONS.assignments)
        .where('providerId', '==', providerId)
        .where('status', '==', 'assigned')
        .limit(1)
        .get();
      return snapshot.empty ? null : snapshot.docs[0].data();
    },
    async setProviderStatus(providerId, status) {
      const provider = await readDoc(COLLECTIONS.providers, providerId);
      if (!provider) return null;
      const next = { ...provider, status, updatedAt: nowIso() };
      return writeDoc(COLLECTIONS.providers, providerId, next, { merge: true });
    },
    async expireStaleAssignments() {
      const snapshots = await Promise.all(EXPIRABLE_ASSIGNMENT_STATUSES.map((status) => (
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
          const patch = buildSharedExpiredAssignmentJobPatch({
            job,
            assignment,
            receiptRecords: await api.listReceiptsForJob(job.jobId)
          });
          if (patch) await api.updateJob(assignment.jobId, patch);
        }
        if (assignment.providerId) {
          await api.setProviderStatus(assignment.providerId, 'available');
          await api.appendReputationEvent({
            type: 'timeout',
            category: 'reputation',
            providerId: assignment.providerId,
            assignmentId: assignment.assignmentId,
            jobId: assignment.jobId,
            reasons: ['assignment expired before completion']
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
    async saveAssignmentCommitment(assignmentId, commitment = {}) {
      const saved = {
        ...commitment,
        assignmentId,
        commitmentId: commitment.commitmentId || makeId('commitment'),
        createdAt: commitment.createdAt || nowIso(),
        updatedAt: nowIso()
      };
      return writeDoc(COLLECTIONS.commitmentEvents, assignmentId, saved, { merge: true });
    },
    async getAssignmentCommitment(assignmentId) {
      return readDoc(COLLECTIONS.commitmentEvents, assignmentId);
    },
    async listCommitmentsForJob(jobId) {
      const snapshot = await collection(COLLECTIONS.commitmentEvents)
        .where('jobId', '==', jobId)
        .get();
      return snapshot.docs.map((entry) => entry.data());
    },
    async saveAssignmentReveal(assignmentId, reveal = {}) {
      const saved = {
        ...reveal,
        assignmentId,
        revealId: reveal.revealId || makeId('reveal'),
        createdAt: reveal.createdAt || nowIso(),
        updatedAt: nowIso()
      };
      return writeDoc(COLLECTIONS.revealEvents, assignmentId, saved, { merge: true });
    },
    async getAssignmentReveal(assignmentId) {
      return readDoc(COLLECTIONS.revealEvents, assignmentId);
    },
    async listRevealsForJob(jobId) {
      const snapshot = await collection(COLLECTIONS.revealEvents)
        .where('jobId', '==', jobId)
        .get();
      return snapshot.docs.map((entry) => entry.data());
    },
    async appendPoolEvent(event = {}) {
      const eventId = event.eventId || makeId('pool_event');
      const saved = {
        eventId,
        ...event,
        createdAt: event.createdAt || nowIso()
      };
      return writeDoc(COLLECTIONS.poolEvents, eventId, saved);
    },
    async listPoolEventsForJob(jobId) {
      const snapshot = await collection(COLLECTIONS.poolEvents)
        .where('jobId', '==', jobId)
        .get();
      return snapshot.docs.map((entry) => entry.data());
    },
    async listPoolEventsForProvider(providerId) {
      const snapshot = await collection(COLLECTIONS.poolEvents)
        .where('providerId', '==', providerId)
        .get();
      return snapshot.docs
        .map((entry) => entry.data())
        .filter((event) => event.category === 'reputation');
    },
    async appendReputationEvent(event = {}) {
      const providerId = event.providerId;
      if (!providerId) throw new Error('reputation event providerId is required');
      const current = await api.getReputation(providerId);
      let events = await api.listPoolEventsForProvider(providerId);
      if (events.length === 0 && hasLegacyReputationEvidence(current)) {
        await api.appendPoolEvent(createReputationSeedEvent(providerId, current));
      }
      const eventId = event.eventId || reputationEventIdFor(event);
      await api.appendPoolEvent({
        ...event,
        ...(eventId ? { eventId } : {}),
        category: 'reputation'
      });
      events = await api.listPoolEventsForProvider(providerId);
      return api.updateReputation(providerId, projectProviderReputation(providerId, events, current));
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
      if (typeof firestore.runTransaction !== 'function') {
        throw new Error('Firestore transactions are required for durable signaling relay sequencing');
      }
      const messageRef = doc(COLLECTIONS.signalingMessages, `${sessionId}_${signalId}`);
      const sequenceRef = doc(COLLECTIONS.signalingRelaySequences, sessionId);
      const sessionRef = doc(COLLECTIONS.signalingSessions, sessionId);
      return firestore.runTransaction(async (transaction) => {
        const existing = await transaction.get(messageRef);
        const prior = resolveIdempotentRelay(existing.exists ? existing.data() : null, message, 'signal');
        if (prior) return prior;
        const sequenceSnapshot = await transaction.get(sequenceRef);
        const relaySequence = Number(sequenceSnapshot.data()?.nextSequence || 0) + 1;
        const saved = {
          ...message,
          sessionId,
          id: signalId,
          relaySequence,
          createdAt: message.createdAt || Date.now(),
          receivedAt: nowIso()
        };
        transaction.set(messageRef, stripUndefined(saved));
        transaction.set(sequenceRef, {
          sessionId,
          nextSequence: relaySequence,
          updatedAt: nowIso()
        });
        transaction.set(sessionRef, { ...session, updatedAt: nowIso() }, { merge: true });
        return saved;
      });
    },
    async listSignalMessages(sessionId, { after = 0, afterId = '', afterSequence = null, peerId = null, limit = 100 } = {}) {
      const cursor = normalizeRelayCursor({ after, afterId, afterSequence });
      let query = collection(COLLECTIONS.signalingMessages).where('sessionId', '==', sessionId);
      if (cursor.sequence !== null) {
        query = query.where('relaySequence', '>', cursor.sequence).orderBy('relaySequence', 'asc');
      } else {
        query = query.orderBy('createdAt', 'asc').orderBy('id', 'asc');
        if (cursor.createdAt > 0 || cursor.messageId) {
          query = query.startAfter(cursor.createdAt, cursor.messageId);
        }
      }
      const snapshot = await query.limit(Number(limit || 100)).get();
      const scanned = snapshot.docs.map((entry) => entry.data());
      const messages = scanned.filter((message) => {
        if (message.expiresAt && toEpochMs(message.expiresAt) < Date.now()) return false;
        if (peerId && message.fromPeerId === peerId) return false;
        if (peerId && message.toPeerId && message.toPeerId !== peerId) return false;
        return true;
      });
      return attachRelayPage(messages, scanned.length ? cursorForRelayRecord(scanned.at(-1), 'id') : null);
    },
    async appendPeerRoomMessage(roomId, message = {}) {
      const resolvedRoomId = String(roomId || '').trim();
      if (!resolvedRoomId) return null;
      const relayId = message.relayId || makeId('peer_room');
      if (typeof firestore.runTransaction !== 'function') {
        throw new Error('Firestore transactions are required for durable peer-room relay sequencing');
      }
      const messageRef = doc(COLLECTIONS.peerRoomMessages, `${resolvedRoomId}_${relayId}`);
      const sequenceRef = doc(COLLECTIONS.peerRoomRelaySequences, resolvedRoomId);
      return firestore.runTransaction(async (transaction) => {
        const existing = await transaction.get(messageRef);
        const prior = resolveIdempotentRelay(existing.exists ? existing.data() : null, message, 'peer room relay');
        if (prior) return prior;
        const sequenceSnapshot = await transaction.get(sequenceRef);
        const relaySequence = Number(sequenceSnapshot.data()?.nextSequence || 0) + 1;
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
        transaction.set(messageRef, stripUndefined(saved));
        transaction.set(sequenceRef, {
          roomId: resolvedRoomId,
          nextSequence: relaySequence,
          updatedAt: nowIso()
        });
        return saved;
      });
    },
    async listPeerRoomMessages(roomId, {
      after = 0,
      afterId = '',
      afterSequence = null,
      notBefore = 0,
      peerId = null,
      limit = 100
    } = {}) {
      const resolvedRoomId = String(roomId || '').trim();
      const cursor = normalizeRelayCursor({
        after: Math.max(Number(after || 0), Number(notBefore || 0)),
        afterId,
        afterSequence
      });
      let query = collection(COLLECTIONS.peerRoomMessages).where('roomId', '==', resolvedRoomId);
      if (cursor.sequence !== null) {
        query = query.where('relaySequence', '>', cursor.sequence).orderBy('relaySequence', 'asc');
      } else {
        query = query
          .where('createdAt', '>=', cursor.createdAt)
          .orderBy('createdAt', 'asc')
          .orderBy('relayId', 'asc');
        if (cursor.messageId) {
          query = query.startAfter(cursor.createdAt, cursor.messageId);
        }
      }
      const snapshot = await query.limit(Number(limit || 100)).get();
      const scanned = snapshot.docs.map((entry) => entry.data());
      const messages = scanned.filter((message) => {
        if (message.expiresAt && toEpochMs(message.expiresAt) < Date.now()) return false;
        if (peerId && message.fromPeerId === peerId) return false;
        return true;
      });
      return attachRelayPage(messages, scanned.length ? cursorForRelayRecord(scanned.at(-1), 'relayId') : null);
    },
    async listPeerRooms({ limit = 50 } = {}) {
      const messages = await listDocs(COLLECTIONS.peerRoomMessages);
      const rooms = new Map();
      for (const message of messages) {
        if (message.expiresAt && toEpochMs(message.expiresAt) < Date.now()) continue;
        const roomId = String(message.roomId || '').trim();
        if (!roomId) continue;
        const current = rooms.get(roomId) || {
          roomId,
          messageCount: 0,
          peerIds: new Set(),
          lastMessageAt: 0
        };
        current.messageCount += 1;
        if (message.fromPeerId) current.peerIds.add(message.fromPeerId);
        current.lastMessageAt = Math.max(current.lastMessageAt, Number(message.createdAt || 0));
        rooms.set(roomId, current);
      }
      return Array.from(rooms.values())
        .map((room) => ({
          roomId: room.roomId,
          messageCount: room.messageCount,
          peerCount: room.peerIds.size,
          lastMessageAt: room.lastMessageAt
        }))
        .sort((left, right) => Number(right.lastMessageAt || 0) - Number(left.lastMessageAt || 0))
        .slice(0, Number(limit || 50));
    },
    async saveResearchRecord(record = {}) {
      if (!record.recordHash) throw new Error('research recordHash is required');
      const existing = await readDoc(COLLECTIONS.researchRecords, record.recordHash);
      if (existing) return existing;
      return writeDoc(COLLECTIONS.researchRecords, record.recordHash, record, { merge: false });
    },
    async getResearchRecord(recordHash) {
      return readDoc(COLLECTIONS.researchRecords, recordHash);
    },
    async listResearchRecords({ roomId = null, kind = null, limit = 1000 } = {}) {
      const records = roomId
        ? (await collection(COLLECTIONS.researchRecords).where('roomId', '==', roomId).get()).docs.map((entry) => entry.data())
        : await listDocs(COLLECTIONS.researchRecords);
      return records
        .filter((record) => (!roomId || record.roomId === roomId) && (!kind || record.kind === kind))
        .sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')))
        .slice(-Math.max(1, Math.min(1000, Number(limit || 1000))));
    },
    async saveAdapterPublication(publication = {}) {
      const packHash = publication.packHash;
      if (!packHash) throw new Error('adapter publication packHash is required');
      const saved = {
        ...publication,
        createdAt: publication.createdAt || nowIso(),
        updatedAt: nowIso()
      };
      return writeDoc(COLLECTIONS.adapterPublications, packHash, saved, { merge: false });
    },
    async getAdapterPublication(packHash) {
      return readDoc(COLLECTIONS.adapterPublications, packHash);
    },
    async listAdapterPublications({ capability = null, publisherId = null, visibility = null } = {}) {
      const publications = await listDocs(COLLECTIONS.adapterPublications);
      return publications.filter((publication) => (
        publication.revoked !== true
        && (!capability || publication.capabilities?.includes(capability))
        && (!publisherId || publication.publisher?.publisherId === publisherId)
        && (!visibility || publication.visibility === visibility)
      ));
    },
    async revokeAdapterPublication(packHash, revocation) {
      const publication = await readDoc(COLLECTIONS.adapterPublications, packHash);
      if (!publication) return null;
      return writeDoc(COLLECTIONS.adapterPublications, packHash, {
        ...publication,
        revoked: true,
        revocation,
        updatedAt: nowIso()
      }, { merge: true });
    },
    async saveAdapterCanaryPublication(publication = {}) {
      const publicationHash = publication.publicationHash;
      if (!publicationHash) throw new Error('adapter canary publicationHash is required');
      return writeDoc(COLLECTIONS.adapterCanaryPublications, publicationHash, {
        ...publication,
        storedAt: publication.storedAt || nowIso()
      }, { merge: false });
    },
    async getAdapterCanaryPublication(publicationHash) {
      return readDoc(COLLECTIONS.adapterCanaryPublications, publicationHash);
    },
    async listAdapterCanaryPublications({ canaryId = null, publisherId = null } = {}) {
      const publications = await listDocs(COLLECTIONS.adapterCanaryPublications);
      return publications.filter((publication) => (
        (!canaryId || publication.canaryId === canaryId)
        && (!publisherId || publication.publisher?.publisherId === publisherId)
      ));
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
      const current = (await readDoc(COLLECTIONS.reputationState, providerId)) || defaultReputation(providerId);
      const events = await api.listPoolEventsForProvider(providerId);
      return events.length > 0
        ? projectProviderReputation(providerId, events, current)
        : current;
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
        commitments,
        reveals,
        poolEvents,
        ledger,
        audits,
        reputations,
        adapterPublications,
        adapterCanaryPublications,
        researchRecords
      ] = await Promise.all([
        listDocs(COLLECTIONS.providers),
        listDocs(COLLECTIONS.jobs),
        listDocs(COLLECTIONS.assignments),
        listDocs(COLLECTIONS.receipts),
        listDocs(COLLECTIONS.commitmentEvents),
        listDocs(COLLECTIONS.revealEvents),
        listDocs(COLLECTIONS.poolEvents),
        listDocs(COLLECTIONS.pointsLedger),
        listDocs(COLLECTIONS.auditChallenges),
        listDocs(COLLECTIONS.reputationState),
        listDocs(COLLECTIONS.adapterPublications),
        listDocs(COLLECTIONS.adapterCanaryPublications),
        listDocs(COLLECTIONS.researchRecords)
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
        researchRecords: researchRecords.length,
        researchRecordKinds: countBy(researchRecords, 'kind'),
        adapterPublications: adapterPublications.length,
        adapterCanaryPublications: adapterCanaryPublications.length,
        commitments: commitments.length,
        reveals: reveals.length,
        poolEvents: poolEvents.length,
        verifierAcceptedReceipts: receipts.filter((receipt) => receipt.verifierDecision?.accepted).length,
        pointsEvents: ledger.length,
        auditChallenges: audits.length,
        routingBlockedProviders: reputations.filter((reputation) => reputation.routingBlocked).length,
        generatedAt: nowIso()
      };
    }
  };

  return assertPoolStoreContract(api);
}

export function createFirebaseStore(options = {}) {
  if (!options.firestore) return poolStore;
  return createFirestorePoolStore(options);
}

export default createFirebaseStore;
