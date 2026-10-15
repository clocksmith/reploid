/**
 * @fileoverview Compose accounts with the credit ledger and contribution
 * rewards. The account store supplies their identity ports; quotes, spending
 * and offer acceptance take their account and device from an authenticated
 * session. No HTTP routes are defined here.
 */

import { LEDGER_COLLECTIONS } from '../ledger/store-contract.js';
import { composeContributionRewards } from '../rewards/engine.js';
import { assertKnownKeys, fail } from './domain.js';
import { createAccountStore } from './engine.js';
import { ACCOUNT_COLLECTIONS } from './store-contract.js';

/**
 * The ledger backend's collections when it shares the account database: the
 * ledger's own, plus the account devices it reads inside quote acceptance.
 * Both backends must use the same database (memory state or Firestore and
 * prefix) so that read joins the acceptance transaction.
 */
export const ACCOUNT_LEDGER_COLLECTIONS = Object.freeze({ ...LEDGER_COLLECTIONS, identityDevices: ACCOUNT_COLLECTIONS.devices });

/**
 * The ledger's deviceAuthority: inside the acceptance transaction, the device
 * must be active and registered to the accepting account. A revocation that
 * commits first refuses the acceptance; on Firestore one that commits during
 * it forces a retry that then refuses.
 */
export async function ledgerDeviceAuthority(tx, { accountId, deviceId }) {
  if (typeof deviceId !== 'string' || !/^dev_[a-f0-9]{32}$/.test(deviceId)) return false;
  const device = await tx.get('identityDevices', deviceId);
  return device?.status === 'active' && device.accountId === accountId;
}

/**
 * The ledger's signerAuthority for attempt evidence: the registration of a
 * participant key in force at its signing time (attribution, so a revocation
 * after signing keeps the receipt's provenance while one before refuses it)
 * and that device's public key.
 */
export function createLedgerSignerAuthority(accounts) {
  return async ({ participantId, at } = {}) => {
    let provenance = null;
    try {
      provenance = await accounts.attributeParticipant({ participantId, at });
    } catch {
      return null;
    }
    const device = provenance ? await accounts.getDevice(provenance.deviceId) : null;
    if (!device?.publicJwk || device.participantId !== participantId) return null;
    return { accountId: provenance.accountId, deviceId: provenance.deviceId, registrationId: provenance.registrationId, publicJwk: device.publicJwk };
  };
}

/**
 * Identity ports for the ledger and rewards. Each answer is read at call
 * time, so a revocation committed earlier always applies.
 *
 *   participantAccount(participantId, { at }?) -> accountId | null
 *   verifyCustodyKey({ certificate, at }) -> { participantId, custodyPeerId, publicKey } | null
 *   accountLinks(accountA, accountB) -> [{ kind, evidenceId, linkId }]
 *   accountOwner(accountId) -> ownerId | null
 *   deviceOwnerAuthorization(participantId) -> owner record | null
 *
 * `at` (ISO) is the signature or work time; it narrows acceptance and never
 * revives a revoked registration. Without it the check covers now.
 */
export function createAccountIdentityPorts(accounts) {
  return Object.freeze({
    async participantAccount(participantId, { at } = {}) {
      return (await accounts.resolveParticipant(participantId, { at }))?.accountId ?? null;
    },
    async verifyCustodyKey({ certificate, at } = {}) {
      const verified = await accounts.verifyCustodyKey({ certificate, at });
      return verified.ok ? { participantId: verified.participantId, custodyPeerId: verified.custodyPeerId, publicKey: verified.publicKey } : null;
    },
    async accountLinks(accountA, accountB) {
      return (await accounts.linksBetween(accountA, accountB)).map(({ kind, evidenceId, linkId }) => ({ kind, evidenceId, linkId }));
    },
    async accountOwner(accountId) {
      return (await accounts.getAccount(accountId))?.ownerId ?? null;
    },
    async deviceOwnerAuthorization(participantId) {
      const resolved = await accounts.resolveParticipant(participantId);
      return resolved ? accounts.getOwnerRecord(resolved.deviceId) : null;
    }
  });
}

/**
 * Session-derived entry points. A caller never names its own account or
 * device: they come from the session, and a revoked device's sessions stop
 * working when the revocation commits.
 */
export function createAccountGuards({ accounts, ledger, rewards }) {
  return Object.freeze({
    /** A quote for the session's account; needs a session acting as an active device. */
    async createQuote({ sessionToken, ...input } = {}) {
      const auth = await accounts.authorizeDevice(sessionToken);
      if (input.accountId !== undefined && input.accountId !== auth.accountId) fail('account_mismatch', 'quotes are issued only to the session account');
      return ledger.createQuote({ ...input, accountId: auth.accountId });
    },

    /** Spending: accept a quote as the session's active device; the ledger re-checks the device at commit. */
    async acceptQuote({ sessionToken, ...input } = {}) {
      assertKnownKeys(input, ['quoteId', 'quoteHash', 'idempotencyKey'], 'acceptQuote');
      const auth = await accounts.authorizeDevice(sessionToken);
      return ledger.acceptQuote({ ...input, accountId: auth.accountId, deviceId: auth.deviceId });
    },

    /**
     * Accept a contribution offer for the session's account. A native
     * contributor must run under the owner policy recorded for its device.
     */
    async acceptOffer({ sessionToken, ...input } = {}) {
      assertKnownKeys(input, ['offerId', 'offerHash', 'ownerAuthorization', 'idempotencyKey'], 'acceptOffer');
      const auth = await accounts.authenticate(sessionToken);
      const offer = typeof input.offerId === 'string' ? await rewards.getOffer(input.offerId) : null;
      const contributor = offer ? await accounts.resolveParticipant(offer.work.participantId) : null;
      if (contributor?.host === 'native') {
        const record = await accounts.getOwnerRecord(contributor.deviceId);
        if (!record || record.ownerPolicyDigest !== input.ownerAuthorization?.digest) {
          fail('owner_authorization_unrecorded', 'native contribution needs the owner policy recorded for this device');
        }
      }
      return rewards.acceptOffer({ ...input, accountId: auth.accountId });
    }
  });
}

/**
 * Build the account store, ledger and rewards over their backends. New
 * accounts open their credit account with the account's owner id; rewards
 * read identity through the account ports. `createLedger` receives
 * `deviceAuthority`; its backend must share the account database and map
 * ACCOUNT_LEDGER_COLLECTIONS, or every acceptance fails on the unknown
 * collection.
 */
export function composeAccountServices({
  accountBackend, accountPolicy, providers, rewardBackend, createLedger, rewardPolicy, issuancePolicy,
  readAdmittedCapacity, otherProvenance = null, readinessProber = null, fundingAuthority = null, clock, createId, random
} = {}) {
  let ledger = null;
  const accounts = createAccountStore({
    backend: accountBackend, policy: accountPolicy, providers, clock, createId,
    openCreditAccount: (input) => ledger.openAccount(input)
  });
  const identity = createAccountIdentityPorts(accounts);
  const composed = composeContributionRewards({
    backend: rewardBackend,
    createLedger: (ports) => createLedger({ ...ports, deviceAuthority: ledgerDeviceAuthority, signerAuthority: createLedgerSignerAuthority(accounts) }),
    rewardPolicy, issuancePolicy, identity, readAdmittedCapacity, otherProvenance, readinessProber, fundingAuthority, clock, createId, random
  });
  ledger = composed.ledger;
  return { accounts, identity, ...composed, guards: createAccountGuards({ accounts, ledger, rewards: composed.rewards }) };
}

export default composeAccountServices;
