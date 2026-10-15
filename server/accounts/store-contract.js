/**
 * @fileoverview Persistence-neutral account store contract.
 *
 * The account store runs over the same transactional document backend shape
 * as the credit ledger (runTransaction, get, list), under its own
 * collections. Balances stay in the ledger.
 */

import { assertLedgerBackend } from '../ledger/store-contract.js';

export const ACCOUNT_STORE_OPERATIONS = Object.freeze([
  'signIn', 'authenticate', 'authorizeDevice', 'endSession', 'recoverAccount', 'getAccount', 'listRecoveries',
  'createRegistrationChallenge', 'registerDevice', 'bindDeviceSession', 'revokeDevice', 'getDevice', 'listDevices',
  'recordOwnerAuthorization', 'getOwnerRecord',
  'verifyCustodyKey', 'resolveParticipant', 'attributeParticipant', 'attributeCustodyKey',
  'recordLink', 'linksBetween', 'listLinks'
]);

// Logical collection -> physical collection.
export const ACCOUNT_COLLECTIONS = Object.freeze({
  accounts: 'identity_accounts',
  sessions: 'identity_sessions',
  assertions: 'identity_assertions',
  recoveries: 'identity_recoveries',
  challenges: 'identity_device_challenges',
  devices: 'identity_devices',
  participants: 'identity_participants',
  registrations: 'identity_device_registrations',
  owners: 'identity_owner_records',
  links: 'identity_account_links',
  idempotency: 'identity_idempotency'
});

export function validateAccountStoreContract(store) {
  const missing = ACCOUNT_STORE_OPERATIONS.filter((operation) => typeof store?.[operation] !== 'function');
  return { ok: missing.length === 0, missing };
}

export function assertAccountStoreContract(store) {
  const { ok, missing } = validateAccountStoreContract(store);
  if (!ok) throw new TypeError(`Account store contract is incomplete: ${missing.join(', ')}`);
  return store;
}

export const assertAccountBackend = (backend) => assertLedgerBackend(backend);

export default {
  ACCOUNT_STORE_OPERATIONS,
  ACCOUNT_COLLECTIONS,
  validateAccountStoreContract,
  assertAccountStoreContract,
  assertAccountBackend
};
