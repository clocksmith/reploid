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
    channel = { label: 'reploid', readyState: 'open', send: vi.fn(), close: vi.fn() };
    constructor() { connections.push(this); }
    close = vi.fn();
    createDataChannel(label, options) {
      if (label === 'reploid') return this.channel;
      return Object.assign(new EventTarget(), { label, ...options, readyState: 'open',
        close: vi.fn(), send: vi.fn(), maxRetransmits: null, maxPacketLifeTime: null });
    }
    async createOffer() { return { type: 'offer', sdp: '' }; }
    async createAnswer() { return { type: 'answer', sdp: '' }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
  }
  const config = resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'test' },
    webrtc: { signalingUrl: 'wss://fixture.invalid', heartbeatIntervalMs: 100, peerTimeoutMs: 500,
      reconnectBaseMs: 1000 } } });
  const swarm = createWebRTCSwarm({ config, peerId: 'local', getSessionId: () => 'session',
    getRoomCredentials: () => ({ roomId: 'test', token: 'x'.repeat(32) }),
    WebSocket: Socket, RTCPeerConnection: Connection,
    Utils: { generateId: () => 'local', logger: { info() {}, debug() {}, warn() {}, error() {} } },
    EventBus: { emit: (...args) => events.push(args) } });
  async function open(incoming = false) {
    const pending = swarm.init(); sockets[0].onopen();
    await sockets[0].receive({ type: 'joined', peerId: 'local', roomId: 'test', peers: incoming ? [] : ['direct'] });
    if (incoming) {
      await sockets[0].receive({ type: 'offer', peerId: 'direct', offer: { type: 'offer', sdp: '' } });
      connections[0].ondatachannel({ channel: connections[0].channel });
    }
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

it.each([false, true])('allows transient ICE recovery within the liveness deadline (incoming=%s)', async incoming => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    await f.open(incoming);
    const connection = f.connections[0];
    connection.connectionState = 'disconnected'; connection.onconnectionstatechange();
    await vi.advanceTimersByTimeAsync(300);
    expect(connection.close).not.toHaveBeenCalled();
    expect(connection.channel.close).not.toHaveBeenCalled();
    connection.connectionState = 'connected'; connection.onconnectionstatechange();
    connection.channel.onmessage({ data: JSON.stringify({ protocolVersion: 1, type: 'pong',
      peerId: 'direct', timestamp: 1, payload: { ts: Date.now() }, payloadSize: 0 }) });
    await vi.advanceTimersByTimeAsync(300);
    expect(f.swarm.sendToPeer('direct', 'sync-request', {})).toBe(true);
    expect(connection.close).not.toHaveBeenCalled();
  } finally { f.swarm.disconnect(); }
});

it.each([false, true])('still retires an unresponsive disconnected peer at the existing deadline (incoming=%s)', async incoming => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    await f.open(incoming);
    const connection = f.connections[0];
    connection.connectionState = 'disconnected'; connection.onconnectionstatechange();
    expect(connection.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(connection.close).toHaveBeenCalledOnce();
    expect(f.swarm.sendToPeer('direct', 'sync-request', {})).toBe(false);
    expect(f.events).toContainEqual(['swarm:peer-timeout', { peerId: 'direct' }]);
  } finally { f.swarm.disconnect(); }
});

it.each(['failed', 'closed', 'manual'])('retires a peer immediately on %s during ICE interruption', async reason => {
  vi.useFakeTimers();
  const f = fixture();
  try {
    await f.open();
    const connection = f.connections[0];
    connection.connectionState = 'disconnected'; connection.onconnectionstatechange();
    expect(connection.close).not.toHaveBeenCalled();
    if (reason === 'manual') f.swarm.disconnect();
    else { connection.connectionState = reason; connection.onconnectionstatechange(); }
    expect(connection.close).toHaveBeenCalledOnce();
    expect(f.swarm.sendToPeer('direct', 'sync-request', {})).toBe(false);
  } finally { f.swarm.disconnect(); }
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

it('admits through an injected introduction adapter without a WebSocket or company credential port', async () => {
  let listener;
  const unsubscribe = vi.fn(), messages = [];
  const adapter = { subscribe: callback => { listener = callback; return unsubscribe; },
    publish: message => { messages.push(message); if (message.type === 'join') queueMicrotask(() => listener({ ...message, type: 'joined', peers: [] })); } };
  const swarm = createWebRTCSwarm({
    config: resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'independent' }, webrtc: { sessionId: 'local' } } }),
    peerId: 'local', signalingAdapter: adapter,
    Utils: { generateId: () => 'local', logger: { info() {}, debug() {}, warn() {}, error() {} } }, EventBus: { emit() {} },
    WebSocket: class { constructor() { throw new Error('Company signaling blocked'); } }
  });
  try { expect(await swarm.init()).toBe(true); expect(messages).toContainEqual({ type: 'join', peerId: 'local', roomId: 'independent' }); }
  finally { swarm.disconnect(); }
  expect(unsubscribe).toHaveBeenCalledOnce();
  await listener({ type: 'joined', peerId: 'local', roomId: 'independent', peers: ['late'] });
  expect(swarm.getConnectedPeers()).toEqual([]);
});


it('admits only registered bounded job channels and closes them on peer shutdown', async () => {
  const f = fixture(), handler = vi.fn();
  try {
    await f.open();
    const connection = f.connections[0];
    const unregistered = connection.createDataChannel('reploid-jobs', { ordered: true });
    connection.ondatachannel({ channel: unregistered });
    expect(unregistered.close).toHaveBeenCalledOnce();
    f.swarm.onDataChannel('reploid-jobs', handler);
    const channel = connection.createDataChannel('reploid-jobs', { ordered: true });
    connection.ondatachannel({ channel });
    expect(handler).toHaveBeenCalledWith('direct', channel);
    const duplicate = connection.createDataChannel('reploid-jobs', { ordered: true });
    connection.ondatachannel({ channel: duplicate });
    expect(duplicate.close).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledOnce();
    expect(() => f.swarm.onDataChannel('arbitrary-work', handler)).toThrow('Explicit auxiliary');
    expect(() => f.swarm.openDataChannel('direct', 'arbitrary-work')).toThrow('Connected WebRTC');
    f.swarm.disconnect();
    expect(connection.close).toHaveBeenCalled();
    const late = connection.createDataChannel('reploid-jobs', { ordered: true });
    connection.ondatachannel({ channel: late });
    expect(late.close).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledOnce();
    expect(() => f.swarm.openDataChannel('direct', 'reploid-jobs')).toThrow('Connected WebRTC');
  } finally { f.swarm.disconnect(); }
});

it('creates dedicated job channels with the existing reliable ordered delivery contract', async () => {
  const f = fixture();
  try {
    await f.open();
    const channel = f.swarm.openDataChannel('direct', 'reploid-jobs');
    expect(channel).toMatchObject({ label: 'reploid-jobs', ordered: true,
      maxRetransmits: null, maxPacketLifeTime: null });
    expect(() => f.swarm.openDataChannel('direct', 'reploid-jobs')).toThrow('duplicate auxiliary');
  } finally { f.swarm.disconnect(); }
});
