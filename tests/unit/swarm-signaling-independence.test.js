import { afterEach, expect, it, vi } from 'vitest';
import { createWebRTCSwarm } from '../../packages/reploid/src/transport/swarm.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';

afterEach(() => vi.useRealTimers());

function fixture() {
  const sockets = [], connections = [], events = [];
  class Socket {
    static OPEN = 1;
    readyState = 1;
    constructor() { sockets.push(this); }
    send = vi.fn();
    close() { this.readyState = 3; this.onclose?.(); }
    receive(message) { return this.onmessage({ data: JSON.stringify(message) }); }
  }
  class Connection {
    channel = { readyState: 'open', send: vi.fn(), close: vi.fn() };
    constructor() { connections.push(this); }
    close = vi.fn();
    createDataChannel() { return this.channel; }
    async createOffer() { return { type: 'offer', sdp: '' }; }
    async setLocalDescription() {}
  }
  const config = resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'test' },
    webrtc: { signalingUrl: 'wss://fixture.invalid', heartbeatIntervalMs: 100, peerTimeoutMs: 500,
      reconnectBaseMs: 1000 } } });
  const swarm = createWebRTCSwarm({ config, peerId: 'local', getSessionId: () => 'session',
    getRoomCredentials: () => ({ roomId: 'test', token: 'x'.repeat(32) }),
    WebSocket: Socket, RTCPeerConnection: Connection,
    Utils: { generateId: () => 'local', logger: { info() {}, debug() {}, warn() {}, error() {} } },
    EventBus: { emit: (...args) => events.push(args) } });
  async function open() {
    const pending = swarm.init(); sockets[0].onopen();
    await sockets[0].receive({ type: 'joined', peerId: 'local', roomId: 'test', peers: ['direct'] });
    connections[0].channel.onopen();
    expect(await pending).toBe(true);
    await sockets[0].receive({ type: 'peer-joined', peerId: 'relay', metadata: { transport: 'signaling-relay' } });
  }
  return { swarm, sockets, connections, events, open };
}

it.each(['close', 'error'])('keeps direct traffic and heartbeats after signaling %s, removes dependent relay routes', async failure => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    await f.open();
    if (failure === 'close') f.sockets[0].close(); else f.sockets[0].onerror(new Error('lost signaling'));
    expect(f.swarm.getConnectedPeers().map(p => p.id)).toEqual(['direct']);
    expect(f.swarm.sendToPeer('direct', 'sync-request', { test: true })).toBe(true);
    expect(f.swarm.sendToPeer('relay', 'sync-request', {})).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(f.connections[0].channel.send.mock.calls.map(([value]) => JSON.parse(value).type)).toContain('ping');
    expect(f.connections[0].close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(400);
    expect(f.connections[0].close).toHaveBeenCalledOnce();
    expect(f.events).toContainEqual(['swarm:peer-timeout', { peerId: 'direct' }]);
  } finally { f.swarm.disconnect(); }
  await vi.advanceTimersByTimeAsync(2000);
  expect(f.sockets).toHaveLength(1);
});

it('retains direct peers across directory departure and rejoin without replacing their channels', async () => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    await f.open();
    await f.sockets[0].receive({ type: 'peer-left', peerId: 'direct' });
    await f.sockets[0].receive({ type: 'peer-joined', peerId: 'direct', metadata: { transport: 'signaling-relay' } });
    expect(f.swarm.sendToPeer('direct', 'sync-request', {})).toBe(true);
    expect(f.connections[0].close).not.toHaveBeenCalled();
    f.sockets[0].close();
    for (let i = 0; i < 10; i++) {
      f.connections[0].channel.onmessage({ data: JSON.stringify({ protocolVersion: 1, type: 'pong',
        peerId: 'direct', timestamp: i, payload: { ts: Date.now() }, payloadSize: 0 }) });
      await vi.advanceTimersByTimeAsync(100);
    }
    f.sockets[1].onopen();
    await f.sockets[1].receive({ type: 'joined', peerId: 'local', roomId: 'test', peers: ['direct'] });
    expect(f.connections).toHaveLength(1);
    expect(f.swarm.getConnectedPeers().map(p => p.id)).toEqual(['direct']);
  } finally { f.swarm.disconnect(); }
  expect(f.connections[0].close).toHaveBeenCalledOnce();
});
