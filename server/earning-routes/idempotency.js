/**
 * @fileoverview Idempotency-Key bindings for the earning routes.
 *
 * A key is bound to its route, its authenticated caller (account, device or
 * operator actor) and the hash of the canonical request (path parameters and
 * body). A different request under a bound key is refused with
 * idempotency_conflict in every state, including while it is in progress.
 *
 * States:
 *   pending   a request holds the key under a lease and may be calling the component
 *   unknown   the call failed ambiguously: the component may have committed
 *   complete  the response is stored; retries replay it
 *   released  the call definitely produced no effect; the key is free again
 *
 * The component receives a key derived only from (route, caller, client
 * key, request hash), so every attempt of one request reaches the component
 * under the same key, whichever process or record holds the binding. A retry
 * of an unknown binding, or of a pending one whose lease expired (its
 * process stopped), reconciles by calling the component again under that key:
 * the component's own idempotency record returns its durable result instead
 * of acting twice. A retry while another holder's lease is live is refused
 * with the retryable idempotency_in_progress.
 */

import { randomUUID } from 'node:crypto';

import { canonicalJson, hashCanonical, sha256Hex } from '../ledger/domain.js';
import { createFirestoreLedgerBackend } from '../ledger/firestore-store.js';
import { createMemoryLedgerBackend } from '../ledger/memory-store.js';
import { assertLedgerBackend } from '../ledger/store-contract.js';
import { RouteError } from './http.js';

export const BINDING_SCHEMA = 'reploid.http-idempotency-binding/v2';
// Logical collection -> physical collection.
export const ROUTE_COLLECTIONS = Object.freeze({ bindings: 'http_idempotency_bindings' });

/** `state` survives backend re-creation, like the other stores' memory backends. */
export const createMemoryRouteBackend = ({ state } = {}) => createMemoryLedgerBackend({ state, collections: ROUTE_COLLECTIONS });
export const createFirestoreRouteBackend = ({ firestore, collectionPrefix = '' } = {}) => createFirestoreLedgerBackend({
  firestore, collectionPrefix, collections: ROUTE_COLLECTIONS
});

/** The key a component receives for one request: deterministic, never tied to a binding record's lifetime. */
export const componentKeyFor = ({ routeId, caller, key, requestHash }) => `http:${sha256Hex(canonicalJson({ routeId, caller, key, requestHash }))}`;

/**
 * @param {object} options
 * @param {object} options.backend transactional document backend over ROUTE_COLLECTIONS
 * @param {number} options.leaseMs how long a pending holder keeps the key before a retry may reconcile
 * @param {Function} options.nowMs () => epoch milliseconds
 */
export function createRouteIdempotency({ backend, leaseMs, nowMs } = {}) {
  assertLedgerBackend(backend);
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new TypeError('idempotency bindings need a positive leaseMs');
  if (typeof nowMs !== 'function') throw new TypeError('idempotency bindings need nowMs');
  const iso = (ms) => new Date(ms).toISOString();

  /** Change the binding only while it is still the one this holder took; returns whether it changed. */
  const update = (bindingId, accept, change) => backend.runTransaction(async (tx) => {
    const current = await tx.get('bindings', bindingId);
    if (!current || !accept(current)) return false;
    tx.set('bindings', bindingId, { ...current, ...change(current), updatedAt: iso(nowMs()) });
    return true;
  });

  return Object.freeze({
    kind: backend.kind,

    /**
     * Take the key for this request, in one transaction. Returns
     * { replay: { status, body } } for a completed request, or a handle with
     * the component key and complete / release / markUnknown. Throws
     * idempotency_conflict for a different request and idempotency_in_progress
     * while another holder's lease is live.
     */
    async begin({ routeId, caller, key, request }) {
      const bindingId = sha256Hex(`${canonicalJson({ routeId, caller })}\u0000${key}`);
      const requestHash = hashCanonical(request);
      const componentKey = componentKeyFor({ routeId, caller, key, requestHash });
      const holder = randomUUID();
      const taken = await backend.runTransaction(async (tx) => {
        const existing = await tx.get('bindings', bindingId);
        const now = nowMs();
        if (existing && existing.status !== 'released' && existing.requestHash !== requestHash) {
          throw new RouteError(409, 'idempotency_conflict', 'this Idempotency-Key was already used with a different request');
        }
        if (existing?.status === 'complete') return { replay: existing.response };
        if (existing?.status === 'pending' && existing.leaseUntilMs > now) {
          throw new RouteError(409, 'idempotency_in_progress', 'a request with this Idempotency-Key is in progress; retry it later', {
            retryAfter: Math.max(1, Math.ceil((existing.leaseUntilMs - now) / 1000))
          });
        }
        // Reconciling: an unknown outcome or an expired holder of this same request.
        const reconciling = Boolean(existing && existing.status !== 'released');
        const record = {
          schema: BINDING_SCHEMA, bindingId, routeId, caller, requestHash, componentKey,
          status: 'pending', holder, leaseUntilMs: now + leaseMs,
          attempts: (reconciling ? existing.attempts : 0) + 1,
          response: null, boundAt: reconciling ? existing.boundAt : iso(now), updatedAt: iso(now), completedAt: null
        };
        if (existing) tx.set('bindings', bindingId, record);
        else tx.create('bindings', bindingId, record);
        return { reconciling };
      });
      if (taken.replay) return { replay: taken.replay };
      const mine = (current) => current.status === 'pending' && current.holder === holder;
      return {
        bindingId,
        requestHash,
        componentKey,
        reconciling: taken.reconciling,
        /** Store the response; any attempt of the same request may complete it once. */
        complete: (response) => update(bindingId, (current) => current.requestHash === requestHash && current.status !== 'complete' && current.status !== 'released',
          () => ({ status: 'complete', holder: null, leaseUntilMs: null, response, completedAt: iso(nowMs()) })),
        /** A definite no-effect failure frees the key. */
        release: () => update(bindingId, mine, () => ({ status: 'released', holder: null, leaseUntilMs: null })),
        /** An ambiguous failure keeps the key for this request; the next retry reconciles at once. */
        markUnknown: () => update(bindingId, mine, () => ({ status: 'unknown', holder: null, leaseUntilMs: null }))
      };
    },

    /** The stored binding, for operators and tests. */
    async get({ routeId, caller, key }) {
      return backend.get('bindings', sha256Hex(`${canonicalJson({ routeId, caller })}\u0000${key}`));
    }
  });
}

export default createRouteIdempotency;
