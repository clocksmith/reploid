import { beforeEach, describe, expect, it } from 'vitest';

import { validatePaymentPolicy } from '../../server/payments/domain.js';
import { createPaymentStore, createPurchaseIssuanceAuthority } from '../../server/payments/engine.js';
import { PAYMENT_STORE_OPERATIONS, validatePaymentStoreContract } from '../../server/payments/store-contract.js';
import { createTestPaymentProcessor } from '../../server/payments/test-processor.js';
import {
  DAY, MIN, accounts, advance, composeIssuance, crash, fx, harnesses, journalShape, rejectsWith, reserve, resetFixture, spend
} from '../helpers/access-fixture.js';
import { publishConversion } from '../helpers/conversion-fixture.js';

// Test-only purchase terms, rate and treatments; not product prices, rates or adopted policy.
const PAYMENT_POLICY = Object.freeze({
  policyVersion: 'test-payments/1',
  processorId: 'test-processor',
  topUps: [
    { topUpId: 'test-topup-a', price: { amountMinor: 999, currency: 'USD' } },
    { topUpId: 'test-topup-b', price: { amountMinor: 1999, currency: 'USD' } }
  ],
  polling: { minAgeMs: MIN, reversalWatchMs: 30 * DAY }
});
const REVERSAL_POLICY = { refund: { spentCredit: 'operator_absorbs' }, chargeback: { spentCredit: 'account_deficit' } };

describe.each(Object.keys(harnesses))('purchase reconciliation (%s store)', (kind) => {
  let harness;
  let processor;
  let ledger;
  let payments;

  // A (re)started process: new ledger and payment stores over the same durable state.
  const open = () => {
    const backend = harness.openPaymentBackend();
    ledger = harness.openLedger({
      issuanceAuthority: composeIssuance({ purchased: createPurchaseIssuanceAuthority({ backend }) }),
      reversalPolicy: REVERSAL_POLICY
    });
    payments = createPaymentStore({ backend, ledger, processor, accounts, policy: PAYMENT_POLICY, clock: () => new Date(fx.nowMs).toISOString() });
  };

  const checkout = (key, topUpId = 'test-topup-a', participantId = 'peer_alice') => payments.startCheckout({ participantId, topUpId, idempotencyKey: key });
  const purchasedLots = async () => (await ledger.getAccount('acct_alice')).byProvenance.purchased;

  beforeEach(async () => {
    resetFixture();
    harness = harnesses[kind]();
    processor = createTestPaymentProcessor({ id: 'test-processor', clock: () => new Date(fx.nowMs).toISOString(), signatureToleranceMs: 5 * MIN, checkoutTtlMs: 30 * MIN });
    open();
    fx.participants.set('peer_alice', 'acct_alice');
    await ledger.openAccount({ accountId: 'acct_alice', ownerId: 'uid_alice' });
    // 100 credits per 999 minor units, rounded down: top-up a buys 100, top-up b buys 200.
    await publishConversion(ledger, { conversionId: 'conv_test_usd_a', rate: { credits: 100, perMinorUnits: 999 }, clock: () => new Date(fx.nowMs).toISOString() });
  });

  it('implements the payment store contract over explicit one-time top-up policy', () => {
    expect(validatePaymentStoreContract(payments)).toEqual({ ok: true, missing: [] });
    expect(PAYMENT_STORE_OPERATIONS).toContain('pollPending');
    const withInterval = { ...PAYMENT_POLICY, topUps: [{ ...PAYMENT_POLICY.topUps[0], interval: 'month' }] };
    expect(() => validatePaymentPolicy(withInterval)).toThrow(expect.objectContaining({ code: 'invalid_policy' }));
    // A top-up names its price; the credits it buys come from the published conversion record.
    const withCredits = { ...PAYMENT_POLICY, topUps: [{ ...PAYMENT_POLICY.topUps[0], credits: 100 }] };
    expect(() => validatePaymentPolicy(withCredits)).toThrow(expect.objectContaining({ code: 'invalid_policy' }));
    expect(() => validatePaymentPolicy({ ...PAYMENT_POLICY, polling: undefined })).toThrow(expect.objectContaining({ code: 'invalid_policy' }));
  });

  it('issues purchased credit exactly once after a checkout and a confirmed notification', async () => {
    const started = await checkout('buy:1');
    expect(started).toMatchObject({
      phase: 'open', accountId: 'acct_alice', processor: 'test-processor',
      topUp: { topUpId: 'test-topup-a', price: { amountMinor: 999, currency: 'USD' } },
      credits: 100,
      quote: { conversionId: 'conv_test_usd_a', currency: 'USD', amountMinor: 999, credits: 100 },
      checkout: { mode: 'one_time' }
    });
    expect(await checkout('buy:1')).toMatchObject({ checkoutId: started.checkoutId, purchaseId: started.purchaseId });
    await rejectsWith(checkout('buy:1', 'test-topup-b'), 'idempotency_conflict');
    await rejectsWith(checkout('buy:x', 'test-topup-unknown'), 'unknown_top_up');
    await rejectsWith(checkout('buy:y', 'test-topup-a', 'peer_unregistered'), 'participant_not_registered');
    expect(await payments.reconcile({ checkoutId: started.checkoutId })).toMatchObject({ phase: 'open', issuance: null });

    const result = await payments.receiveNotification(processor.pay(started.purchaseId));
    expect(result).toMatchObject({ duplicate: false, matched: true, payment: { phase: 'issued', observed: { paid: true } } });
    const lot = await ledger.getLot(result.payment.issuance.lotId);
    expect(lot).toMatchObject({
      provenance: 'purchased', quantity: 100, accountId: 'acct_alice',
      source: {
        processor: 'test-processor', purchaseId: started.purchaseId, checkoutId: started.checkoutId,
        confirmationId: result.payment.observed.confirmationId, price: { amountMinor: 999, currency: 'USD' }, topUpId: 'test-topup-a'
      },
      issuance: { decisionId: `purchase:test-processor:${started.purchaseId}` }
    });
    expect(await journalShape(ledger, 'acct_alice')).toEqual([['issue', 100]]);
    expect(await payments.reconcile({ checkoutId: started.checkoutId })).toMatchObject({ phase: 'issued' });
    expect(await journalShape(ledger, 'acct_alice')).toEqual([['issue', 100]]);

    // Purchased credit cannot be minted for a payment that is not confirmed.
    const unpaid = await checkout('buy:2');
    await rejectsWith(ledger.issueCredits({
      accountId: 'acct_alice', provenance: 'purchased', amount: 100, idempotencyKey: 'mint:unpaid',
      source: {
        processor: 'test-processor', purchaseId: unpaid.purchaseId, confirmationId: 'forged', checkoutId: unpaid.checkoutId, price: { amountMinor: 999, currency: 'USD' },
        conversion: { conversionId: unpaid.quote.conversionId, recordHash: unpaid.quote.recordHash }
      }
    }), 'issuance_not_authorized');
    expect(await purchasedLots()).toMatchObject({ issued: 100, available: 100 });
  });

  it('gives duplicate, reordered and replayed notifications no second effect', async () => {
    const first = await checkout('buy:1');
    const paid = processor.pay(first.purchaseId);
    await payments.receiveNotification(paid);
    expect(await payments.receiveNotification(paid)).toMatchObject({ duplicate: true, payment: { phase: 'issued' } });

    // Forged, tampered and stale replays fail authenticity before any lookup.
    await rejectsWith(payments.receiveNotification(processor.forge(JSON.parse(paid.rawBody))), 'notification_not_authentic');
    await rejectsWith(payments.receiveNotification({ ...paid, rawBody: paid.rawBody.replace('payment.succeeded', 'payment.refunded') }), 'notification_not_authentic');
    advance(6 * MIN);
    await rejectsWith(payments.receiveNotification(paid), 'notification_not_authentic');
    expect(await journalShape(ledger, 'acct_alice')).toEqual([['issue', 100]]);

    // An authentic notification for a purchase this store never started has no effect.
    const foreign = processor.notify('payment.succeeded', 'pay_unknown');
    expect(await payments.receiveNotification(foreign)).toMatchObject({ matched: false, payment: null });

    // Refunded before any notification arrived; the refund notice is delivered first.
    const second = await checkout('buy:2');
    const paidLate = processor.pay(second.purchaseId);
    const refunded = processor.refund(second.purchaseId);
    expect(await payments.receiveNotification(refunded)).toMatchObject({
      payment: { phase: 'reversed', issuance: null, reversal: { applied: false, reason: 'reversed_before_issuance' } }
    });
    expect(await payments.receiveNotification(paidLate)).toMatchObject({ payment: { phase: 'reversed', issuance: null } });
    expect(await payments.receiveNotification(refunded)).toMatchObject({ duplicate: true, payment: { phase: 'reversed' } });
    expect(await journalShape(ledger, 'acct_alice')).toEqual([['issue', 100]]);
    expect(await purchasedLots()).toMatchObject({ issued: 100, reversed: 0, available: 100 });
  });

  it('converges after a restart in the middle of reconciliation', async () => {
    const first = await checkout('buy:1');
    const paid = processor.pay(first.purchaseId);
    // Crash after the ledger commits the lot but before the payment record notes it.
    harness.faults.ledger.afterCommit = () => {
      harness.faults.payments.beforeCommit = crash('simulated crash before recording issuance');
    };
    await expect(payments.receiveNotification(paid)).rejects.toThrow('simulated crash before recording issuance');
    expect(await payments.getPayment(first.checkoutId)).toMatchObject({ phase: 'awaiting_issuance', issuance: null });
    expect(await purchasedLots()).toMatchObject({ issued: 100 });

    open();
    expect(await payments.receiveNotification(paid)).toMatchObject({ duplicate: true, payment: { phase: 'issued' } });

    // Crash before the authoritative status is stored; polling resumes from the record.
    const second = await checkout('buy:2');
    harness.faults.payments.afterCommit = () => {
      harness.faults.payments.beforeCommit = crash('simulated crash before storing status');
    };
    await expect(payments.receiveNotification(processor.pay(second.purchaseId))).rejects.toThrow('simulated crash before storing status');
    open();
    advance(MIN);
    const polled = await payments.pollPending();
    expect(polled.map((payment) => [payment.checkoutId, payment.phase])).toEqual(expect.arrayContaining([[second.checkoutId, 'issued']]));
    expect(await journalShape(ledger, 'acct_alice')).toEqual([['issue', 100], ['issue', 100]]);
    expect(await ledger.auditAccount('acct_alice')).toMatchObject({ consistent: true });
  });

  it('recovers missed notifications by polling authoritative status', async () => {
    const missed = await checkout('buy:1');
    const abandoned = await checkout('buy:2', 'test-topup-b');
    processor.pay(missed.purchaseId);
    expect(await payments.pollPending()).toEqual([]);
    advance(MIN);
    const first = await payments.pollPending();
    expect(first.find((payment) => payment.checkoutId === missed.checkoutId)).toMatchObject({ phase: 'issued' });
    expect(first.find((payment) => payment.checkoutId === abandoned.checkoutId)).toMatchObject({ phase: 'open' });

    // A chargeback whose notification never arrives is found while the watch window lasts.
    processor.chargeback(missed.purchaseId);
    advance(30 * MIN);
    const second = await payments.pollPending();
    expect(second.find((payment) => payment.checkoutId === missed.checkoutId)).toMatchObject({ phase: 'reversed', reversal: { kind: 'chargeback' } });
    expect(second.find((payment) => payment.checkoutId === abandoned.checkoutId)).toMatchObject({ phase: 'expired', issuance: null });
    advance(MIN);
    expect(await payments.pollPending()).toEqual([]);
    expect(await purchasedLots()).toMatchObject({ issued: 100, reversed: 100, available: 0 });
  });

  it('reverses the unspent balance on refund or chargeback and applies the declared spent-credit treatment', async () => {
    const refundedBuy = await checkout('buy:1');
    await payments.receiveNotification(processor.pay(refundedBuy.purchaseId));
    await spend(ledger, 'acct_alice', 'q1');
    const refund = await payments.receiveNotification(processor.refund(refundedBuy.purchaseId));
    expect(refund.payment).toMatchObject({
      phase: 'reversed',
      reversal: { applied: true, kind: 'refund', treatment: 'operator_absorbs', removed: 70, shortfall: 30, status: 'complete' }
    });
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 0, deficit: 0 });
    expect((await ledger.getSolvencySnapshot()).subsidy).toMatchObject({ reversalAbsorbed: 30 });

    const disputedBuy = await checkout('buy:2');
    await payments.receiveNotification(processor.pay(disputedBuy.purchaseId));
    await spend(ledger, 'acct_alice', 'q2');
    const dispute = await payments.receiveNotification(processor.chargeback(disputedBuy.purchaseId));
    expect(dispute.payment.reversal).toMatchObject({ kind: 'chargeback', treatment: 'account_deficit', removed: 70, shortfall: 30 });
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ deficit: 30 });
    await rejectsWith(reserve(ledger, 'acct_alice', 'q3'), 'account_in_deficit');

    // Partial refunds and wrong amounts wait for review with no ledger effect.
    const partialBuy = await checkout('buy:3');
    await payments.receiveNotification(processor.pay(partialBuy.purchaseId));
    expect((await payments.receiveNotification(processor.refund(partialBuy.purchaseId, { amountMinor: 300 }))).payment)
      .toMatchObject({ phase: 'review_required', review: { reason: 'partial_reversal', reversedMinor: 300 }, reversal: null });
    const shortPaid = await checkout('buy:4');
    expect((await payments.receiveNotification(processor.pay(shortPaid.purchaseId, { amountMinor: 1 }))).payment)
      .toMatchObject({ phase: 'review_required', review: { reason: 'amount_mismatch' }, issuance: null });
    expect(await purchasedLots()).toMatchObject({ issued: 300, spent: 60, reversed: 140, available: 100 });
    expect(await ledger.auditAccount('acct_alice')).toMatchObject({ consistent: true });
  });
});
