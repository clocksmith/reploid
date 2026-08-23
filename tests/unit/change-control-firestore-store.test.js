import { describe, expect, it } from 'vitest';

import { createFirestoreChangeControlStore } from '../../server/change-control/firestore-store.js';

const clone = (value) => value === undefined ? undefined : structuredClone(value);

const createFakeFirestore = () => {
  const records = new Map();
  let queue = Promise.resolve();
  const snapshot = (path) => ({
    exists: records.has(path),
    data: () => clone(records.get(path))
  });
  const directChildren = (collectionPath) => [...records.entries()]
    .filter(([entryPath]) => {
      if (!entryPath.startsWith(`${collectionPath}/`)) return false;
      return entryPath.slice(collectionPath.length + 1).split('/').length === 1;
    })
    .map(([entryPath, value]) => ({ id: entryPath.split('/').at(-1), data: () => clone(value) }));
  const reference = (path) => ({
    path,
    async get() { return snapshot(path); },
    collection(name) { return collection(`${path}/${name}`); }
  });
  const collection = (path) => ({
    path,
    doc(id) { return reference(`${path}/${id}`); },
    orderBy(field, direction) {
      return {
        async get() {
          const docs = directChildren(path).sort((left, right) => {
            const delta = Number(left.data()[field]) - Number(right.data()[field]);
            return direction === 'desc' ? -delta : delta;
          });
          return { docs };
        }
      };
    },
    async get() { return { docs: directChildren(path) }; }
  });
  return {
    collection,
    runTransaction(operation) {
      const pending = queue.then(() => operation({
        get: (ref) => Promise.resolve(snapshot(ref.path)),
        set: (ref, value, options = {}) => {
          const prior = records.get(ref.path) || {};
          records.set(ref.path, clone(options.merge ? { ...prior, ...value } : value));
        }
      }));
      queue = pending.catch(() => {});
      return pending;
    }
  };
};

const event = (sequence, type = sequence === 1 ? 'passport.created' : 'evidence.admitted') => ({
  passportId: 'passport:firestore:1',
  sequence,
  type,
  timestamp: `2026-08-22T20:00:0${sequence}.000Z`
});

describe('Firestore Change Passport store', () => {
  it('persists compare-and-append events, idempotency records, and deliveries', async () => {
    const store = createFirestoreChangeControlStore({ firestore: createFakeFirestore(), collectionPrefix: 'test' });
    const created = await store.createPassport({
      passportId: 'passport:firestore:1',
      event: event(1),
      idempotencyKey: 'create',
      requestHash: 'request:create'
    });
    const retry = await store.createPassport({
      passportId: 'passport:firestore:1',
      event: event(1),
      idempotencyKey: 'create',
      requestHash: 'request:create'
    });
    expect(retry).toEqual(created);

    await store.appendEvent({
      passportId: 'passport:firestore:1',
      event: event(2),
      expectedSequence: 1,
      idempotencyKey: 'append:1',
      requestHash: 'request:append:1'
    });
    expect(await store.getEvents('passport:firestore:1')).toEqual([event(1), event(2)]);
    expect(await store.listPassportIds()).toEqual(['passport:firestore:1']);
    expect(await store.getIdempotency('passport:firestore:1', 'append:append:1')).toMatchObject({
      requestHash: 'request:append:1'
    });

    await store.saveDelivery({
      source: 'github_webhook',
      deliveryId: 'delivery:1',
      requestHash: 'request:delivery:1',
      result: { accepted: true }
    });
    expect(await store.getDelivery('github_webhook', 'delivery:1')).toEqual({ accepted: true });
    expect(await store.getDeliveryRecord('github_webhook', 'delivery:1')).toEqual({
      requestHash: 'request:delivery:1',
      result: { accepted: true }
    });
  });

  it('allows only one concurrent append at the expected sequence', async () => {
    const store = createFirestoreChangeControlStore({ firestore: createFakeFirestore() });
    await store.createPassport({
      passportId: 'passport:firestore:1',
      event: event(1),
      idempotencyKey: 'create',
      requestHash: 'request:create'
    });
    const outcomes = await Promise.allSettled([
      store.appendEvent({
        passportId: 'passport:firestore:1',
        event: event(2),
        expectedSequence: 1,
        idempotencyKey: 'append:a',
        requestHash: 'request:a'
      }),
      store.appendEvent({
        passportId: 'passport:firestore:1',
        event: { ...event(2), type: 'evidence.excluded' },
        expectedSequence: 1,
        idempotencyKey: 'append:b',
        requestHash: 'request:b'
      })
    ]);
    expect(outcomes.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((entry) => entry.status === 'rejected')[0].reason).toMatchObject({
      code: 'SEQUENCE_CONFLICT',
      actualSequence: 2
    });
  });
});
