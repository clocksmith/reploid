// Fresh paths and ICE restart of an open connection in the swarm transport, on a scripted RTCPeerConnection.
// The same behaviour on real node WebRTC is in tests/integration/fresh-path-recovery.test.js.
import { afterEach, expect, it, vi } from 'vitest';
import { createWebRTCSwarm } from '../../packages/reploid/src/transport/swarm.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';

afterEach(() => vi.useRealTimers());

function fixture({ peerId = 'local', remotePeerId = 'remote' } = {}) {
  const sockets = [], connections = [], events = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    constructor() { sockets.push(this); }
    send = vi.fn();
    close() { this.readyState = 3; this.onclose?.(); }
    receive(message) { return this.onmessage({ data: JSON.stringify(message) }); }
  }
  const channel = label => Object.assign(new EventTarget(), { label, readyState: 'open', send: vi.fn(), close: vi.fn() });
  class Connection extends EventTarget {
    channel = channel('reploid');
    signalingState = 'stable'; iceConnectionState = 'connected'; connectionState = 'connected';
    created = [];
    constructor() { super(); connections.push(this); }
    close = vi.fn();
    restartIce = vi.fn();
    createDataChannel(label) { if (label === 'reploid') return this.channel; const made = channel(label); this.created.push(made); return made; }
    async createOffer(options) { this.lastOfferOptions = options; return { type: 'offer', sdp: 'offer-sdp' }; }
    async createAnswer() { return { type: 'answer', sdp: 'answer-sdp' }; }
    async setLocalDescription(description) {
      if (description.type === 'rollback') this.signalingState = 'stable';
      else this.signalingState = description.type === 'offer' ? 'have-local-offer' : 'stable';
      this.localDescription = description;
    }
    async setRemoteDescription(description) {
      this.signalingState = description.type === 'offer' ? 'have-remote-offer' : 'stable';
      this.remoteDescription = description;
    }
    async addIceCandidate() {}
    setIce(state) { this.iceConnectionState = state; this.dispatchEvent(new Event('iceconnectionstatechange')); }
  }
  const config = resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'test' },
    webrtc: { signalingUrl: 'wss://fixture.invalid', heartbeatIntervalMs: 60000, connectTimeoutMs: 5000 } } });
  const swarm = createWebRTCSwarm({ config, peerId, getSessionId: () => 'session',
    getRoomCredentials: () => ({ roomId: 'test', token: 'x'.repeat(32) }),
    WebSocket: Socket, RTCPeerConnection: Connection,
    Utils: { generateId: () => peerId, logger: { info() {}, debug() {}, warn() {}, error() {} } },
    EventBus: { emit: (...args) => events.push(args) } });
  async function open() {
    const pending = swarm.init(); sockets[0].onopen();
    await sockets[0].receive({ type: 'joined', peerId, roomId: 'test', peers: [remotePeerId] });
    await sockets[0].receive({ type: 'answer', peerId: remotePeerId, answer: { type: 'answer', sdp: 'first' } });
    connections[0].channel.onopen();
    expect(await pending).toBe(true);
    connections[0].channel.send.mockClear(); sockets[0].send.mockClear();
  }
  const sent = type => sockets[0].send.mock.calls.map(([value]) => JSON.parse(value)).filter(frame => frame.type === type);
  return { swarm, sockets, connections, events, open, sent, remotePeerId };
}

it('opens a fresh path on the same connection, sends on it while open, and falls back to the connection\'s own channel', async () => {
  const f = fixture();
  try {
    await f.open();
    const connection = f.connections[0];
    expect(await f.swarm.openFreshPath('remote')).toBe(1);
    expect(connection.created.map(item => item.label)).toEqual(['reploid-path-1']);
    expect(f.swarm.sendToPeer('remote', 'sync-request', {}, { path: 1 })).toBe(true);
    expect(connection.created[0].send).toHaveBeenCalledOnce();
    expect(connection.channel.send).not.toHaveBeenCalled();
    connection.created[0].readyState = 'closed'; connection.created[0].onclose();
    expect(f.swarm.sendToPeer('remote', 'sync-request', {}, { path: 1 })).toBe(true);
    expect(connection.channel.send).toHaveBeenCalledOnce();
    expect(f.connections).toHaveLength(1);
  } finally { f.swarm.disconnect(); }
});

it('accepts a peer\'s fresh path once, delivers its frames with the path number, and refuses a reused number', async () => {
  const f = fixture();
  try {
    await f.open();
    const delivered = [];
    f.swarm.onMessage('sync-request', (peerId, _payload, _envelope, context) => delivered.push([peerId, context.path]));
    const connection = f.connections[0];
    const incoming = Object.assign(new EventTarget(), { label: 'reploid-path-1', readyState: 'open', send: vi.fn(), close: vi.fn() });
    connection.ondatachannel({ channel: incoming });
    const envelope = JSON.parse((f.swarm.sendToPeer('remote', 'sync-request', {}), connection.channel.send.mock.calls[0][0]));
    incoming.onmessage({ data: JSON.stringify({ ...envelope, peerId: 'remote' }) });
    connection.channel.onmessage({ data: JSON.stringify({ ...envelope, peerId: 'remote' }) });
    expect(delivered).toEqual([['remote', 1], ['remote', 0]]);
    const reused = Object.assign(new EventTarget(), { label: 'reploid-path-1', readyState: 'open', send: vi.fn(), close: vi.fn() });
    connection.ondatachannel({ channel: reused });
    expect(reused.close).toHaveBeenCalledOnce();
    expect(incoming.close).not.toHaveBeenCalled();
  } finally { f.swarm.disconnect(); }
});

it('restarts ICE on the open connection through a marked offer over discovery, and settles once ICE is connected', async () => {
  const f = fixture();
  try {
    await f.open();
    const connection = f.connections[0];
    const restarted = f.swarm.restartPath('remote', { timeoutMs: 2000 });
    await vi.waitFor(() => expect(f.sent('offer')).toHaveLength(1));
    expect(connection.restartIce).toHaveBeenCalledOnce();
    expect(connection.lastOfferOptions).toEqual({ iceRestart: true });
    expect(f.sent('offer')[0]).toMatchObject({ targetPeer: 'remote', offer: { type: 'offer', sdp: 'offer-sdp', reploidRenegotiation: 1 } });
    connection.setIce('checking');
    await f.sockets[0].receive({ type: 'answer', peerId: 'remote', answer: { type: 'answer', sdp: 'restart-answer' } });
    connection.setIce('connected');
    expect(await restarted).toBe(true);
    expect(f.connections).toHaveLength(1);
    expect(connection.close).not.toHaveBeenCalled();
    expect(f.events).toContainEqual(['swarm:peer-path', expect.objectContaining({ peerId: 'remote', kind: 'ice-restart', ok: true })]);
  } finally { f.swarm.disconnect(); }
});

it('answers a marked renegotiation on the same connection, and still ignores an unmarked offer for an open one', async () => {
  const f = fixture({ peerId: 'zeta', remotePeerId: 'alpha' });
  try {
    await f.open();
    const connection = f.connections[0];
    await f.sockets[0].receive({ type: 'offer', peerId: 'alpha', offer: { type: 'offer', sdp: 'plain' } });
    expect(f.sent('answer')).toEqual([]);
    // Crossing restarts: the higher peer ID withdraws its own offer and answers the lower one's.
    void f.swarm.restartPath('alpha', { timeoutMs: 2000 });
    await vi.waitFor(() => expect(connection.signalingState).toBe('have-local-offer'));
    await f.sockets[0].receive({ type: 'offer', peerId: 'alpha', offer: { type: 'offer', sdp: 'restart', reploidRenegotiation: 1 } });
    expect(connection.remoteDescription).toEqual({ type: 'offer', sdp: 'restart' });
    expect(f.sent('answer')).toEqual([expect.objectContaining({ targetPeer: 'alpha', answer: { type: 'answer', sdp: 'answer-sdp' } })]);
    expect(f.connections).toHaveLength(1);
  } finally { f.swarm.disconnect(); }
});

it.each([[false, 'retires it at once'], [true, 'keeps it through one ICE restart']])(
  'on ICE failure, a connection with path recovery=%s %s', async (recovery) => {
    const f = fixture();
    try {
      await f.open();
      const connection = f.connections[0];
      if (recovery) f.swarm.allowPathRecovery('remote');
      connection.connectionState = 'failed'; connection.onconnectionstatechange();
      if (!recovery) {
        expect(connection.close).toHaveBeenCalledOnce();
        expect(f.sent('offer')).toEqual([]);
        return;
      }
      expect(connection.close).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(f.sent('offer').map(frame => frame.offer.reploidRenegotiation)).toEqual([1]));
      await f.sockets[0].receive({ type: 'answer', peerId: 'remote', answer: { type: 'answer', sdp: 'restart-answer' } });
      connection.connectionState = 'connected'; connection.setIce('connected');
      await vi.waitFor(() => expect(f.events.some(([name, detail]) => name === 'swarm:peer-path' && detail.ok === true)).toBe(true));
      expect(connection.close).not.toHaveBeenCalled();
      expect(f.swarm.getConnectedPeers().map(peer => peer.id)).toEqual(['remote']);
    } finally { f.swarm.disconnect(); }
  });

it('retires a failed connection whose ICE restart does not reconnect within its bound', async () => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    await f.open();
    const connection = f.connections[0];
    f.swarm.allowPathRecovery('remote');
    connection.connectionState = 'failed'; connection.onconnectionstatechange();
    await vi.advanceTimersByTimeAsync(4000);
    expect(connection.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(connection.close).toHaveBeenCalledOnce();
  } finally { f.swarm.disconnect(); }
});
