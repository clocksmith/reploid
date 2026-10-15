/**
 * @fileoverview Idempotency-Key bindings for the earning routes.
 *
 * A key is bound to its route, its authenticated caller (account, device or
 * operator actor) and the hash of the canonical request (path parameters and
 * body). A later request with the same key from the same caller on the same
 * route must hash the same, or it is refused with idempotency_conflict; the
 * same key from another caller is a separate binding and never reaches the
 * first caller's result. As in the ledger, a request that fails leaves its
 * key free for a different request.
 *
 * The key each component receives derives from the binding, so component
 * idempotency records are per caller too, and a committed component record
 * still refuses a different request under that key.
 */

import { randomUUID } from 'node:crypto';

import { canonicalJson, hashCanonical, sha256Hex } from '../ledger/domain.js';
import { createFirestoreLedgerBackend } from '../ledger/firestore-store.js';
import { createMemoryLedgerBackend } from '../ledger/memory-store.js';
import { assertLedgerBackend } from '../ledger/store-contract.js';
import { RouteError } from './http.js';

export const BINDING_SCHEMA = 'reploid.http-idempotency-binding/v1';
// Logical collection -> physical collection.
export const ROUTE_COLLECTIONS = Object.freeze({ bindings: 'http_idempotency_bindings' });

/** `state` survives backend re-creation, like the other stores' memory backends. */
export const createMemoryRouteBackend = ({ state } = {}) => createMemoryLedgerBackend({ state, collections: ROUTE_COLLECTIONS });
export const createFirestoreRouteBackend = ({ firestore, collectionPrefix = '' } = {}) => createFirestoreLedgerBackend({
  firestore, collectionPrefix, collections: ROUTE_COLLECTIONS
});

/**
 * @param {object} options
 * @param {object} options.backend transactional document backend over ROUTE_COLLECTIONS
 * @param {Function} [options.clock] () => ISO time
 */
export function createRouteIdempotency({ backend, clock = () => new Date().toISOString() } = {}) {
  assertLedgerBackend(backend);
  return Object.freeze({
    kind: backend.kind,

    /**
     * Bind `key` for this route and caller to `request`. Returns the key the
     * component receives, the binding and request digests, and a release()
     * for a failed request.
     */
    async bind({ routeId, caller, key, request }) {
      const bindingId = sha256Hex(`${canonicalJson({ routeId, caller })}\u0000${key}`);
      const requestHash = hashCanonical(request);
      const holder = randomUUID();
      await backend.runTransaction(async (tx) => {
        const existing = await tx.get('bindings', bindingId);
        if (existing && existing.status === 'bound') {
          if (existing.requestHash !== requestHash) {
            throw new RouteError(409, 'idempotency_conflict', 'this Idempotency-Key was already used with a different request');
          }
          return;
        }
        const record = { schema: BINDING_SCHEMA, bindingId, routeId, caller, requestHash, status: 'bound', holder, boundAt: clock() };
        if (existing) tx.set('bindings', bindingId, record);
        else tx.create('bindings', bindingId, record);
      });
      return {
        componentKey: `http:${bindingId}`,
        bindingId,
        requestHash,
        /** A failed request frees the key, unless a concurrent request already rebound it. */
        release: () => backend.runTransaction(async (tx) => {
          const current = await tx.get('bindings', bindingId);
          if (current?.status === 'bound' && current.requestHash === requestHash && current.holder === holder) {
            tx.set('bindings', bindingId, { ...current, status: 'released', releasedAt: clock() });
          }
        })
      };
    }
  });
}

export default createRouteIdempotency;
