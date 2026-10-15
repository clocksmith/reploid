// @vitest-environment node
// A real custody transfer between a browser identity and a native identity: the exchange
// carries each party's certificate and the certified acquirer's attestation of its receipt,
// and that delivery evidence becomes a verified-delivery claim that rewards attribute
// through the account ports.
import { beforeEach, describe, expect, it } from 'vitest';

import { deliveryEvidenceFromRecord, deliveryEvidenceId } from '../../packages/reploid/src/artifacts/delivery-attestation.js';
import { sha256Hex, signCanonical } from '../../packages/reploid/src/artifacts/signatures.js';
import { DELIVERY_ATTESTATION_SCHEMA, deliveryAttestationBody } from '../../server/rewards/custody-evidence.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
import { newIdentity, openAccountFixture, registerDevice, signInAs } from '../helpers/account-fixture.js';
import { PIECE_BYTES as BYTES, transferPiece } from '../helpers/custody-transfer.js';
import { MIN, advance, at, clock, codes, ownerAuthorization, rejectsWith } from '../helpers/reward-fixture.js';

describe.each(['memory', 'firestore'])('custody delivery attribution (%s store)', (kind) => {
  let accounts;
  let rewards;
  let guards;
  let provider;

  beforeEach(() => {
    ({ accounts, rewards, guards, provider } = openAccountFixture(kind));
  });

  /** A signed-in account with one registered device of `host`. */
  async function participant(subject, host) {
    const { account, session } = await signInAs(accounts, provider, subject);
    const identity = await newIdentity(host === 'browser' ? 'ECDSA' : 'Ed25519');
    const { registration } = await registerDevice(accounts, session, identity, { host, bindSession: host === 'browser' });
    if (host === 'native') {
      await accounts.recordOwnerAuthorization({ sessionToken: session.token, deviceId: registration.deviceId, ownerAuthorization, idempotencyKey: `owner:${subject}` });
    }
    return { account, session, identity, registration };
  }

  /** A delivery offer accepted by the supplier for the transferred piece. */
  async function acceptedOffer(supplier, offerId) {
    const offer = await rewards.createOffer({
      offerId, accountId: supplier.account.accountId,
      work: { category: 'verified_delivery', participantId: supplier.identity.peerId, pieces: [{ hash: await sha256Hex(BYTES), sizeBytes: BYTES.length }] },
      reward: { basis: { kind: 'test_per_delivered_byte' }, formula: { kind: 'metered', base: 0, rates: [{ meter: 'deliveredBytes', numerator: 1, denominator: 1 }] }, maxReward: 50 },
      resourceBounds: { transferBytes: { max: 1024, unit: 'byte' } },
      duration: { startsAt: clock(), endsAt: at(40 * MIN) }, validUntil: at(5 * MIN),
      paymentTiming: { trigger: 'on_validation', claimWindowMs: 30 * MIN }, failureCompensation: { kind: 'none' },
      idempotencyKey: `offer:${offerId}`
    });
    await guards.acceptOffer({ sessionToken: supplier.session.token, offerId, offerHash: offer.offerHash, ownerAuthorization, idempotencyKey: `accept:${offerId}` });
    return offer;
  }

  /**
   * The claim for a transfer: the acquirer's evidence with the attestation the exchange signed.
   * An uncertified acquirer's exchange signs none, so the test signs one by hand with its key.
   */
  async function claimFrom({ record, acquirerKey }, offerId, overrides = {}) {
    let attestation = record.attestation;
    if (!attestation) {
      const body = await deliveryAttestationBody({ receipt: record.receipt, attestedAt: clock() });
      attestation = { ...body, signature: await signCanonical(body, acquirerKey.privateKey, { domain: DELIVERY_ATTESTATION_SCHEMA }) };
    }
    return {
      offerId, artifactId: record.authorization.artifactSet.artifacts[0].artifactId,
      authorization: record.authorization, index: record.index, receipt: record.receipt, attestation,
      supplierCertificate: record.certificates.supplier, acquirerCertificate: record.certificates.requester,
      idempotencyKey: `claim:${offerId}`, ...overrides
    };
  }

  it.each([['native', 'browser'], ['browser', 'native']])('attributes a %s supplier\'s delivery to a %s acquirer', async (supplierHost, acquirerHost) => {
    const supplier = await participant('supplier', supplierHost);
    const acquirer = await participant('acquirer', acquirerHost);
    await acceptedOffer(supplier, 'offer_delivery');
    advance(MIN);
    const transfer = await transferPiece([acquirer.identity, supplier.identity]);
    expect(transfer.record.certificates.requester.participantId).toBe(acquirer.identity.peerId);
    expect(transfer.record.certificates.supplier.participantId).toBe(supplier.identity.peerId);
    // The certified acquirer's exchange attested the exact receipt; the supplier's record carries no attestation.
    expect(transfer.record.attestation).toMatchObject({
      schema: DELIVERY_ATTESTATION_SCHEMA, transferId: transfer.record.transferId, attestedAt: clock(),
      receiptDigest: await hashDopplerEvidence(transfer.record.receipt)
    });
    expect(transfer.supplierRecord.attestation).toBeNull();
    const validation = await rewards.validateWork(await claimFrom(transfer, 'offer_delivery'));
    expect(validation).toMatchObject({
      outcome: 'accepted', reasons: [],
      evidence: { acquirerAccountId: acquirer.account.accountId, acquirerParticipantId: acquirer.identity.peerId }
    });
  });

  it('leaves uncertified keys unattributable and refuses a revoked supplier device', async () => {
    const supplier = await participant('supplier', 'native');
    const acquirer = await participant('acquirer', 'browser');
    await acceptedOffer(supplier, 'offer_delivery');
    advance(MIN);
    // An acquirer that never certified its custody key cannot be named as the counterparty.
    const uncertified = await transferPiece([null, supplier.identity]);
    expect(uncertified.record.certificates.requester).toBeNull();
    // Without an identity the acquirer's exchange signs no attestation and has no evidence to submit.
    expect(uncertified.record.attestation).toBeNull();
    expect(deliveryEvidenceFromRecord(uncertified.record)).toBeNull();
    await rejectsWith(rewards.validateWork(await claimFrom(uncertified, 'offer_delivery')), 'invalid_input');
    const borrowed = await rewards.validateWork(await claimFrom(uncertified, 'offer_delivery', {
      acquirerCertificate: uncertified.record.certificates.supplier, idempotencyKey: 'claim:borrowed'
    }));
    expect(codes(borrowed)).toContain('acquirer_identity_unbound');

    const certified = await transferPiece([acquirer.identity, supplier.identity]);
    await accounts.revokeDevice({ sessionToken: supplier.session.token, deviceId: supplier.registration.deviceId, reason: 'retired', idempotencyKey: 'revoke:supplier' });
    const refused = await rewards.validateWork(await claimFrom(certified, 'offer_delivery', { idempotencyKey: 'claim:revoked' }));
    expect(codes(refused)).toEqual(['contributor_identity_mismatch']);
  });

  it('keeps a certified acquirer device\'s delivery evidence once and validates the supplier\'s claim from it', async () => {
    const supplier = await participant('supplier', 'native');
    const acquirer = await participant('acquirer', 'browser');
    await acceptedOffer(supplier, 'offer_delivery');
    advance(MIN);
    const transfer = await transferPiece([acquirer.identity, supplier.identity]);
    const evidence = deliveryEvidenceFromRecord(transfer.record);
    const asDevice = (who) => ({ accountId: who.account.accountId, participantId: who.identity.peerId });

    // Only the device whose certificate attests the receipt may submit it.
    await rejectsWith(rewards.recordDeliveryEvidence({ submitter: asDevice(supplier), evidence }), 'acquirer_device_mismatch');
    const tampered = structuredClone(evidence);
    tampered.receipt.completed = [];
    await rejectsWith(rewards.recordDeliveryEvidence({ submitter: asDevice(acquirer), evidence: tampered }), 'delivery_evidence_invalid');
    await rejectsWith(rewards.recordDeliveryEvidence({ submitter: asDevice(acquirer), evidence: { ...evidence, supplierCertificate: evidence.acquirerCertificate } }), 'delivery_evidence_invalid');

    const kept = await rewards.recordDeliveryEvidence({ submitter: asDevice(acquirer), evidence });
    const authorizationHash = await hashDopplerEvidence(transfer.supplierRecord.authorization);
    // The supplier derives the same id from its own grant.
    expect(kept).toMatchObject({
      deliveryId: await deliveryEvidenceId({ authorizationHash, artifactId: evidence.artifactId }), authorizationHash,
      transferId: transfer.record.transferId, pieceHash: await sha256Hex(BYTES), deliveredBytes: BYTES.length,
      submittedBy: asDevice(acquirer), recordedAt: clock()
    });
    expect(await rewards.recordDeliveryEvidence({ submitter: asDevice(acquirer), evidence })).toEqual(kept);
    // A second attestation of the same receipt is different evidence for the same delivery.
    advance(1000);
    const body = await deliveryAttestationBody({ receipt: evidence.receipt, attestedAt: clock() });
    const resigned = { ...evidence, attestation: { ...body, signature: await signCanonical(body, transfer.acquirerKey.privateKey, { domain: DELIVERY_ATTESTATION_SCHEMA }) } };
    await rejectsWith(rewards.recordDeliveryEvidence({ submitter: asDevice(acquirer), evidence: resigned }), 'delivery_evidence_exists');

    const stored = await rewards.getDeliveryEvidence(kept.deliveryId);
    expect(stored.evidence).toEqual(evidence);
    const validation = await rewards.validateWork({ offerId: 'offer_delivery', ...stored.evidence, idempotencyKey: 'claim:stored' });
    expect(validation).toMatchObject({ outcome: 'accepted', evidence: { acquirerAccountId: acquirer.account.accountId } });
    expect(await rewards.getDeliveryEvidence('dlv_missing')).toBeNull();
  });
});
