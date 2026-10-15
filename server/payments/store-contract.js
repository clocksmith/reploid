/**
 * @fileoverview Persistence-neutral purchase-reconciliation store contract.
 *
 * Payment records live in their own collections on a transactional document
 * backend with the credit ledger's backend shape. Balances and lots stay in
 * the ledger; this store never writes them directly.
 */

import { assertLedgerBackend } from '../ledger/store-contract.js';

export const PAYMENT_STORE_OPERATIONS = Object.freeze([
  'startCheckout', 'receiveNotification', 'reconcile', 'pollPending', 'getPayment', 'listPayments'
]);

// Logical collection -> physical collection.
export const PAYMENT_COLLECTIONS = Object.freeze({
  payments: 'payment_records',
  claims: 'payment_claims',
  notifications: 'payment_notifications'
});

export function validatePaymentStoreContract(store) {
  const missing = PAYMENT_STORE_OPERATIONS.filter((operation) => typeof store?.[operation] !== 'function');
  return { ok: missing.length === 0, missing };
}

export function assertPaymentStoreContract(store) {
  const { ok, missing } = validatePaymentStoreContract(store);
  if (!ok) throw new TypeError(`Payment store contract is incomplete: ${missing.join(', ')}`);
  return store;
}

export const assertPaymentBackend = (backend) => assertLedgerBackend(backend);

export default {
  PAYMENT_STORE_OPERATIONS,
  PAYMENT_COLLECTIONS,
  validatePaymentStoreContract,
  assertPaymentStoreContract,
  assertPaymentBackend
};
