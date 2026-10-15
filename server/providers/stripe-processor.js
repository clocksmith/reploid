/**
 * @fileoverview Stripe Checkout behind the payment processor port
 * (../payments/processor-contract.js) for one-time top-ups.
 *
 * - createCheckout opens a Checkout Session in `payment` mode with one line
 *   item priced inline at the checkout's policy price, and stamps Reploid's
 *   checkout, credits, top-up, payment policy version and conversion record
 *   in the session and payment metadata. The idempotency key is derived from
 *   the checkout id, so a retried creation returns the same session.
 * - verifyNotification checks Stripe-Signature over the raw body (secret
 *   rotation and timestamp tolerance), requires the event's livemode to match
 *   this mode, and only names the Checkout Session the event concerns: a
 *   session event names itself; a charge, refund, dispute or payment intent
 *   names the session that created its payment intent. Other events name none.
 * - fetchPayment reads the session, its payment intent and latest charge,
 *   and lists the payment's refunds and disputes. A refund counts once it
 *   succeeded; a dispute counts as a chargeback once lost. Open disputes and
 *   inquiries reverse nothing, so every arrival order of the same Stripe facts
 *   gives the same reversals; the reconciler maps full reversals to the lot
 *   and sends partial ones to review.
 *
 * Test and live mode are separate processors (`stripe-test`, `stripe-live`)
 * with mode-matching keys, session ids and livemode flags.
 */

import { fail, PaymentError } from '../payments/domain.js';
import { createStripeApi, STRIPE_API_VERSION, verifyStripeSignature } from './stripe-api.js';

export const STRIPE_MODES = Object.freeze(['test', 'live']);
export const DEFAULT_PRODUCT_NAME = 'Reploid credit top-up';
/** The event types a webhook endpoint should send; others are accepted and name no purchase. */
export const STRIPE_WEBHOOK_EVENTS = Object.freeze([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed',
  'checkout.session.expired', 'charge.refunded', 'charge.refund.updated', 'charge.dispute.created', 'charge.dispute.closed'
]);
const PAYMENT_OBJECTS = new Set(['charge', 'refund', 'dispute', 'payment_intent']);
const MAX_NOTIFICATION_BYTES = 1024 * 1024;

const iso = (seconds) => new Date(seconds * 1000).toISOString();
const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const isCurrency = (value) => typeof value === 'string' && /^[a-z]{3}$/.test(value);
const idOf = (value) => (typeof value === 'string' ? value : typeof value?.id === 'string' ? value.id : null);
const invalid = (operation, reason) => fail('invalid_processor_response', `Stripe ${operation}: ${reason}`, { errors: [reason] });

const headerValue = (headers, name) => {
  if (!headers || typeof headers !== 'object') return undefined;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name);
  const value = key === undefined ? undefined : headers[key];
  return Array.isArray(value) ? value.join(',') : value;
};

const assertRedirectUrl = (value, label) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute URL`);
  }
  if (!(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) {
    throw new TypeError(`${label} must be https (http only on loopback)`);
  }
  return value;
};

/**
 * @param {object} options
 * @param {'test'|'live'} options.mode
 * @param {string} options.secretKey a secret or restricted key of this mode
 * @param {string[]} options.webhookSecrets endpoint signing secrets, current first
 * @param {number} options.toleranceMs accepted signature age either side of now
 * @param {string} options.successUrl where Checkout returns after payment ({CHECKOUT_SESSION_ID} allowed)
 * @param {string} options.cancelUrl where Checkout returns when abandoned
 * @param {string} [options.productName] the line item name the payer sees
 * @param {string} [options.apiVersion]
 * @param {Function} [options.fetch]
 * @param {Function} [options.clock] () => ISO time
 */
export function createStripePaymentProcessor({
  mode, secretKey, webhookSecrets, toleranceMs, successUrl, cancelUrl, productName = DEFAULT_PRODUCT_NAME,
  apiVersion = STRIPE_API_VERSION, fetch = globalThis.fetch, clock = () => new Date().toISOString()
} = {}) {
  if (!STRIPE_MODES.includes(mode)) throw new TypeError('mode must be test or live');
  if (typeof secretKey !== 'string' || !new RegExp(`^(sk|rk)_${mode}_`).test(secretKey)) throw new TypeError(`secretKey must be a Stripe ${mode}-mode secret or restricted key`);
  if (!Array.isArray(webhookSecrets) || webhookSecrets.length === 0 || webhookSecrets.some((secret) => typeof secret !== 'string' || !/^whsec_[A-Za-z0-9+/=_-]{16,}$/.test(secret))) {
    throw new TypeError('webhookSecrets must list at least one whsec_ endpoint secret');
  }
  if (!Number.isSafeInteger(toleranceMs) || toleranceMs <= 0 || toleranceMs > 60 * 60_000) throw new TypeError('toleranceMs must be a positive integer of at most one hour');
  assertRedirectUrl(successUrl, 'successUrl');
  assertRedirectUrl(cancelUrl, 'cancelUrl');
  if (typeof productName !== 'string' || !productName.trim() || productName.length > 250) throw new TypeError('productName must be 1 to 250 characters');
  if (typeof clock !== 'function') throw new TypeError('clock must be a function');
  const live = mode === 'live';
  const sessionPattern = new RegExp(`^cs_${mode}_[A-Za-z0-9]+$`);
  const api = createStripeApi({ secretKey, apiVersion, fetch });
  const secrets = Object.freeze([...webhookSecrets]);

  const assertMode = (object, operation) => {
    if (object?.livemode !== live) invalid(operation, `the ${object?.object ?? 'object'} is not a ${mode}-mode object`);
  };

  /** The Checkout Session that created a payment intent, or null when none did. */
  const sessionForPaymentIntent = async (paymentIntentId) => {
    const sessions = await api.get('/v1/checkout/sessions', { payment_intent: paymentIntentId, limit: 1 });
    const session = Array.isArray(sessions?.data) ? sessions.data[0] : null;
    return session && sessionPattern.test(session.id) ? session.id : null;
  };

  /** The session an event object concerns; null for objects that name no Checkout payment. */
  const purchaseFor = async (object) => {
    if (object?.object === 'checkout.session') return sessionPattern.test(object.id) ? object.id : null;
    if (!PAYMENT_OBJECTS.has(object?.object)) return null;
    let paymentIntentId = object.object === 'payment_intent' ? idOf(object) : idOf(object.payment_intent);
    if (!paymentIntentId && object.object === 'dispute' && idOf(object.charge)) {
      paymentIntentId = idOf((await api.get(`/v1/charges/${encodeURIComponent(idOf(object.charge))}`)).payment_intent);
    }
    return paymentIntentId ? sessionForPaymentIntent(paymentIntentId) : null;
  };

  /** Succeeded refunds and lost disputes of one payment intent, as processor reversals. */
  const reversalsFor = async (paymentIntentId) => {
    const [refunds, disputes] = await Promise.all([
      api.list('/v1/refunds', { payment_intent: paymentIntentId }),
      api.list('/v1/disputes', { payment_intent: paymentIntentId })
    ]);
    const reversal = (item, kind) => {
      if (!isPositiveInteger(item.amount) || !isCurrency(item.currency) || !Number.isSafeInteger(item.created) || typeof item.id !== 'string') {
        invalid('fetchPayment', `${kind} ${String(item.id)} is malformed`);
      }
      return { reversalRef: item.id, kind, amount: { amountMinor: item.amount, currency: item.currency.toUpperCase() }, at: iso(item.created) };
    };
    return [
      ...refunds.filter((refund) => refund.status === 'succeeded').map((refund) => reversal(refund, 'refund')),
      ...disputes.filter((dispute) => dispute.status === 'lost').map((dispute) => reversal(dispute, 'chargeback'))
    ];
  };

  return Object.freeze({
    id: `stripe-${mode}`,
    mode,
    testOnly: false,

    async createCheckout({ checkoutId, accountId, credits, amount, idempotencyKey, topUpId = null, paymentPolicyVersion = null, conversion = null }) {
      if (!isPositiveInteger(amount?.amountMinor) || typeof amount.currency !== 'string' || !/^[A-Z]{3}$/.test(amount.currency)) {
        fail('invalid_input', 'a checkout needs a positive price in minor units and an ISO currency');
      }
      if (!isPositiveInteger(credits)) fail('invalid_input', 'a checkout needs a positive credit quantity');
      const currency = amount.currency.toLowerCase();
      const metadata = Object.fromEntries(Object.entries({
        reploid_checkout_id: checkoutId,
        reploid_account_id: accountId,
        reploid_credits: String(credits),
        reploid_top_up_id: topUpId,
        reploid_payment_policy_version: paymentPolicyVersion,
        reploid_conversion_id: conversion?.conversionId ?? null,
        reploid_conversion_hash: conversion?.recordHash ?? null
      }).filter(([, value]) => typeof value === 'string' && value.length > 0));
      const session = await api.post('/v1/checkout/sessions', {
        mode: 'payment',
        client_reference_id: checkoutId,
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: [{
          quantity: 1,
          price_data: { currency, unit_amount: amount.amountMinor, product_data: { name: productName, description: `${credits} credits` } }
        }],
        metadata,
        payment_intent_data: { metadata }
      }, { idempotencyKey: `reploid-checkout:${idempotencyKey}` });
      if (session?.object !== 'checkout.session' || !sessionPattern.test(session.id)) invalid('createCheckout', 'no Checkout Session id of this mode');
      assertMode(session, 'createCheckout');
      if (session.mode !== 'payment' || session.client_reference_id !== checkoutId) invalid('createCheckout', 'the session is not this one-time checkout');
      if (session.amount_total !== amount.amountMinor || session.currency !== currency) invalid('createCheckout', 'the session total differs from the checkout price');
      if (typeof session.url !== 'string' || !session.url.startsWith('https://') || !Number.isSafeInteger(session.expires_at)) {
        invalid('createCheckout', 'the session has no hosted page or expiry');
      }
      return {
        purchaseId: session.id,
        checkout: { kind: 'stripe_checkout', sessionId: session.id, url: session.url, expiresAt: iso(session.expires_at), mode: 'one_time', livemode: live }
      };
    },

    async verifyNotification({ headers, rawBody } = {}) {
      const size = typeof rawBody === 'string' ? Buffer.byteLength(rawBody) : rawBody?.length;
      if (!(size > 0 && size <= MAX_NOTIFICATION_BYTES)) throw new Error('notification body is missing or too large');
      verifyStripeSignature({ header: headerValue(headers, 'stripe-signature'), rawBody, secrets, toleranceMs, nowMs: Date.parse(clock()) });
      let event;
      try {
        event = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody);
      } catch {
        throw new Error('notification body is not JSON');
      }
      if (event?.object !== 'event' || typeof event.id !== 'string' || !/^evt_[A-Za-z0-9]+$/.test(event.id)
        || typeof event.type !== 'string' || !Number.isSafeInteger(event.created) || !event.data?.object || typeof event.data.object !== 'object') {
        throw new Error('notification is not a Stripe event');
      }
      if (event.livemode !== live) throw new Error(`notification is not a ${mode}-mode event`);
      let purchaseId;
      try {
        purchaseId = await purchaseFor(event.data.object);
      } catch (error) {
        // The event is authentic; finding its session failed and a redelivery can retry.
        if (error instanceof PaymentError) throw error;
        fail('processor_unavailable', 'the Stripe session for this notification could not be found yet');
      }
      return { eventId: event.id, purchaseId, type: event.type, createdAt: iso(event.created) };
    },

    async fetchPayment(purchaseId) {
      if (typeof purchaseId !== 'string' || !sessionPattern.test(purchaseId)) fail('invalid_input', `${purchaseId} is not a ${mode}-mode Checkout Session`);
      const session = await api.get(`/v1/checkout/sessions/${encodeURIComponent(purchaseId)}`, { expand: ['payment_intent.latest_charge'] });
      if (session?.object !== 'checkout.session' || session.id !== purchaseId) invalid('fetchPayment', 'the session id differs');
      assertMode(session, 'fetchPayment');
      if (session.mode !== 'payment' || !Number.isSafeInteger(session.amount_total) || !isCurrency(session.currency)) invalid('fetchPayment', 'the session is not a priced one-time payment');
      const intent = session.payment_intent && typeof session.payment_intent === 'object' ? session.payment_intent : null;
      if (intent) {
        if (intent.object !== 'payment_intent' || typeof intent.id !== 'string') invalid('fetchPayment', 'the payment intent is malformed');
        assertMode(intent, 'fetchPayment');
      }
      const sessionAmount = { amountMinor: session.amount_total, currency: session.currency.toUpperCase() };
      const unpaid = (status) => ({ purchaseId, status, amount: sessionAmount, confirmationId: null, paidAt: null, reversals: [] });
      if (session.status === 'expired') return unpaid('expired');
      if (session.status === 'open') return unpaid('open');
      if (session.status !== 'complete') invalid('fetchPayment', `unknown session status ${String(session.status)}`);
      if (session.payment_status === 'no_payment_required') return unpaid('failed');
      if (session.payment_status !== 'paid' || intent?.status !== 'succeeded') {
        // A completed session whose payment intent needs a new method or was canceled will not be paid.
        return unpaid(['requires_payment_method', 'canceled'].includes(intent?.status) ? 'failed' : 'open');
      }
      if (!Number.isSafeInteger(intent.amount_received) || !isCurrency(intent.currency)) invalid('fetchPayment', 'the paid amount is malformed');
      const charge = intent.latest_charge && typeof intent.latest_charge === 'object' ? intent.latest_charge : null;
      return {
        purchaseId,
        status: 'paid',
        amount: { amountMinor: intent.amount_received, currency: intent.currency.toUpperCase() },
        confirmationId: intent.id,
        paidAt: charge?.status === 'succeeded' && Number.isSafeInteger(charge.created) ? iso(charge.created) : null,
        reversals: await reversalsFor(intent.id)
      };
    }
  });
}

export default createStripePaymentProcessor;
