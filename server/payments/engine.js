import { createKnownKeyValidator } from '../input-validation.js';
/**
 * @fileoverview Purchase reconciliation behind a payment processor port.
 *
 * A checkout is the purchase quote: its credits come from the ledger's
 * conversion record in effect when it starts, and it stamps that record, so a
 * later rate never changes it and the ledger recomputes the lot from it.
 * A notification only names the purchase to look at. Every effect follows the
 * processor's authoritative status, fetched through the port, so duplicate,
 * reordered and replayed notifications converge on one state, and polling
 * recovers notifications that never arrive. A confirmed payment issues its
 * purchased lot exactly once through the credit ledger, under a deterministic
 * idempotency key and the ledger's one-lot-per-purchase claim; a full refund
 * or chargeback reverses that lot through the ledger. Each step commits
 * separately and is re-derived from stored records, so a restart between any
 * two steps resumes without a second effect.
 */

import {
  assertId,
  assertIdempotencyKey,
  cloneJson,
  hashCanonical,
  isNonEmptyString,
  lotIdForSource,
  sha256Hex,
  sourceClaimKey,
  toMs
} from '../ledger/domain.js';
import { assertLedgerStoreContract } from '../ledger/store-contract.js';
import {
  NOTIFICATION_SCHEMA,
  PAYMENT_PHASES,
  PAYMENT_SCHEMA,
  POLLED_PHASES,
  PaymentError,
  completingReversal,
  derivePhase,
  fail,
  mergeObservation,
  validatePaymentPolicy
} from './domain.js';
import {
  assertPaymentProcessor,
  validateCheckoutResponse,
  validateNotificationEvent,
  validatePaymentStatus
} from './processor-contract.js';
import { assertPaymentBackend, assertPaymentStoreContract } from './store-contract.js';

const defaultClock = () => new Date().toISOString();

const purchaseClaimId = (processor, purchaseId) => sha256Hex(`purchase\u0000${processor}\u0000${purchaseId}`);
const notificationId = (processor, eventId) => sha256Hex(`notification\u0000${processor}\u0000${eventId}`);
const lotIdFor = (record) => lotIdForSource(sourceClaimKey('purchased', { processor: record.processor, purchaseId: record.purchaseId }));
const issuanceKey = (record) => `purchase:${record.processor}:${record.purchaseId}`;

const assertKnownKeys = createKnownKeyValidator(fail);

// The ledger source names the purchase, its confirmation, its price apart from quantity and the conversion stamp.
const purchaseSource = (record) => ({
  processor: record.processor,
  purchaseId: record.purchaseId,
  confirmationId: record.observed.confirmationId,
  price: record.topUp.price,
  conversion: { conversionId: record.quote.conversionId, recordHash: record.quote.recordHash },
  checkoutId: record.checkoutId,
  topUpId: record.topUp.topUpId,
  paymentPolicyVersion: record.paymentPolicyVersion
});

export function summarizePayment(record) {
  return {
    checkoutId: record.checkoutId,
    accountId: record.accountId,
    processor: record.processor,
    purchaseId: record.purchaseId,
    phase: record.phase,
    topUp: record.topUp,
    quote: record.quote ?? null,
    credits: record.credits ?? record.topUp.credits ?? null,
    checkout: record.checkout,
    observed: record.observed,
    issuance: record.issuance,
    reversal: record.reversal,
    review: record.review,
    lastError: record.lastError ?? null,
    updatedAt: record.updatedAt
  };
}

/**
 * @param {object} options
 * @param {object} options.backend transactional document backend (see stores.js)
 * @param {object} options.ledger credit ledger store; its issuanceAuthority should include
 *   createPurchaseIssuanceAuthority over this backend
 * @param {object} options.processor payment processor port (see processor-contract.js)
 * @param {object} options.accounts authenticated account port:
 *   participantAccount(participantId) -> accountId | null
 * @param {object} options.policy explicit payment policy; there is no default
 */
export function createPaymentStore({ backend, ledger, processor, accounts, policy, clock = defaultClock } = {}) {
  assertPaymentBackend(backend);
  assertLedgerStoreContract(ledger);
  assertPaymentProcessor(processor);
  if (typeof accounts?.participantAccount !== 'function') {
    throw new TypeError('payment store requires an accounts port with participantAccount');
  }
  const paymentPolicy = validatePaymentPolicy(policy);
  if (paymentPolicy.processorId !== processor.id) throw new TypeError('policy.processorId must name the supplied processor');
  const processorId = processor.id;
  // Records name the processor that created them; another processor never reconciles them.
  const ownRecord = (record) => {
    if (record.processor !== processorId) {
      fail('processor_mismatch', `payment ${record.checkoutId} belongs to processor ${record.processor}`, { checkoutId: record.checkoutId });
    }
    return record;
  };

  // Apply `change` to the current record in one transaction and re-derive its phase.
  const update = (checkoutId, change) => backend.runTransaction(async (tx) => {
    const current = await tx.get('payments', checkoutId);
    const next = change(current);
    if (!next) return current;
    const updated = { ...next, ...derivePhase(next), updatedAt: clock() };
    tx.set('payments', checkoutId, updated);
    return updated;
  });

  const readPayment = async (checkoutId) => {
    assertId(checkoutId, 'checkoutId');
    const record = await backend.get('payments', checkoutId);
    if (!record) fail('payment_not_found', `payment ${checkoutId} was not found`, { checkoutId });
    return record;
  };

  /** Create (or recover) the processor checkout for a record still in `creating`. */
  const completeCheckout = async (record) => {
    const response = validateCheckoutResponse(await processor.createCheckout({
      checkoutId: record.checkoutId,
      accountId: record.accountId,
      credits: record.credits ?? record.topUp.credits,
      amount: record.topUp.price,
      idempotencyKey: record.checkoutId,
      topUpId: record.topUp.topUpId,
      paymentPolicyVersion: record.paymentPolicyVersion,
      conversion: record.quote ? { conversionId: record.quote.conversionId, recordHash: record.quote.recordHash } : null
    }));
    const claimId = purchaseClaimId(processorId, response.purchaseId);
    return backend.runTransaction(async (tx) => {
      const current = await tx.get('payments', record.checkoutId);
      const claim = await tx.get('claims', claimId);
      if (current.phase !== 'creating') return current;
      if (claim && claim.checkoutId !== record.checkoutId) {
        fail('purchase_conflict', 'the processor returned a purchase already bound to another checkout', { purchaseId: response.purchaseId });
      }
      const updated = { ...current, purchaseId: response.purchaseId, checkout: response.checkout, phase: 'open', updatedAt: clock() };
      if (!claim) {
        tx.create('claims', claimId, {
          kind: 'purchase', processor: processorId, purchaseId: response.purchaseId, checkoutId: record.checkoutId, recordedAt: updated.updatedAt
        });
      }
      tx.set('payments', record.checkoutId, updated);
      return updated;
    });
  };

  /** Mint the purchased lot once. A lot already minted for this purchase counts only if it names this checkout. */
  const issue = async (record) => {
    const lotId = lotIdFor(record);
    try {
      await ledger.issueCredits({
        accountId: record.accountId,
        provenance: 'purchased',
        amount: record.credits,
        source: purchaseSource(record),
        idempotencyKey: issuanceKey(record)
      });
    } catch (error) {
      if (error?.code === 'issuance_not_authorized') {
        // Stays awaiting issuance; polling retries once the authority allows it.
        return update(record.checkoutId, (current) => ({
          ...current, lastError: { code: error.code, reason: error.details?.reason ?? null, at: clock() }
        }));
      }
      if (error?.code !== 'duplicate_issuance_source' || (await ledger.getLot(lotId))?.source?.checkoutId !== record.checkoutId) throw error;
    }
    const lot = await ledger.getLot(lotId);
    return update(record.checkoutId, (current) => (current.issuance ? null : {
      ...current,
      // A reversal recorded while this issuance was in flight is applied next.
      reversal: current.reversal?.applied === false ? null : current.reversal,
      issuance: { lotId, decisionId: lot.issuance?.decisionId ?? null, issuedAt: lot.issuedAt },
      lastError: null
    }));
  };

  /** Reverse the purchased lot after a full refund or chargeback, or record that none was issued. */
  const reverse = async (record) => {
    const lotId = lotIdFor(record);
    const lot = await ledger.getLot(lotId);
    if (!lot) {
      // Any issuance racing this records its lot afterwards, finds this marker and reverses.
      return update(record.checkoutId, (current) => (current.issuance || current.reversal ? null : {
        ...current, reversal: { applied: false, reason: 'reversed_before_issuance', recordedAt: clock() }
      }));
    }
    const { reversalRef, kind } = completingReversal(record.observed);
    let result;
    try {
      result = await ledger.reverseIssuance({
        lotId,
        reversalId: reversalRef,
        kind,
        authority: { kind: 'payment_processor', decisionId: reversalRef, actorId: processorId },
        reason: `processor_${kind}`,
        idempotencyKey: `reverse:${processorId}:${record.purchaseId}`
      });
    } catch (error) {
      if (error?.code !== 'duplicate_reversal') throw error;
      result = await ledger.getReversal(lotId);
    }
    return update(record.checkoutId, (current) => (current.reversal?.applied ? null : {
      ...current,
      issuance: current.issuance ?? { lotId, decisionId: lot.issuance?.decisionId ?? null, issuedAt: lot.issuedAt },
      reversal: {
        applied: true,
        lotId,
        reversalId: result.reversalId,
        kind: result.kind,
        treatment: result.treatment,
        removed: result.removed,
        shortfall: result.shortfall,
        status: result.status,
        reversedAt: result.reversedAt
      },
      lastError: null
    }));
  };

  const advance = async (record) => {
    let current = record;
    if (current.phase === 'awaiting_issuance') current = await issue(current);
    if (current.phase === 'awaiting_reversal') current = await reverse(current);
    return current;
  };

  const store = {
    kind: backend.kind,
    policy: paymentPolicy,
    /** Which processor reconciles here, whether it serves local runs and tests only, and its mode. */
    processor: Object.freeze({ id: processorId, testOnly: processor.testOnly === true, mode: typeof processor.mode === 'string' ? processor.mode : null }),

    /**
     * Start a one-time top-up checkout for the authenticated participant's
     * account, quoting its credits from the conversion record in effect. The
     * idempotency key fixes the checkout id, so a retry after a crash resumes
     * the same processor checkout and keeps its quote.
     */
    async startCheckout(input = {}) {
      assertKnownKeys(input, ['participantId', 'topUpId', 'idempotencyKey'], 'startCheckout');
      const { participantId, topUpId, idempotencyKey } = input;
      if (!isNonEmptyString(participantId)) fail('invalid_input', 'participantId must name the authenticated participant');
      assertIdempotencyKey(idempotencyKey);
      const topUp = paymentPolicy.topUps.find((entry) => entry.topUpId === topUpId);
      if (!topUp) fail('unknown_top_up', `top-up ${topUpId} is not offered by policy ${paymentPolicy.policyVersion}`);
      const accountId = await accounts.participantAccount(participantId);
      if (!isNonEmptyString(accountId)) fail('participant_not_registered', 'participant has no authenticated account');
      if (!await ledger.getAccount(accountId)) fail('account_not_found', `account ${accountId} has no credit account`);
      const checkoutId = `chk_${sha256Hex(`${accountId}\u0000${idempotencyKey}`).slice(0, 32)}`;
      const requestHash = hashCanonical({ accountId, topUpId, paymentPolicyVersion: paymentPolicy.policyVersion });
      const quote = await backend.get('payments', checkoutId)
        ? null : await ledger.quoteConversion({ currency: topUp.price.currency, amountMinor: topUp.price.amountMinor });
      if (quote && quote.credits <= 0) fail('top_up_buys_nothing', `top-up ${topUpId} converts to no credits under ${quote.conversionId}`);
      const now = clock();
      let record = await backend.runTransaction(async (tx) => {
        const existing = await tx.get('payments', checkoutId);
        if (existing) {
          if (existing.requestHash !== requestHash) fail('idempotency_conflict', 'idempotency key was already used with a different request');
          return existing;
        }
        if (!quote) fail('storage_conflict', 'checkout record disappeared during creation; retry');
        const created = {
          schema: PAYMENT_SCHEMA,
          checkoutId,
          accountId,
          participantId,
          processor: processorId,
          purchaseId: null,
          topUp: cloneJson(topUp),
          quote,
          credits: quote.credits,
          paymentPolicyVersion: paymentPolicy.policyVersion,
          requestHash,
          phase: 'creating',
          checkout: null,
          observed: null,
          issuance: null,
          reversal: null,
          review: null,
          lastError: null,
          createdAt: now,
          updatedAt: now
        };
        tx.create('payments', checkoutId, created);
        return created;
      });
      if (record.phase === 'creating') record = await completeCheckout(record);
      return summarizePayment(record);
    },

    /**
     * Accept a processor notification only after the port verifies its
     * authenticity, record its event id once, and reconcile the purchase it
     * names from authoritative status. The payload never drives an effect.
     */
    async receiveNotification({ headers, rawBody } = {}) {
      let event = null;
      try {
        event = validateNotificationEvent(await processor.verifyNotification({ headers, rawBody }));
      } catch (error) {
        // A processor failure after authentication (a lookup it needs) is not a verdict on authenticity.
        if (error instanceof PaymentError) throw error;
        fail('notification_not_authentic', 'the processor could not verify this notification', { reason: error?.message ?? null });
      }
      if (!event) fail('notification_not_authentic', 'the processor could not verify this notification');
      // An authentic event that names no purchase is recorded and has no effect.
      const claim = event.purchaseId === null ? null : await backend.get('claims', purchaseClaimId(processorId, event.purchaseId));
      const now = clock();
      const duplicate = await backend.runTransaction(async (tx) => {
        const noticeId = notificationId(processorId, event.eventId);
        if (await tx.get('notifications', noticeId)) return true;
        tx.create('notifications', noticeId, {
          schema: NOTIFICATION_SCHEMA, processor: processorId, ...event, matched: Boolean(claim), receivedAt: now
        });
        return false;
      });
      if (!claim) return { eventId: event.eventId, duplicate, matched: false, payment: null };
      // Reconciling again is idempotent, so a redelivery also finishes work a crash interrupted.
      const payment = await store.reconcile({ checkoutId: claim.checkoutId });
      return { eventId: event.eventId, duplicate, matched: true, payment };
    },

    /** Bring one payment and its ledger effects in line with the processor's authoritative status. */
    async reconcile({ checkoutId } = {}) {
      let record = ownRecord(await readPayment(checkoutId));
      if (record.phase === 'creating') record = await completeCheckout(record);
      const status = validatePaymentStatus(await processor.fetchPayment(record.purchaseId), record);
      record = await update(checkoutId, (current) => ({ ...current, observed: mergeObservation(current.observed, status, clock()) }));
      return summarizePayment(await advance(record));
    },

    /**
     * Recover missed notifications: reconcile every payment still waiting on
     * the processor or the ledger, plus issued payments inside the declared
     * reversal watch window. Failures stay pending for the next poll.
     */
    async pollPending({ limit = 100 } = {}) {
      const nowMs = toMs(clock());
      const lists = await Promise.all([...POLLED_PHASES, 'issued'].map((phase) => backend.list('payments', { field: 'phase', value: phase })));
      const due = lists.flat()
        .filter((record) => record.processor === processorId)
        .filter((record) => record.phase !== 'issued' || nowMs - toMs(record.issuance.issuedAt) <= paymentPolicy.polling.reversalWatchMs)
        .filter((record) => nowMs - toMs(record.updatedAt) >= paymentPolicy.polling.minAgeMs)
        .sort((left, right) => toMs(left.updatedAt) - toMs(right.updatedAt) || left.checkoutId.localeCompare(right.checkoutId))
        .slice(0, limit);
      const results = [];
      for (const { checkoutId } of due) {
        try {
          results.push(await store.reconcile({ checkoutId }));
        } catch (error) {
          results.push({ checkoutId, phase: null, error: { code: error?.code ?? 'reconcile_failed', message: error?.message ?? null } });
        }
      }
      return results;
    },

    async getPayment(checkoutId) {
      const record = await backend.get('payments', checkoutId);
      return record ? summarizePayment(record) : null;
    },

    async listPayments({ phase } = {}) {
      if (!PAYMENT_PHASES.includes(phase)) fail('invalid_input', `phase must be one of ${PAYMENT_PHASES.join(', ')}`);
      return (await backend.list('payments', { field: 'phase', value: phase })).map(summarizePayment);
    }
  };
  return assertPaymentStoreContract(store);
}

/**
 * Ledger issuance decision for purchased credit: allow a purchased lot only
 * for a payment the processor confirmed at the expected amount, for the
 * checkout's account and quantity, before any reversal. Other provenance is
 * declined so a composed authority must route it elsewhere.
 */
export function createPurchaseIssuanceAuthority({ backend } = {}) {
  assertPaymentBackend(backend);
  return async function purchaseIssuanceAuthority(request) {
    if (request?.provenance !== 'purchased') return { allowed: false, reason: 'provenance_not_governed' };
    const { processor, purchaseId, confirmationId, checkoutId } = request.source || {};
    if (!isNonEmptyString(processor) || !isNonEmptyString(purchaseId)) return { allowed: false, reason: 'payment_not_found' };
    const claim = await backend.get('claims', purchaseClaimId(processor, purchaseId));
    const record = claim ? await backend.get('payments', claim.checkoutId) : null;
    if (!record) return { allowed: false, reason: 'payment_not_found' };
    if (record.phase !== 'awaiting_issuance') return { allowed: false, reason: 'payment_not_confirmed', phase: record.phase };
    const matches = Boolean(record.quote)
      && record.accountId === request.accountId
      && record.credits === request.amount
      && record.quote.conversionId === request.source.conversion?.conversionId
      && record.quote.recordHash === request.source.conversion?.recordHash
      && record.checkoutId === checkoutId
      && record.observed.confirmationId === confirmationId
      && hashCanonical(record.topUp.price) === hashCanonical(request.source.price);
    if (!matches) return { allowed: false, reason: 'issuance_request_mismatch' };
    return { allowed: true, decisionId: issuanceKey(record), limitId: null };
  };
}

export default createPaymentStore;
