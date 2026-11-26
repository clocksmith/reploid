// A fresh page in a room whose directory lists several computers and one other browser (an introducer).
// Synthetic sockets and connections; contacts and introductions are the real signed records.
import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createWebRTCSwarm } from '../../packages/reploid/src/transport/swarm.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createPeerIntroductions, INTRODUCTION_CONTACT, INTRODUCTION_SIGNAL } from '../../packages/reploid/src/transport/introductions.js';
import { createContact } from '../../packages/reploid/src/transport/introduction-records.js';
import policy from '../../packages/reploid/src/transport/introduction-policy.json' with { type: 'json' };

vi.stubGlobal('crypto', webcrypto);
afterEach(() => vi.useRealTimers());

const SDP = 'v=0\r\na=fingerprint:sha-256 ' + Array(32).fill('ab').join(':') + '\r\n';
// The page's ID sorts below the computers' IDs, so it is the side that would introduce them.
const PAGE = 'page-1', BROWSER = 'browser-0', COMPUTERS = ['peer-a', 'peer-b'];

async function freshPage({ peerId = PAGE } = {}) {
  const sockets = [], connections = [], warnings = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    constructor() { sockets.push(this); }
    send = vi.fn();
    close() { this.readyState = 3; this.onclose?.(); }
    receive(message) { return this.onmessage({ data: JSON.stringify(message) }); }
  }
  class Connection {
    constructor() { connections.push(this); this.channel = null; this.signalingState = 'stable'; }
    close = vi.fn(() => { this.signalingState = 'closed'; });
    createDataChannel(label) {
      this.channel = { label, readyState: 'connecting', send: vi.fn(), close: vi.fn() };
      return this.channel;
    }
    async createOffer() { return { type: 'offer', sdp: SDP }; }
    async createAnswer() { return { type: 'answer', sdp: SDP }; }
    async setLocalDescription(description) { this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable'; }
    async setRemoteDescription(description) { this.remoteDescription = description; this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable'; }
    async addIceCandidate() {}
  }
  const identity = await createSigningIdentity({ algorithm: 'ECDSA' });
  const config = resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'test' },
    webrtc: { signalingUrl: 'wss://fixture.invalid', heartbeatIntervalMs: 30000, peerTimeoutMs: 60000,
      reconnectBaseMs: 1000, connectTimeoutMs: 30000 } } });
  const swarm = createWebRTCSwarm({ config, peerId, getSessionId: () => 'session',
    getRoomCredentials: () => ({ roomId: 'test', token: 'x'.repeat(32) }),
    WebSocket: Socket, RTCPeerConnection: Connection,
    introductions: { getIdentity: () => identity, authorize: async () => true },
    Utils: { generateId: () => peerId, logger: { info() {}, debug() {}, error() {}, warn: (...args) => warnings.push(args.join(' ')) } },
    EventBus: { emit() {} } });
  const pending = swarm.init();
  await vi.waitFor(() => expect(sockets).toHaveLength(1));
  sockets[0].onopen();
  const byPeer = new Map();
  const join = async peers => {
    await sockets[0].receive({ type: 'joined', peerId, roomId: 'test', peers });
    peers.forEach((remote, index) => byPeer.set(remote, connections[index]));
    expect(await pending).toBe(true);
  };
  const open = remote => { const { channel } = byPeer.get(remote); channel.readyState = 'open'; channel.onopen(); };
  const sentTypes = remote => byPeer.get(remote).channel.send.mock.calls.map(([data]) => JSON.parse(data).type);
  const offersTo = remote => sockets[0].send.mock.calls.map(([data]) => JSON.parse(data))
    .filter(frame => frame.type === 'offer' && frame.targetPeer === remote);
  return { swarm, sockets, connections, warnings, byPeer, join, open, sentTypes, offersTo };
}

// A contact record for a computer, as the introducer forwards it.
async function computerContact(peerId) {
  const identity = await createSigningIdentity({ algorithm: 'ECDSA' });
  const { record } = await createContact({ identity, peerId, roomId: 'test', sequence: Date.now(), policy, now: Date.now() });
  return { identity, record };
}

it('a contact forwarded by the first open browser does not replace the direct negotiations still opening', async () => {
  const page = await freshPage();
  try {
    await page.join([BROWSER, ...COMPUTERS]);
    page.open(BROWSER);
    const contacts = await Promise.all(COMPUTERS.map(computerContact));
    const introductions = page.swarm.getIntroductions();
    for (const { record } of contacts) await introductions.receive(BROWSER, INTRODUCTION_CONTACT, { contact: record, forwarded: true });
    // Before the fix each computer's opening connection was closed and an introduced one opened in its place.
    for (const computer of COMPUTERS) expect(page.byPeer.get(computer).close).not.toHaveBeenCalled();
    expect(page.connections).toHaveLength(3);
    expect(introductions.getState()).toMatchObject({ contacts: 2, pending: 0 });
    // The direct negotiations finish as usual.
    for (const computer of COMPUTERS) page.open(computer);
    expect(page.swarm.getConnectedPeers().map(peer => peer.id).sort()).toEqual([BROWSER, ...COMPUTERS].sort());
  } finally { page.swarm.disconnect(); }
});

it('announces the page contact only once its direct negotiations have settled', async () => {
  const page = await freshPage();
  try {
    await page.join([BROWSER, ...COMPUTERS]);
    page.open(BROWSER);
    await new Promise(resolve => setTimeout(resolve, 50));
    // An introducer that had it would forward it, and a computer with a lower ID would introduce itself.
    expect(page.sentTypes(BROWSER)).not.toContain(INTRODUCTION_CONTACT);
    page.open(COMPUTERS[0]);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(page.sentTypes(BROWSER)).not.toContain(INTRODUCTION_CONTACT);
    page.open(COMPUTERS[1]);
    await vi.waitFor(() => {
      for (const remote of [BROWSER, ...COMPUTERS]) expect(page.sentTypes(remote)).toContain(INTRODUCTION_CONTACT);
    });
  } finally { page.swarm.disconnect(); }
});

it('a direct negotiation that times out releases the contact for introductions', async () => {
  vi.useFakeTimers();
  const page = await freshPage();
  try {
    await page.join([BROWSER, COMPUTERS[0]]);
    page.open(BROWSER);
    await vi.advanceTimersByTimeAsync(0);
    expect(page.sentTypes(BROWSER)).not.toContain(INTRODUCTION_CONTACT);
    await vi.advanceTimersByTimeAsync(30000);
    expect(page.byPeer.get(COMPUTERS[0]).close).toHaveBeenCalled();
    await vi.waitFor(() => expect(page.sentTypes(BROWSER)).toContain(INTRODUCTION_CONTACT));
  } finally { page.swarm.disconnect(); }
});

it('broadcasts reach open channels only and never warn about peers still opening', async () => {
  const page = await freshPage();
  try {
    await page.join([BROWSER, ...COMPUTERS]);
    expect(page.swarm.broadcast('ping', { ts: 1 })).toBe(0);
    page.open(BROWSER);
    expect(page.swarm.broadcast('ping', { ts: 2 })).toBe(1);
    expect(page.sentTypes(BROWSER)).toContain('ping');
    // sendToPeer still reports an explicit send to a peer that is not open.
    expect(page.swarm.sendToPeer(COMPUTERS[0], 'ping', {})).toBe(false);
    expect(page.warnings.filter(line => line.includes('Cannot send'))).toHaveLength(1);
  } finally { page.swarm.disconnect(); }
});

it('a computer whose introduction never completes is offered again directly, even from the higher peer ID', async () => {
  vi.useFakeTimers();
  // The page sorts above the computer, so only the computer could introduce it; its introduction then stalls.
  const page = await freshPage({ peerId: 'zz-page' });
  try {
    const computer = 'computer-a';
    await page.join([BROWSER, computer]);
    page.open(BROWSER);
    const { identity } = await computerContact(computer);
    const transport = { getPeerId: () => computer, getConnectedPeers: () => [], onMessage() {}, sendToPeer: () => true,
      connectIntroducedPeer: async (remote, exchange) => exchange.publish({ type: 'offer', offer: { type: 'offer', sdp: SDP } }),
      acceptIntroductionSignal: async () => {} };
    const remote = await createPeerIntroductions({ transport, identity, roomId: 'test', authorize: async () => true });
    const packets = [];
    await remote.connect(page.swarm.getIntroductions().exportContact(), envelope => { packets.push(envelope); return true; });
    await vi.waitFor(() => expect(packets).toHaveLength(1));
    await page.swarm.getIntroductions().receive(BROWSER, INTRODUCTION_SIGNAL, { ...packets[0], forwarded: true });
    // The computer's introduction replaced the page's direct negotiation (its side had abandoned it).
    await vi.waitFor(() => expect(page.connections).toHaveLength(3));
    expect(page.byPeer.get(computer).close).toHaveBeenCalled();
    const before = page.offersTo(computer).length;
    // The introduced connection never opens; after the negotiation deadline the page offers directly again.
    await vi.advanceTimersByTimeAsync(30000 + 1000 + 10);
    expect(page.offersTo(computer).length).toBe(before + 1);
    expect(page.connections).toHaveLength(4);
    remote.close();
  } finally { page.swarm.disconnect(); }
});
