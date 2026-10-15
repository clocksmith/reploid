/**
 * @fileoverview Payment processor port.
 *
 * A processor adapter supplies exactly three operations:
 *
 * - `createCheckout({ checkoutId, accountId, credits, amount, idempotencyKey,
 *   topUpId, paymentPolicyVersion, conversion })` starts a one-time top-up
 *   checkout at `amount` (the policy price) for `credits` (stamped under the
 *   `conversion` record) and returns `{ purchaseId, checkout }`, where
 *   `checkout` is the opaque hand-off the client completes with the
 *   processor. Repeating the same idempotency key returns the same purchase.
 *   There is no subscription operation.
 * - `verifyNotification({ headers, rawBody })` checks the notification's
 *   authenticity (signature over the raw body, timestamp tolerance) and
 *   returns `{ eventId, purchaseId, type, createdAt }`, with `purchaseId`
 *   null for an authentic event that names no purchase. It throws (or
 *   returns null) when the notification is not authentic, and throws a
 *   PaymentError when a lookup it needs fails.
 * - `fetchPayment(purchaseId)` returns the processor's authoritative status:
 *   `{ purchaseId, status, amount, confirmationId, paidAt, reversals }` with
 *   status one of open, paid, failed or expired, and reversals listing
 *   `{ reversalRef, kind: refund|chargeback, amount, at }`.
 *
 * Processor output is external data: every response is validated here
 * before the reconciler uses it.
 */

import { isIsoTime, isNonEmptyString } from '../ledger/domain.js';
import { PROCESSOR_REVERSAL_KINDS, PROCESSOR_STATUSES, fail, isMoney, isStatusTime } from './domain.js';

export const PAYMENT_PROCESSOR_OPERATIONS = Object.freeze(['createCheckout', 'verifyNotification', 'fetchPayment']);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,159}$/;
const isIdentifier = (value) => typeof value === 'string' && ID_PATTERN.test(value);

export function assertPaymentProcessor(processor) {
  const missing = PAYMENT_PROCESSOR_OPERATIONS.filter((operation) => typeof processor?.[operation] !== 'function');
  if (missing.length) throw new TypeError(`Payment processor port is incomplete: ${missing.join(', ')}`);
  if (!isIdentifier(processor.id)) throw new TypeError('Payment processor port requires an identifier `id`');
  if (processor.testOnly !== undefined && typeof processor.testOnly !== 'boolean') throw new TypeError('Payment processor testOnly must be a boolean');
  return processor;
}

const invalid = (operation, errors) => fail('invalid_processor_response', `${operation} returned an invalid response`, { errors });

export function validateCheckoutResponse(response) {
  const errors = [];
  if (!isIdentifier(response?.purchaseId)) errors.push('purchaseId must be an identifier');
  if (!response?.checkout || typeof response.checkout !== 'object') errors.push('checkout hand-off is required');
  if (errors.length) invalid('createCheckout', errors);
  return { purchaseId: response.purchaseId, checkout: JSON.parse(JSON.stringify(response.checkout)) };
}

/** Null when the notification is not a well-formed authentic event; `purchaseId` may be null. */
export function validateNotificationEvent(event) {
  if (!event || !isNonEmptyString(event.eventId) || event.eventId.length > 256 || !(event.purchaseId === null || isIdentifier(event.purchaseId))
    || !isNonEmptyString(event.type) || !isIsoTime(event.createdAt)) {
    return null;
  }
  return { eventId: event.eventId, purchaseId: event.purchaseId, type: event.type, createdAt: event.createdAt };
}

export function validatePaymentStatus(status, { purchaseId }) {
  const errors = [];
  if (status?.purchaseId !== purchaseId) errors.push('purchaseId must match the requested purchase');
  if (!PROCESSOR_STATUSES.includes(status?.status)) errors.push(`status must be one of ${PROCESSOR_STATUSES.join(', ')}`);
  if (!isMoney(status?.amount)) errors.push('amount must state amountMinor and currency');
  if (status?.status === 'paid' && !isNonEmptyString(status?.confirmationId)) errors.push('a paid status must carry confirmationId');
  if (!isStatusTime(status?.paidAt ?? null)) errors.push('paidAt must be an ISO time or null');
  if (!Array.isArray(status?.reversals)) errors.push('reversals must be a list');
  (status?.reversals || []).forEach((reversal, index) => {
    if (!isIdentifier(reversal?.reversalRef)) errors.push(`reversals[${index}].reversalRef must be an identifier`);
    if (!PROCESSOR_REVERSAL_KINDS.includes(reversal?.kind)) errors.push(`reversals[${index}].kind must be refund or chargeback`);
    if (!isMoney(reversal?.amount) || reversal.amount.amountMinor === 0) errors.push(`reversals[${index}].amount must be positive money`);
    if (!isIsoTime(reversal?.at)) errors.push(`reversals[${index}].at must be an ISO time`);
  });
  if (status?.reversals?.length && status.status !== 'paid') errors.push('only a paid payment can carry reversals');
  if (errors.length) invalid('fetchPayment', errors);
  return {
    purchaseId,
    status: status.status,
    amount: { amountMinor: status.amount.amountMinor, currency: status.amount.currency },
    confirmationId: status.confirmationId ?? null,
    paidAt: status.paidAt ?? null,
    reversals: status.reversals.map(({ reversalRef, kind, amount, at }) => ({
      reversalRef, kind, amount: { amountMinor: amount.amountMinor, currency: amount.currency }, at
    }))
  };
}

export default { PAYMENT_PROCESSOR_OPERATIONS, assertPaymentProcessor, validateCheckoutResponse, validateNotificationEvent, validatePaymentStatus };
