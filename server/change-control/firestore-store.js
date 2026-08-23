/**
 * @fileoverview Firestore compare-and-append Change Passport store.
 */

import crypto from 'crypto';

const cloneJson = (value) => JSON.parse(JSON.stringify(value));
const documentId = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const eventId = (sequence) => String(sequence).padStart(12, '0');

const assertPrior = (snapshot, requestHash, label) => {
  if (!snapshot.exists) return null;
  const prior = snapshot.data();
  if (prior.requestHash !== requestHash) throw new Error(`${label} idempotency key reused with different input`);
  return cloneJson(prior.result);
};

export function createFirestoreChangeControlStore({ firestore, collectionPrefix = 'reploid' } = {}) {
  if (!firestore?.collection || typeof firestore.runTransaction !== 'function') {
    throw new Error('Firestore collection() and runTransaction() are required');
  }
  const prefix = String(collectionPrefix || '').trim();
  const collectionName = (name) => prefix ? `${prefix}_${name}` : name;
  const passports = firestore.collection(collectionName('change_passports'));
  const deliveries = firestore.collection(collectionName('change_control_deliveries'));
  const passportRef = (passportId) => passports.doc(documentId(passportId));
  const idempotencyRef = (passportId, key) => passportRef(passportId)
    .collection('idempotency')
    .doc(documentId(key));
  const deliveryRef = (source, deliveryId) => deliveries.doc(documentId(`${source}:${deliveryId}`));

  return {
    kind: 'firestore',

    async createPassport({ passportId, event, idempotencyKey, requestHash }) {
      const passport = passportRef(passportId);
      const idempotency = idempotencyRef(passportId, `create:${idempotencyKey}`);
      return firestore.runTransaction(async (transaction) => {
        const prior = assertPrior(await transaction.get(idempotency), requestHash, 'createPassport');
        if (prior) return prior;
        if ((await transaction.get(passport)).exists) throw new Error('passport already exists');
        const result = { passportId, sequence: 1, event: cloneJson(event) };
        transaction.set(passport, { passportId, eventCount: 1, createdAt: event.timestamp, updatedAt: event.timestamp });
        transaction.set(passport.collection('events').doc(eventId(1)), cloneJson(event));
        transaction.set(idempotency, { passportId, key: `create:${idempotencyKey}`, requestHash, result });
        return cloneJson(result);
      });
    },

    async appendEvent({ passportId, event, expectedSequence, idempotencyKey, requestHash }) {
      const passport = passportRef(passportId);
      const key = `append:${idempotencyKey}`;
      const idempotency = idempotencyRef(passportId, key);
      return firestore.runTransaction(async (transaction) => {
        const prior = assertPrior(await transaction.get(idempotency), requestHash, 'appendEvent');
        if (prior) return prior;
        const snapshot = await transaction.get(passport);
        if (!snapshot.exists) throw new Error('passport not found');
        const actualSequence = Number(snapshot.data().eventCount || 0);
        if (actualSequence !== expectedSequence) {
          const error = new Error(`passport sequence conflict: expected ${expectedSequence}, actual ${actualSequence}`);
          error.code = 'SEQUENCE_CONFLICT';
          error.actualSequence = actualSequence;
          throw error;
        }
        if (event.sequence !== expectedSequence + 1) throw new Error('event sequence does not follow expected sequence');
        const result = { passportId, sequence: event.sequence, event: cloneJson(event) };
        transaction.set(passport.collection('events').doc(eventId(event.sequence)), cloneJson(event));
        transaction.set(passport, { eventCount: event.sequence, updatedAt: event.timestamp }, { merge: true });
        transaction.set(idempotency, { passportId, key, requestHash, result });
        return cloneJson(result);
      });
    },

    async getEvents(passportId) {
      const passport = await passportRef(passportId).get();
      if (!passport.exists) return null;
      const snapshot = await passportRef(passportId).collection('events').orderBy('sequence', 'asc').get();
      return snapshot.docs.map((entry) => cloneJson(entry.data()));
    },

    async getIdempotency(passportId, key) {
      const snapshot = await idempotencyRef(passportId, key).get();
      return snapshot.exists ? cloneJson(snapshot.data()) : null;
    },

    async listPassportIds() {
      const snapshot = await passports.get();
      return snapshot.docs.map((entry) => entry.data().passportId).filter(Boolean).sort();
    },

    async saveDelivery({ source, deliveryId, requestHash, result }) {
      const reference = deliveryRef(source, deliveryId);
      return firestore.runTransaction(async (transaction) => {
        const prior = assertPrior(await transaction.get(reference), requestHash, 'delivery');
        if (prior) return prior;
        const stored = cloneJson(result);
        transaction.set(reference, { source, deliveryId, requestHash, result: stored });
        return cloneJson(stored);
      });
    },

    async getDelivery(source, deliveryId) {
      const snapshot = await deliveryRef(source, deliveryId).get();
      return snapshot.exists ? cloneJson(snapshot.data().result) : null;
    },

    async getDeliveryRecord(source, deliveryId) {
      const snapshot = await deliveryRef(source, deliveryId).get();
      if (!snapshot.exists) return null;
      const record = snapshot.data();
      return { requestHash: record.requestHash, result: cloneJson(record.result) };
    }
  };
}

export default createFirestoreChangeControlStore;
