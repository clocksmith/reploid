/**
 * @fileoverview In-memory compare-and-append Change Passport store.
 */

import { canonicalChangePassportJson } from '../../self/shared/change-passport/contract.js';

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const assertIdempotency = (prior, requestHash, label) => {
  if (!prior) return null;
  if (prior.requestHash !== requestHash) throw new Error(`${label} idempotency key reused with different input`);
  return cloneJson(prior.result);
};

export function createMemoryChangeControlStore() {
  const passports = new Map();
  const idempotency = new Map();
  const deliveries = new Map();

  return {
    kind: 'memory',

    async createPassport({ passportId, event, idempotencyKey, requestHash }) {
      const key = `create:${passportId}:${idempotencyKey}`;
      const prior = assertIdempotency(idempotency.get(key), requestHash, 'createPassport');
      if (prior) return prior;
      if (passports.has(passportId)) throw new Error('passport already exists');
      const events = [cloneJson(event)];
      passports.set(passportId, events);
      const result = { passportId, sequence: 1, event: cloneJson(event) };
      idempotency.set(key, { requestHash, result: cloneJson(result) });
      return result;
    },

    async appendEvent({ passportId, event, expectedSequence, idempotencyKey, requestHash }) {
      const key = `append:${passportId}:${idempotencyKey}`;
      const prior = assertIdempotency(idempotency.get(key), requestHash, 'appendEvent');
      if (prior) return prior;
      const events = passports.get(passportId);
      if (!events) throw new Error('passport not found');
      if (events.length !== expectedSequence) {
        const error = new Error(`passport sequence conflict: expected ${expectedSequence}, actual ${events.length}`);
        error.code = 'SEQUENCE_CONFLICT';
        error.actualSequence = events.length;
        throw error;
      }
      if (event.sequence !== expectedSequence + 1) throw new Error('event sequence does not follow expected sequence');
      events.push(cloneJson(event));
      const result = { passportId, sequence: events.length, event: cloneJson(event) };
      idempotency.set(key, { requestHash, result: cloneJson(result) });
      return result;
    },

    async getEvents(passportId) {
      const events = passports.get(passportId);
      return events ? cloneJson(events) : null;
    },

    async getIdempotency(passportId, key) {
      const scope = key.startsWith('create:') ? 'create' : 'append';
      const operationKey = key.replace(/^(?:create|append):/, '');
      const prior = idempotency.get(`${scope}:${passportId}:${operationKey}`);
      return prior ? cloneJson(prior) : null;
    },

    async listPassportIds() {
      return [...passports.keys()].sort();
    },

    async saveDelivery({ source, deliveryId, requestHash, result }) {
      const key = `${source}:${deliveryId}`;
      const prior = assertIdempotency(deliveries.get(key), requestHash, 'delivery');
      if (prior) return prior;
      const stored = cloneJson(result);
      deliveries.set(key, { requestHash, result: stored });
      return cloneJson(stored);
    },

    async getDelivery(source, deliveryId) {
      const prior = deliveries.get(`${source}:${deliveryId}`);
      return prior ? cloneJson(prior.result) : null;
    },

    async getDeliveryRecord(source, deliveryId) {
      const prior = deliveries.get(`${source}:${deliveryId}`);
      return prior ? cloneJson(prior) : null;
    },

    _debug: {
      passports,
      idempotency,
      deliveries,
      snapshot: () => canonicalChangePassportJson({
        passports: [...passports.entries()],
        idempotency: [...idempotency.entries()],
        deliveries: [...deliveries.entries()]
      })
    }
  };
}

export default createMemoryChangeControlStore;
