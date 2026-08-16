import { describe, expect, it } from 'vitest';

import { createFirestorePoolStore } from '../../server/pool/firebase-store.js';
import { createPoolStore } from '../../server/pool/store.js';
import { POOL_STORE_OPERATIONS, validatePoolStoreContract } from '../../server/pool/store-contract.js';

const createQueryableFirestore = () => {
  const records = new Map();
  const recordsFor = (name) => {
    const existing = records.get(name);
    if (existing) return existing;
    const created = new Map();
    records.set(name, created);
    return created;
  };
  const snapshotFor = (value) => ({
    exists: value !== undefined,
    data: () => value
  });
  const queryFor = (name, filters = [], orders = [], startAfterValues = null, resultLimit = null) => ({
    where(field, operator, value) {
      return queryFor(name, [...filters, { field, operator, value }], orders, startAfterValues, resultLimit);
    },
    orderBy(field, direction) {
      return queryFor(name, filters, [...orders, { field, direction }], startAfterValues, resultLimit);
    },
    startAfter(...values) {
      return queryFor(name, filters, orders, values, resultLimit);
    },
    limit(value) {
      return queryFor(name, filters, orders, startAfterValues, Number(value));
    },
    async get() {
      let values = Array.from(recordsFor(name).values());
      for (const filter of filters) {
        values = values.filter((entry) => {
          if (filter.operator === '==') return entry[filter.field] === filter.value;
          if (filter.operator === '>') return Number(entry[filter.field]) > Number(filter.value);
          if (filter.operator === '>=') return Number(entry[filter.field]) >= Number(filter.value);
          throw new Error(`Unsupported query operator: ${filter.operator}`);
        });
      }
      if (orders.length > 0) {
        values.sort((left, right) => {
          for (const order of orders) {
            const direction = order.direction === 'desc' ? -1 : 1;
            const leftValue = left[order.field];
            const rightValue = right[order.field];
            const difference = typeof leftValue === 'number' || typeof rightValue === 'number'
              ? Number(leftValue || 0) - Number(rightValue || 0)
              : String(leftValue || '').localeCompare(String(rightValue || ''));
            if (difference !== 0) return difference * direction;
          }
          return 0;
        });
      }
      if (startAfterValues) {
        values = values.filter((entry) => {
          for (let index = 0; index < orders.length; index += 1) {
            const order = orders[index];
            const left = entry[order.field];
            const right = startAfterValues[index];
            const difference = typeof left === 'number' || typeof right === 'number'
              ? Number(left || 0) - Number(right || 0)
              : String(left || '').localeCompare(String(right || ''));
            if (difference !== 0) return difference > 0;
          }
          return false;
        });
      }
      if (resultLimit !== null) values = values.slice(0, resultLimit);
      return {
        docs: values.map((value) => snapshotFor(value)),
        empty: values.length === 0
      };
    }
  });
  return {
    firestore: {
      collection(name) {
        return {
          ...queryFor(name),
          doc(id) {
            return {
              async get() {
                return snapshotFor(recordsFor(name).get(id));
              },
              async set(value) {
                recordsFor(name).set(id, structuredClone(value));
              }
            };
          }
        };
      },
      async runTransaction(callback) {
        const writes = [];
        const result = await callback({
          get: (reference) => reference.get(),
          set(reference, value, options) {
            writes.push({ reference, value, options });
          }
        });
        for (const write of writes) await write.reference.set(write.value, write.options);
        return result;
      }
    },
    seed(name, id, value) {
      recordsFor(name).set(id, structuredClone(value));
    }
  };
};

describe('Firestore-backed peer-room relay', () => {
  it('keeps the memory and Firestore stores on one coordinator operation contract', async () => {
    const fake = createQueryableFirestore();
    const firestoreApi = { ...fake.firestore };
    delete firestoreApi.runTransaction;
    const firestore = createFirestorePoolStore({ firestore: firestoreApi });
    const memory = createPoolStore();
    expect(POOL_STORE_OPERATIONS).toHaveLength(58);
    expect(validatePoolStoreContract(memory)).toEqual({ ok: true, missing: [] });
    expect(validatePoolStoreContract(firestore)).toEqual({ ok: true, missing: [] });

    const exerciseAssignmentRead = async (store) => {
      await store.registerProvider({ providerId: 'provider_contract', sessionId: 'session_contract' });
      await store.createJob({ jobId: 'job_contract' });
      await store.createAssignment({
        assignmentId: 'assignment_later', jobId: 'job_contract', providerId: 'provider_contract'
      });
      await store.createAssignment({
        assignmentId: 'assignment_earlier', jobId: 'job_contract', providerId: 'provider_contract'
      });
      await store.updateAssignment('assignment_later', { createdAt: '2026-08-01T00:00:02.000Z' });
      await store.updateAssignment('assignment_earlier', { createdAt: '2026-08-01T00:00:01.000Z' });
      const pending = await store.nextPendingAssignmentForProvider('provider_contract');
      const claimed = await store.nextAssignmentForProvider('provider_contract');
      return {
        pendingId: pending?.assignmentId,
        pendingStatus: pending?.status,
        claimedId: claimed?.assignmentId,
        claimedStatus: claimed?.status,
        claimedStarted: Boolean(claimed?.startedAt)
      };
    };

    const expected = {
      pendingId: 'assignment_earlier', pendingStatus: 'assigned',
      claimedId: 'assignment_earlier', claimedStatus: 'running', claimedStarted: true
    };
    await expect(exerciseAssignmentRead(memory)).resolves.toEqual(expected);
    await expect(exerciseAssignmentRead(firestore)).resolves.toEqual(expected);
  });

  it('preserves the first immutable research record and refuses a non-transactional Firestore adapter', async () => {
    const fake = createQueryableFirestore();
    const store = createFirestorePoolStore({ firestore: fake.firestore });
    const first = {
      recordHash: 'sha256:research-record',
      roomId: 'research-room',
      kind: 'research_submission',
      signature: 'first-signature'
    };
    const conflicting = { ...first, signature: 'later-signature', extra: 'must-not-overwrite' };

    expect(await store.saveResearchRecord(first)).toEqual(first);
    expect(await store.saveResearchRecord(conflicting)).toEqual(first);
    expect(await store.getResearchRecord(first.recordHash)).toEqual(first);

    const withoutTransactions = { ...fake.firestore };
    delete withoutTransactions.runTransaction;
    await expect(
      createFirestorePoolStore({ firestore: withoutTransactions }).saveResearchRecord(first)
    ).rejects.toThrow('Firestore transactions are required for immutable research-record publication');
  });

  it('applies the same expired-assignment agreement decision in both adapters', async () => {
    const fake = createQueryableFirestore();
    const stores = [createPoolStore(), createFirestorePoolStore({ firestore: fake.firestore })];
    const exerciseExpiry = async (store) => {
      await store.registerProvider({ providerId: 'provider_expired', sessionId: 'session_expired' });
      await store.registerProvider({ providerId: 'provider_live', sessionId: 'session_live' });
      await store.createJob({
        jobId: 'job_expiry', providerCount: 2,
        assignmentIds: ['assignment_expired', 'assignment_live'],
        agreement: { mode: 'redundant', requiredAgreement: 2, requiredProviders: 2 }
      });
      await store.createAssignment({
        assignmentId: 'assignment_expired', jobId: 'job_expiry', providerId: 'provider_expired',
        expiresAt: new Date(Date.now() - 1_000).toISOString()
      });
      await store.createAssignment({
        assignmentId: 'assignment_live', jobId: 'job_expiry', providerId: 'provider_live',
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      });
      await store.expireStaleAssignments();
      const job = await store.getJob('job_expiry');
      return {
        status: job?.status,
        retryable: job?.retryable,
        failedAssignmentIds: job?.failedAssignmentIds,
        timedOutProviderIds: job?.timedOutProviderIds,
        agreement: job?.agreement?.status,
        failureReason: job?.lastAssignmentFailure?.reason,
        expiredFromStatus: (await store.getAssignment('assignment_expired'))?.expiredFromStatus
      };
    };

    await expect(Promise.all(stores.map(exerciseExpiry))).resolves.toEqual([
      {
        status: 'redundant_disagreement', retryable: true,
        failedAssignmentIds: ['assignment_expired'], timedOutProviderIds: ['provider_expired'], agreement: 'rejected',
        failureReason: 'assignment_claim_expired', expiredFromStatus: 'assigned'
      },
      {
        status: 'redundant_disagreement', retryable: true,
        failedAssignmentIds: ['assignment_expired'], timedOutProviderIds: ['provider_expired'], agreement: 'rejected',
        failureReason: 'assignment_claim_expired', expiredFromStatus: 'assigned'
      }
    ]);
  });

  it('applies the same assignment and acceptance claim transitions in both adapters', async () => {
    const fake = createQueryableFirestore();
    const stores = [createPoolStore(), createFirestorePoolStore({ firestore: fake.firestore })];
    const exerciseClaims = async (store) => {
      await store.createJob({ jobId: 'job_claim', retryable: true });
      await store.updateJob('job_claim', { status: 'failed' });
      const assignmentClaim = await store.claimJobForAssignment('job_claim');
      const assignmentStatus = assignmentClaim?.status;
      const assignmentAttempts = assignmentClaim?.assignmentAttempts;
      const repeatedAssignmentClaim = await store.claimJobForAssignment('job_claim');
      const acceptanceClaim = await store.claimJobForAcceptance('job_claim');
      const acceptanceStatus = acceptanceClaim?.status;
      const repeatedAcceptanceClaim = await store.claimJobForAcceptance('job_claim');
      return {
        assignmentStatus,
        assignmentAttempts,
        repeatedAssignmentClaim,
        acceptanceStatus,
        repeatedAcceptanceClaim
      };
    };

    await expect(Promise.all(stores.map(exerciseClaims))).resolves.toEqual([
      {
        assignmentStatus: 'assignment_processing',
        assignmentAttempts: 0,
        repeatedAssignmentClaim: null,
        acceptanceStatus: 'acceptance_processing',
        repeatedAcceptanceClaim: null
      },
      {
        assignmentStatus: 'assignment_processing',
        assignmentAttempts: 0,
        repeatedAssignmentClaim: null,
        acceptanceStatus: 'acceptance_processing',
        repeatedAcceptanceClaim: null
      }
    ]);
  });

  it('applies each expired-assignment penalty once in both adapters', async () => {
    const fake = createQueryableFirestore();
    const stores = [createPoolStore(), createFirestorePoolStore({ firestore: fake.firestore })];
    const exercise = async (store) => {
      await store.registerProvider({ providerId: 'provider_once', sessionId: 'session_once' });
      await store.createJob({
        jobId: 'job_once',
        assignmentIds: ['assignment_once'],
        assignmentAttemptId: 1
      });
      await store.createAssignment({
        assignmentId: 'assignment_once',
        jobId: 'job_once',
        requesterId: 'requester_once',
        providerId: 'provider_once',
        assignmentAttemptId: 1,
        status: 'reveal_open',
        expiresAt: new Date(Date.now() - 1_000).toISOString()
      });
      await store.updateAssignment('assignment_once', { status: 'reveal_open' });
      const first = await store.expireStaleAssignments();
      const second = await store.expireStaleAssignments();
      const ledger = await store.listLedger('provider_once');
      const reputation = await store.getReputation('provider_once');
      return {
        first: first.length,
        second: second.length,
        penalties: ledger.filter((entry) => entry.reason === 'assignment_timeout').length,
        timeouts: reputation.timeouts,
        reason: (await store.getAssignment('assignment_once')).failureReason
      };
    };

    await expect(Promise.all(stores.map(exercise))).resolves.toEqual([
      { first: 1, second: 0, penalties: 1, timeouts: 1, reason: 'ring_reveal_missed' },
      { first: 1, second: 0, penalties: 1, timeouts: 1, reason: 'ring_reveal_missed' }
    ]);
  });

  it('allocates a durable per-session signal sequence and preserves idempotent signal ids', async () => {
    const fake = createQueryableFirestore();
    const store = createFirestorePoolStore({ firestore: fake.firestore });
    const session = await store.createSignalingSession({
      sessionId: 'sequenced-session',
      participantIds: ['requester_1', 'provider_1']
    });
    const first = await store.appendSignalMessage(session.sessionId, {
      id: 'signal-one',
      type: 'offer',
      fromPeerId: 'requester_1',
      idempotencyHash: 'sha256:signal-one',
      createdAt: 1
    });
    const duplicate = await store.appendSignalMessage(session.sessionId, {
      id: 'signal-one',
      type: 'offer',
      fromPeerId: 'requester_1',
      idempotencyHash: 'sha256:signal-one',
      createdAt: 999
    });
    const second = await store.appendSignalMessage(session.sessionId, {
      id: 'signal-two',
      type: 'answer',
      fromPeerId: 'provider_1',
      createdAt: 2
    });

    expect(first.relaySequence).toBe(1);
    expect(duplicate).toEqual(first);
    expect(second.relaySequence).toBe(2);

    const page = await store.listSignalMessages(session.sessionId, { afterSequence: 1 });
    expect(page.map((message) => message.id)).toEqual(['signal-two']);
    expect(page.nextCursor).toMatchObject({ sequence: 2, messageId: 'signal-two' });
  });

  it('allocates a durable per-room relay sequence and preserves idempotent relay ids', async () => {
    const fake = createQueryableFirestore();
    const store = createFirestorePoolStore({ firestore: fake.firestore });
    const roomId = 'sequenced-room';
    const first = await store.appendPeerRoomMessage(roomId, {
      relayId: 'relay-one',
      fromPeerId: 'provider_1',
      idempotencyHash: 'sha256:relay-one',
      createdAt: 1
    });
    const duplicate = await store.appendPeerRoomMessage(roomId, {
      relayId: 'relay-one',
      fromPeerId: 'provider_1',
      idempotencyHash: 'sha256:relay-one',
      createdAt: 999
    });
    const second = await store.appendPeerRoomMessage(roomId, {
      relayId: 'relay-two',
      fromPeerId: 'provider_2',
      createdAt: 2
    });

    expect(first.relaySequence).toBe(1);
    expect(duplicate).toEqual(first);
    expect(second.relaySequence).toBe(2);

    const page = await store.listPeerRoomMessages(roomId, { afterSequence: 1 });
    expect(page.map((message) => message.relayId)).toEqual(['relay-two']);
    expect(page.nextCursor).toMatchObject({ sequence: 2, messageId: 'relay-two' });
  });

  it('rejects reuse of a relay id for a different payload', async () => {
    const fake = createQueryableFirestore();
    const store = createFirestorePoolStore({ firestore: fake.firestore });
    await store.appendPeerRoomMessage('conflict-room', {
      relayId: 'reused-id',
      idempotencyHash: 'sha256:original'
    });

    await expect(store.appendPeerRoomMessage('conflict-room', {
      relayId: 'reused-id',
      idempotencyHash: 'sha256:replacement'
    })).rejects.toMatchObject({ code: 'relay_id_conflict' });
  });

  it('paginates same-millisecond signal messages by message id without loss', async () => {
    const fake = createQueryableFirestore();
    const sessionId = 'same-millisecond-session';
    for (const id of ['signal-a', 'signal-b', 'signal-c']) {
      fake.seed('signaling_messages', id, {
        id,
        sessionId,
        createdAt: 12345,
        fromPeerId: 'requester_1',
        type: 'ice-candidate'
      });
    }
    const store = createFirestorePoolStore({ firestore: fake.firestore });

    const firstPage = await store.listSignalMessages(sessionId, { limit: 2 });
    const secondPage = await store.listSignalMessages(sessionId, {
      after: firstPage.nextCursor.createdAt,
      afterId: firstPage.nextCursor.messageId,
      limit: 2
    });

    expect(firstPage.map((message) => message.id)).toEqual(['signal-a', 'signal-b']);
    expect(secondPage.map((message) => message.id)).toEqual(['signal-c']);
  });

  it('paginates same-millisecond peer-room messages by relay id without loss', async () => {
    const fake = createQueryableFirestore();
    const roomId = 'same-millisecond-room';
    for (const relayId of ['relay-a', 'relay-b', 'relay-c']) {
      fake.seed('peer_room_messages', relayId, {
        relayId,
        roomId,
        createdAt: 12345,
        expiresAt: Date.now() + 60_000
      });
    }
    const store = createFirestorePoolStore({ firestore: fake.firestore });

    const firstPage = await store.listPeerRoomMessages(roomId, { limit: 2 });
    const secondPage = await store.listPeerRoomMessages(roomId, {
      after: firstPage.nextCursor.createdAt,
      afterId: firstPage.nextCursor.messageId,
      limit: 2
    });

    expect(firstPage.map((message) => message.relayId)).toEqual(['relay-a', 'relay-b']);
    expect(secondPage.map((message) => message.relayId)).toEqual(['relay-c']);
  });

  it('filters expired room history before applying the message limit', async () => {
    const now = Date.now();
    const roomId = 'busy-default-room';
    const fake = createQueryableFirestore();
    for (let index = 0; index < 101; index += 1) {
      fake.seed('peer_room_messages', `expired-${index}`, {
        roomId,
        relayId: `expired-${index}`,
        createdAt: now - 10_000 + index,
        expiresAt: now - 1
      });
    }
    fake.seed('peer_room_messages', 'fresh', {
      roomId,
      relayId: 'fresh',
      createdAt: now - 100,
      expiresAt: now + 1000
    });
    const store = createFirestorePoolStore({ firestore: fake.firestore });

    const messages = await store.listPeerRoomMessages(roomId, {
      after: 0,
      notBefore: now - 2000,
      limit: 100
    });

    expect(messages.map((message) => message.relayId)).toEqual(['fresh']);
  });

  it('paginates the oldest unseen live messages without skipping a newer relay record', async () => {
    const now = Date.now();
    const roomId = 'busy-live-room';
    const fake = createQueryableFirestore();
    for (let index = 0; index < 120; index += 1) {
      fake.seed('peer_room_messages', `heartbeat-${index}`, {
        roomId,
        relayId: `heartbeat-${index}`,
        createdAt: now - 1500 + index,
        expiresAt: now + 60_000,
        type: 'provider-advert'
      });
    }
    fake.seed('peer_room_messages', 'fresh-nonce-response', {
      roomId,
      relayId: 'fresh-nonce-response',
      createdAt: now - 100,
      expiresAt: now + 60_000,
      type: 'provider-advert',
      body: {
        discoveryNonce: 'requester-nonce'
      }
    });
    const store = createFirestorePoolStore({ firestore: fake.firestore });

    const messages = await store.listPeerRoomMessages(roomId, {
      after: 0,
      notBefore: now - 2000,
      limit: 100
    });

    expect(messages).toHaveLength(100);
    expect(messages.at(-1)?.relayId).toBe('heartbeat-99');
    const nextPage = await store.listPeerRoomMessages(roomId, {
      after: messages.nextCursor.createdAt,
      afterId: messages.nextCursor.messageId,
      notBefore: now - 2000,
      limit: 100
    });
    expect(nextPage.map((message) => message.relayId)).toContain('fresh-nonce-response');
  });
});
