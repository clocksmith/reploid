import { describe, expect, it } from 'vitest';

import { createFirestorePoolStore } from '../../server/pool/firebase-store.js';

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
  const queryFor = (name, filters = [], order = null, resultLimit = null) => ({
    where(field, operator, value) {
      return queryFor(name, [...filters, { field, operator, value }], order, resultLimit);
    },
    orderBy(field, direction) {
      return queryFor(name, filters, { field, direction }, resultLimit);
    },
    limit(value) {
      return queryFor(name, filters, order, Number(value));
    },
    async get() {
      let values = Array.from(recordsFor(name).values());
      for (const filter of filters) {
        values = values.filter((entry) => {
          if (filter.operator === '==') return entry[filter.field] === filter.value;
          if (filter.operator === '>') return Number(entry[filter.field]) > Number(filter.value);
          throw new Error(`Unsupported query operator: ${filter.operator}`);
        });
      }
      if (order) {
        const direction = order.direction === 'desc' ? -1 : 1;
        values.sort((left, right) => (
          (Number(left[order.field]) - Number(right[order.field])) * direction
        ));
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
      }
    },
    seed(name, id, value) {
      recordsFor(name).set(id, structuredClone(value));
    }
  };
};

describe('Firestore-backed peer-room relay', () => {
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
});
