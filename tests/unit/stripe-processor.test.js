// Stripe Checkout behind the payment processor port: the Checkout Session request, webhook
// signatures, and reconciliation of duplicate, reordered and replayed events, refunds and
// disputes through the existing purchase reconciliation. Stripe is a local fake; keys, prices
// and rates are test-only.
import { beforeEach, describe, expect, it } from 'vitest';

import { createPaymentStore, createPurchaseIssuanceAuthority } from '../../server/payments/engine.js';
import { createTestPaymentProcessor } from '../../server/payments/test-processor.js';
import { STRIPE_API_VERSION } from '../../server/providers/stripe-api.js';
import { createStripePaymentProcessor } from '../../server/providers/stripe-processor.js';
import { DAY, MIN, accounts, advance, composeIssuance, fx, harnesses, journalShape, rejectsWith, resetFixture } from '../helpers/access-fixture.js';
import { publishConversion } from '../helpers/conversion-fixture.js';
import { NEXT_WEBHOOK_SECRET, TEST_SECRET_KEY, WEBHOOK_SECRET, createStripeFake, stripeSignature } from '../helpers/stripe-fake.js';

const clock = () => new Date(fx.nowMs).toISOString();
// Test-only purchase terms and reversal treatments; not product prices or adopted policy.
const POLICY = Object.freeze({
  policyVersion: 'test-payments/stripe-1',
  processorId: 'stripe-test',
  topUps: [{ topUpId: 'test-topup-a', price: { amountMinor: 999, currency: 'USD' } }],
  polling: { minAgeMs: MIN, reversalWatchMs: 30 * DAY }
});
const REVERSAL_POLICY = { refund: { spentCredit: 'operator_absorbs' }, chargeback: { spentCredit: 'account_deficit' } };
const SUCCESS_URL = 'https://reploid.test/top-up/done?session={CHECKOUT_SESSION_ID}';
const CANCEL_URL = 'https://reploid.test/top-up';

const createProcessor = (stripe, options = {}) => createStripePaymentProcessor({
  mode: 'test', secretKey: TEST_SECRET_KEY, webhookSecrets: [WEBHOOK_SECRET], toleranceMs: 5 * MIN,
  successUrl: SUCCESS_URL, cancelUrl: CANCEL_URL, fetch: stripe.fetch, clock, ...options
});

describe.each(Object.keys(harnesses))('Stripe Checkout reconciliation (%s store)', (kind) => {
  let harness;
  let stripe;
  let processor;
  let ledger;
  let payments;
  let paymentBackend;

  const open = (withProcessor = processor, policy = POLICY) => {
    paymentBackend = harness.openPaymentBackend();
    ledger = harness.openLedger({
      issuanceAuthority: composeIssuance({ purchased: createPurchaseIssuanceAuthority({ backend: paymentBackend }) }),
      reversalPolicy: REVERSAL_POLICY
    });
    payments = createPaymentStore({ backend: paymentBackend, ledger, processor: withProcessor, accounts, policy, clock });
  };
  const checkout = (key) => payments.startCheckout({ participantId: 'peer_alice', topUpId: 'test-topup-a', idempotencyKey: key });
  const deliver = (delivery) => payments.receiveNotification(delivery);
  const purchased = async () => (await ledger.getAccount('acct_alice')).byProvenance.purchased;

  beforeEach(async () => {
    resetFixture();
    harness = harnesses[kind]();
    stripe = createStripeFake({ nowMs: () => fx.nowMs, pageSize: 2 });
    processor = createProcessor(stripe);
    open();
    fx.participants.set('peer_alice', 'acct_alice');
    await ledger.openAccount({ accountId: 'acct_alice', ownerId: 'uid_alice' });
    // 100 credits per 999 minor units under a test-only conversion record.
    await publishConversion(ledger, { conversionId: 'conv_test_usd_a', rate: { credits: 100, perMinorUnits: 999 }, clock });
  });

  it('opens a one-time Checkout Session at the policy price, stamped with the conversion record', async () => {
    const started = await checkout('buy:1');
    expect(started).toMatchObject({
      phase: 'open', processor: 'stripe-test', credits: 100, purchaseId: expect.stringMatching(/^cs_test_/),
      checkout: { kind: 'stripe_checkout', mode: 'one_time', livemode: false, url: expect.stringMatching(/^https:\/\/checkout\.stripe\.com\//) }
    });
    const [request] = stripe.requests;
    expect(request).toMatchObject({ method: 'POST', url: 'https://api.stripe.com/v1/checkout/sessions' });
    expect(request.headers).toEqual({
      Authorization: `Bearer ${TEST_SECRET_KEY}`, 'Stripe-Version': STRIPE_API_VERSION,
      'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `reploid-checkout:${started.checkoutId}`
    });
    const stamp = {
      reploid_checkout_id: started.checkoutId, reploid_account_id: 'acct_alice', reploid_credits: '100', reploid_top_up_id: 'test-topup-a',
      reploid_payment_policy_version: 'test-payments/stripe-1', reploid_conversion_id: 'conv_test_usd_a', reploid_conversion_hash: started.quote.recordHash
    };
    expect(Object.fromEntries(request.form)).toEqual({
      mode: 'payment',
      client_reference_id: started.checkoutId,
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': '999',
      'line_items[0][price_data][product_data][name]': 'Reploid credit top-up',
      'line_items[0][price_data][product_data][description]': '100 credits',
      ...Object.fromEntries(Object.entries(stamp).map(([key, value]) => [`metadata[${key}]`, value])),
      ...Object.fromEntries(Object.entries(stamp).map(([key, value]) => [`payment_intent_data[metadata][${key}]`, value]))
    });
    expect(request.form.some(([key]) => /recurring|subscription|interval/.test(key))).toBe(false);
    // A retried start returns the same checkout and makes no second session.
    expect(await checkout('buy:1')).toMatchObject({ checkoutId: started.checkoutId, purchaseId: started.purchaseId });
    expect(stripe.sessions.size).toBe(1);
  });

  it('resumes an interrupted creation under the same Stripe idempotency key', async () => {
    // Stripe creates the session, but its response never arrives.
    stripe.failNext(1, 0, { afterEffect: true });
    await expect(checkout('buy:1')).rejects.toMatchObject({ code: 'processor_unavailable', retryable: true });
    expect(stripe.sessions.size).toBe(1);
    const [record] = await payments.listPayments({ phase: 'creating' });
    expect(record).toMatchObject({ phase: 'creating', purchaseId: null });
    open();
    const resumed = await payments.reconcile({ checkoutId: record.checkoutId });
    expect(resumed).toMatchObject({ phase: 'open', purchaseId: expect.stringMatching(/^cs_test_/) });
    expect(stripe.sessions.size).toBe(1);
  });

  it('verifies Stripe-Signature over the raw body: tampered, stale, future, missing and rotated secrets', async () => {
    const started = await checkout('buy:1');
    const { session } = stripe.complete(started.purchaseId);
    const delivery = stripe.event('checkout.session.completed', session);
    expect(await processor.verifyNotification(delivery)).toEqual({
      eventId: delivery.eventId, purchaseId: started.purchaseId, type: 'checkout.session.completed', createdAt: clock()
    });
    // The exact bytes are signed: a Buffer of them verifies, any change does not.
    expect((await processor.verifyNotification({ ...delivery, rawBody: Buffer.from(delivery.rawBody) })).eventId).toBe(delivery.eventId);
    const notAuthentic = (attempt) => rejectsWith(deliver(attempt), 'notification_not_authentic');
    await notAuthentic({ ...delivery, rawBody: delivery.rawBody.replace('"complete"', '"expired"') });
    await notAuthentic({ ...delivery, rawBody: JSON.stringify(JSON.parse(delivery.rawBody)) + ' ' });
    await notAuthentic({ headers: {}, rawBody: delivery.rawBody });
    await notAuthentic({ headers: { 'stripe-signature': delivery.headers['stripe-signature'].replace(/v1=/, 'v0=') }, rawBody: delivery.rawBody });
    await notAuthentic(stripe.event('checkout.session.completed', session, { secrets: ['whsec_someone_elses_secret'] }));
    await notAuthentic(stripe.event('checkout.session.completed', session, { signedAtMs: fx.nowMs + 6 * MIN }));
    await notAuthentic(stripe.event('checkout.session.completed', session, { eventLivemode: true }));
    advance(6 * MIN);
    await notAuthentic(delivery);

    // Rolling the endpoint secret: Stripe signs with both; the old secret is accepted until it is removed.
    const rolling = stripe.event('checkout.session.completed', session, { secrets: [NEXT_WEBHOOK_SECRET, WEBHOOK_SECRET] });
    expect((await processor.verifyNotification(rolling)).purchaseId).toBe(started.purchaseId);
    const rolled = createProcessor(stripe, { webhookSecrets: [NEXT_WEBHOOK_SECRET, WEBHOOK_SECRET] });
    expect((await rolled.verifyNotification(stripe.event('checkout.session.completed', session))).purchaseId).toBe(started.purchaseId);
    const retired = createProcessor(stripe, { webhookSecrets: [NEXT_WEBHOOK_SECRET] });
    await expect(retired.verifyNotification(stripe.event('checkout.session.completed', session))).rejects.toThrow(/no Stripe-Signature matches/);
    expect((await retired.verifyNotification(stripe.event('checkout.session.completed', session, { secrets: [NEXT_WEBHOOK_SECRET] }))).eventId).toMatch(/^evt_/);
    expect(stripeSignature('{}', [WEBHOOK_SECRET], fx.nowMs)).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    expect(await journalShape(ledger, 'acct_alice')).toEqual([]);
  });

  it('issues credit exactly once across duplicate, reordered and replayed webhooks', async () => {
    const first = await checkout('buy:1');
    const { session, charge } = stripe.complete(first.purchaseId);
    const completed = stripe.event('checkout.session.completed', session);
    expect(await deliver(completed)).toMatchObject({ duplicate: false, matched: true, payment: { phase: 'issued', observed: { paid: true } } });
    expect(await deliver(completed)).toMatchObject({ duplicate: true, payment: { phase: 'issued' } });
    // Stripe retries the same event id with a fresh signature: still one effect.
    advance(10 * MIN);
    expect(await deliver(stripe.event('checkout.session.completed', session, { eventId: completed.eventId }))).toMatchObject({ duplicate: true });
    await rejectsWith(deliver(completed), 'notification_not_authentic');
    const lot = (await payments.getPayment(first.checkoutId)).issuance.lotId;
    expect(await ledger.getLot(lot)).toMatchObject({
      provenance: 'purchased', quantity: 100, source: { processor: 'stripe-test', purchaseId: first.purchaseId, confirmationId: session.payment_intent, price: { amountMinor: 999, currency: 'USD' } }
    });
    expect((await payments.getPayment(first.checkoutId)).observed).toMatchObject({ amount: { amountMinor: 999, currency: 'USD' }, paidAt: new Date(charge.created * 1000).toISOString() });

    // A delayed payment: the success event arrives before the completion event.
    const second = await checkout('buy:2');
    const pending = stripe.complete(second.purchaseId, { processing: true });
    const completedLater = stripe.event('checkout.session.completed', pending.session);
    expect(await payments.reconcile({ checkoutId: second.checkoutId })).toMatchObject({ phase: 'open' });
    const succeeded = stripe.event('checkout.session.async_payment_succeeded', stripe.settleDelayed(second.purchaseId, { succeeded: true }).session);
    expect(await deliver(succeeded)).toMatchObject({ payment: { phase: 'issued' } });
    expect(await deliver(completedLater)).toMatchObject({ duplicate: false, payment: { phase: 'issued' } });

    // Authentic events about nothing this store started have no effect and need no lookup.
    const before = stripe.requests.length;
    expect(await deliver(stripe.event('customer.created', { id: 'cus_fake1', object: 'customer' }))).toMatchObject({ matched: false, payment: null });
    expect(stripe.requests.length).toBe(before);
    expect(await journalShape(ledger, 'acct_alice')).toEqual([['issue', 100], ['issue', 100]]);
  });

  it('maps refunds and disputes to the existing reversal semantics, sending partials to review', async () => {
    const paid = async (key) => {
      const started = await checkout(key);
      const { session, charge } = stripe.complete(started.purchaseId);
      await deliver(stripe.event('checkout.session.completed', session));
      return { ...started, charge };
    };
    // A full refund, announced through its charge, reverses the lot.
    const refunded = await paid('buy:refund');
    stripe.refund(refunded.purchaseId);
    expect(await deliver(stripe.event('charge.refunded', stripe.charge(refunded.charge.id)))).toMatchObject({
      matched: true, payment: { phase: 'reversed', reversal: { applied: true, kind: 'refund' } }
    });

    // A partial refund goes to review; failed refunds count for nothing; a pending one counts once it succeeds.
    const partial = await paid('buy:partial');
    expect(await deliver(stripe.event('charge.refunded', stripe.refund(partial.purchaseId, { amount: 300 })))).toMatchObject({
      payment: { phase: 'review_required', review: { reason: 'partial_reversal', reversedMinor: 300 } }
    });
    const slow = await paid('buy:slow');
    expect(await deliver(stripe.event('charge.refund.updated', stripe.refund(slow.purchaseId, { status: 'failed' })))).toMatchObject({ payment: { phase: 'issued' } });
    const pendingRefund = stripe.refund(slow.purchaseId, { status: 'pending' });
    expect(await deliver(stripe.event('charge.refund.updated', pendingRefund))).toMatchObject({ payment: { phase: 'issued' } });
    expect(await deliver(stripe.event('charge.refund.updated', stripe.update(pendingRefund, { status: 'succeeded' })))).toMatchObject({ payment: { phase: 'reversed' } });

    // Disputes: open and won ones reverse nothing; a lost one is a chargeback; a lost part goes to review.
    const disputed = await paid('buy:dispute');
    const opened = stripe.dispute(disputed.purchaseId);
    expect(await deliver(stripe.event('charge.dispute.created', opened))).toMatchObject({ payment: { phase: 'issued' } });
    expect(await deliver(stripe.event('charge.dispute.closed', stripe.update(opened, { status: 'won' })))).toMatchObject({ payment: { phase: 'issued' } });
    const lost = await paid('buy:lost');
    // A dispute that names only its charge is traced through the charge's payment intent.
    const lostDispute = stripe.dispute(lost.purchaseId, { linkIntent: false, status: 'lost' });
    expect(await deliver(stripe.event('charge.dispute.closed', lostDispute))).toMatchObject({
      matched: true, payment: { phase: 'reversed', reversal: { applied: true, kind: 'chargeback' } }
    });
    const inquiry = await paid('buy:inquiry');
    expect(await deliver(stripe.event('charge.dispute.closed', stripe.dispute(inquiry.purchaseId, { status: 'warning_closed' })))).toMatchObject({ payment: { phase: 'issued' } });
    const partLost = await paid('buy:part-lost');
    expect(await deliver(stripe.event('charge.dispute.closed', stripe.dispute(partLost.purchaseId, { amount: 500, status: 'lost' })))).toMatchObject({
      payment: { phase: 'review_required', review: { reason: 'partial_reversal', reversedMinor: 500 } }
    });
    // Pagination: several refunds across list pages sum to the full amount.
    const split = await paid('buy:split');
    for (const amount of [333, 333, 333]) stripe.refund(split.purchaseId, { amount });
    expect(await payments.reconcile({ checkoutId: split.checkoutId })).toMatchObject({ phase: 'reversed' });
    // Eight purchases: four fully reversed, two partials in review, two standing.
    expect(await purchased()).toMatchObject({ issued: 800, reversed: 400 });
  });

  it('records failed and expired checkouts without credit, and waits out a Stripe outage', async () => {
    const failing = await checkout('buy:fail');
    stripe.complete(failing.purchaseId, { processing: true });
    const failed = stripe.event('checkout.session.async_payment_failed', stripe.settleDelayed(failing.purchaseId, { succeeded: false }).session);
    expect(await deliver(failed)).toMatchObject({ payment: { phase: 'failed' } });
    const abandoned = await checkout('buy:expire');
    expect(await deliver(stripe.event('checkout.session.expired', stripe.expire(abandoned.purchaseId)))).toMatchObject({ payment: { phase: 'expired' } });

    // Stripe is down while the notification arrives: recorded, then reconciled by the redelivery.
    const later = await checkout('buy:later');
    const { session, charge } = stripe.complete(later.purchaseId);
    const completed = stripe.event('checkout.session.completed', session);
    stripe.failNext(1, 503);
    await expect(deliver(completed)).rejects.toMatchObject({ code: 'processor_unavailable', retryable: true });
    expect(await deliver(completed)).toMatchObject({ duplicate: true, payment: { phase: 'issued' } });
    // A charge event whose session lookup fails is retryable, not inauthentic.
    stripe.failNext(1, 500);
    await expect(deliver(stripe.event('charge.refunded', stripe.charge(charge.id)))).rejects.toMatchObject({ code: 'processor_unavailable' });
    expect(await journalShape(ledger, 'acct_alice')).toEqual([['issue', 100]]);
  });

  it('keeps test-mode and other processors\' records apart', async () => {
    const legacy = createTestPaymentProcessor({ id: 'test-processor', clock, signatureToleranceMs: 5 * MIN, checkoutTtlMs: 30 * MIN });
    open(legacy, { ...POLICY, processorId: 'test-processor' });
    const other = await checkout('buy:other');
    open();
    await rejectsWith(payments.reconcile({ checkoutId: other.checkoutId }), 'processor_mismatch');
    advance(2 * MIN);
    expect(await payments.pollPending()).toEqual([]);
    expect(payments.processor).toEqual({ id: 'stripe-test', testOnly: false, mode: 'test' });
    await expect(processor.fetchPayment('cs_live_fake000001')).rejects.toMatchObject({ code: 'invalid_input' });
    expect(() => createProcessor(stripe, { secretKey: 'sk_live_fakeKeyForTests' })).toThrow(/test-mode/);
    expect(() => createProcessor(stripe, { webhookSecrets: ['not-a-secret'] })).toThrow(/whsec_/);
    expect(() => createProcessor(stripe, { successUrl: 'http://reploid.test/done' })).toThrow(/https/);
  });
});
