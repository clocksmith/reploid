/**
 * @fileoverview Change-control append-only store contract validation.
 */

export const CHANGE_CONTROL_STORE_METHODS = Object.freeze([
  'createPassport',
  'appendEvent',
  'getEvents',
  'getIdempotency',
  'listPassportIds',
  'saveDelivery',
  'getDelivery',
  'getDeliveryRecord'
]);

export function assertChangeControlStore(store) {
  const missing = CHANGE_CONTROL_STORE_METHODS.filter((method) => typeof store?.[method] !== 'function');
  if (missing.length) throw new Error(`Change-control store is missing: ${missing.join(', ')}`);
  return store;
}

export default { CHANGE_CONTROL_STORE_METHODS, assertChangeControlStore };
