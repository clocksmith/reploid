// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import { createAccountGuards, ledgerDeviceAuthority } from '../../server/accounts/compose.js';
import {
  createDeviceRegistrationProof, createSessionBinding, registrationProofBody, signAsParticipant, REGISTRATION_PROOF_SCHEMA
} from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { ACCOUNT_STORE_OPERATIONS, validateAccountStoreContract } from '../../server/accounts/store-contract.js';
import { validateAccountPolicy } from '../../server/accounts/domain.js';
import { createLedgerStore } from '../../server/ledger/engine.js';
import {
  ACCOUNT_POLICY, createTestSignInProvider, newIdentity, openAccountFixture, registerDevice, signInAs
} from '../helpers/account-fixture.js';
import { LEDGER_POLICY, MIN, advance, clock, fund, journalShape, quoteInput, rejectsWith } from '../helpers/reward-fixture.js';

describe.each(['memory', 'firestore'])('account identity (%s store)', (kind) => {
  let harness;
  let provider;
  let accounts;
  let ledger;
  let guards;
  let identity;

  beforeEach(() => {
    ({ harness, provider, accounts, ledger, guards, identity } = openAccountFixture(kind));
  });

  const signIn = (subject, options) => signInAs(accounts, provider, subject, options);

  it('implements the account store contract and requires an explicit policy', () => {
    expect(validateAccountStoreContract(accounts)).toEqual({ ok: true, missing: [] });
    expect(ACCOUNT_STORE_OPERATIONS).toContain('registerDevice');
    expect(() => validateAccountPolicy({ ...ACCOUNT_POLICY, sessionTtlMs: undefined })).toThrow(expect.objectContaining({ code: 'invalid_policy' }));
    expect(() => validateAccountPolicy({ ...ACCOUNT_POLICY, extra: 1 })).toThrow(expect.objectContaining({ code: 'invalid_policy' }));
  });

  describe('sign-in', () => {
    it('creates one account per provider subject and opens its credit account with the account owner', async () => {
      const first = await signIn('alice');
      expect(first).toMatchObject({
        created: true,
        account: { accountId: expect.stringMatching(/^acct_[a-f0-9]{32}$/), ownerId: expect.stringMatching(/^owner_[a-f0-9]{32}$/), activeDeviceIds: [] },
        session: { token: expect.any(String), deviceId: null, expiresAt: new Date(Date.parse(clock()) + ACCOUNT_POLICY.sessionTtlMs).toISOString() }
      });
      const { accountId, ownerId } = first.account;
      expect(await ledger.getAccount(accountId)).toMatchObject({ accountId, ownerId });
      expect(first.account.creditAccountOpenedAt).toBe(clock());

      const again = await signIn('alice');
      expect(again).toMatchObject({ created: false, account: { accountId, ownerId } });
      expect(again.session.sessionId).not.toBe(first.session.sessionId);
      expect((await signIn('bob')).account.accountId).not.toBe(accountId);
      expect(await accounts.authenticate(first.session.token)).toMatchObject({ accountId, ownerId, deviceId: null });
      expect(await identity.accountOwner(accountId)).toBe(ownerId);

      // A restarted process sees the same account; stored records hold neither the subject nor the session secret.
      const reopened = harness.open().accounts;
      expect(await reopened.authenticate(again.session.token)).toMatchObject({ accountId });
      const stored = JSON.stringify(await reopened.getAccount(accountId));
      expect(stored).not.toContain('alice');
      expect(stored).not.toContain(first.session.token.split('.')[1]);
    });

    it('rejects forged, foreign, wrong-audience, expired, replayed and unknown-provider assertions', async () => {
      const assertion = provider.issue({ subject: 'alice' });
      const [claims, mac] = assertion.split('.');
      await rejectsWith(accounts.signIn({ providerId: provider.providerId, assertion: `${claims}.${mac.slice(1)}x` }), 'assertion_invalid');
      const forgedClaims = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(claims, 'base64url')), sub: 'mallory' })).toString('base64url');
      await rejectsWith(accounts.signIn({ providerId: provider.providerId, assertion: `${forgedClaims}.${mac}` }), 'assertion_invalid');
      // Another provider instance with the same id holds a different key.
      const impostor = createTestSignInProvider({ providerId: provider.providerId });
      await rejectsWith(accounts.signIn({ providerId: provider.providerId, assertion: impostor.issue({ subject: 'alice' }) }), 'assertion_invalid');
      await rejectsWith(signIn('alice', { audience: 'another-service' }), 'assertion_invalid');
      await rejectsWith(signIn('alice', { expiresInMs: -1 }), 'assertion_expired');
      await rejectsWith(signIn('alice', { authenticatedAt: new Date(Date.parse(clock()) + MIN).toISOString() }), 'assertion_invalid');
      await rejectsWith(accounts.signIn({ providerId: 'unconfigured', assertion }), 'provider_unknown');

      await accounts.signIn({ providerId: provider.providerId, assertion });
      await rejectsWith(accounts.signIn({ providerId: provider.providerId, assertion }), 'assertion_replayed');
    });

    it('ends, expires and refuses sessions', async () => {
      const { session } = await signIn('alice');
      const [sessionId, secret] = session.token.split('.');
      const altered = secret.slice(0, -1) + (secret.endsWith('A') ? 'B' : 'A');
      await rejectsWith(accounts.authenticate(`${sessionId}.${altered}`), 'session_invalid');
      await rejectsWith(accounts.authenticate('not-a-token'), 'session_invalid');
      await rejectsWith(accounts.authorizeDevice(session.token), 'device_session_required');

      const other = (await signIn('alice')).session;
      expect(await accounts.endSession({ sessionToken: other.token })).toMatchObject({ sessionId: other.sessionId, endedAt: clock() });
      await rejectsWith(accounts.authenticate(other.token), 'session_ended');

      advance(ACCOUNT_POLICY.sessionTtlMs);
      await rejectsWith(accounts.authenticate(session.token), 'session_expired');
    });
  });

  describe('device registration', () => {
    it('binds browser and native identity keys after proof of possession', async () => {
      const { account, session } = await signIn('alice');
      const phone = await newIdentity('Ed25519');
      const laptop = await newIdentity('ECDSA');
      const idempotencyKey = 'register:phone';
      const { challenge, proof, sessionBinding, registration } = await registerDevice(accounts, session, phone, { bindSession: true, idempotencyKey });
      expect(challenge).toMatchObject({
        accountId: account.accountId, audience: ACCOUNT_POLICY.audience, sessionId: session.sessionId,
        expiresAt: new Date(Date.parse(clock()) + ACCOUNT_POLICY.challengeTtlMs).toISOString()
      });
      expect(registration).toMatchObject({
        deviceId: expect.stringMatching(/^dev_[a-f0-9]{32}$/), participantId: phone.peerId, accountId: account.accountId,
        host: 'browser', registeredAt: clock(), sessionBound: true, sharedDeviceLinks: []
      });
      // A retried request returns the stored registration.
      expect(await accounts.registerDevice({ sessionToken: session.token, proof, bindSession: true, sessionBinding, idempotencyKey })).toEqual(registration);
      expect(await accounts.authorizeDevice(session.token)).toMatchObject({ accountId: account.accountId, deviceId: registration.deviceId });

      const native = (await registerDevice(accounts, session, laptop, { host: 'native' })).registration;
      expect(native).toMatchObject({ participantId: laptop.peerId, host: 'native', sessionBound: false });
      expect(await identity.participantAccount(phone.peerId)).toBe(account.accountId);
      expect(await identity.participantAccount(laptop.peerId)).toBe(account.accountId);
      expect(await identity.participantAccount('peer:unregistered')).toBeNull();
      expect((await accounts.listDevices(account.accountId)).map((device) => [device.participantId, device.status]))
        .toEqual(expect.arrayContaining([[phone.peerId, 'active'], [laptop.peerId, 'active']]));
      expect((await accounts.getAccount(account.accountId)).activeDeviceIds).toEqual([registration.deviceId, native.deviceId]);
      expect(await accounts.getDevice(registration.deviceId)).toMatchObject({ publicJwk: { kty: 'OKP', crv: 'Ed25519', x: phone.publicJwk.x } });
      // A work time before registration is not covered.
      expect(await identity.participantAccount(phone.peerId, { at: new Date(Date.parse(clock()) - 1).toISOString() })).toBeNull();
    });

    it('rejects forged proofs', async () => {
      const { session } = await signIn('alice');
      const victim = await newIdentity();
      const attacker = await newIdentity();
      const register = (proof, idempotencyKey) => accounts.registerDevice({ sessionToken: session.token, proof, idempotencyKey });

      // The attacker signs a proof naming the victim's key.
      let challenge = await accounts.createRegistrationChallenge({ sessionToken: session.token });
      const claimed = registrationProofBody({ challenge, participantId: victim.peerId, publicJwk: (await createDeviceRegistrationProof({ identity: victim, challenge, host: 'native' })).publicJwk, host: 'native' });
      await rejectsWith(register({ ...claimed, signature: await signAsParticipant(attacker, REGISTRATION_PROOF_SCHEMA, claimed) }, 'forged:1'), 'proof_signature_invalid');
      // The attacker's key presented under the victim's participant id.
      const own = await createDeviceRegistrationProof({ identity: attacker, challenge, host: 'native' });
      await rejectsWith(register({ ...own, participantId: victim.peerId }, 'forged:2'), 'participant_key_mismatch');
      // Altered after signing.
      await rejectsWith(register({ ...own, host: 'browser' }, 'forged:3'), 'proof_signature_invalid');
      // Private key material is never accepted as a device key.
      await rejectsWith(register({ ...own, publicJwk: { ...own.publicJwk, d: attacker.privateJwk.d } }, 'forged:4'), 'proof_malformed');
      // A validly signed answer to a different nonce.
      const wrongNonce = await createDeviceRegistrationProof({ identity: attacker, challenge: { ...challenge, nonce: 'another-nonce' }, host: 'native' });
      await rejectsWith(register(wrongNonce, 'forged:5'), 'challenge_mismatch');
      await rejectsWith(accounts.registerDevice({ sessionToken: 'ses_missing.x', proof: own, idempotencyKey: 'forged:6' }), 'session_invalid');
      challenge = await accounts.createRegistrationChallenge({ sessionToken: session.token });
      expect((await register(await createDeviceRegistrationProof({ identity: attacker, challenge, host: 'native' }), 'genuine')).participantId).toBe(attacker.peerId);
      expect(await identity.participantAccount(victim.peerId)).toBeNull();
    });

    it('rejects replayed proofs and challenges from other sessions, other accounts or after expiry', async () => {
      const alice = await signIn('alice');
      const aliceTablet = (await signIn('alice')).session;
      const bob = await signIn('bob');
      const device = await newIdentity();
      const { proof } = await registerDevice(accounts, alice.session, device);
      await rejectsWith(accounts.registerDevice({ sessionToken: alice.session.token, proof, idempotencyKey: 'replay' }), 'challenge_used');

      const other = await newIdentity();
      const challenge = await accounts.createRegistrationChallenge({ sessionToken: alice.session.token });
      const answer = await createDeviceRegistrationProof({ identity: other, challenge, host: 'browser' });
      await rejectsWith(accounts.registerDevice({ sessionToken: aliceTablet.token, proof: answer, idempotencyKey: 'other-session' }), 'challenge_mismatch');
      await rejectsWith(accounts.registerDevice({ sessionToken: bob.session.token, proof: answer, idempotencyKey: 'other-account' }), 'challenge_mismatch');
      advance(ACCOUNT_POLICY.challengeTtlMs);
      await rejectsWith(accounts.registerDevice({ sessionToken: alice.session.token, proof: answer, idempotencyKey: 'late' }), 'challenge_expired');
      expect(await identity.participantAccount(other.peerId)).toBeNull();
    });

    it('binds a session only with the registering device\'s own signed binding for that session', async () => {
      const { session } = await signIn('alice');
      const desk = (await signIn('alice')).session;
      const native = await newIdentity();
      const browser = await newIdentity('ECDSA');
      const challenge = await accounts.createRegistrationChallenge({ sessionToken: session.token });
      const proof = await createDeviceRegistrationProof({ identity: native, challenge, host: 'native' });
      const register = (input, idempotencyKey) => accounts.registerDevice({ sessionToken: session.token, proof, bindSession: true, idempotencyKey, ...input });
      // A native host answering another session's challenge signs no binding, so that session cannot act as it.
      await rejectsWith(register({}, 'bind:none'), 'session_binding_invalid');
      // Another key's binding, a binding for another session and an altered binding all fail.
      await rejectsWith(register({ sessionBinding: await createSessionBinding({ identity: browser, challenge }) }, 'bind:other-key'), 'session_binding_invalid');
      await rejectsWith(register({ sessionBinding: await createSessionBinding({ identity: native, challenge: { ...challenge, sessionId: desk.sessionId } }) }, 'bind:other-session'), 'session_binding_invalid');
      const genuine = await createSessionBinding({ identity: native, challenge });
      await rejectsWith(register({ sessionBinding: { ...genuine, nonce: 'another-nonce' } }, 'bind:altered'), 'session_binding_invalid');
      await rejectsWith(accounts.registerDevice({ sessionToken: session.token, proof, sessionBinding: genuine, idempotencyKey: 'bind:unrequested' }), 'invalid_input');
      // The refusals left the challenge open; the device's own binding works and the session acts as it.
      expect(await register({ sessionBinding: genuine }, 'bind:genuine')).toMatchObject({ participantId: native.peerId, sessionBound: true });
      expect((await accounts.authorizeDevice(session.token)).deviceId).toBe((await accounts.listDevices((await accounts.authenticate(session.token)).accountId))[0].deviceId);
      await rejectsWith(accounts.authorizeDevice(desk.token), 'device_session_required');
    });

    it('binds a later session to an active registration with the device\'s own signed binding', async () => {
      const { session } = await signIn('alice');
      const device = await newIdentity();
      const { registration } = await registerDevice(accounts, session, device, { host: 'native', bindSession: true });
      advance(ACCOUNT_POLICY.sessionTtlMs + MIN);
      await rejectsWith(accounts.authorizeDevice(session.token), 'session_expired');
      const later = (await signIn('alice')).session;
      const challenge = await accounts.createRegistrationChallenge({ sessionToken: later.token });
      const bind = (input, idempotencyKey) => accounts.bindDeviceSession({ sessionToken: later.token, deviceId: registration.deviceId, idempotencyKey, ...input });
      await rejectsWith(bind({ sessionBinding: await createSessionBinding({ identity: await newIdentity(), challenge }) }, 'b:other-key'), 'session_binding_invalid');
      await rejectsWith(bind({ deviceId: 'dev_' + '0'.repeat(32), sessionBinding: await createSessionBinding({ identity: device, challenge }) }, 'b:unknown'), 'device_not_found');
      const bound = await bind({ sessionBinding: await createSessionBinding({ identity: device, challenge }) }, 'b:genuine');
      expect(bound).toMatchObject({ deviceId: registration.deviceId, registrationId: registration.registrationId, sessionBound: true });
      expect(await bind({ sessionBinding: await createSessionBinding({ identity: device, challenge }) }, 'b:genuine')).toEqual(bound);
      expect((await accounts.authorizeDevice(later.token)).deviceId).toBe(registration.deviceId);
      // The challenge is spent, a bound session cannot rebind, and another account's session cannot bind this device.
      await rejectsWith(bind({ sessionBinding: await createSessionBinding({ identity: device, challenge }) }, 'b:again'), 'challenge_used');
      const bob = (await signIn('bob')).session;
      const bobChallenge = await accounts.createRegistrationChallenge({ sessionToken: bob.token });
      await rejectsWith(accounts.bindDeviceSession({ sessionToken: bob.token, deviceId: registration.deviceId,
        sessionBinding: await createSessionBinding({ identity: device, challenge: bobChallenge }), idempotencyKey: 'b:bob' }), 'device_not_found');
    });
  });

  describe('revocation', () => {
    it('stops the device, its sessions, quotes and spending at once while past receipts keep provenance', async () => {
      const { account, session } = await signIn('alice');
      const desk = (await signIn('alice')).session;
      const phone = await newIdentity();
      const { registration } = await registerDevice(accounts, session, phone, { bindSession: true });
      await fund(ledger, account.accountId, 500);
      const quote = await guards.createQuote({ sessionToken: session.token, ...quoteInput({ quoteId: 'q_before', accountId: account.accountId }), idempotencyKey: 'quote:before' });
      const accepted = await guards.acceptQuote({ sessionToken: session.token, quoteId: quote.quoteId, quoteHash: quote.quoteHash, idempotencyKey: 'accept:before' });
      expect(accepted.deviceId).toBe(registration.deviceId);
      const spentAt = clock();

      advance(MIN);
      const revoked = await accounts.revokeDevice({ sessionToken: desk.token, deviceId: registration.deviceId, reason: 'retired', idempotencyKey: 'revoke:phone' });
      expect(revoked).toMatchObject({ deviceId: registration.deviceId, revokedAt: clock(), reason: 'retired' });

      await rejectsWith(accounts.authenticate(session.token), 'session_device_revoked');
      const next = await ledger.createQuote({ ...quoteInput({ quoteId: 'q_after', accountId: account.accountId }), idempotencyKey: 'quote:after' });
      await rejectsWith(guards.acceptQuote({ sessionToken: session.token, quoteId: next.quoteId, quoteHash: next.quoteHash, idempotencyKey: 'accept:after' }), 'session_device_revoked');
      await rejectsWith(guards.createQuote({ sessionToken: session.token, ...quoteInput({ quoteId: 'q_more', accountId: account.accountId }), idempotencyKey: 'quote:more' }), 'session_device_revoked');
      expect(await identity.participantAccount(phone.peerId)).toBeNull();
      expect((await accounts.getAccount(account.accountId)).activeDeviceIds).toEqual([]);

      // Past receipts are untouched; provenance still names the account and the revocation.
      expect(await ledger.getReservation(accepted.reservationId)).toMatchObject({ deviceId: registration.deviceId, status: 'open' });
      expect(await accounts.attributeParticipant({ participantId: phone.peerId, at: spentAt })).toMatchObject({
        accountId: account.accountId, registrationId: registration.registrationId, status: 'revoked', revocation: { reason: 'retired' }
      });
      expect(await accounts.attributeParticipant({ participantId: phone.peerId, at: clock() })).toBeNull();

      await rejectsWith(accounts.revokeDevice({ sessionToken: desk.token, deviceId: registration.deviceId, reason: 'retired', idempotencyKey: 'revoke:again' }), 'device_already_revoked');
      const mallory = (await signIn('mallory')).session;
      await rejectsWith(accounts.revokeDevice({ sessionToken: mallory.token, deviceId: registration.deviceId, reason: 'retired', idempotencyKey: 'revoke:foreign' }), 'device_not_found');
    });

    /** A funded account with a phone-bound session, a second session and an open quote. */
    async function spendingFixture() {
      const { account, session } = await signIn('alice');
      const desk = (await signIn('alice')).session;
      const { registration } = await registerDevice(accounts, session, await newIdentity(), { bindSession: true });
      await fund(ledger, account.accountId, 500);
      const quote = await guards.createQuote({ sessionToken: session.token, ...quoteInput({ quoteId: 'q_race', accountId: account.accountId }), idempotencyKey: 'quote:race' });
      const revoke = () => accounts.revokeDevice({ sessionToken: desk.token, deviceId: registration.deviceId, reason: 'compromised', idempotencyKey: 'revoke:race' });
      return { account, session, registration, quote, revoke };
    }

    it('refuses a spend when the device is revoked between the session guard and the ledger write', async () => {
      const { account, session, quote, revoke } = await spendingFixture();
      const before = await ledger.getAccount(account.accountId);
      // The guard's device check passes, then the revocation commits, then the ledger write runs.
      const racing = createAccountGuards({ ledger, rewards: null, accounts: { ...accounts, authorizeDevice: async (token) => {
        const auth = await accounts.authorizeDevice(token);
        await revoke();
        return auth;
      } } });
      await rejectsWith(racing.acceptQuote({ sessionToken: session.token, quoteId: quote.quoteId, quoteHash: quote.quoteHash, idempotencyKey: 'accept:race' }), 'device_not_authorized');
      expect(await ledger.getQuote(quote.quoteId)).toMatchObject({ status: 'offered', reservationId: null });
      expect(await ledger.getAccount(account.accountId)).toEqual(before);
      expect(await ledger.listReservations({ status: 'open' })).toEqual([]);
    });

    it('decides a revocation that commits during the acceptance transaction by commit order', async () => {
      const { account, session, registration, quote, revoke } = await spendingFixture();
      // A second ledger process over the same database whose device read triggers the revocation.
      let revocation = null;
      const raced = createLedgerStore({
        backend: harness.ledgerBackend(), policy: LEDGER_POLICY, clock,
        deviceAuthority: async (tx, input) => {
          const allowed = await ledgerDeviceAuthority(tx, input);
          if (!revocation) {
            revocation = revoke();
            // Firestore: the revocation commits now, so this transaction's device read is stale.
            // Memory: transactions are serialized, so it waits until this acceptance commits.
            if (kind === 'firestore') await revocation;
          }
          return allowed;
        }
      });
      const accept = (idempotencyKey) => raced.acceptQuote({
        quoteId: quote.quoteId, accountId: account.accountId, quoteHash: quote.quoteHash, deviceId: registration.deviceId, idempotencyKey
      });
      if (kind === 'firestore') {
        await rejectsWith(accept('accept:during'), 'device_not_authorized');
        expect(await ledger.getQuote(quote.quoteId)).toMatchObject({ status: 'offered' });
      } else {
        // The acceptance committed first; the revocation follows it and refuses the next one.
        expect(await accept('accept:during')).toMatchObject({ deviceId: registration.deviceId });
        await revocation;
        const next = await ledger.createQuote({ ...quoteInput({ quoteId: 'q_next', accountId: account.accountId }), idempotencyKey: 'quote:next' });
        await rejectsWith(raced.acceptQuote({
          quoteId: next.quoteId, accountId: account.accountId, quoteHash: next.quoteHash, deviceId: registration.deviceId, idempotencyKey: 'accept:next'
        }), 'device_not_authorized');
      }
      expect((await accounts.getDevice(registration.deviceId)).status).toBe('revoked');
    });

    it('refuses acceptance for a device of another account or an unknown device id', async () => {
      const { account, quote } = await spendingFixture();
      const other = await signIn('bob');
      const { registration } = await registerDevice(accounts, other.session, await newIdentity(), { bindSession: true });
      for (const deviceId of [registration.deviceId, 'phone', 'dev_' + '0'.repeat(32)]) {
        await rejectsWith(ledger.acceptQuote({ quoteId: quote.quoteId, accountId: account.accountId, quoteHash: quote.quoteHash, deviceId, idempotencyKey: `accept:${deviceId}` }), 'device_not_authorized');
      }
    });
  });

  describe('recovery', () => {
    it('re-establishes access and re-registers devices without moving or minting credit', async () => {
      const { account, session } = await signIn('alice');
      const phone = await newIdentity();
      const host = await newIdentity();
      const phoneDevice = (await registerDevice(accounts, session, phone, { bindSession: true })).registration;
      await registerDevice(accounts, session, host, { host: 'native' });
      await fund(ledger, account.accountId, 500);
      const quote = await guards.createQuote({ sessionToken: session.token, ...quoteInput({ quoteId: 'q_hold', accountId: account.accountId }), idempotencyKey: 'quote:hold' });
      await guards.acceptQuote({ sessionToken: session.token, quoteId: quote.quoteId, quoteHash: quote.quoteHash, idempotencyKey: 'accept:hold' });
      const solvency = async () => {
        const { generatedAt: _generatedAt, ...snapshot } = await ledger.getSolvencySnapshot();
        return snapshot;
      };
      const before = {
        account: await ledger.getAccount(account.accountId),
        journal: await journalShape(ledger, account.accountId),
        solvency: await solvency()
      };

      advance(MIN);
      const recovered = await accounts.recoverAccount({ providerId: provider.providerId, assertion: provider.issue({ subject: 'alice' }) });
      expect(recovered).toMatchObject({
        account: { accountId: account.accountId, activeDeviceIds: [], recoveredAt: clock() },
        recovery: { accountId: account.accountId, revokedDeviceIds: [phoneDevice.deviceId, expect.any(String)], sessionEpoch: 1 },
        session: { accountId: account.accountId, deviceId: null }
      });
      await rejectsWith(accounts.authenticate(session.token), 'session_revoked');
      expect(await identity.participantAccount(phone.peerId)).toBeNull();
      expect(await identity.participantAccount(host.peerId)).toBeNull();
      expect(await ledger.getAccount(account.accountId)).toEqual(before.account);
      expect(await journalShape(ledger, account.accountId)).toEqual(before.journal);
      expect(await solvency()).toEqual(before.solvency);

      // The recovered session re-registers the same phone key by proving possession again.
      const again = (await registerDevice(accounts, recovered.session, phone, { bindSession: true })).registration;
      expect(again).toMatchObject({ deviceId: phoneDevice.deviceId, accountId: account.accountId, sharedDeviceLinks: [] });
      expect(again.registrationId).not.toBe(phoneDevice.registrationId);
      expect(await identity.participantAccount(phone.peerId)).toBe(account.accountId);
      expect(await accounts.listRecoveries(account.accountId)).toHaveLength(1);
      expect(await ledger.getAccount(account.accountId)).toEqual(before.account);
    });

    it('requires a recent provider authentication and an existing account', async () => {
      await signIn('alice');
      const stale = provider.issue({ subject: 'alice', authenticatedAt: new Date(Date.parse(clock()) - ACCOUNT_POLICY.recoveryMaxAuthAgeMs - 1).toISOString() });
      await rejectsWith(accounts.recoverAccount({ providerId: provider.providerId, assertion: stale }), 'reauthentication_required');
      await rejectsWith(accounts.recoverAccount({ providerId: provider.providerId, assertion: provider.issue({ subject: 'nobody' }) }), 'account_not_found');
      const fresh = provider.issue({ subject: 'alice' });
      await accounts.recoverAccount({ providerId: provider.providerId, assertion: fresh });
      await rejectsWith(accounts.recoverAccount({ providerId: provider.providerId, assertion: fresh }), 'assertion_replayed');
    });
  });

  describe('device moves', () => {
    it('refuses a device registered to another account until revoked, then links the accounts', async () => {
      const alice = await signIn('alice');
      const bob = await signIn('bob');
      const host = await newIdentity();
      const first = (await registerDevice(accounts, alice.session, host, { host: 'native' })).registration;
      const registeredAt = clock();
      await rejectsWith(registerDevice(accounts, bob.session, host, { host: 'native' }), 'device_registered_elsewhere');
      expect(await identity.participantAccount(host.peerId)).toBe(alice.account.accountId);

      advance(MIN);
      await accounts.revokeDevice({ sessionToken: alice.session.token, deviceId: first.deviceId, reason: 'transfer', idempotencyKey: 'revoke:move' });
      const moved = (await registerDevice(accounts, bob.session, host, { host: 'native' })).registration;
      expect(moved).toMatchObject({ deviceId: first.deviceId, accountId: bob.account.accountId, sharedDeviceLinks: [expect.stringMatching(/^lnk_/)] });
      expect(await identity.participantAccount(host.peerId)).toBe(bob.account.accountId);
      expect(await identity.accountLinks(alice.account.accountId, bob.account.accountId)).toEqual([
        { kind: 'shared_device', evidenceId: first.deviceId, linkId: moved.sharedDeviceLinks[0] }
      ]);
      expect(await accounts.attributeParticipant({ participantId: host.peerId, at: registeredAt })).toMatchObject({ accountId: alice.account.accountId, status: 'revoked' });
      expect(await accounts.attributeParticipant({ participantId: host.peerId, at: clock() })).toMatchObject({ accountId: bob.account.accountId, status: 'active' });
    });

    it('never registers a key again after it is revoked as compromised', async () => {
      const alice = await signIn('alice');
      const stolen = await newIdentity();
      const { registration } = await registerDevice(accounts, alice.session, stolen);
      await accounts.revokeDevice({ sessionToken: alice.session.token, deviceId: registration.deviceId, reason: 'compromised', idempotencyKey: 'revoke:stolen' });
      await rejectsWith(registerDevice(accounts, alice.session, stolen), 'device_key_compromised');
      await rejectsWith(registerDevice(accounts, (await signIn('mallory')).session, stolen), 'device_key_compromised');
    });
  });
});
