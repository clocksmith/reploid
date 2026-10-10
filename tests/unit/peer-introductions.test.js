// Native WebCrypto with synthetic channels; browser transport is checked separately.
import { expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createPeerIntroductions, INTRODUCTION_CONTACT, INTRODUCTION_SIGNAL } from '../../packages/reploid/src/transport/introductions.js';
import { createContact, verifyContact, sealIntroduction, verifyIntroduction, openIntroduction }
  from '../../packages/reploid/src/transport/introduction-records.js';
import policy from '../../packages/reploid/src/transport/introduction-policy.json' with { type: 'json' };
vi.stubGlobal('crypto', webcrypto);
const identity = () => createSigningIdentity({ algorithm: 'ECDSA' });
const sdp = { type: 'offer', sdp: 'a=fingerprint:sha-256 ' + Array(32).fill('ab').join(':') };

it('authenticates encrypted endpoint negotiation and rejects mutation, wrong recipients and expiry', async () => {
  const a = await identity(), b = await identity(), c = await identity();
  const make = id => createContact({ identity: id, peerId: id.peerId, roomId: 'room', sequence: 1, now: 100, policy });
  const ac = await make(a), bc = await make(b), cc = await make(c);
  const payload = { type: 'offer', offer: sdp, attemptId: crypto.randomUUID() };
  const sealed = await sealIntroduction({ identity: a, contact: ac, recipient: bc.record, payload, policy, now: 100 });
  expect(JSON.stringify(sealed)).not.toContain('fingerprint');
  const checked = await verifyIntroduction(sealed, { roomId: 'room', policy, now: 101 });
  expect(await openIntroduction(checked, bc)).toEqual(payload);
  await expect(openIntroduction(checked, cc)).rejects.toThrow('recipient');
  const corrupt = structuredClone(sealed); corrupt.body.to = c.peerId;
  await expect(verifyIntroduction(corrupt, { roomId: 'room', policy, now: 101 })).rejects.toThrow('signature');
  await expect(verifyIntroduction(sealed, { roomId: 'other', policy, now: 101 })).rejects.toThrow();
  await expect(verifyIntroduction(sealed, { roomId: 'room', policy, now: 40000 })).rejects.toThrow('lifetime');
  const forged = structuredClone(ac.record); forged.body.peerId = 'victim';
  await expect(verifyContact(forged, { roomId: 'room', policy, now: 101 })).rejects.toThrow('signature');
});

async function endpoint(id, options = {}) {
  const signer = await identity(), received = [], published = [], errors = [];
  const transport = { _getPeerId: () => id, getConnectedPeers: () => [], onMessage() {},
    sendToPeer: (...args) => { published.push(args); return true; },
    connectIntroducedPeer: vi.fn(async (remote, exchange) => exchange.publish({ type: 'offer', offer: sdp })),
    acceptIntroductionSignal: vi.fn(async (...args) => { received.push(args); }), cancelIntroduction: vi.fn(), ...options.transport };
  const authorize = options.authorize || vi.fn(async () => true);
  const controller = await createPeerIntroductions({ ...options, transport, identity: signer, roomId: 'room', authorize,
    onError: error => errors.push(error.message) });
  return { controller, signer, transport, authorize, received, published, errors };
}

it('carries a verified offer through one introducer, rejects replay and additional forwarding', async () => {
  const a = await endpoint('a'), b = await endpoint('b'), relay = await endpoint('relay', {
    transport: { getConnectedPeers: () => [{ id: 'a' }, { id: 'b' }] } });
  try {
    const packets = [];
    await a.controller.connect(b.controller.exportContact(), envelope => { packets.push(envelope); return true; });
    await relay.controller.receive('a', INTRODUCTION_SIGNAL, packets[0]);
    const [recipient, type, forwarded] = relay.published[0];
    expect(recipient).toBe('b'); expect(forwarded.forwarded).toBe(true);
    await b.controller.receive('relay', type, forwarded);
    expect(b.received[0][0]).toBe('a'); expect(b.received[0][1].offer).toEqual(sdp);
    await expect(b.controller.receive('relay', type, forwarded)).rejects.toThrow('Replayed');
    const secondRelay = await endpoint('second');
    try { await expect(secondRelay.controller.receive('relay', type, forwarded)).rejects.toThrow('forwarding limit'); }
    finally { secondRelay.controller.close(); }
  } finally { a.controller.close(); b.controller.close(); relay.controller.close(); }
});

it('requires admission and forwarding grants and snapshots incoming contact records', async () => {
  const a = await endpoint('a'), deny = await endpoint('deny', { authorize: async () => false });
  try {
    await expect(deny.controller.connect(a.controller.exportContact(), () => true)).rejects.toThrow('denied');
    expect(deny.transport.connectIntroducedPeer).not.toHaveBeenCalled();
    const b = await endpoint('b');
    try {
      const input = { contact: a.controller.exportContact(), forwarded: false };
      const accepting = b.controller.receive('a', INTRODUCTION_CONTACT, input);
      input.contact.body.peerId = 'tampered';
      await accepting;
      expect(b.controller.getState().contacts).toBe(1);
    } finally { b.controller.close(); }
  } finally { a.controller.close(); deny.controller.close(); }
});

it('bounds concurrent authorization, rejects sequence rollback, and invalidates in-flight work on close', async () => {
  const a = await endpoint('a');
  let release;
  const b = await endpoint('b', { policy: { ...policy, maxPending: 1 },
    authorize: () => new Promise(resolve => { release = resolve; }) });
  try {
    const waiting = b.controller.connect(a.controller.exportContact(), () => true);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    await expect(b.controller.connect(a.controller.exportContact(), () => true)).rejects.toThrow('rate limit');
    b.controller.close(); release(true);
    await expect(waiting).rejects.toThrow('closed');
    expect(b.transport.connectIntroducedPeer).not.toHaveBeenCalled();
  } finally { a.controller.close(); b.controller.close(); }
});

it('rejects contact rollback and signed descriptions without a unique certificate fingerprint', async () => {
  const a = await endpoint('a'), b = await endpoint('b');
  try {
    const fresh = await createContact({ identity: a.signer, peerId: 'a', roomId: 'room', sequence: Date.now() + 1, policy });
    const old = a.controller.exportContact();
    await b.controller.receive('a', INTRODUCTION_CONTACT, { contact: fresh.record, forwarded: false });
    await expect(b.controller.receive('a', INTRODUCTION_CONTACT, { contact: old, forwarded: false })).rejects.toThrow('Stale contact');
    const sender = await createContact({ identity: a.signer, peerId: 'a', roomId: 'room', sequence: fresh.record.body.sequence + 1, policy });
    const record = await sealIntroduction({ identity: a.signer, contact: sender, recipient: b.controller.exportContact(),
      payload: { type: 'offer', offer: { type: 'offer', sdp: 'v=0' }, attemptId: crypto.randomUUID() }, policy });
    await expect(b.controller.receive('a', INTRODUCTION_SIGNAL, { record, forwarded: false })).rejects.toThrow('fingerprint');
    expect(b.transport.acceptIntroductionSignal).not.toHaveBeenCalled();
  } finally { a.controller.close(); b.controller.close(); }
});

it('proves private-room admission without a service, rejects wrong capabilities and binds the entire contact', async () => {
  const { createRoomIntroductionAdmission } = await import('../../packages/reploid/src/transport/introduction-admission.js');
  const token = 'private-capability-'.repeat(3), admission = createRoomIntroductionAdmission({ roomId: 'room', token });
  const stranger = createRoomIntroductionAdmission({ roomId: 'room', token: 'different-capability-'.repeat(3) });
  const signer = await identity();
  const contact = await createContact({ identity: signer, peerId: 'private', roomId: 'room', sequence: 1, policy,
    createAdmission: admission.create });
  expect(await admission.verify(contact.record)).toBe(true);
  expect(await stranger.verify(contact.record)).toBe(false);
  expect(JSON.stringify(contact.record)).not.toContain(token);
  contact.record.body.encryptionKey.x = 'changed';
  expect(await admission.verify(contact.record)).toBe(false);
});

it('cancels an introduction while admission is pending without starting a late connection', async () => {
  const a = await endpoint('a');
  let release;
  const b = await endpoint('b', { authorize: () => new Promise(resolve => { release = resolve; }) });
  const abort = new AbortController();
  try {
    const pending = b.controller.connect(a.controller.exportContact(), () => true, abort.signal);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    abort.abort(); release(true);
    await expect(pending).rejects.toThrow();
    expect(b.transport.connectIntroducedPeer).not.toHaveBeenCalled();
    expect(b.controller.getState().pending).toBe(0);
  } finally { a.controller.close(); b.controller.close(); }
});

it('invalidates an exchange while the transport is obtaining connection configuration', async () => {
  const a = await endpoint('a');
  let exchange, release;
  const b = await endpoint('b', { transport: { connectIntroducedPeer: vi.fn(async (_, value) => {
    exchange = value; await new Promise(resolve => { release = resolve; });
  }) } });
  const abort = new AbortController();
  try {
    const pending = b.controller.connect(a.controller.exportContact(), () => true, abort.signal);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    expect(exchange.isActive()).toBe(true);
    abort.abort();
    expect(exchange.isActive()).toBe(false);
    release(); await expect(pending).rejects.toThrow();
    expect(b.transport.cancelIntroduction).toHaveBeenCalledWith('a', exchange.attemptId);
    expect(b.controller.getState().pending).toBe(0);
  } finally { a.controller.close(); b.controller.close(); }
});
