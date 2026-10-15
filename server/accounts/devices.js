/**
 * @fileoverview Device registration, revocation and native owner records.
 *
 * A device is a persistent participant identity key (browser or native). An
 * authenticated session asks for a single-use challenge; the device signs it
 * with that key; the session submits the proof. A key is bound to at most one
 * account at a time. Moving it needs revocation first and records a
 * `shared_device` link. Revocation applies to every later check and keeps
 * each registration's history, so past receipts keep their provenance.
 */

import { randomBytes } from 'node:crypto';

import custodyPolicy from '../../self/config/chat-files.json' with { type: 'json' };
import { nativeOwnerPolicyDigest, validateNativeOwnerPolicy } from '../native-owner/policy.js';
import {
  CHALLENGE_SCHEMA,
  DEVICE_SCHEMA,
  OWNER_RECORD_SCHEMA,
  REGISTRATION_SCHEMA,
  REVOCATION_REASONS,
  addMs,
  assertIdempotencyKey,
  assertKnownKeys,
  assertText,
  deviceIdFor,
  deviceView,
  fail,
  hashCanonical,
  indexId,
  insert,
  linkIdFor,
  linkPair,
  newLink,
  put,
  toMs
} from './domain.js';
import { checkDeviceRegistrationProof } from '../../packages/reploid/src/artifacts/participant-proofs.js';

const challengeView = (challenge) => ({
  schema: challenge.schema,
  challengeId: challenge.challengeId,
  nonce: challenge.nonce,
  accountId: challenge.accountId,
  audience: challenge.audience,
  issuedAt: challenge.issuedAt,
  expiresAt: challenge.expiresAt
});

/** The equipment and network grants of a valid native owner policy, bound by its digest. */
function verifyOwnerGrants(value) {
  let policy;
  try {
    policy = validateNativeOwnerPolicy(value?.policy, { custody: custodyPolicy });
  } catch (error) {
    fail('owner_authorization_invalid', `owner grants need a valid native owner policy: ${error.message}`);
  }
  if (nativeOwnerPolicyDigest(policy) !== value.digest) fail('owner_authorization_invalid', 'the owner policy digest does not match the supplied policy');
  return { ownerPolicyDigest: value.digest, policySchema: policy.schema, equipment: { ...policy.authorization.equipment }, network: { ...policy.authorization.network } };
}

/** How the account holder relates to the equipment's owner, as declared. */
const accountRelation = (grant) => (grant.ownership === 'personal' ? 'owner' : 'workplace_user');

/**
 * @param {object} ctx store internals: backend, policy, clock, createId,
 *   transact, mutate, lookupIdempotent and readSession
 */
export function createDeviceOperations({ backend, policy, clock, createId, transact, mutate, lookupIdempotent, readSession }) {
  return {
    /** A single-use challenge for one session to register one device key. */
    async createRegistrationChallenge({ sessionToken } = {}) {
      const now = clock();
      return transact(async (tx) => {
        const { session, account } = await readSession(tx, sessionToken, now);
        const challenge = {
          schema: CHALLENGE_SCHEMA,
          challengeId: createId('chal'),
          nonce: randomBytes(32).toString('base64url'),
          accountId: account.accountId,
          audience: policy.audience,
          sessionId: session.sessionId,
          issuedAt: now,
          expiresAt: addMs(now, policy.challengeTtlMs),
          status: 'open',
          usedAt: null,
          registrationId: null
        };
        return { result: challengeView(challenge), writes: [insert('challenges', challenge.challengeId, challenge)] };
      });
    },

    /**
     * Bind the proving device key to the session's account. `bindSession`
     * makes the calling session act as that device (for spending); a session
     * registering another device, such as a native host, leaves it false.
     */
    async registerDevice(input = {}) {
      assertKnownKeys(input, ['sessionToken', 'proof', 'label', 'bindSession', 'idempotencyKey'], 'registerDevice');
      const { sessionToken, proof, label = null, bindSession = false, idempotencyKey } = input;
      if (label !== null) assertText(label, 'label', 64);
      if (typeof bindSession !== 'boolean') fail('invalid_input', 'bindSession must be a boolean');
      assertIdempotencyKey(idempotencyKey);
      const now = clock();
      const { account: caller } = await readSession(backend, sessionToken, now);
      const accountId = caller.accountId;
      const request = { proof, label, bindSession };
      const operation = 'registerDevice';
      const prior = await lookupIdempotent({ operation, scopeId: accountId, idempotencyKey, request });
      if (prior) return prior.result;
      const checked = await checkDeviceRegistrationProof(proof);
      if (checked.problem) fail(checked.problem, 'the device did not prove possession of its participant identity key');
      const { publicJwk, participantId } = checked;
      const deviceId = deviceIdFor(publicJwk);
      const participantIndexId = indexId('participant', participantId);
      return mutate({
        operation, scopeId: accountId, idempotencyKey, request, now,
        body: async (tx) => {
          const { session, account } = await readSession(tx, sessionToken, now);
          const challenge = await tx.get('challenges', proof.challengeId);
          const device = await tx.get('devices', deviceId);
          const indexed = await tx.get('participants', participantIndexId);
          const links = [];
          for (const priorAccountId of (device?.accountHistory ?? []).filter((id) => id !== accountId)) {
            const pair = linkPair(priorAccountId, accountId);
            links.push({ pair, existing: await tx.get('links', linkIdFor('shared_device', pair, deviceId)) });
          }
          if (account.accountId !== accountId) fail('session_invalid', 'the session changed accounts during registration');
          if (!challenge) fail('challenge_not_found', 'no registration challenge has this id');
          if (challenge.status !== 'open') fail('challenge_used', 'this registration challenge was already answered; request a new one');
          if (challenge.accountId !== accountId || challenge.sessionId !== session.sessionId) {
            fail('challenge_mismatch', 'the challenge was issued to a different session');
          }
          if (toMs(now) >= toMs(challenge.expiresAt)) fail('challenge_expired', 'the registration challenge has expired');
          if (proof.nonce !== challenge.nonce || proof.accountId !== challenge.accountId || proof.audience !== challenge.audience) {
            fail('challenge_mismatch', 'the proof does not answer this challenge');
          }
          if (indexed && indexed.deviceId !== deviceId) fail('participant_conflict', 'another key already holds this participant id');
          if (device?.status === 'active') {
            if (device.accountId === accountId) fail('device_already_registered', 'this device key is already registered to the account');
            fail('device_registered_elsewhere', 'this device key is registered to another account; that account must revoke it first');
          }
          if (device?.revocation?.reason === 'compromised') fail('device_key_compromised', 'a key revoked as compromised cannot register again');
          if (bindSession && session.deviceId) fail('session_already_bound', 'the session already acts as another device');
          const registrationId = createId('reg');
          const registration = {
            schema: REGISTRATION_SCHEMA,
            registrationId,
            deviceId,
            participantId,
            accountId,
            host: proof.host,
            registeredAt: now,
            revokedAt: null,
            revocation: null,
            challengeId: challenge.challengeId,
            sessionId: session.sessionId,
            proofDigest: hashCanonical(proof)
          };
          const next = {
            schema: DEVICE_SCHEMA,
            deviceId,
            participantId,
            publicJwk,
            host: proof.host,
            label,
            status: 'active',
            accountId,
            registrationId,
            registeredAt: now,
            revokedAt: null,
            revocation: null,
            ownerRecordId: null,
            accountHistory: [...new Set([...(device?.accountHistory ?? []), accountId])]
          };
          const writes = [
            device ? put('devices', deviceId, next) : insert('devices', deviceId, next),
            insert('registrations', registrationId, registration),
            put('participants', participantIndexId, { participantId, deviceId }),
            put('challenges', challenge.challengeId, { ...challenge, status: 'used', usedAt: now, registrationId }),
            put('accounts', accountId, { ...account, activeDeviceIds: [...account.activeDeviceIds, deviceId] })
          ];
          if (bindSession) writes.push(put('sessions', session.sessionId, { ...session, deviceId, registrationId }));
          const sharedDeviceLinks = [];
          for (const { pair, existing } of links) {
            const link = existing ?? newLink({ kind: 'shared_device', pair, evidenceId: deviceId, recordedBy: { authority: 'accounts', id: registrationId }, now });
            if (!existing) writes.push(insert('links', link.linkId, link));
            sharedDeviceLinks.push(link.linkId);
          }
          return {
            result: { deviceId, participantId, registrationId, accountId, host: proof.host, registeredAt: now, sessionBound: bindSession, sharedDeviceLinks },
            writes
          };
        }
      });
    },

    /**
     * Revoke a device of the session's account. Every later identity check,
     * custody-key attribution and device-bound session refuses it at once;
     * registrations keep their history.
     */
    async revokeDevice(input = {}) {
      assertKnownKeys(input, ['sessionToken', 'deviceId', 'reason', 'idempotencyKey'], 'revokeDevice');
      const { sessionToken, deviceId, reason, idempotencyKey } = input;
      assertText(deviceId, 'deviceId', 160);
      if (!REVOCATION_REASONS.includes(reason) || reason === 'recovery') fail('invalid_input', 'reason must be retired, transfer or compromised');
      assertIdempotencyKey(idempotencyKey);
      const now = clock();
      const { account: caller } = await readSession(backend, sessionToken, now);
      const request = { deviceId, reason };
      const operation = 'revokeDevice';
      const prior = await lookupIdempotent({ operation, scopeId: caller.accountId, idempotencyKey, request });
      if (prior) return prior.result;
      return mutate({
        operation, scopeId: caller.accountId, idempotencyKey, request, now,
        body: async (tx) => {
          const { session, account } = await readSession(tx, sessionToken, now);
          const device = await tx.get('devices', deviceId);
          const registration = device ? await tx.get('registrations', device.registrationId) : null;
          if (!device || device.accountId !== account.accountId) fail('device_not_found', 'no device with this id belongs to the account');
          if (device.status !== 'active') fail('device_already_revoked', 'the device is already revoked');
          const revocation = { reason, revokedAt: now, sessionId: session.sessionId, recoveryId: null };
          return {
            result: { deviceId, participantId: device.participantId, registrationId: device.registrationId, accountId: account.accountId, revokedAt: now, reason },
            writes: [
              put('devices', deviceId, { ...device, status: 'revoked', revokedAt: now, revocation }),
              put('registrations', device.registrationId, { ...registration, revokedAt: now, revocation }),
              put('accounts', account.accountId, { ...account, activeDeviceIds: account.activeDeviceIds.filter((id) => id !== deviceId) })
            ]
          };
        }
      });
    },

    async getDevice(deviceId) {
      const device = typeof deviceId === 'string' ? await backend.get('devices', deviceId) : null;
      return device ? deviceView(device) : null;
    },

    /** Devices whose latest registration was with this account, active or revoked. */
    async listDevices(accountId) {
      return (await backend.list('devices', { field: 'accountId', value: accountId }))
        .map(deviceView)
        .sort((left, right) => toMs(left.registeredAt) - toMs(right.registeredAt) || left.deviceId.localeCompare(right.deviceId));
    },

    /**
     * Record the equipment and network grants a native device contributes
     * under, from the owner policy it runs. The record is the account
     * holder's declaration, bound to this registration; it does not prove the
     * named owner or workplace approved anything.
     */
    async recordOwnerAuthorization(input = {}) {
      assertKnownKeys(input, ['sessionToken', 'deviceId', 'ownerAuthorization', 'idempotencyKey'], 'recordOwnerAuthorization');
      const { sessionToken, deviceId, ownerAuthorization, idempotencyKey } = input;
      assertText(deviceId, 'deviceId', 160);
      assertIdempotencyKey(idempotencyKey);
      const grants = verifyOwnerGrants(ownerAuthorization);
      const now = clock();
      const { account: caller } = await readSession(backend, sessionToken, now);
      const request = { deviceId, ownerPolicyDigest: grants.ownerPolicyDigest };
      const operation = 'recordOwnerAuthorization';
      const prior = await lookupIdempotent({ operation, scopeId: caller.accountId, idempotencyKey, request });
      if (prior) return prior.result;
      const recordId = createId('own');
      return mutate({
        operation, scopeId: caller.accountId, idempotencyKey, request, now,
        body: async (tx) => {
          const { session, account } = await readSession(tx, sessionToken, now);
          const device = await tx.get('devices', deviceId);
          const previous = device?.ownerRecordId ? await tx.get('owners', device.ownerRecordId) : null;
          if (!device || device.accountId !== account.accountId || device.status !== 'active') {
            fail('device_not_found', 'no active device with this id belongs to the account');
          }
          if (device.host !== 'native') fail('owner_record_native_only', 'owner grants are recorded for native devices');
          const record = {
            schema: OWNER_RECORD_SCHEMA,
            recordId,
            deviceId,
            participantId: device.participantId,
            registrationId: device.registrationId,
            accountId: account.accountId,
            accountOwnerId: account.ownerId,
            ownerPolicyDigest: grants.ownerPolicyDigest,
            policySchema: grants.policySchema,
            equipment: { ...grants.equipment, accountRelation: accountRelation(grants.equipment) },
            network: { ...grants.network, accountRelation: accountRelation(grants.network) },
            declaredBy: { sessionId: session.sessionId },
            recordedAt: now,
            supersedes: previous?.registrationId === device.registrationId ? previous.recordId : null
          };
          return {
            result: record,
            writes: [insert('owners', recordId, record), put('devices', deviceId, { ...device, ownerRecordId: recordId })]
          };
        }
      });
    },

    /** The owner record in force for an active device's current registration, or null. */
    async getOwnerRecord(deviceId) {
      const device = typeof deviceId === 'string' ? await backend.get('devices', deviceId) : null;
      if (device?.status !== 'active' || !device.ownerRecordId) return null;
      const record = await backend.get('owners', device.ownerRecordId);
      return record?.registrationId === device.registrationId ? record : null;
    }
  };
}

export default createDeviceOperations;
