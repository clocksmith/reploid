import { describe, expect, it } from 'vitest';

import { createFirestorePoolStore } from '../../server/pool/firebase-store.js';

const createFakeFirestore = () => {
  const records = new Map();
  const reference = (path) => ({
    path,
    async get() {
      return records.has(path)
        ? { exists: true, data: () => records.get(path) }
        : { exists: false, data: () => undefined };
    },
    async set(value) {
      records.set(path, structuredClone(value));
    }
  });
  return {
    collection(name) {
      return {
        doc(id) {
          return reference(`${name}/${id}`);
        }
      };
    },
    async runTransaction(callback) {
      const writes = [];
      const result = await callback({
        get: (docRef) => docRef.get(),
        set: (docRef, value) => writes.push([docRef, value])
      });
      for (const [docRef, value] of writes) await docRef.set(value);
      return result;
    }
  };
};

describe('Firestore-backed pool rate limits', () => {
  it('shares a fixed-window quota through the persistent store', async () => {
    const store = createFirestorePoolStore({ firestore: createFakeFirestore() });
    const inputs = {
      key: 'requester_alice',
      maxRequests: 2,
      bucketMs: 1000,
      now: 5000
    };

    expect(await store.consumeRateLimit(inputs)).toMatchObject({ allowed: true, count: 1 });
    expect(await store.consumeRateLimit(inputs)).toMatchObject({ allowed: true, count: 2 });
    expect(await store.consumeRateLimit(inputs)).toMatchObject({ allowed: false, count: 3 });
    expect(await store.consumeRateLimit({ ...inputs, now: 6000 })).toMatchObject({
      allowed: true,
      count: 1,
      resetAt: 7000
    });
  });
});
