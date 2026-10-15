// @vitest-environment node
// A real custody transfer between a browser identity and a native identity: the exchange
// carries each party's certificate, and the requester's delivery evidence becomes a
// verified-delivery claim that rewards attribute through the account ports.
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCustodyKeyCertifier } from '../../packages/reploid/src/artifacts/custody-certificate.js';
import { createCustodyExchange } from '../../packages/reploid/src/artifacts/custody/exchange.js';
import { createCustodyContracts } from '../../packages/reploid/src/artifacts/custody/runtime.js';
import { createSigningKeyPair, exportPublicKey, sha256Hex, signCanonical, verifyCanonicalSignature } from '../../packages/reploid/src/artifacts/signatures.js';
import { DELIVERY_ATTESTATION_SCHEMA, deliveryAttestationBody } from '../../server/rewards/custody-evidence.js';
import { createPeerPackDataChannel } from '../../self/pool/peer-pack-data-channel.js';
import { executablePacksMatch, hashDopplerEvidence, validateExecutablePack } from '../../self/pool/executable-pack.js';
import { newIdentity, openAccountFixture, registerDevice, signInAs } from '../helpers/account-fixture.js';
import { MIN, advance, at, clock, codes, fx, ownerAuthorization, rejectsWith } from '../helpers/reward-fixture.js';

const contracts = createCustodyContracts({ hashDopplerEvidence, validateExecutablePack, executablePacksMatch, sha256Hex, signCanonical, verifyCanonicalSignature });
const BYTES = new Uint8Array([1, 2, 3, 4, 5]);

function channelPair() {
  const channels = [new EventTarget(), new EventTarget()];
  for (const [i, channel] of channels.entries()) Object.assign(channel, {
    ordered: true, maxRetransmits: null, maxPacketLifeTime: null, readyState: 'open', bufferedAmount: 0,
    send(data) { queueMicrotask(() => channels[1 - i].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) }))); },
    close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); }
  });
  return channels;
}

/** Two exchanges on one fake transport: 0 acquires from 1. `identities[i]` null leaves that key uncertified. */
async function transferPiece(identities) {
  const file = { path: 'piece.bin', role: 'model-weights', sizeBytes: BYTES.length, hash: (await sha256Hex(BYTES)).slice(7), hashAlgorithm: 'sha256' };
  const policy = { maxTransfers: 2, maxPeers: 4, maxAcquisitionAttempts: 2, maxSupplyBytes: 100, maxArtifactBytes: 20, maxInventoryFiles: 8, grantMs: 5 * MIN,
    channel: { maxFrameBytes: 128, maxControlBytes: 4096, maxChunkBytes: 2, maxBufferedBytes: 8192, maxPendingRequests: 2, maxTransferBytes: 1 << 20, timeoutMs: 1000 } };
  const handlers = [new Map(), new Map()], callbacks = [], keys = [], deliveries = [], owners = [];
  for (const i of [0, 1]) {
    const pair = await createSigningKeyPair();
    keys[i] = { peerId: `transport-${i}`, publicKey: await exportPublicKey(pair.publicKey), privateKey: pair.privateKey };
    const certifier = identities[i] && createCustodyKeyCertifier({ identity: identities[i], now: () => fx.nowMs });
    let reserved = 0;
    const transport = {
      _getPeerId: () => keys[i].peerId,
      getConnectedPeers: () => [{ id: `transport-${1 - i}` }],
      onMessage: (type, handler) => handlers[i].set(type, handler),
      sendToPeer: (peer, type, payload) => { queueMicrotask(() => handlers[1 - i].get(type)?.(keys[i].peerId, structuredClone(payload))); return true; },
      broadcast(type, payload) { this.sendToPeer(`transport-${1 - i}`, type, payload); },
      onDataChannel: (_, callback) => { callbacks[i] = callback; return () => {}; },
      openDataChannel() { const [left, right] = channelPair(); callbacks[1 - i](keys[i].peerId, right); return left; }
    };
    owners.push(createCustodyExchange({ transport, identity: keys[i], policy, ports: {
      now: () => fx.nowMs,
      supplyBudget: { getState: () => ({ reservedBytes: reserved, maxBytes: 100 }), async reserve(bytes) { reserved += bytes; return this.getState(); } },
      createSupplier: contracts.createPeerPackSupplier, createStore: contracts.createPeerPackArtifactStore, createChannel: createPeerPackDataChannel,
      readArtifact: async () => BYTES.slice(),
      async verifyArtifact(descriptor, data) { if (await sha256Hex(data) !== 'sha256:' + descriptor.hash) throw new Error('integrity'); },
      hash: hashDopplerEvidence, hashBytes: sha256Hex,
      observeDelivery: (record) => deliveries.push(record),
      ...(certifier ? { certificate: () => certifier.certify({ custodyPeerId: keys[i].peerId, custodyPublicKey: keys[i].publicKey }) } : {})
    } }));
  }
  try {
    owners[1].offer([file]);
    await vi.waitFor(() => expect(owners[0].has(file)).toBe(true));
    await owners[0].acquire(file, { signal: new AbortController().signal });
  } finally { await Promise.all(owners.map((owner) => owner.close())); }
  return { record: deliveries.find((row) => row.role === 'requester'), acquirerKey: keys[0] };
}

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

  /** The claim the acquirer submits: its delivery evidence plus its attestation of the receipt. */
  async function claimFrom({ record, acquirerKey }, offerId, overrides = {}) {
    const body = await deliveryAttestationBody({ receipt: record.receipt, attestedAt: clock() });
    return {
      offerId, artifactId: record.authorization.artifactSet.artifacts[0].artifactId,
      authorization: record.authorization, index: record.index, receipt: record.receipt,
      attestation: { ...body, signature: await signCanonical(body, acquirerKey.privateKey, { domain: DELIVERY_ATTESTATION_SCHEMA }) },
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
});
