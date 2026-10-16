import { it, expect, vi } from 'vitest';
import { createMeshPeerIdentity } from '../../packages/reploid/src/mesh/peer-identity.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';

async function fixture() {
  const keys = await Promise.all(['ECDSA', 'Ed25519'].map(algorithm => createSigningIdentity({ algorithm })));
  const handlers = [new Map(), new Map()], messages = [];
  let hold = false;
  const bindings = [{ local: 'certificate-a', remote: 'certificate-b' }, { local: 'certificate-b', remote: 'certificate-a' }];
  const transports = [0, 1].map(i => ({
    getPeerBinding: () => structuredClone(bindings[i]), _getPeerId: () => 'connection-' + i,
    onMessage: (type, fn) => handlers[i].set(type, fn),
    sendToPeer(peerId, type, payload) {
      messages.push({ i, peerId, type, payload });
      if (!hold) queueMicrotask(() => handlers[1 - i].get(type)?.('connection-' + i, structuredClone(payload)));
      return true;
    }
  }));
  const owners = transports.map((transport, i) => createMeshPeerIdentity({ transport,
    getIdentity: () => keys[i], roomId: 'room', timeoutMs: 1000, maxPending: 4 }));
  return { owners, keys, handlers, messages, bindings, hold: () => { hold = true; }, close: () => owners.forEach(owner => owner.close()) };
}

it('verifies the signing identity on the bound channel using fresh proof each time', async () => {
  const f = await fixture();
  try {
    expect(await f.owners[0].verify('connection-1')).toBe(f.keys[1].peerId);
    expect(await f.owners[1].verify('connection-0')).toBe(f.keys[0].peerId);
    expect(await f.owners[0].verify('connection-1')).toBe(f.keys[1].peerId);
    expect(new Set(f.messages.filter(m => m.type.endsWith('challenge')).map(m => m.payload.nonce)).size).toBe(3);
  } finally { f.close(); }
});

it('answers concurrent fresh challenges from the same connection within the pending bound', async () => {
  const f = await fixture();
  try {
    const responses = await Promise.all(Array.from({ length: 4 }, () => f.owners[0].verify('connection-1')));
    expect(responses).toEqual(Array(4).fill(f.keys[1].peerId));
    const challenges = f.messages.filter(message => message.type.endsWith('challenge'));
    const proofs = f.messages.filter(message => message.type.endsWith('proof'));
    expect(new Set(challenges.map(message => message.payload.nonce)).size).toBe(4);
    expect(proofs.map(message => message.payload.nonce).sort())
      .toEqual(challenges.map(message => message.payload.nonce).sort());
  } finally { f.close(); }
});

it('deduplicates a challenge that arrives again while its proof is being signed', async () => {
  const f = await fixture();
  try {
    f.hold();
    const pending = f.owners[0].verify('connection-1');
    const challenge = f.messages.at(-1).payload;
    const answer = f.handlers[1].get('reploid:identity-challenge');
    answer('connection-0', structuredClone(challenge));
    answer('connection-0', structuredClone(challenge));
    await vi.waitFor(() => expect(f.messages.filter(message => message.type.endsWith('proof'))).toHaveLength(1));
    const proof = f.messages.find(message => message.type.endsWith('proof')).payload;
    f.handlers[0].get('reploid:identity-proof')('connection-1', proof);
    await expect(pending).resolves.toBe(f.keys[1].peerId);
  } finally { f.close(); }
});

it('rejects a replayed signature under a fresh challenge and a changed connection', async () => {
  const f = await fixture();
  try {
    await f.owners[0].verify('connection-1');
    const prior = f.messages.find(m => m.type.endsWith('proof')).payload;
    f.hold();
    const pending = f.owners[0].verify('connection-1');
    const rejected = expect(pending).rejects.toThrow('Invalid recipient identity proof');
    const nonce = f.messages.at(-1).payload.nonce;
    f.handlers[0].get('reploid:identity-proof')('connection-1', { ...prior, nonce });
    await rejected;
    const changed = f.owners[0].verify('connection-1');
    const stopped = expect(changed).rejects.toThrow('peer disconnected');
    f.owners[0].retirePeer('connection-1'); await stopped;
  } finally { f.close(); }
});

it('does not prove a recipient without a channel binding and cancels pending verification', async () => {
  const f = await fixture();
  try {
    f.bindings[0] = null;
    expect(await f.owners[0].verify('connection-1')).toBeNull();
    f.bindings[0] = { local: 'new-a', remote: 'new-b' }; f.hold();
    const controller = new AbortController();
    const request = f.owners[0].verify('connection-1', controller.signal);
    const stopped = expect(request).rejects.toThrow('Stopped');
    controller.abort(new Error('Stopped')); await stopped;
  } finally { f.close(); }
});

it('rejects a valid signature when the channel changes while proof is in flight', async () => {
  const f = await fixture();
  const handler = f.handlers[0].get('reploid:identity-proof');
  f.handlers[0].set('reploid:identity-proof', (peer, proof) => {
    f.bindings[0].remote = 'replacement-certificate'; handler(peer, proof);
  });
  try { await expect(f.owners[0].verify('connection-1')).rejects.toThrow('Recipient connection changed'); }
  finally { f.close(); }
});
