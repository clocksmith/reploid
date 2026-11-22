// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createBrowserOwnerPairing } from '../../apps/poolday/host/owner-pairing.js';
import { openOwnerPairing } from '../../server/circles/owner-pairing.js';
import { createOwnerPairingTerminal } from '../../server/circles/owner-pairing-terminal.js';
import { createPairingNetwork } from '../fixtures/owner-pairing-webrtc.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key)
  };
}

it('pairs browser controller to verified desktop over WebRTC, survives reload and desktop restart, and reports offline when absent', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'reploid-browser-pairing-'));
  const file = path.join(directory, 'owner-pairing.sqlite');
  const [desktop, otherDesktop, phone] = await Promise.all([
    createSigningIdentity({ algorithm: 'Ed25519' }),
    createSigningIdentity({ algorithm: 'Ed25519' }),
    createSigningIdentity({ algorithm: 'ECDSA' })
  ]);
  const storage = memoryStorage();
  const rtcMesh = createPairingNetwork();
  let pairing = null;
  let activePhone = null;

  const channelFor = () => activePhone ? {
    transport: activePhone.transport,
    verifyPeer: activePhone.verifyPeer,
    currentPeer: activePhone.currentPeer,
    getPeers: () => activePhone.transport.getConnectedPeers().map(peer => ({ peerId: peer.id, readiness: 'ready', model: 'qwen-3-5-0-8b' })),
    getPeerStates: () => activePhone.transport.getPeerStates()
  } : null;

  try {
    let pendingRequest = Promise.withResolvers();
    pairing = await openOwnerPairing({
      file,
      hostParticipantId: desktop.peerId,
      onRequest: req => pendingRequest.resolve(req)
    });
    const desk = await rtcMesh.start('desktop-1', desktop);
    pairing.attach(desk);
    const other = await rtcMesh.start('other-desktop-1', otherDesktop);
    activePhone = await rtcMesh.start('phone-1', phone);
    await expect.poll(() => activePhone.transport.getPeerBinding('desktop-1')).not.toBeNull();
    await expect.poll(() => activePhone.transport.getPeerBinding('other-desktop-1')).not.toBeNull();

    const browser = createBrowserOwnerPairing({ storage, getChannel: channelFor });
    expect(browser.state().status).toBe('unpaired');

    const offer = pairing.issue();
    const pairPromise = browser.pair({
      hostParticipantId: desktop.peerId,
      hostLabel: "Alex's PC",
      code: offer.code,
      signal: AbortSignal.timeout(4000)
    });
    const observed = await pendingRequest.promise;
    expect(observed.participantId).toBe(phone.peerId);
    expect(browser.state().status).toBe('pairing');
    expect(pairing.pendingRequests()).toEqual([{ requestId: observed.requestId, participantId: phone.peerId, expiresAt: observed.expiresAt }]);
    // The desktop owner answers the single waiting request with y.
    const written = [];
    createOwnerPairingTerminal({ pairing, write: line => written.push(line) }).handleLine('approve next');
    expect(written).toEqual(['Phone paired.']);
    expect(pairing.pendingRequests()).toEqual([]);
    const paired = await pairPromise;
    expect(paired.hostParticipantId).toBe(desktop.peerId);
    expect(paired.disclosure.readableBy).toBe("Readable by: Alex's PC");

    // Online state pins the verified desktop and never stores the one-time pairing code.
    expect(browser.state()).toMatchObject({
      status: 'online',
      paired: true,
      canSend: true,
      hostParticipantId: desktop.peerId,
      hostLabel: "Alex's PC",
      readyModel: 'qwen-3-5-0-8b'
    });
    expect(JSON.stringify(storage.getItem('reploid.owner-paired-desktop:v1'))).not.toContain(offer.code);

    // Reused code is rejected without disturbing the pairing.
    await expect(browser.pair({
      hostParticipantId: desktop.peerId,
      code: offer.code,
      signal: AbortSignal.timeout(400)
    })).rejects.toThrow();

    // Stop the paired desktop while otherDesktop stays online: browser MUST show offline (no substitute!).
    desk.close();
    pairing.close();
    await expect.poll(() => browser.state().status).toBe('offline');
    expect(browser.state().canSend).toBe(false);

    // Simulate phone reload + network change + desktop restart under fresh DTLS sessions.
    activePhone.close();
    browser.close();
    pairing = await openOwnerPairing({ file, hostParticipantId: desktop.peerId });
    const returnedDesk = await rtcMesh.start('desktop-2', desktop);
    pairing.attach(returnedDesk);
    activePhone = await rtcMesh.start('phone-2', phone);
    await expect.poll(() => activePhone.transport.getPeerBinding('desktop-2')).not.toBeNull();
    expect(await activePhone.verifyPeer('desktop-2')).toBe(desktop.peerId);
    expect(pairing.isOwner(await returnedDesk.verifyPeer('phone-2'))).toBe(true);

    const reloadedBrowser = createBrowserOwnerPairing({ storage, getChannel: channelFor });
    expect(reloadedBrowser.state()).toMatchObject({
      status: 'online',
      paired: true,
      canSend: true,
      hostParticipantId: desktop.peerId,
      hostLabel: "Alex's PC"
    });
    other.close();
    reloadedBrowser.close();
  } finally {
    pairing?.close();
    rtcMesh.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
