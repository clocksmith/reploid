/**
 * @fileoverview Pure purchase-reconciliation rules: payment policy, the
 * authoritative observation merge and the phase a payment record is in.
 *
 * Top-up quantities and prices arrive in explicit policy. Nothing here
 * performs I/O or supplies a default price, quantity or policy value.
 */

import { isAmount, isIsoTime, isNonEmptyString, toMs } from '../ledger/domain.js';

export const PAYMENT_SCHEMA = 'reploid.payment-record/v1';
export const NOTIFICATION_SCHEMA = 'reploid.payment-notification/v1';

// Processor-reported payment states. `paid` is sticky once observed.
export const PROCESSOR_STATUSES = Object.freeze(['open', 'paid', 'failed', 'expired']);
export const PROCESSOR_REVERSAL_KINDS = Object.freeze(['refund', 'chargeback']);

// Phases needing another look at the processor's authoritative status.
export const POLLED_PHASES = Object.freeze(['creating', 'open', 'awaiting_issuance', 'awaiting_reversal']);
export const PAYMENT_PHASES = Object.freeze([
  ...POLLED_PHASES, 'issued', 'reversed', 'failed', 'expired', 'review_required'
]);

const RETRYABLE_CODES = new Set(['storage_conflict', 'processor_unavailable']);

export class PaymentError extends Error {
  constructor(code, message = code, details = {}) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
    this.details = details;
    this.retryable = RETRYABLE_CODES.has(code);
  }
}

export const fail = (code, message, details) => {
  throw new PaymentError(code, message, details);
};

const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const isCurrency = (value) => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
export const isMoney = (value) => isAmount(value?.amountMinor) && isCurrency(value?.currency);
export const sameMoney = (left, right) => left?.amountMinor === right?.amountMinor && left?.currency === right?.currency;

const unknownKeys = (value, allowed, label, errors) => {
  for (const key of Object.keys(value || {})) {
    if (!allowed.includes(key)) errors.push(`${label}.${key} is not a recognized field`);
  }
};

/**
 * Validate explicit payment policy. Top-ups are one-time purchases; there is
 * no recurring or subscription field. Credits and price are separate inputs.
 */
export function validatePaymentPolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== 'object') fail('invalid_policy', 'payment policy is required', { errors: ['policy missing'] });
  unknownKeys(policy, ['policyVersion', 'processorId', 'topUps', 'polling'], 'policy', errors);
  if (!isNonEmptyString(policy.policyVersion)) errors.push('policy.policyVersion is required');
  if (!isNonEmptyString(policy.processorId)) errors.push('policy.processorId is required');
  if (!Array.isArray(policy.topUps) || policy.topUps.length === 0) errors.push('policy.topUps must list at least one top-up');
  const seen = new Set();
  (policy.topUps || []).forEach((topUp, index) => {
    const label = `policy.topUps[${index}]`;
    unknownKeys(topUp, ['topUpId', 'credits', 'price'], label, errors);
    if (!isNonEmptyString(topUp?.topUpId)) errors.push(`${label}.topUpId is required`);
    if (seen.has(topUp?.topUpId)) errors.push(`${label}.topUpId repeats ${topUp.topUpId}`);
    seen.add(topUp?.topUpId);
    if (!isPositiveInteger(topUp?.credits)) errors.push(`${label}.credits must be a positive integer quantity`);
    if (!isMoney(topUp?.price) || topUp.price.amountMinor === 0) errors.push(`${label}.price must state a positive amountMinor and ISO currency`);
    unknownKeys(topUp?.price, ['amountMinor', 'currency'], `${label}.price`, errors);
  });
  unknownKeys(policy.polling, ['minAgeMs', 'reversalWatchMs'], 'policy.polling', errors);
  if (!isAmount(policy.polling?.minAgeMs)) errors.push('policy.polling.minAgeMs must be a non-negative integer');
  if (!isPositiveInteger(policy.polling?.reversalWatchMs)) errors.push('policy.polling.reversalWatchMs must be a positive integer');
  if (errors.length) fail('invalid_policy', 'payment policy is incomplete', { errors });
  return Object.freeze(JSON.parse(JSON.stringify({
    policyVersion: policy.policyVersion,
    processorId: policy.processorId,
    topUps: policy.topUps.map(({ topUpId, credits, price }) => ({ topUpId, credits, price: { amountMinor: price.amountMinor, currency: price.currency } })),
    polling: { minAgeMs: policy.polling.minAgeMs, reversalWatchMs: policy.polling.reversalWatchMs }
  })));
}

/**
 * Merge one authoritative status into the record's observation. Payment is
 * sticky once observed; reversals accumulate by processor reference. A later
 * fetch that regresses (paid back to open) cannot undo an observed payment.
 */
export function mergeObservation(previous, status, now) {
  const paid = Boolean(previous?.paid) || status.status === 'paid';
  const reversals = [...(previous?.reversals || [])];
  for (const reversal of status.reversals) {
    if (!reversals.some((entry) => entry.reversalRef === reversal.reversalRef)) reversals.push(reversal);
  }
  reversals.sort((left, right) => toMs(left.at) - toMs(right.at) || left.reversalRef.localeCompare(right.reversalRef));
  return {
    status: paid ? 'paid' : status.status,
    lastReportedStatus: status.status,
    paid,
    amount: previous?.paid ? previous.amount : status.amount,
    confirmationId: previous?.confirmationId ?? status.confirmationId ?? null,
    paidAt: previous?.paidAt ?? status.paidAt ?? null,
    reversals,
    fetchedAt: now
  };
}

/** The reversal that completed a full reversal; any chargeback makes it a chargeback. */
export function completingReversal(observed) {
  let total = 0;
  for (const [index, reversal] of observed.reversals.entries()) {
    total += reversal.amount.amountMinor;
    if (total >= observed.amount.amountMinor) {
      const covered = observed.reversals.slice(0, index + 1);
      return { reversalRef: reversal.reversalRef, kind: covered.some((entry) => entry.kind === 'chargeback') ? 'chargeback' : 'refund' };
    }
  }
  return null;
}

/**
 * The phase follows from the observation and recorded ledger effects alone,
 * so every arrival order of the same facts yields the same phase.
 */
export function derivePhase({ observed, issuance, reversal, topUp }) {
  if (!observed) return { phase: 'open', review: null };
  if (!observed.paid) return { phase: observed.status === 'open' ? 'open' : observed.status, review: null };
  if (!sameMoney(observed.amount, topUp.price)) {
    return { phase: 'review_required', review: { reason: 'amount_mismatch', paid: observed.amount, expected: topUp.price } };
  }
  if (observed.reversals.some((entry) => entry.amount.currency !== observed.amount.currency)) {
    return { phase: 'review_required', review: { reason: 'reversal_currency_mismatch' } };
  }
  const reversedMinor = observed.reversals.reduce((sum, entry) => sum + entry.amount.amountMinor, 0);
  if (reversedMinor === 0) return { phase: issuance ? 'issued' : 'awaiting_issuance', review: null };
  if (reversedMinor > observed.amount.amountMinor) {
    return { phase: 'review_required', review: { reason: 'reversal_exceeds_payment', reversedMinor } };
  }
  if (reversedMinor < observed.amount.amountMinor) {
    // Mapping part of a payment to part of a lot is a pricing decision this component does not make.
    return { phase: 'review_required', review: { reason: 'partial_reversal', reversedMinor } };
  }
  const settled = reversal && (reversal.applied || !issuance);
  return { phase: settled ? 'reversed' : 'awaiting_reversal', review: null };
}

export const isStatusTime = (value) => value === null || isIsoTime(value);

export default {
  PaymentError,
  validatePaymentPolicy,
  mergeObservation,
  completingReversal,
  derivePhase
};
