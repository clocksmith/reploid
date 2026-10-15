/**
 * @fileoverview In-memory payment processor for local runs and tests.
 *
 * It moves no money, holds no credentials and makes no network calls. Each
 * instance signs its notifications with its own random key, so authenticity
 * is checked through the same port a real processor adapter implements.
 * Simulation controls (pay, fail, expire, refund, chargeback, notify) let a
 * test choose which notifications are delivered, duplicated, reordered,
 * replayed or lost.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const SIGNATURE_HEADER = 'x-test-processor-signature';

const signatureFor = (key, timestamp, rawBody) => createHmac('sha256', key).update(`${timestamp}.${rawBody}`).digest('hex');

/**
 * @param {object} options
 * @param {string} options.id processor identifier recorded on every purchase
 * @param {Function} options.clock () => ISO time
 * @param {number} options.signatureToleranceMs accepted notification age
 * @param {number} options.checkoutTtlMs checkout lifetime before expiry
 */
export function createTestPaymentProcessor({ id, clock, signatureToleranceMs, checkoutTtlMs } = {}) {
  if (typeof id !== 'string' || typeof clock !== 'function'
    || !Number.isSafeInteger(signatureToleranceMs) || !Number.isSafeInteger(checkoutTtlMs)) {
    throw new TypeError('test processor needs id, clock, signatureToleranceMs and checkoutTtlMs');
  }
  const key = randomBytes(32);
  const payments = new Map();
  const byCheckout = new Map();
  let sequence = 0;
  const nextId = (prefix) => `${prefix}_${String(++sequence).padStart(6, '0')}`;
  const nowMs = () => Date.parse(clock());

  const payment = (purchaseId) => {
    const record = payments.get(purchaseId);
    if (!record) throw new Error(`test processor has no purchase ${purchaseId}`);
    return record;
  };

  /** Sign an event as this processor would deliver it. */
  const envelope = (event, { signedAt = clock(), signingKey = key } = {}) => {
    const rawBody = JSON.stringify(event);
    const timestamp = String(Date.parse(signedAt));
    return { headers: { [SIGNATURE_HEADER]: `t=${timestamp},v1=${signatureFor(signingKey, timestamp, rawBody)}` }, rawBody };
  };

  const notify = (type, purchaseId) => envelope({ eventId: nextId('evt'), type, purchaseId, createdAt: clock() });

  return {
    id,

    async createCheckout({ checkoutId, accountId, credits, amount, idempotencyKey }) {
      if (byCheckout.has(idempotencyKey)) {
        const existing = payment(byCheckout.get(idempotencyKey));
        return { purchaseId: existing.purchaseId, checkout: existing.checkout };
      }
      const purchaseId = nextId('pay');
      const expiresAt = new Date(nowMs() + checkoutTtlMs).toISOString();
      const record = {
        purchaseId, checkoutId, accountId, credits, amount: { ...amount }, status: 'open',
        confirmationId: null, paidAt: null, reversals: [], expiresAt,
        checkout: { reference: `session_${purchaseId}`, mode: 'one_time', expiresAt }
      };
      payments.set(purchaseId, record);
      byCheckout.set(idempotencyKey, purchaseId);
      return { purchaseId, checkout: record.checkout };
    },

    async verifyNotification({ headers, rawBody } = {}) {
      const header = headers?.[SIGNATURE_HEADER];
      const parts = Object.fromEntries(String(header || '').split(',').map((part) => part.split('=')));
      if (!/^\d+$/.test(parts.t || '') || !/^[a-f0-9]{64}$/.test(parts.v1 || '') || typeof rawBody !== 'string') {
        throw new Error('missing or malformed signature');
      }
      const expected = Buffer.from(signatureFor(key, parts.t, rawBody), 'hex');
      if (!timingSafeEqual(expected, Buffer.from(parts.v1, 'hex'))) throw new Error('signature mismatch');
      if (Math.abs(nowMs() - Number(parts.t)) > signatureToleranceMs) throw new Error('signature outside tolerance');
      return JSON.parse(rawBody);
    },

    async fetchPayment(purchaseId) {
      const record = payment(purchaseId);
      if (record.status === 'open' && nowMs() >= Date.parse(record.expiresAt)) record.status = 'expired';
      const { status, amount, confirmationId, paidAt, reversals } = record;
      return JSON.parse(JSON.stringify({ purchaseId, status, amount, confirmationId, paidAt, reversals }));
    },

    // Simulation controls. Each returns the signed notification the processor
    // would send; the caller decides whether, when and how often to deliver it.
    pay(purchaseId, { amountMinor } = {}) {
      const record = payment(purchaseId);
      Object.assign(record, {
        status: 'paid',
        confirmationId: nextId('confirm'),
        paidAt: clock(),
        amount: { ...record.amount, amountMinor: amountMinor ?? record.amount.amountMinor }
      });
      return notify('payment.succeeded', purchaseId);
    },
    fail(purchaseId) {
      payment(purchaseId).status = 'failed';
      return notify('payment.failed', purchaseId);
    },
    refund(purchaseId, { amountMinor } = {}) {
      const record = payment(purchaseId);
      record.reversals.push({
        reversalRef: nextId('refund'), kind: 'refund', at: clock(),
        amount: { currency: record.amount.currency, amountMinor: amountMinor ?? record.amount.amountMinor }
      });
      return notify('payment.refunded', purchaseId);
    },
    chargeback(purchaseId) {
      const record = payment(purchaseId);
      record.reversals.push({ reversalRef: nextId('dispute'), kind: 'chargeback', at: clock(), amount: { ...record.amount } });
      return notify('payment.disputed', purchaseId);
    },
    notify,
    envelope,
    /** Sign with a key this processor does not hold, as a forger would. */
    forge(event) {
      return envelope(event, { signingKey: randomBytes(32) });
    }
  };
}

export default createTestPaymentProcessor;
