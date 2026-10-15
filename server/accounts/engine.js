/**
 * @fileoverview Account operations over a transactional document backend:
 * sign-in, sessions, recovery and account links. Device registration and
 * custody-key verification compose in from devices.js and custody-keys.js.
 *
 * Each mutation commits its records, uniqueness claims and idempotency
 * record in one backend transaction, or nothing. Sessions are re-read inside
 * the transaction that uses them, so a recovery or revocation committed first
 * always wins. This component holds no balance: recovery has no ledger port
 * and cannot move or mint credit.
 */

import { randomBytes, randomUUID } from 'node:crypto';

import { createCustodyKeyOperations } from './custody-keys.js';
import { createDeviceOperations } from './devices.js';
import {
  ACCOUNT_SCHEMA,
  LINK_KINDS,
  RECOVERY_SCHEMA,
  SESSION_SCHEMA,
  accountIdFor,
  accountView,
  addMs,
  assertIdempotencyKey,
  assertKnownKeys,
  assertText,
  byTime,
  cloneJson,
  fail,
  hashCanonical,
  indexId,
  insert,
  linkIdFor,
  linkPair,
  newLink,
  ownerIdFor,
  put,
  parseSessionToken,
  sessionProblem,
  sessionSecretDigest,
  sessionView,
  sha256Hex,
  subjectDigest,
  toMs,
  validateAccountPolicy
} from './domain.js';
import { createSignInProviders } from './sign-in.js';
import { assertAccountBackend, assertAccountStoreContract } from './store-contract.js';

const defaultClock = () => new Date().toISOString();
const defaultCreateId = (prefix) => `${prefix}_${randomUUID()}`;

/**
 * @param {object} options
 * @param {object} options.backend transactional document backend (see store-contract.js)
 * @param {object} options.policy explicit account policy; there is no default
 * @param {Array<object>} options.providers sign-in providers (see sign-in.js)
 * @param {Function} [options.openCreditAccount] ({ accountId, ownerId }) -> credit ledger account;
 *   called before a new account becomes visible, never by recovery
 */
export function createAccountStore({
  backend, policy, providers = [], openCreditAccount = null, clock = defaultClock, createId = defaultCreateId
} = {}) {
  assertAccountBackend(backend);
  const activePolicy = validateAccountPolicy(policy);
  const signInProviders = createSignInProviders(providers);
  if (openCreditAccount !== null && typeof openCreditAccount !== 'function') throw new TypeError('openCreditAccount must be a function');
  const idempotencyId = (operation, scopeId, key) => sha256Hex(`${operation}\u0000${scopeId}\u0000${key}`);

  const priorResult = (record, requestHash, operation) => {
    if (!record) return null;
    if (record.requestHash !== requestHash) fail('idempotency_conflict', 'idempotency key was already used with a different request', { operation });
    return { result: cloneJson(record.result) };
  };

  const lookupIdempotent = async ({ operation, scopeId, idempotencyKey, request }) => priorResult(
    await backend.get('idempotency', idempotencyId(operation, scopeId, idempotencyKey)),
    hashCanonical({ operation, request }),
    operation
  );

  const applyWrites = (tx, writes) => {
    for (const write of writes) {
      if (write.create) tx.create(write.collection, write.id, write.value);
      else tx.set(write.collection, write.id, write.value);
    }
  };

  const transact = (body) => backend.runTransaction(async (tx) => {
    const { result, writes } = await body(tx);
    applyWrites(tx, writes);
    return cloneJson(result);
  });

  const mutate = ({ operation, scopeId, idempotencyKey, request, now, body }) => {
    const requestHash = hashCanonical({ operation, request });
    const recordId = idempotencyId(operation, scopeId, idempotencyKey);
    return backend.runTransaction(async (tx) => {
      const prior = priorResult(await tx.get('idempotency', recordId), requestHash, operation);
      if (prior) return prior.result;
      const { result, writes } = await body(tx);
      applyWrites(tx, writes);
      tx.create('idempotency', recordId, { operation, scopeId, idempotencyKey, requestHash, result, recordedAt: now });
      return cloneJson(result);
    });
  };

  /** Read and check a session through `reader` (a transaction or the backend). */
  const readSession = async (reader, token, now) => {
    const parsed = parseSessionToken(token);
    if (!parsed) fail('session_invalid', 'a valid session token is required');
    const session = await reader.get('sessions', parsed.sessionId);
    const account = session ? await reader.get('accounts', session.accountId) : null;
    const device = session?.deviceId ? await reader.get('devices', session.deviceId) : null;
    const problem = sessionProblem({ session, account, device, secret: parsed.secret, now });
    if (problem) fail(problem, 'the session cannot authorize this action');
    return { session, account, device };
  };

  /** The secret appears once, in the issuing result; only its digest is stored. */
  const newSession = (account, now, origin) => {
    const sessionId = `ses_${randomUUID()}`;
    const secret = randomBytes(32).toString('base64url');
    const record = {
      schema: SESSION_SCHEMA,
      sessionId,
      accountId: account.accountId,
      epoch: account.sessionEpoch,
      secretDigest: sessionSecretDigest(secret),
      deviceId: null,
      registrationId: null,
      origin,
      issuedAt: now,
      expiresAt: addMs(now, activePolicy.sessionTtlMs),
      endedAt: null
    };
    return { record, issued: { ...sessionView(record), token: `${sessionId}.${secret}` } };
  };

  const verifyAssertion = (input, now) => {
    assertKnownKeys(input, ['providerId', 'assertion'], 'sign-in');
    return signInProviders.verify({
      providerId: input.providerId, assertion: input.assertion, audience: activePolicy.audience, now, maxClockSkewMs: activePolicy.maxClockSkewMs
    });
  };
  const assertionClaimId = (verified) => indexId('assertion', `${verified.providerId}\u0000${verified.assertionId}`);
  const assertionClaim = (verified, accountId, usage, now) => ({
    providerId: verified.providerId, accountId, usage, authenticatedAt: verified.authenticatedAt, assertionExpiresAt: verified.expiresAt, recordedAt: now
  });

  const ctx = { backend, policy: activePolicy, clock, createId, transact, mutate, lookupIdempotent, readSession };

  const store = {
    kind: backend.kind,
    policy: activePolicy,
    providerIds: signInProviders.providerIds,
    /** Configured providers and whether each serves local runs and tests only. */
    signInProviders: signInProviders.providers,

    /**
     * Verify a provider assertion and open a session for its subject's
     * account, creating the account (and its credit account) on first use.
     * Each assertion signs in once; a retry needs a fresh assertion.
     */
    async signIn(input = {}) {
      const now = clock();
      const verified = await verifyAssertion(input, now);
      const accountId = accountIdFor(verified.providerId, verified.subject);
      const ownerId = ownerIdFor(verified.providerId, verified.subject);
      const claimId = assertionClaimId(verified);
      if (await backend.get('assertions', claimId)) fail('assertion_replayed', 'this assertion was already used');
      // The credit account opens first, so an account is never visible without one.
      const existing = await backend.get('accounts', accountId);
      let creditOpened = Boolean(existing?.creditAccountOpenedAt);
      if (!creditOpened && openCreditAccount) {
        await openCreditAccount({ accountId, ownerId });
        creditOpened = true;
      }
      return transact(async (tx) => {
        if (await tx.get('assertions', claimId)) fail('assertion_replayed', 'this assertion was already used');
        const current = await tx.get('accounts', accountId);
        const account = current ?? {
          schema: ACCOUNT_SCHEMA,
          accountId,
          ownerId,
          providerId: verified.providerId,
          subjectDigest: subjectDigest(verified.providerId, verified.subject),
          status: 'active',
          sessionEpoch: 0,
          activeDeviceIds: [],
          createdAt: now,
          creditAccountOpenedAt: null,
          recoveredAt: null
        };
        const writes = [];
        if (creditOpened && !account.creditAccountOpenedAt) {
          account.creditAccountOpenedAt = now;
          if (current) writes.push(put('accounts', accountId, account));
        }
        if (!current) writes.push(insert('accounts', accountId, account));
        const session = newSession(account, now, 'sign_in');
        writes.push(
          insert('sessions', session.record.sessionId, session.record),
          insert('assertions', claimId, assertionClaim(verified, accountId, 'sign_in', now))
        );
        return { result: { account: accountView(account), created: !current, session: session.issued }, writes };
      });
    },

    /** The session's account and bound device, or a session_* error. */
    async authenticate(sessionToken) {
      const { session, account } = await readSession(backend, sessionToken, clock());
      return { ...sessionView(session), ownerId: account.ownerId };
    },

    /** Spending and quotes need a session bound to an active registered device. */
    async authorizeDevice(sessionToken) {
      const auth = await store.authenticate(sessionToken);
      if (!auth.deviceId) fail('device_session_required', 'this action needs a session bound to a registered device');
      return auth;
    },

    async endSession({ sessionToken } = {}) {
      const now = clock();
      return transact(async (tx) => {
        const { session } = await readSession(tx, sessionToken, now);
        return { result: { sessionId: session.sessionId, endedAt: now }, writes: [put('sessions', session.sessionId, { ...session, endedAt: now })] };
      });
    },

    /**
     * Re-establish access through the sign-in provider after a recent
     * authentication: end every existing session, revoke every active device
     * and open one new session. Devices re-register by proving possession
     * again. Balances are untouched; recovery never creates or merges accounts.
     */
    async recoverAccount(input = {}) {
      const now = clock();
      const verified = await verifyAssertion(input, now);
      if (toMs(now) - toMs(verified.authenticatedAt) > activePolicy.recoveryMaxAuthAgeMs) {
        fail('reauthentication_required', 'recovery needs a recent authentication with the sign-in provider');
      }
      const accountId = accountIdFor(verified.providerId, verified.subject);
      const claimId = assertionClaimId(verified);
      const recoveryId = createId('rec');
      return transact(async (tx) => {
        if (await tx.get('assertions', claimId)) fail('assertion_replayed', 'this assertion was already used');
        const account = await tx.get('accounts', accountId);
        if (!account) fail('account_not_found', 'no account exists for this subject; recovery never creates or merges accounts');
        const devices = [];
        for (const deviceId of account.activeDeviceIds) devices.push(await tx.get('devices', deviceId));
        const registrations = [];
        for (const device of devices) registrations.push(device ? await tx.get('registrations', device.registrationId) : null);
        const revocation = { reason: 'recovery', revokedAt: now, sessionId: null, recoveryId };
        const writes = [];
        const revokedDeviceIds = [];
        devices.forEach((device, index) => {
          if (device?.status !== 'active') return;
          writes.push(put('devices', device.deviceId, { ...device, status: 'revoked', revokedAt: now, revocation }));
          if (registrations[index]) writes.push(put('registrations', device.registrationId, { ...registrations[index], revokedAt: now, revocation }));
          revokedDeviceIds.push(device.deviceId);
        });
        Object.assign(account, { sessionEpoch: account.sessionEpoch + 1, activeDeviceIds: [], recoveredAt: now });
        const session = newSession(account, now, 'recovery');
        const recovery = {
          schema: RECOVERY_SCHEMA,
          recoveryId,
          accountId,
          providerId: verified.providerId,
          authenticatedAt: verified.authenticatedAt,
          recoveredAt: now,
          sessionEpoch: account.sessionEpoch,
          revokedDeviceIds
        };
        writes.push(
          put('accounts', accountId, account),
          insert('sessions', session.record.sessionId, session.record),
          insert('assertions', claimId, assertionClaim(verified, accountId, 'recovery', now)),
          insert('recoveries', recoveryId, recovery)
        );
        return { result: { recovery, account: accountView(account), session: session.issued }, writes };
      });
    },

    async getAccount(accountId) {
      const account = typeof accountId === 'string' ? await backend.get('accounts', accountId) : null;
      return account ? accountView(account) : null;
    },

    async listRecoveries(accountId) {
      return (await backend.list('recoveries', { field: 'accountId', value: accountId })).sort(byTime('recoveredAt', 'recoveryId'));
    },

    ...createDeviceOperations(ctx),
    ...createCustodyKeyOperations(ctx),

    /**
     * Record a relation between two accounts. Only the authorities named for
     * a kind may record it; the caller's authority is established by the
     * route layer. `shared_device` links are recorded only by registration.
     * A missing link never shows that two accounts are independent.
     */
    async recordLink(input = {}) {
      assertKnownKeys(input, ['kind', 'accountIds', 'evidenceId', 'recordedBy', 'note', 'idempotencyKey'], 'recordLink');
      const { kind, accountIds, evidenceId, recordedBy, note = null, idempotencyKey } = input;
      const authorities = LINK_KINDS[kind];
      if (!authorities) fail('invalid_link_kind', `link kind must be one of ${Object.keys(LINK_KINDS).join(', ')}`);
      if (!authorities.includes(recordedBy?.authority) || recordedBy.authority === 'accounts') {
        fail('link_authority_denied', `${kind} links are recorded only by ${authorities.join(', ')}`);
      }
      assertText(recordedBy.id, 'recordedBy.id', 160);
      if (!Array.isArray(accountIds) || accountIds.length !== 2 || accountIds.some((id) => typeof id !== 'string') || accountIds[0] === accountIds[1]) {
        fail('invalid_input', 'a link names two distinct accounts');
      }
      assertText(evidenceId, 'evidenceId');
      if (note !== null) assertText(note, 'note', 512);
      assertIdempotencyKey(idempotencyKey);
      const pair = linkPair(...accountIds);
      const request = { kind, accountIds: pair, evidenceId, recordedBy: { authority: recordedBy.authority, id: recordedBy.id }, note };
      const operation = 'recordLink';
      const scopeId = pair.join('|');
      const prior = await lookupIdempotent({ operation, scopeId, idempotencyKey, request });
      if (prior) return prior.result;
      const now = clock();
      const linkId = linkIdFor(kind, pair, evidenceId);
      return mutate({
        operation, scopeId, idempotencyKey, request, now,
        body: async (tx) => {
          const accounts = [await tx.get('accounts', pair[0]), await tx.get('accounts', pair[1])];
          const existing = await tx.get('links', linkId);
          if (accounts.some((account) => !account)) fail('account_not_found', 'both linked accounts must exist');
          if (existing) return { result: existing, writes: [] };
          const link = newLink({ kind, pair, evidenceId, recordedBy: request.recordedBy, note, now });
          return { result: link, writes: [insert('links', linkId, link)] };
        }
      });
    },

    /** Recorded links between two accounts; an empty list proves nothing about independence. */
    async linksBetween(left, right) {
      if (typeof left !== 'string' || typeof right !== 'string' || left === right) return [];
      return (await backend.list('links', { field: 'pairKey', value: linkPair(left, right).join('|') })).sort(byTime('recordedAt', 'linkId'));
    },

    async listLinks(accountId) {
      const [asA, asB] = await Promise.all([
        backend.list('links', { field: 'accountA', value: accountId }),
        backend.list('links', { field: 'accountB', value: accountId })
      ]);
      return [...asA, ...asB].sort(byTime('recordedAt', 'linkId'));
    }
  };
  return assertAccountStoreContract(store);
}

export default createAccountStore;
