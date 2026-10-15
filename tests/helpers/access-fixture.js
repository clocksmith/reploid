// Shared fixture for purchase reconciliation, reversals and Community Access.
// Test-only values; none is a product price, quantity, limit or guarantee decision.
import { expect } from 'vitest';

import { PRODUCT_ECONOMICS_CONTRACT_ID } from '../../server/ledger/domain.js';
import { createFirestoreLedgerStore } from '../../server/ledger/firestore-store.js';
import { createMemoryLedgerState, createMemoryLedgerStore } from '../../server/ledger/memory-store.js';
import { createFirestoreCommunityAccessBackend, createMemoryCommunityAccessBackend } from '../../server/community-access/stores.js';
import { createFirestorePaymentBackend, createMemoryPaymentBackend } from '../../server/payments/stores.js';
import { createFakeFirestore } from './fake-firestore.js';

export const LEDGER_POLICY = Object.freeze({
  accountingVersion: 'test-accounting/1',
  contract: { id: PRODUCT_ECONOMICS_CONTRACT_ID, documentRevision: 'test-document-revision' },
  unit: { name: 'credit', minorUnitsPerCredit: 1 },
  rounding: 'ceil',
  lotConsumptionOrder: ['community_access', 'earned', 'subsidized', 'donated', 'purchased'],
  transfers: { enabled: false }
});

export const START = Date.parse('2026-10-14T00:00:00.000Z');
export const MIN = 60_000;
export const DAY = 24 * 60 * MIN;
// Mutable fixture state, reset by resetFixture().
export const fx = { nowMs: START, participants: new Map(), capacity: null };
export const clock = () => new Date(fx.nowMs).toISOString();
export const at = (offsetMs) => new Date(fx.nowMs + offsetMs).toISOString();
export const advance = (ms) => { fx.nowMs += ms; };
export const resetFixture = () => {
  fx.nowMs = START;
  fx.participants = new Map();
  fx.capacity = null;
};

// Authenticated account port double.
export const accounts = { participantAccount: async (participantId) => fx.participants.get(participantId) ?? null };

export const rejectsWith = (promise, code) => expect(promise).rejects.toMatchObject({ code });

// Ledger issuance authority composed from per-provenance decision ports;
// provenance without a route stands in for its own owner and is allowed.
export const composeIssuance = (routes) => async (request) => (routes[request.provenance]
  ? routes[request.provenance](request)
  : { allowed: true, decisionId: `test-authority:${request.provenance}` });

const fireOnce = (faults, point) => () => {
  const fault = faults[point];
  faults[point] = null;
  if (fault) fault();
};
const memoryHooks = (faults) => ({ beforeCommit: fireOnce(faults, 'beforeCommit'), afterCommit: fireOnce(faults, 'afterCommit') });

// Each harness owns durable state per component; every open*() call models a
// (re)started process over that state. faults.<component>.beforeCommit /
// afterCommit fire once on that component's next commit.
export const harnesses = {
  memory: () => {
    const states = { ledger: createMemoryLedgerState(), payments: createMemoryLedgerState(), community: createMemoryLedgerState() };
    const faults = Object.fromEntries(Object.keys(states).map((name) => [name, { beforeCommit: null, afterCommit: null }]));
    return {
      faults,
      openLedger: (options) => createMemoryLedgerStore({ state: states.ledger, hooks: memoryHooks(faults.ledger), policy: LEDGER_POLICY, clock, ...options }),
      openPaymentBackend: () => createMemoryPaymentBackend({ state: states.payments, hooks: memoryHooks(faults.payments) }),
      openCommunityBackend: () => createMemoryCommunityAccessBackend({ state: states.community, hooks: memoryHooks(faults.community) })
    };
  },
  firestore: () => {
    const stores = { ledger: createFakeFirestore(), payments: createFakeFirestore(), community: createFakeFirestore() };
    return {
      faults: Object.fromEntries(Object.entries(stores).map(([name, firestore]) => [name, firestore.faults])),
      openLedger: (options) => createFirestoreLedgerStore({ firestore: stores.ledger, collectionPrefix: 'test', policy: LEDGER_POLICY, clock, ...options }),
      openPaymentBackend: () => createFirestorePaymentBackend({ firestore: stores.payments, collectionPrefix: 'test' }),
      openCommunityBackend: () => createFirestoreCommunityAccessBackend({ firestore: stores.community, collectionPrefix: 'test' })
    };
  }
};

export const crash = (message) => () => { throw new Error(message); };

const outputRate = (base, denominator) => ({ kind: 'metered', base, rates: [{ meter: 'output', numerator: 1, denominator }] });

// Quote terms with a maximum charge of 60: full settlement charges 10 + output/2.
export const quoteTerms = ({ maxCharge = 60, validForMs = 30 * MIN } = {}) => ({
  service: {
    serviceRecordId: 'svc_chat_test',
    model: { modelId: 'model_test', checkpoint: 'sha256:checkpoint', deployedRepresentation: 'q4k-test', tokenizer: 'tok_test', adapters: [] },
    runtime: { runtimeId: 'doppler@test' },
    operation: 'chat.completion',
    limits: {
      context: { max: 4096, unit: 'token', exceedance: 'reject' },
      output: { max: 100, unit: 'token', exceedance: 'stop_and_report' }
    },
    qualityPolicyVersion: 'quality-policy-test/1',
    recipientScope: { policyId: 'remote-permission-test' },
    disclosureScope: { scopeId: 'thread-disclosure-test' },
    queueClass: 'community',
    deadline: at(validForMs + 10 * MIN)
  },
  pricing: { basis: { kind: 'test_per_output_token' }, maxCharge },
  terms: {
    validUntil: at(validForMs),
    reservationPeriodMs: 10 * MIN,
    queue: { behavior: 'fair_bounded', maxWaitMs: 10 * MIN },
    execution: { maxAttempts: 2, maxDurationMs: 120_000 },
    refund: { policyId: 'refund-terms-test' },
    qualityReview: { procedureId: 'quality-review-test' },
    settlement: {
      full: outputRate(10, 2),
      reduced: outputRate(0, 4),
      partialDelivery: outputRate(0, 2),
      cancellationQueued: { kind: 'fixed', amount: 0 },
      cancellationDispatched: outputRate(0, 2),
      timeout: { kind: 'fixed', amount: 0 },
      providerFailure: { kind: 'fixed', amount: 0 },
      failedQuality: { kind: 'fixed', amount: 0 }
    }
  }
});

/** Quote, accept and bind one attempt; returns the reservation id. */
export async function reserve(ledger, accountId, quoteId, { deviceId = 'phone' } = {}) {
  const quote = await ledger.createQuote({ ...quoteTerms(), quoteId, accountId, idempotencyKey: `quote:${quoteId}` });
  const { reservationId } = await ledger.acceptQuote({ quoteId, accountId, quoteHash: quote.quoteHash, deviceId, idempotencyKey: `accept:${quoteId}` });
  return reservationId;
}

/** Bind an attempt and settle in full; output 40 charges 30 under quoteTerms(). */
export async function deliver(ledger, reservationId, { output = 40 } = {}) {
  await ledger.bindAttempt({ reservationId, attemptId: 'a1', recipients: ['peer_x'], idempotencyKey: `bind:${reservationId}` });
  return ledger.settleReservation({
    reservationId, billableEventId: `bill:${reservationId}`, outcome: 'full', attemptId: 'a1',
    metering: { output }, completedAt: clock(), idempotencyKey: `settle:${reservationId}`
  });
}

/** One spend of 30 from an account's balance. */
export async function spend(ledger, accountId, quoteId) {
  return deliver(ledger, await reserve(ledger, accountId, quoteId));
}

export const journalShape = async (ledger, accountId) => (await ledger.listJournal(accountId)).map((entry) => [entry.type, entry.amount]);
