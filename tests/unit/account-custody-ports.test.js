// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';

import {
  CUSTODY_CERTIFICATE_LIFETIME_MS, CUSTODY_CERTIFICATE_SCHEMA, createCustodyKeyCertificate, createCustodyKeyCertifier, custodyCertificateBody
} from '../../packages/reploid/src/artifacts/custody-certificate.js';
import { signAsParticipant } from '../../packages/reploid/src/artifacts/participant-proofs.js';
import { checkCounterparty } from '../../server/rewards/counterparty.js';
import { certifiedCustodyKey } from '../../server/rewards/custody-evidence.js';
import { ACCOUNT_POLICY, newCustodyKey, newIdentity, openAccountFixture, registerDevice, signInAs } from '../helpers/account-fixture.js';
import {
  MIN, OWNER_DIGEST, REWARD_POLICY, advance, claimInput, clock, codes, fund, fx, offerInput, ownerAuthorization, quoteInput, rejectsWith, settle
} from '../helpers/reward-fixture.js';

describe.each(['memory', 'firestore'])('custody certificates and identity ports (%s store)', (kind) => {
  let accounts;
  let ledger;
  let rewards;
  let guards;
  let identity;
  let provider;

  beforeEach(() => {
    ({ accounts, ledger, rewards, guards, identity, provider } = openAccountFixture(kind));
  });

  const signIn = (subject) => signInAs(accounts, provider, subject);
  const nowCertifier = (host, issued = []) => createCustodyKeyCertifier({ identity: host, now: () => fx.nowMs, onIssue: (certificate) => issued.push(certificate) });
  const refusal = async (certificate, at = clock()) => (await accounts.verifyCustodyKey({ certificate, at })).reason;

  /** A native host registered to a fresh account, with its custody key certified now. */
  async function nativeHost(subject, algorithm = 'Ed25519') {
    const { account, session } = await signIn(subject);
    const host = await newIdentity(algorithm);
    const { registration } = await registerDevice(accounts, session, host, { host: 'native' });
    const custody = await newCustodyKey();
    const issued = [];
    const certifier = nowCertifier(host, issued);
    const certificate = await certifier.certify({ custodyPeerId: `transport-${subject}`, custodyPublicKey: custody.publicKey });
    return { account, session, host, registration, custody, certifier, certificate, issued };
  }

  describe('custody certificates', () => {
    it('attribute a per-process custody key through certificate, device and account', async () => {
      for (const algorithm of ['Ed25519', 'ECDSA']) {
        const { account, host, registration, custody, certifier, certificate, issued } = await nativeHost(`carol-${algorithm}`, algorithm);
        expect(certificate).toEqual({
          schema: CUSTODY_CERTIFICATE_SCHEMA, certificateId: expect.stringMatching(/^cert_/), participantId: host.peerId,
          custodyPeerId: `transport-carol-${algorithm}`, custodyPublicKey: custody.publicKey,
          issuedAt: clock(), expiresAt: new Date(fx.nowMs + CUSTODY_CERTIFICATE_LIFETIME_MS).toISOString(), signature: expect.any(String)
        });
        expect(await certifier.certify({ custodyPeerId: certificate.custodyPeerId, custodyPublicKey: custody.publicKey })).toBe(certificate);
        expect(issued).toEqual([certificate]);
        expect(await accounts.verifyCustodyKey({ certificate, at: clock() })).toMatchObject({
          ok: true, accountId: account.accountId, deviceId: registration.deviceId, registrationId: registration.registrationId,
          participantId: host.peerId, custodyPeerId: certificate.custodyPeerId, publicKey: custody.publicKey
        });
        const binding = { participantId: host.peerId, custodyPeerId: certificate.custodyPeerId, publicKey: custody.publicKey };
        expect(await identity.verifyCustodyKey({ certificate, at: clock() })).toEqual(binding);
        // The rewards reader accepts exactly this binding.
        expect(await certifiedCustodyKey(identity, { certificate, at: clock() })).toEqual(binding);
        expect(await identity.participantAccount(binding.participantId)).toBe(account.accountId);
      }
    });

    it('renew at half-life and reject expired, forged, altered, over-long, unregistered and early certificates', async () => {
      const { host, custody, certifier, certificate, issued } = await nativeHost('carol');
      const key = { custodyPeerId: certificate.custodyPeerId, custodyPublicKey: custody.publicKey };
      expect(await refusal(certificate, new Date(fx.nowMs + MIN).toISOString())).toBe('time_in_future');

      advance(CUSTODY_CERTIFICATE_LIFETIME_MS / 2 + 1);
      const renewed = await certifier.certify(key);
      expect(renewed.certificateId).not.toBe(certificate.certificateId);
      expect(issued).toEqual([certificate, renewed]);
      advance(CUSTODY_CERTIFICATE_LIFETIME_MS / 2);
      expect(await refusal(certificate)).toBe('certificate_expired');
      expect(await identity.verifyCustodyKey({ certificate })).toBeNull();
      expect((await accounts.verifyCustodyKey({ certificate: renewed })).ok).toBe(true);
      expect(await refusal(renewed, new Date(Date.parse(renewed.issuedAt) - ACCOUNT_POLICY.maxClockSkewMs - 1).toISOString())).toBe('certificate_not_yet_valid');

      // Another identity signs a statement naming the registered participant.
      const attacker = await newIdentity();
      const claimed = custodyCertificateBody({ ...renewed, certificateId: 'cert_forged' });
      expect(await refusal({ ...claimed, signature: await signAsParticipant(attacker, CUSTODY_CERTIFICATE_SCHEMA, claimed) })).toBe('certificate_signature_invalid');
      // The custody key swapped after signing.
      expect(await refusal({ ...renewed, custodyPublicKey: (await newCustodyKey()).publicKey })).toBe('certificate_signature_invalid');
      expect(await refusal({ ...renewed, custodyPeerId: 'transport-other' })).toBe('certificate_signature_invalid');
      expect(await refusal({ ...renewed, extra: true })).toBe('certificate_malformed');
      const longLived = await createCustodyKeyCertificate({
        identity: host, ...key, issuedAtMs: fx.nowMs, lifetimeMs: ACCOUNT_POLICY.custodyCertificateMaxLifetimeMs + 1
      });
      expect(await refusal(longLived)).toBe('certificate_lifetime_exceeded');
      const stranger = await createCustodyKeyCertificate({ identity: attacker, ...key, issuedAtMs: fx.nowMs, lifetimeMs: MIN });
      expect(await refusal(stranger)).toBe('device_not_registered');
      expect(await identity.verifyCustodyKey({ certificate: stranger, at: clock() })).toBeNull();
      expect(await certifiedCustodyKey(identity, { certificate: null, at: clock() })).toBeNull();

      // A certificate signed before its key registered is not attributable to that registration.
      const early = await newIdentity();
      const premature = await createCustodyKeyCertificate({ identity: early, ...key, issuedAtMs: fx.nowMs - 10 * MIN, lifetimeMs: 30 * MIN });
      await registerDevice(accounts, (await signIn('erin')).session, early, { host: 'native' });
      expect(await refusal(premature)).toBe('certificate_precedes_registration');
    });

    it('stop at revocation and after the key registers elsewhere, while provenance keeps the signing account', async () => {
      const { account, session, host, registration, custody, certificate } = await nativeHost('carol');
      const signedAt = clock();
      advance(MIN);
      await accounts.revokeDevice({ sessionToken: session.token, deviceId: registration.deviceId, reason: 'transfer', idempotencyKey: 'revoke:host' });
      expect(await refusal(certificate, signedAt)).toBe('device_revoked');
      expect(await identity.verifyCustodyKey({ certificate, at: signedAt })).toBeNull();
      expect(await accounts.attributeCustodyKey({ certificate, at: signedAt })).toMatchObject({
        accountId: account.accountId, registrationId: registration.registrationId, status: 'revoked', publicKey: custody.publicKey
      });

      advance(MIN);
      const dave = await signIn('dave');
      await registerDevice(accounts, dave.session, host, { host: 'native' });
      expect(await refusal(certificate)).toBe('certificate_precedes_registration');
      const fresh = await nowCertifier(host).certify({ custodyPeerId: 'transport-dave', custodyPublicKey: custody.publicKey });
      expect(await accounts.verifyCustodyKey({ certificate: fresh, at: clock() })).toMatchObject({ ok: true, accountId: dave.account.accountId });
      expect(await accounts.attributeCustodyKey({ certificate, at: signedAt })).toMatchObject({ accountId: account.accountId });
      expect(await accounts.attributeCustodyKey({ certificate: fresh, at: clock() })).toMatchObject({ accountId: dave.account.accountId, status: 'active' });
    });
  });

  describe('ledger and reward ports', () => {
    it('give the ledger account owner and recorded links, and never treat a missing link as independence', async () => {
      const [alice, bob, carol] = [await signIn('alice'), await signIn('bob'), await signIn('carol')];
      const [a, b, c] = [alice, bob, carol].map((entry) => entry.account.accountId);
      expect((await ledger.getAccount(a)).ownerId).toBe(await identity.accountOwner(a));
      expect(await identity.accountOwner('acct_missing')).toBeNull();

      const input = { kind: 'shared_payment_instrument', accountIds: [b, a], evidenceId: 'instrument_fingerprint_1', recordedBy: { authority: 'payments', id: 'payments_test' } };
      const link = await accounts.recordLink({ ...input, idempotencyKey: 'link:1' });
      expect(link).toMatchObject({ kind: 'shared_payment_instrument', accountA: [a, b].sort()[0], accountB: [a, b].sort()[1], recordedBy: { authority: 'payments' } });
      expect(await accounts.recordLink({ ...input, idempotencyKey: 'link:1' })).toEqual(link);
      expect(await accounts.recordLink({ ...input, idempotencyKey: 'link:2' })).toEqual(link);
      expect(await identity.accountLinks(a, b)).toEqual([{ kind: 'shared_payment_instrument', evidenceId: 'instrument_fingerprint_1', linkId: link.linkId }]);
      expect(await identity.accountLinks(b, a)).toEqual(await identity.accountLinks(a, b));
      expect(await identity.accountLinks(a, c)).toEqual([]);
      expect((await accounts.listLinks(a)).map((entry) => entry.linkId)).toEqual([link.linkId]);

      await rejectsWith(accounts.recordLink({ ...input, kind: 'shared_device', recordedBy: { authority: 'accounts', id: 'x' }, idempotencyKey: 'link:3' }), 'link_authority_denied');
      await rejectsWith(accounts.recordLink({ ...input, kind: 'operator_flagged', idempotencyKey: 'link:4' }), 'link_authority_denied');
      await rejectsWith(accounts.recordLink({ ...input, kind: 'same_household', idempotencyKey: 'link:5' }), 'invalid_link_kind');
      await rejectsWith(accounts.recordLink({ ...input, accountIds: [a, a], idempotencyKey: 'link:6' }), 'invalid_input');
      await rejectsWith(accounts.recordLink({ ...input, accountIds: [a, 'acct_missing'], idempotencyKey: 'link:7' }), 'account_not_found');
      expect(await accounts.recordLink({
        kind: 'operator_flagged', accountIds: [a, c], evidenceId: 'case_1', recordedBy: { authority: 'operator', id: 'operator_test' }, note: 'test note', idempotencyKey: 'link:8'
      })).toMatchObject({ kind: 'operator_flagged', note: 'test note' });

      // The reward collusion rule reads these answers.
      const reasons = [];
      const check = (counterpartyAccountId) => checkCounterparty({
        contributorAccountId: a, counterpartyAccountId, ledger, identity, rewardPolicy: REWARD_POLICY,
        reject: (code) => reasons.push(code)
      });
      expect(await check(b)).toEqual([{ kind: 'shared_payment_instrument', evidenceId: 'instrument_fingerprint_1' }]);
      expect(reasons).toEqual(['collusive_demand']);
      reasons.length = 0;
      expect(await check(c)).toEqual([{ kind: 'operator_flagged', evidenceId: 'case_1' }]);
      expect(reasons).toEqual([]);
    });

    it('let rewards attribute demanded inference to registered devices and refuse a revoked contributor', async () => {
      const rita = await signIn('rita');
      const phone = await newIdentity();
      await registerDevice(accounts, rita.session, phone, { bindSession: true });
      await fund(ledger, rita.account.accountId, 1000);
      const carl = await signIn('carl');
      const host = await newIdentity();
      const { registration } = await registerDevice(accounts, carl.session, host, { host: 'native' });

      const offer = await rewards.createOffer({ ...offerInput({ offerId: 'offer_carl', accountId: carl.account.accountId, participantId: host.peerId }), idempotencyKey: 'offer:carl' });
      const accept = (offerId, offerHash, idempotencyKey) => guards.acceptOffer({ sessionToken: carl.session.token, offerId, offerHash, ownerAuthorization, idempotencyKey });
      await rejectsWith(accept(offer.offerId, offer.offerHash, 'accept:early'), 'owner_authorization_unrecorded');
      const owner = await accounts.recordOwnerAuthorization({ sessionToken: carl.session.token, deviceId: registration.deviceId, ownerAuthorization, idempotencyKey: 'owner:host' });
      expect(owner).toMatchObject({
        accountId: carl.account.accountId, accountOwnerId: carl.account.ownerId, ownerPolicyDigest: OWNER_DIGEST,
        equipment: { granted: true, ownership: 'personal', accountRelation: 'owner' }, network: { granted: true, ownership: 'personal' }
      });
      expect(await identity.deviceOwnerAuthorization(host.peerId)).toEqual(owner);
      await rejectsWith(accounts.recordOwnerAuthorization({ sessionToken: rita.session.token, deviceId: registration.deviceId, ownerAuthorization, idempotencyKey: 'owner:foreign' }), 'device_not_found');
      await rejectsWith(accounts.recordOwnerAuthorization({ sessionToken: carl.session.token, deviceId: registration.deviceId, ownerAuthorization: { ...ownerAuthorization, digest: 'sha256:other' }, idempotencyKey: 'owner:bad' }), 'owner_authorization_invalid');
      expect(await accept(offer.offerId, offer.offerHash, 'accept:carl')).toMatchObject({ offerId: 'offer_carl', accountId: carl.account.accountId, ownerPolicyDigest: OWNER_DIGEST });

      // The requester spends from its registered phone; the contributor's native stage earns.
      const stages = ['peer_stage0', host.peerId];
      const spend = async (quoteId) => {
        const quote = await guards.createQuote({ sessionToken: rita.session.token, ...quoteInput({ quoteId, accountId: rita.account.accountId }), idempotencyKey: `quote:${quoteId}` });
        const { reservationId, deviceId } = await guards.acceptQuote({ sessionToken: rita.session.token, quoteId, quoteHash: quote.quoteHash, idempotencyKey: `accept:${quoteId}` });
        const work = { reservationId, attemptId: `att_${quoteId}` };
        await ledger.bindAttempt({ reservationId, attemptId: work.attemptId, recipients: stages, idempotencyKey: `bind:${quoteId}` });
        await settle(ledger, work);
        return { work, deviceId };
      };
      const first = await spend('q1');
      expect(first.deviceId).toMatch(/^dev_/);
      const accepted = await rewards.validateWork(claimInput({ offerId: offer.offerId, work: first.work, stages, requesterId: phone.peerId }));
      expect(accepted).toMatchObject({ outcome: 'accepted', reasons: [], evidence: { requester: { accountId: rita.account.accountId } } });

      advance(MIN);
      await accounts.revokeDevice({ sessionToken: carl.session.token, deviceId: registration.deviceId, reason: 'retired', idempotencyKey: 'revoke:host' });
      const second = await spend('q2');
      const refused = await rewards.validateWork(claimInput({ offerId: offer.offerId, work: second.work, stages, requesterId: phone.peerId }));
      expect(refused.outcome).toBe('rejected');
      expect(codes(refused)).toContain('contributor_identity_mismatch');
      expect(await identity.deviceOwnerAuthorization(host.peerId)).toBeNull();
      const later = await rewards.createOffer({ ...offerInput({ offerId: 'offer_carl_2', accountId: carl.account.accountId, participantId: host.peerId }), idempotencyKey: 'offer:carl:2' });
      await rejectsWith(accept(later.offerId, later.offerHash, 'accept:revoked'), 'participant_not_owned');
    });
  });
});
