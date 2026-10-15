// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const ports = vi.hoisted(() => ({ exchange: vi.fn() }));
vi.mock('../../self/vendor/reploid/artifacts/custody/exchange.js', () => ({ createCustodyExchange: ports.exchange }));
vi.mock('../../self/infrastructure/pack-transfer-storage.js', () => ({ openPeerPackFileCheckpoints: async () => ({ close: async () => {} }) }));

import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import {
  CUSTODY_CERTIFICATE_LIFETIME_MS, checkCustodyKeyCertificate
} from '../../self/vendor/reploid/artifacts/custody-certificate.js';
import { createWorkModelFiles } from '../../self/host/work-model-files.js';

let captured;
beforeEach(() => {
  captured = null;
  ports.exchange.mockReset();
  ports.exchange.mockImplementation((options) => {
    captured = options;
    return { announce() {}, getState: () => ({}), close: async () => {} };
  });
});
afterEach(() => vi.useRealTimers());

const transport = { onDataChannel() {}, _getPeerId: () => 'browser-transport' };
const check = (certificate, identity) => checkCustodyKeyCertificate(certificate, {
  publicJwk: identity.publicJwk, atMs: Date.now(), maxLifetimeMs: CUSTODY_CERTIFICATE_LIFETIME_MS, maxClockSkewMs: 0
});

it('certifies the browser custody key with the persistent identity and renews it at half-life', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-14T12:00:00.000Z') });
  const identity = await createSigningIdentity({ algorithm: 'ECDSA' });
  const files = createWorkModelFiles({ getTransport: () => transport, getIdentity: () => identity });
  await files.attach();
  const custodyKey = captured.identity;
  expect(custodyKey.peerId).toBe('browser-transport');

  const certificate = await captured.ports.certificate();
  expect(certificate).toMatchObject({
    participantId: identity.peerId, custodyPeerId: 'browser-transport', custodyPublicKey: custodyKey.publicKey,
    issuedAt: '2026-10-14T12:00:00.000Z', expiresAt: new Date(Date.now() + CUSTODY_CERTIFICATE_LIFETIME_MS).toISOString()
  });
  expect(await check(certificate, identity)).toEqual([]);
  expect(await files.custodyCertificate()).toBe(certificate);

  vi.setSystemTime(Date.now() + CUSTODY_CERTIFICATE_LIFETIME_MS / 2 - 1);
  expect(await captured.ports.certificate()).toBe(certificate);
  vi.setSystemTime(Date.now() + 2);
  const renewed = await captured.ports.certificate();
  expect(renewed.certificateId).not.toBe(certificate.certificateId);
  expect(renewed.custodyPublicKey).toBe(custodyKey.publicKey);
  expect(await check(renewed, identity)).toEqual([]);

  // Transfer evidence from the exchange is retained for whoever submits the claim.
  const record = { role: 'requester', transferId: 'transfer_1', certificates: { requester: renewed, supplier: null } };
  captured.ports.observeDelivery(record);
  expect(files.getDeliveryEvidence()).toEqual([record]);
  await files.close();
});

it('leaves custody keys uncertified without a persistent identity', async () => {
  const files = createWorkModelFiles({ getTransport: () => transport });
  expect(await files.custodyCertificate()).toBeNull();
  await files.attach();
  expect(await captured.ports.certificate()).toBeNull();
  expect(await files.custodyCertificate()).toBeNull();
  await files.close();
});
