// @vitest-environment node
import { it, expect } from 'vitest';
import { createPairingNetwork } from '../fixtures/owner-pairing-webrtc.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { openOwnerPairing } from '../../server/circles/owner-pairing.js';
import { requestOwnerPairing } from '../../packages/reploid/src/transport/index.js';

it('pairs only after local approval and preserves the authenticated desktop and owner across new RTC sessions', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'reploid-owner-pairing-'));
  const file = path.join(directory, 'owner-pairing.sqlite');
  const desktop = await createSigningIdentity({ algorithm: 'Ed25519' });
  const phone = await createSigningIdentity({ algorithm: 'ECDSA' });
  const turn = process.env.REPLOID_OWNER_PAIRING_TURN;
  const network = createPairingNetwork(turn);
  const { start, signaling } = network;
  let pairing;
  try {
    let request = Promise.withResolvers(), now = Date.now();
    pairing = await openOwnerPairing({ file, hostParticipantId: desktop.peerId, now: () => now, onRequest: value => request.resolve(value) });
    const desk = await start('desktop-a', desktop);
    pairing.attach(desk);
    const mobile = await start('phone-a', phone);
    await expect.poll(() => mobile.transport.getPeerBinding('desktop-a')).not.toBeNull();
    if (turn) await expect.poll(() => mobile.transport.getPeerStates().find(peer => peer.id === 'desktop-a')?.path).toBe('relayed');
    const offer = pairing.issue();
    const send = (inputs = {}) => requestOwnerPairing({ ...mobile, hostPeer: 'desktop-a', ...offer,
      signal: AbortSignal.timeout(2500), ...inputs });
    await expect(send({ hostParticipantId: phone.peerId })).rejects.toThrow('Could not verify the paired desktop');
    const pending = send();
    const observed = await request.promise;
    expect(observed.participantId).toBe(phone.peerId);
    expect(pairing.isOwner(phone.peerId)).toBe(false);
    expect(pairing.decide(observed.requestId, true)).toBe(true);
    expect(await pending).toEqual({ hostParticipantId: desktop.peerId });
    expect(pairing.isOwner(phone.peerId)).toBe(true);
    await expect(send({ signal: AbortSignal.timeout(350) })).rejects.toThrow();
    expect(JSON.stringify(signaling)).not.toContain(offer.code);
    expect(signaling.every(message => ['join', 'leave', 'heartbeat', 'offer', 'answer', 'ice-candidate'].includes(message.type))).toBe(true);

    request = Promise.withResolvers();
    const expiring = pairing.issue();
    const expired = send({ code: expiring.code });
    const declined = expect(expired).rejects.toThrow('Desktop declined owner pairing');
    const next = await request.promise;
    now = expiring.expiresAt;
    expect(pairing.decide(next.requestId, true)).toBe(false);
    await declined;

    const prior = mobile.transport.getPeerBinding('desktop-a');
    pairing.close(); desk.close(); mobile.close();
    pairing = await openOwnerPairing({ file, hostParticipantId: desktop.peerId });
    const returned = await start('desktop-b', desktop);
    pairing.attach(returned);
    const reconnected = await start('phone-b', phone);
    await expect.poll(() => reconnected.transport.getPeerBinding('desktop-b')).not.toBeNull();
    if (turn) await expect.poll(() => reconnected.transport.getPeerStates().find(peer => peer.id === 'desktop-b')?.path).toBe('relayed');
    expect(reconnected.transport.getPeerBinding('desktop-b')).not.toEqual(prior);
    expect(await reconnected.verifyPeer('desktop-b')).toBe(desktop.peerId);
    expect(pairing.isOwner(await returned.verifyPeer('phone-b'))).toBe(true);
    await expect(openOwnerPairing({ file, hostParticipantId: phone.peerId })).rejects.toThrow('belongs to another desktop');
  } finally {
    pairing?.close();
    network.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
