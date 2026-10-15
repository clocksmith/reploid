import { beforeEach, describe, expect, it } from 'vitest';

import { PRODUCT_ECONOMICS_CONTRACT_ID, validateAccountingPolicy } from '../../server/ledger/domain.js';
import { createFirestoreLedgerStore } from '../../server/ledger/firestore-store.js';
import { createMemoryLedgerState, createMemoryLedgerStore } from '../../server/ledger/memory-store.js';
import { LEDGER_STORE_OPERATIONS, validateLedgerStoreContract } from '../../server/ledger/store-contract.js';

// Test-only accounting fixture. It is not a product pricing or reward decision.
const POLICY = Object.freeze({
  accountingVersion: 'test-accounting/1',
  contract: { id: PRODUCT_ECONOMICS_CONTRACT_ID, documentRevision: 'test-document-revision' },
  unit: { name: 'credit', minorUnitsPerCredit: 1 },
  rounding: 'ceil',
  lotConsumptionOrder: ['community_access', 'earned', 'donated', 'purchased'],
  transfers: { enabled: false }
});

const START = Date.parse('2026-10-14T00:00:00.000Z');
const MIN = 60_000;
let nowMs = START;
const clock = () => new Date(nowMs).toISOString();
const at = (offsetMs) => new Date(nowMs + offsetMs).toISOString();
const advance = (ms) => { nowMs += ms; };

const issuanceAuthority = async ({ provenance, amount }) => ({ allowed: true, decisionId: `test-capacity:${provenance}:${amount}` });
const storeOptions = { policy: POLICY, clock, issuanceAuthority };

// Firestore double with optimistic concurrency: a transaction whose read
// versions changed before commit, or that failed after reading documents that
// have since changed, is retried. This models the serializable reads the
// server SDK gives each transaction under contention.
const createFakeFirestore = () => {
  const docs = new Map();
  const faults = { beforeCommit: null, afterCommit: null };
  const stats = { commits: 0, retries: 0 };
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const snapshot = (path) => {
    const doc = docs.get(path);
    return { exists: Boolean(doc), data: () => structuredClone(doc?.data) };
  };
  const children = (name) => [...docs.entries()]
    .filter(([path]) => path.startsWith(`${name}/`) && !path.slice(name.length + 1).includes('/'))
    .map(([, doc]) => ({ data: () => structuredClone(doc.data) }));
  const fire = (point) => {
    const fault = faults[point];
    faults[point] = null;
    if (fault) fault();
  };
  return {
    faults,
    stats,
    collection: (name) => ({
      doc: (id) => ({
        path: `${name}/${id}`,
        async get() { await tick(); return snapshot(`${name}/${id}`); }
      }),
      where: (field, op, value) => ({
        async get() { await tick(); return { docs: children(name).filter((doc) => doc.data()[field] === value) }; }
      }),
      async get() { await tick(); return { docs: children(name) }; }
    }),
    async runTransaction(operation) {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const reads = new Map();
        const writes = [];
        const stale = () => [...reads].some(([path, version]) => (docs.get(path)?.version ?? 0) !== version);
        let result;
        try {
          result = await operation({
            async get(ref) {
              if (writes.length) throw new Error('Firestore transactions require all reads to be executed before all writes.');
              await tick();
              reads.set(ref.path, docs.get(ref.path)?.version ?? 0);
              return snapshot(ref.path);
            },
            set(ref, data) { writes.push({ create: false, path: ref.path, data: structuredClone(data) }); },
            create(ref, data) { writes.push({ create: true, path: ref.path, data: structuredClone(data) }); }
          });
        } catch (error) {
          if (!stale()) throw error;
          stats.retries += 1;
          continue;
        }
        // Commit is synchronous: validate read versions, then apply every write.
        if (stale()) {
          stats.retries += 1;
          continue;
        }
        if (writes.some((write) => write.create && docs.has(write.path))) throw new Error('ALREADY_EXISTS');
        fire('beforeCommit');
        for (const write of writes) docs.set(write.path, { version: (docs.get(write.path)?.version ?? 0) + 1, data: write.data });
        stats.commits += 1;
        fire('afterCommit');
        return result;
      }
      throw new Error('ABORTED: transaction contention');
    }
  };
};

// Each harness owns durable state; open() models a (re)started process over it.
const harnesses = {
  memory: () => {
    const state = createMemoryLedgerState();
    const faults = { beforeCommit: null, afterCommit: null };
    const fire = (point) => {
      const fault = faults[point];
      faults[point] = null;
      if (fault) fault();
    };
    const hooks = { beforeCommit: () => fire('beforeCommit'), afterCommit: () => fire('afterCommit') };
    return { faults, retries: () => null, open: (options = storeOptions) => createMemoryLedgerStore({ state, hooks, ...options }) };
  },
  firestore: () => {
    const firestore = createFakeFirestore();
    return {
      faults: firestore.faults,
      retries: () => firestore.stats.retries,
      open: (options = storeOptions) => createFirestoreLedgerStore({ firestore, collectionPrefix: 'test', ...options })
    };
  }
};

const baseService = () => ({
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
  queueClass: 'standard',
  deadline: at(3 * MIN)
});

const outputRate = (base, denominator) => ({ kind: 'metered', base, rates: [{ meter: 'output', numerator: 1, denominator }] });
const baseSettlement = () => ({
  full: outputRate(10, 2),
  reduced: outputRate(0, 4),
  partialDelivery: outputRate(0, 2),
  cancellationQueued: { kind: 'fixed', amount: 0 },
  cancellationDispatched: outputRate(0, 2),
  timeout: { kind: 'fixed', amount: 0 },
  providerFailure: { kind: 'fixed', amount: 0 },
  failedQuality: { kind: 'fixed', amount: 0 }
});

const quoteInput = ({ quoteId, accountId = 'acct_alice', maxCharge = 60, settlement = {}, terms = {}, service = {} } = {}) => ({
  quoteId,
  accountId,
  service: { ...baseService(), ...service },
  pricing: { basis: { kind: 'test_per_output_token' }, maxCharge },
  terms: {
    validUntil: at(MIN),
    reservationPeriodMs: 10 * MIN,
    queue: { behavior: 'fifo_bounded', maxWaitMs: 30_000 },
    execution: { maxAttempts: 2, maxDurationMs: 120_000 },
    refund: { policyId: 'refund-terms-test' },
    qualityReview: { procedureId: 'quality-review-test' },
    ...terms,
    settlement: { ...baseSettlement(), ...settlement }
  }
});

const rejectsWith = (promise, code) => expect(promise).rejects.toMatchObject({ code });
const throwsWith = (operation, code) => {
  let thrown = null;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toMatchObject({ code });
};

const fund = (ledger, accountId, amount, purchaseId = `purchase:${accountId}:${amount}`) => ledger.issueCredits({
  accountId,
  provenance: 'purchased',
  amount,
  source: { processor: 'test-processor', purchaseId, confirmationId: `confirm:${purchaseId}`, price: { amountMinor: 1999, currency: 'USD' } },
  idempotencyKey: `issue:${purchaseId}`
});

const earn = (ledger, accountId, amount, workId) => ledger.issueCredits({
  accountId,
  provenance: 'earned',
  amount,
  source: {
    category: 'computation', workId, offerId: `offer:${workId}`, validationId: `validation:${workId}`,
    validatorId: 'validator_test', outcome: 'accepted', validatedAt: clock()
  },
  idempotencyKey: `issue:${workId}`
});

const accept = async (ledger, quoteId, { accountId = 'acct_alice', deviceId = 'phone', ...overrides } = {}) => {
  const quote = await ledger.createQuote({ ...quoteInput({ quoteId, accountId, ...overrides }), idempotencyKey: `quote:${quoteId}` });
  const acceptance = await ledger.acceptQuote({
    quoteId, accountId, quoteHash: quote.quoteHash, deviceId, idempotencyKey: `accept:${quoteId}:${deviceId}`
  });
  return { quote, acceptance, reservationId: acceptance.reservationId };
};

const bind = (ledger, reservationId, attemptId, recipients = ['peer_x']) => ledger.bindAttempt({
  reservationId, attemptId, recipients, idempotencyKey: `bind:${reservationId}:${attemptId}`
});

const settle = (ledger, reservationId, { outcome = 'full', attemptId = 'a1', output = 40, key, ...rest } = {}) => ledger.settleReservation({
  reservationId,
  billableEventId: `bill:${reservationId}`,
  outcome,
  attemptId,
  metering: { output },
  completedAt: clock(),
  ...rest,
  idempotencyKey: key || `settle:${reservationId}:${outcome}`
});

const journalShape = async (ledger, accountId) => (await ledger.listJournal(accountId)).map((entry) => [entry.type, entry.amount]);

describe.each(Object.keys(harnesses))('credit ledger (%s store)', (kind) => {
  let harness;
  let ledger;

  beforeEach(async () => {
    nowMs = START;
    harness = harnesses[kind]();
    ledger = harness.open();
    await ledger.openAccount({ accountId: 'acct_alice', ownerId: 'uid_alice' });
    await ledger.openAccount({ accountId: 'acct_bob', ownerId: 'uid_bob' });
  });

  it('implements the store contract', () => {
    expect(validateLedgerStoreContract(ledger)).toEqual({ ok: true, missing: [] });
    expect(LEDGER_STORE_OPERATIONS).toContain('settleReservation');
  });

  it('states complete quote terms and binds the accepted terms for the validity window', async () => {
    await fund(ledger, 'acct_alice', 100);
    const incomplete = quoteInput({ quoteId: 'q_incomplete' });
    delete incomplete.service.model.checkpoint;
    delete incomplete.terms.settlement.timeout;
    incomplete.service.limits.output.exceedance = 'truncate';
    await expect(ledger.createQuote({ ...incomplete, idempotencyKey: 'quote:incomplete' })).rejects.toMatchObject({
      code: 'invalid_quote',
      details: { errors: expect.arrayContaining([
        'service.model.checkpoint is required',
        'terms.settlement.timeout must be a settlement formula',
        expect.stringContaining('no silent truncation')
      ]) }
    });
    await rejectsWith(ledger.createQuote({ ...quoteInput({ quoteId: 'q_over', maxCharge: 59 }), idempotencyKey: 'quote:over' }), 'invalid_quote');

    const quote = await ledger.createQuote({ ...quoteInput({ quoteId: 'q1' }), idempotencyKey: 'quote:q1' });
    expect(quote).toMatchObject({
      status: 'offered',
      contract: { id: PRODUCT_ECONOMICS_CONTRACT_ID, documentRevision: 'test-document-revision' },
      accountingVersion: 'test-accounting/1',
      pricing: { maxCharge: 60, basis: { kind: 'test_per_output_token' } },
      service: { model: { checkpoint: 'sha256:checkpoint' }, runtime: { runtimeId: 'doppler@test' }, queueClass: 'standard' },
      terms: { reservationPeriodMs: 10 * MIN, queue: { behavior: 'fifo_bounded' }, refund: { policyId: 'refund-terms-test' } }
    });
    expect(quote.quoteHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const acceptance = { quoteId: 'q1', accountId: 'acct_alice', quoteHash: quote.quoteHash, deviceId: 'phone', idempotencyKey: 'accept:q1' };
    await rejectsWith(ledger.acceptQuote({ ...acceptance, quoteHash: 'sha256:altered' }), 'quote_terms_mismatch');
    await rejectsWith(ledger.acceptQuote({ ...acceptance, accountId: 'acct_bob' }), 'quote_account_mismatch');
    const accepted = await ledger.acceptQuote(acceptance);
    expect(accepted).toMatchObject({ authorizedMax: 60, balance: { available: 40, held: 60 }, expiresAt: at(10 * MIN) });
    expect(await ledger.acceptQuote(acceptance)).toEqual(accepted);
    expect(await ledger.getQuote('q1')).toMatchObject({ status: 'accepted', reservationId: accepted.reservationId });

    const late = await ledger.createQuote({ ...quoteInput({ quoteId: 'q_late' }), idempotencyKey: 'quote:late' });
    advance(MIN);
    await rejectsWith(ledger.acceptQuote({ ...acceptance, quoteId: 'q_late', quoteHash: late.quoteHash, idempotencyKey: 'accept:late' }), 'quote_expired');
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 40, held: 60 });
  });

  it('reserves the maximum, then settles exactly once across duplicate and replayed messages', async () => {
    await fund(ledger, 'acct_alice', 100);
    const { quote, reservationId } = await accept(ledger, 'q1');
    await rejectsWith(settle(ledger, reservationId), 'attempt_not_bound');
    await bind(ledger, reservationId, 'a1', ['peer_x', 'peer_y']);
    const receipt = await settle(ledger, reservationId);
    expect(receipt).toMatchObject({
      outcome: 'full', charge: 30, released: 30, authorizedMax: 60,
      billableEventId: `bill:${reservationId}`, quoteHash: quote.quoteHash,
      attempt: { attemptId: 'a1', recipients: ['peer_x', 'peer_y'] },
      contract: { id: PRODUCT_ECONOMICS_CONTRACT_ID }, accountingVersion: 'test-accounting/1'
    });
    expect(await settle(ledger, reservationId)).toEqual(receipt);
    await rejectsWith(settle(ledger, reservationId, { key: 'settle:replayed' }), 'reservation_already_settled');
    await rejectsWith(settle(ledger, reservationId, { outcome: 'cancellation', key: 'cancel:late' }), 'reservation_already_settled');
    expect(await journalShape(ledger, 'acct_alice')).toEqual([['issue', 100], ['reserve', 60], ['charge', 30], ['release', 30]]);
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 70, held: 0, byProvenance: { purchased: { spent: 30 } } });
    expect(await ledger.auditAccount('acct_alice')).toMatchObject({ consistent: true, journalEntries: 4 });
  });

  it('converges to one economic effect when attempt and settlement messages arrive out of order', async () => {
    const scenario = async (order) => {
      const run = harnesses[kind]().open();
      await run.openAccount({ accountId: 'acct_alice', ownerId: 'uid_alice' });
      await fund(run, 'acct_alice', 100);
      const { reservationId } = await accept(run, 'q1');
      const messages = {
        bindA1: () => bind(run, reservationId, 'a1'),
        failA1: () => run.recordAttemptOutcome({ reservationId, attemptId: 'a1', status: 'failed', reason: 'connection_lost', idempotencyKey: 'fail:a1' }),
        bindA2: () => bind(run, reservationId, 'a2', ['peer_z']),
        settleA2: () => settle(run, reservationId, { attemptId: 'a2' })
      };
      const pending = order.map((name) => messages[name]);
      for (let pass = 0; pending.length && pass < 4; pass += 1) {
        for (const send of [...pending]) {
          try {
            await send();
            pending.splice(pending.indexOf(send), 1);
          } catch (error) {
            if (!error.retryable) pending.splice(pending.indexOf(send), 1);
          }
        }
      }
      const reservation = await run.getReservation(reservationId);
      return {
        charge: reservation.settlement.charge,
        account: await run.getAccount('acct_alice'),
        journal: await journalShape(run, 'acct_alice')
      };
    };
    const inOrder = await scenario(['bindA1', 'failA1', 'bindA2', 'settleA2']);
    const reordered = await scenario(['settleA2', 'settleA2', 'failA1', 'bindA2', 'bindA1', 'failA1', 'settleA2']);
    expect(inOrder.charge).toBe(30);
    expect(reordered).toEqual(inOrder);
    expect(reordered.journal).toEqual([['issue', 100], ['reserve', 60], ['charge', 30], ['release', 30]]);
  });

  it('keeps every retry under one acceptance within its authorized maximum', async () => {
    await fund(ledger, 'acct_alice', 200);
    const { quote, reservationId } = await accept(ledger, 'q1');
    await bind(ledger, reservationId, 'a1');
    await ledger.recordAttemptOutcome({ reservationId, attemptId: 'a1', status: 'failed', reason: 'provider_lost', idempotencyKey: 'fail:a1' });
    // A replacement recipient set binds under the same acceptance: no new per-request disclosure review.
    expect(await bind(ledger, reservationId, 'a2', ['peer_z', 'peer_w'])).toMatchObject({ attemptNumber: 2, status: 'bound' });
    await rejectsWith(bind(ledger, reservationId, 'a3'), 'attempt_active');
    await rejectsWith(settle(ledger, reservationId, { attemptId: 'a2', output: 101 }), 'metering_exceeds_limits');
    expect(await settle(ledger, reservationId, { attemptId: 'a2', output: 100 })).toMatchObject({
      charge: 60, released: 0, attempt: { attemptId: 'a2', attemptNumber: 2 }
    });
    await rejectsWith(ledger.acceptQuote({
      quoteId: 'q1', accountId: 'acct_alice', quoteHash: quote.quoteHash, deviceId: 'laptop', idempotencyKey: 'accept:q1:again'
    }), 'quote_already_accepted');
    await rejectsWith(bind(ledger, reservationId, 'a3'), 'reservation_already_settled');

    const second = await accept(ledger, 'q2');
    for (const attemptId of ['b1', 'b2']) {
      await bind(ledger, second.reservationId, attemptId);
      await ledger.recordAttemptOutcome({ reservationId: second.reservationId, attemptId, status: 'failed', reason: 'provider_lost', idempotencyKey: `fail:${attemptId}` });
    }
    await rejectsWith(bind(ledger, second.reservationId, 'b3'), 'attempt_limit_reached');
    expect(await settle(ledger, second.reservationId, { outcome: 'provider_failure', attemptId: 'b2' })).toMatchObject({ charge: 0, released: 60 });
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 140, held: 0, byProvenance: { purchased: { spent: 60 } } });
  });

  it('settles queued and dispatched cancellation from the accepted terms', async () => {
    await fund(ledger, 'acct_alice', 200);
    const queued = await accept(ledger, 'q_queued');
    expect(await ledger.settleReservation({
      reservationId: queued.reservationId, billableEventId: 'bill:queued', outcome: 'cancellation', idempotencyKey: 'cancel:queued'
    })).toMatchObject({ outcome: 'cancellation', phase: 'queued', termKey: 'cancellationQueued', charge: 0, released: 60, attempt: null });

    const dispatched = await accept(ledger, 'q_dispatched');
    await bind(ledger, dispatched.reservationId, 'a1');
    expect(await settle(ledger, dispatched.reservationId, { outcome: 'cancellation', output: 10 })).toMatchObject({
      phase: 'dispatched', termKey: 'cancellationDispatched', charge: 5, released: 55
    });
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 195, held: 0 });
  });

  it('settles partial delivery, reduced service and provider failure from the accepted terms', async () => {
    await fund(ledger, 'acct_alice', 300);
    const partial = await accept(ledger, 'q_partial');
    await bind(ledger, partial.reservationId, 'a1');
    expect(await settle(ledger, partial.reservationId, { outcome: 'partial_delivery', output: 31 })).toMatchObject({ charge: 16, released: 44 });

    const reduced = await accept(ledger, 'q_reduced');
    await bind(ledger, reduced.reservationId, 'a1');
    await rejectsWith(settle(ledger, reduced.reservationId, { outcome: 'reduced', output: 100 }), 'invalid_input');
    expect(await settle(ledger, reduced.reservationId, { outcome: 'reduced', output: 100, reason: 'declared_latency_reduction' }))
      .toMatchObject({ charge: 25, reason: 'declared_latency_reduction' });

    const noReduced = await accept(ledger, 'q_no_reduced', { settlement: { reduced: null } });
    await bind(ledger, noReduced.reservationId, 'a1');
    await rejectsWith(settle(ledger, noReduced.reservationId, { outcome: 'reduced', reason: 'unoffered' }), 'outcome_not_in_terms');
    expect(await settle(ledger, noReduced.reservationId, { outcome: 'provider_failure' })).toMatchObject({ charge: 0, released: 60 });
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 259, held: 0 });
  });

  it('distinguishes timeout after the deadline from release at reservation expiry', async () => {
    await fund(ledger, 'acct_alice', 200);
    const timed = await accept(ledger, 'q_timeout');
    const queued = await accept(ledger, 'q_queued_timeout');
    const expiring = await accept(ledger, 'q_expiring');
    await bind(ledger, timed.reservationId, 'a1');
    await rejectsWith(settle(ledger, timed.reservationId, { outcome: 'timeout' }), 'timeout_before_deadline');
    advance(4 * MIN);
    await rejectsWith(ledger.settleReservation({
      reservationId: timed.reservationId, billableEventId: 'bill:late', outcome: 'full', attemptId: 'a1',
      metering: { output: 40 }, completedAt: clock(), idempotencyKey: 'settle:late'
    }), 'delivered_after_deadline');
    expect(await settle(ledger, timed.reservationId, { outcome: 'timeout' })).toMatchObject({ outcome: 'timeout', charge: 0, released: 60 });
    expect(await ledger.settleReservation({
      reservationId: queued.reservationId, billableEventId: 'bill:queued-timeout', outcome: 'timeout', idempotencyKey: 'timeout:queued'
    })).toMatchObject({ outcome: 'timeout', attempt: null, charge: 0, released: 60 });

    advance(7 * MIN);
    await rejectsWith(bind(ledger, expiring.reservationId, 'late'), 'reservation_expired');
    expect((await ledger.getSolvencySnapshot()).reservations.awaitingExpiryRelease).toBe(1);
    const released = await ledger.expireReservations();
    expect(released).toHaveLength(1);
    expect(released[0]).toMatchObject({ outcome: 'expired', charge: 0, released: 60, billableEventId: null });
    expect(await ledger.expireReservations()).toEqual([]);
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 200, held: 0 });
  });

  it('refunds charged credit to its original lots under a distinct reconciliation identity', async () => {
    await fund(ledger, 'acct_alice', 100);
    const { reservationId } = await accept(ledger, 'q1');
    const open = await accept(ledger, 'q_open', { maxCharge: 60 }).catch((error) => error);
    expect(open.code).toBe('insufficient_balance');
    await bind(ledger, reservationId, 'a1');
    const receipt = await settle(ledger, reservationId);
    const refund = {
      reservationId, refundId: 'refund:1', amount: 10,
      authority: { kind: 'operator_adjustment', decisionId: 'decision:1', actorId: 'operator_test' },
      idempotencyKey: 'refund:1'
    };
    await rejectsWith(ledger.refundSettlement({ ...refund, authority: { kind: 'automatic_grader', decisionId: 'x', actorId: 'y' } }), 'refund_authority_required');
    expect(await ledger.refundSettlement(refund)).toMatchObject({
      refundId: 'refund:1', amount: 10, originalCharge: 30, refundedTotal: 10, settlementId: receipt.settlementId,
      lots: [expect.objectContaining({ provenance: 'purchased', amount: 10 })]
    });
    expect(await ledger.refundSettlement(refund)).toMatchObject({ refundId: 'refund:1', refundedTotal: 10 });
    await rejectsWith(ledger.refundSettlement({ ...refund, idempotencyKey: 'refund:1:replayed' }), 'duplicate_refund');
    await rejectsWith(ledger.refundSettlement({ ...refund, refundId: 'refund:2', amount: 21, idempotencyKey: 'refund:2' }), 'refund_exceeds_charge');
    expect((await ledger.getReservation(reservationId)).settlement).toEqual(receipt);
    expect(await journalShape(ledger, 'acct_alice')).toEqual([['issue', 100], ['reserve', 60], ['charge', 30], ['release', 30], ['refund', 10]]);
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 80, byProvenance: { purchased: { spent: 30, refunded: 10 } } });
    expect(await ledger.auditAccount('acct_alice')).toMatchObject({ consistent: true });
  });

  it('holds failed quality for operational review and never adjudicates it automatically', async () => {
    await fund(ledger, 'acct_alice', 100);
    const { reservationId } = await accept(ledger, 'q1');
    await bind(ledger, reservationId, 'a1');
    const pending = await settle(ledger, reservationId, { outcome: 'failed_quality', reason: 'reported_incorrect_answer' });
    expect(pending).toMatchObject({
      status: 'under_review', held: 60,
      dispositionCharges: { full: 30, reduced: 10, partial_delivery: 20, failed_quality: 0 }
    });
    expect(await ledger.getQualityReview(pending.reviewId)).toMatchObject({
      status: 'pending_review', qualityPolicyVersion: 'quality-policy-test/1', procedureId: 'quality-review-test'
    });
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 40, held: 60 });
    await rejectsWith(settle(ledger, reservationId, { key: 'settle:full:after-review' }), 'reservation_under_review');
    advance(11 * MIN);
    expect(await ledger.expireReservations()).toEqual([]);

    const resolution = { reviewId: pending.reviewId, disposition: 'failed_quality', idempotencyKey: 'review:1' };
    await rejectsWith(ledger.resolveQualityReview({
      ...resolution, reviewer: { reviewerId: 'grader_model', authority: 'automatic_grader', decisionId: 'auto:1' }
    }), 'review_authority_required');
    const reviewer = { reviewerId: 'operator_test', authority: 'operational_review', decisionId: 'review-decision:1' };
    expect(await ledger.resolveQualityReview({ ...resolution, reviewer })).toMatchObject({
      outcome: 'failed_quality', charge: 0, released: 60, review: { disposition: 'failed_quality', reviewerId: 'operator_test' }
    });
    await rejectsWith(ledger.resolveQualityReview({ ...resolution, reviewer, disposition: 'full', idempotencyKey: 'review:again' }), 'review_already_resolved');
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 100, held: 0 });
  });

  it('prevents overdraft and double spending from concurrent devices', async () => {
    await fund(ledger, 'acct_alice', 100);
    const quotes = await Promise.all(Array.from({ length: 8 }, (_, index) => ledger.createQuote({
      ...quoteInput({ quoteId: `q${index}`, maxCharge: 15, settlement: { full: outputRate(0, 8), partialDelivery: outputRate(0, 8), cancellationDispatched: outputRate(0, 8), reduced: null } }),
      idempotencyKey: `quote:q${index}`
    })));
    const outcomes = await Promise.allSettled(quotes.map((quote, index) => ledger.acceptQuote({
      quoteId: quote.quoteId, accountId: 'acct_alice', quoteHash: quote.quoteHash,
      deviceId: index % 2 ? 'laptop' : 'phone', idempotencyKey: `accept:${quote.quoteId}`
    })));
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(6);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected').map((outcome) => outcome.reason.code))
      .toEqual(['insufficient_balance', 'insufficient_balance']);
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 10, held: 90 });

    const accepted = outcomes.find((outcome) => outcome.status === 'fulfilled').value;
    await bind(ledger, accepted.reservationId, 'a1');
    const racing = await Promise.allSettled([
      settle(ledger, accepted.reservationId, { output: 100, key: 'settle:phone' }),
      settle(ledger, accepted.reservationId, { outcome: 'cancellation', output: 0, key: 'cancel:laptop' })
    ]);
    expect(racing.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(racing.find((outcome) => outcome.status === 'rejected').reason.code)
      .toMatch(/^(reservation_already_settled|billable_event_already_settled)$/);

    const duplicateQuote = await ledger.createQuote({ ...quoteInput({ quoteId: 'q_shared', maxCharge: 60 }), idempotencyKey: 'quote:shared' });
    await fund(ledger, 'acct_alice', 100, 'purchase:second');
    const sameQuote = await Promise.allSettled(['phone', 'laptop'].map((deviceId) => ledger.acceptQuote({
      quoteId: 'q_shared', accountId: 'acct_alice', quoteHash: duplicateQuote.quoteHash, deviceId, idempotencyKey: `accept:shared:${deviceId}`
    })));
    expect(sameQuote.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(sameQuote.find((outcome) => outcome.status === 'rejected').reason.code).toBe('quote_already_accepted');
    if (harness.retries() !== null) expect(harness.retries()).toBeGreaterThan(0);
    expect(await ledger.auditAccount('acct_alice')).toMatchObject({ consistent: true });
  });

  it('rejects replayed acceptance, settlement, issuance and reused idempotency keys', async () => {
    await fund(ledger, 'acct_alice', 200);
    await rejectsWith(ledger.issueCredits({
      accountId: 'acct_alice', provenance: 'purchased', amount: 200,
      source: { processor: 'test-processor', purchaseId: 'purchase:acct_alice:200', confirmationId: 'confirm:replayed', price: { amountMinor: 1999, currency: 'USD' } },
      idempotencyKey: 'issue:replayed-payment'
    }), 'duplicate_issuance_source');
    await rejectsWith(ledger.issueCredits({
      accountId: 'acct_alice', provenance: 'purchased', amount: 999,
      source: { processor: 'test-processor', purchaseId: 'purchase:acct_alice:200', confirmationId: 'confirm:x', price: { amountMinor: 1, currency: 'USD' } },
      idempotencyKey: 'issue:purchase:acct_alice:200'
    }), 'idempotency_conflict');

    const first = await accept(ledger, 'q1');
    const second = await accept(ledger, 'q2');
    await bind(ledger, first.reservationId, 'a1');
    await bind(ledger, second.reservationId, 'a1');
    await settle(ledger, first.reservationId);
    await rejectsWith(ledger.settleReservation({
      reservationId: second.reservationId, billableEventId: `bill:${first.reservationId}`, outcome: 'full', attemptId: 'a1',
      metering: { output: 40 }, completedAt: clock(), idempotencyKey: 'settle:cross-reservation'
    }), 'billable_event_already_settled');
    await rejectsWith(ledger.acceptQuote({
      quoteId: 'q1', accountId: 'acct_alice', quoteHash: first.quote.quoteHash, deviceId: 'phone', idempotencyKey: 'accept:q1:replayed'
    }), 'quote_already_accepted');
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 110, held: 60 });
  });

  it('recovers a restart mid-settlement from the store without lost or duplicated effects', async () => {
    await fund(ledger, 'acct_alice', 200);
    const first = await accept(ledger, 'q1');
    await bind(ledger, first.reservationId, 'a1');
    const journalBefore = await journalShape(ledger, 'acct_alice');

    harness.faults.beforeCommit = () => { throw new Error('simulated crash before commit'); };
    await expect(settle(ledger, first.reservationId)).rejects.toThrow('simulated crash before commit');
    expect(await journalShape(ledger, 'acct_alice')).toEqual(journalBefore);
    expect(await ledger.getReservation(first.reservationId)).toMatchObject({ status: 'open', settlement: null });

    const restarted = harness.open();
    expect(await settle(restarted, first.reservationId)).toMatchObject({ charge: 30 });

    const second = await accept(restarted, 'q2');
    await bind(restarted, second.reservationId, 'a1');
    harness.faults.afterCommit = () => { throw new Error('simulated crash after commit'); };
    await expect(settle(restarted, second.reservationId, { output: 100 })).rejects.toThrow('simulated crash after commit');
    const recovered = harness.open();
    const replayed = await settle(recovered, second.reservationId, { output: 100 });
    expect(replayed).toEqual((await recovered.getReservation(second.reservationId)).settlement);
    expect(replayed).toMatchObject({ charge: 60 });

    const journal = await recovered.listJournal('acct_alice');
    expect(journal.map((entry) => entry.seq)).toEqual(journal.map((_, index) => index + 1));
    expect(journal.filter((entry) => entry.type === 'charge').map((entry) => entry.amount)).toEqual([30, 60]);
    expect(await recovered.getAccount('acct_alice')).toMatchObject({ available: 110, held: 0 });
    expect(await recovered.auditAccount('acct_alice')).toMatchObject({ consistent: true });
  });

  it('never expires earned or purchased balances', async () => {
    await fund(ledger, 'acct_alice', 50);
    await earn(ledger, 'acct_alice', 50, 'work:old');
    await rejectsWith(ledger.issueCredits({
      accountId: 'acct_alice', provenance: 'purchased', amount: 10, expiresAt: at(MIN),
      source: { processor: 'p', purchaseId: 'expiring', confirmationId: 'c', price: { amountMinor: 1, currency: 'USD' } },
      idempotencyKey: 'issue:expiring'
    }), 'expiry_not_permitted');
    throwsWith(() => validateAccountingPolicy({ ...POLICY, expiry: { days: 365 } }), 'invalid_policy');

    advance(10 * 365 * 24 * 60 * MIN);
    expect(await ledger.expireReservations()).toEqual([]);
    expect(await ledger.getAccount('acct_alice')).toMatchObject({
      available: 100, byProvenance: { earned: { available: 50 }, purchased: { available: 50 } }
    });
    const { reservationId } = await accept(ledger, 'q_decade_later');
    await bind(ledger, reservationId, 'a1');
    expect(await settle(ledger, reservationId)).toMatchObject({ charge: 30 });
  });

  it('records issuance provenance per lot and keeps quantity, price, reward and service price distinct', async () => {
    const purchased = await fund(ledger, 'acct_alice', 40);
    const earned = await earn(ledger, 'acct_alice', 30, 'work:1');
    const donated = await ledger.issueCredits({
      accountId: 'acct_alice', provenance: 'donated', amount: 20,
      source: { donationId: 'donation:1', donorId: 'donor_test' }, idempotencyKey: 'issue:donation:1'
    });
    const funded = await ledger.issueCredits({
      accountId: 'acct_alice', provenance: 'community_access', amount: 10,
      source: { fundingId: 'funding:1', funderId: 'operator_test', funderKind: 'operator' }, idempotencyKey: 'issue:funding:1'
    });

    expect(await ledger.getLot(purchased.lotId)).toMatchObject({
      provenance: 'purchased', quantity: 40, source: { price: { amountMinor: 1999, currency: 'USD' } }, parentLotId: null
    });
    expect(await ledger.getLot(earned.lotId)).toMatchObject({
      provenance: 'earned', quantity: 30, source: { workId: 'work:1', validationId: 'validation:work:1', outcome: 'accepted' },
      issuance: { decisionId: 'test-capacity:earned:30' }
    });
    expect((await ledger.getLot(donated.lotId)).provenance).toBe('donated');
    expect((await ledger.getLot(funded.lotId)).provenance).toBe('community_access');

    expect(await earn(ledger, 'acct_alice', 30, 'work:1')).toEqual(earned);
    await rejectsWith(ledger.issueCredits({
      accountId: 'acct_alice', provenance: 'earned', amount: 30,
      source: { category: 'computation', workId: 'work:1', offerId: 'o', validationId: 'v2', validatorId: 'val', outcome: 'accepted', validatedAt: clock() },
      idempotencyKey: 'issue:work:1:second-validation'
    }), 'duplicate_issuance_source');
    await rejectsWith(ledger.issueCredits({
      accountId: 'acct_alice', provenance: 'earned', amount: 5, source: { category: 'computation', workId: 'work:unvalidated' },
      idempotencyKey: 'issue:unvalidated'
    }), 'invalid_source_reference');
    await rejectsWith(ledger.issueCredits({
      accountId: 'acct_alice', provenance: 'earned', amount: 5,
      source: { category: 'presence', workId: 'w', offerId: 'o', validationId: 'v', validatorId: 'val', outcome: 'rejected', validatedAt: clock() },
      idempotencyKey: 'issue:rejected'
    }), 'invalid_source_reference');
    const withoutAuthority = harness.open({ policy: POLICY, clock });
    await rejectsWith(earn(withoutAuthority, 'acct_alice', 5, 'work:2'), 'issuance_authority_required');
    const declining = harness.open({ policy: POLICY, clock, issuanceAuthority: async () => ({ allowed: false, reason: 'capacity_shortfall' }) });
    await rejectsWith(earn(declining, 'acct_alice', 5, 'work:3'), 'issuance_not_authorized');

    const { reservationId } = await accept(ledger, 'q1', { maxCharge: 60 });
    const reserve = (await ledger.listJournal('acct_alice')).find((entry) => entry.type === 'reserve');
    expect(reserve.lots.map((lot) => [lot.provenance, lot.amount])).toEqual([['community_access', 10], ['earned', 30], ['donated', 20]]);
    await bind(ledger, reservationId, 'a1');
    const receipt = await settle(ledger, reservationId, { output: 40 });
    expect(receipt.chargedLots.map((lot) => [lot.provenance, lot.amount])).toEqual([['community_access', 10], ['earned', 20]]);
    expect([receipt.authorizedMax, receipt.charge]).toEqual([60, 30]);
    expect(await ledger.getAccount('acct_alice')).toMatchObject({
      available: 70,
      byProvenance: {
        community_access: { issued: 10, spent: 10, available: 0 },
        earned: { issued: 30, spent: 20, available: 10 },
        donated: { issued: 20, spent: 0, available: 20 },
        purchased: { issued: 40, spent: 0, available: 40 }
      }
    });
  });

  it('keeps account transfers disabled', async () => {
    await fund(ledger, 'acct_alice', 10);
    await rejectsWith(ledger.transferCredits({ fromAccountId: 'acct_alice', toAccountId: 'acct_bob', amount: 5 }), 'transfers_disabled');
    throwsWith(() => validateAccountingPolicy({ ...POLICY, transfers: { enabled: true } }), 'invalid_policy');
    throwsWith(() => harness.open({ policy: { ...POLICY, transfers: undefined }, clock }), 'invalid_policy');
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ transfersEnabled: false, available: 10 });
    expect(await ledger.getAccount('acct_bob')).toMatchObject({ available: 0 });
  });

  it('records outstanding balances, open reservations and issuance by provenance for solvency analysis', async () => {
    await fund(ledger, 'acct_alice', 100);
    await earn(ledger, 'acct_bob', 80, 'work:bob');
    const alice = await accept(ledger, 'qa');
    const bob = await accept(ledger, 'qb', { accountId: 'acct_bob' });
    await bind(ledger, bob.reservationId, 'a1');
    await settle(ledger, bob.reservationId, { outcome: 'failed_quality', reason: 'reported_incorrect_answer' });

    expect(await ledger.getSolvencySnapshot()).toMatchObject({
      contract: { id: PRODUCT_ECONOMICS_CONTRACT_ID },
      accountingVersion: 'test-accounting/1',
      accountsObserved: 2,
      issued: { total: 180, byProvenance: { purchased: 100, earned: 80, donated: 0, community_access: 0 } },
      outstanding: { total: 180, byProvenance: { purchased: 100, earned: 80 } },
      held: { total: 120 },
      reservations: { open: { count: 1, held: 60 }, underReview: { count: 1, held: 60 }, awaitingExpiryRelease: 0 },
      notTracked: { expectedRedemptionDemand: null, admittedSupply: null, reliabilityReserves: null, operatorSubsidy: null }
    });

    await bind(ledger, alice.reservationId, 'a1');
    await settle(ledger, alice.reservationId);
    expect(await ledger.getSolvencySnapshot()).toMatchObject({
      outstanding: { total: 150, byProvenance: { purchased: 70, earned: 80 } },
      spent: { total: 30, byProvenance: { purchased: 30 } },
      reservations: { open: { count: 0, held: 0 }, underReview: { count: 1, held: 60 } }
    });
  });
});
