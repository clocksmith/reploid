import { test } from 'node:test';
import assert from 'node:assert/strict';
import policy from '../../self/config/swarm-bootstrap.json' with { type: 'json' };
import { resolveSwarmJoin, resolveSwarmSignalingUrl } from '../../self/capabilities/communication/swarm-join-policy.js';
import { resolveDopplerBrowserAssets, DOPPLER_MODULE_URL } from '../../self/config/doppler-local-models.js';
import { startSwarmAutoconnect } from '../../self/host/swarm-autoconnect.js';
import { createWebRTCSwarm } from '../../packages/reploid/src/transport/swarm.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';

const storage = values => ({ getItem: key => values[key] ?? null });
const location = search => ({ href: 'https://replo.id/' + search });
const join = (search = '', values = {}) => resolveSwarmJoin({ location: location(search), storage: storage(values), policy });

test('public defaults ignore saved private rooms and signaling alone; opt-out is explicit', () => {
  for (const query of ['', '?swarm=public', '?signaling=wss://example.com/swarm']) {
    assert.deepEqual(join(query, { REPLOID_SWARM_ROOM_ID: 'secret' }), {
      scope: 'public', roomId: policy.publicRoomId, token: policy.publicJoinMarker, autoConnect: true
    });
  }
  for (const query of ['?swarm=off', '?swarm=false']) assert.equal(join(query).autoConnect, false);
  assert.equal(join('', { REPLOID_SWARM_ENABLED: 'false' }).autoConnect, false);
  const publicUrl = resolveSwarmSignalingUrl({ location: location(''), policy, join: join(''), privateOverride: 'wss://evil.invalid' });
  assert.equal(publicUrl, policy.signalingUrl + '?scope=public');
});

test('private invitations require their scoped capability and preserve their endpoint', () => {
  assert.throws(() => join('?swarm=private-room'), /capability/);
  assert.throws(() => join('?room=private-room', { REPLOID_SWARM_ROOM_TOKEN: 'x'.repeat(32) }), /capability/);
  const invited = join('?swarm=private-room&swarmToken=' + 'a'.repeat(32));
  assert.equal(invited.scope, 'private');
  assert.equal(invited.roomId, 'reploid-swarm-private-room');
  const endpoint = resolveSwarmSignalingUrl({ location: location(''), policy, join: invited, privateOverride: 'wss://private.example/swarm' });
  assert.equal(endpoint, 'wss://private.example/swarm?scope=private');
});

test('assets stay origin-relative in Node and obsolete saved defaults cannot win', () => {
  assert.equal(DOPPLER_MODULE_URL, '/vendor/doppler/0.6.2/src/index.js');
  for (const pageUrl of ['https://replo.id/', 'http://localhost:8000/']) {
    for (const storedBase of [null, '/doppler', 'https://cdn.jsdelivr.net/npm/doppler-gpu@0.6.2']) {
      const assets = resolveDopplerBrowserAssets({ pageUrl, storedBase });
      assert.equal(assets.moduleUrl, new URL(DOPPLER_MODULE_URL, pageUrl).href);
    }
    assert.equal(resolveDopplerBrowserAssets({ pageUrl, explicitBase: '/doppler' }).baseUrl, new URL('/doppler', pageUrl).href);
  }
  assert.equal(resolveDopplerBrowserAssets({ pageUrl: 'https://replo.id/', storedBase: 'https://dev.example/runtime' }).baseUrl, 'https://dev.example/runtime');
  assert.equal(resolveDopplerBrowserAssets({ pageUrl: 'https://replo.id/', explicitBase: '/doppler', storedBase: 'http://[' }).baseUrl, 'https://replo.id/doppler');
  assert.equal(resolveDopplerBrowserAssets({ pageUrl: 'https://replo.id/', storedBase: 'file:///obsolete' }).moduleUrl, 'https://replo.id' + DOPPLER_MODULE_URL);
});

test('autoconnect coalesces retries, pauses, resumes and disposes listeners', async () => {
  const timers = new Map(); let id = 0, calls = 0, reject;
  const events = new EventTarget();
  const controller = startSwarmAutoconnect({ policy, eventTarget: events, enabled: () => true,
    isConnected: () => false, random: () => 0.5, onError: () => {},
    connect: () => { calls++; return new Promise((_, fail) => { reject = fail; }); },
    setTimer: (fn, delay) => { timers.set(++id, { fn, delay }); return id; }, clearTimer: key => timers.delete(key) });
  const run = () => { const [key, timer] = timers.entries().next().value; timers.delete(key); return timer.fn(); };
  const pending = run(); await Promise.resolve();
  events.dispatchEvent(new Event('online')); await run();
  assert.equal(calls, 1);
  reject(new Error('offline')); await pending;
  assert.equal([...timers.values()][0].delay, 1000);
  controller.pause(); assert.equal(timers.size, 0);
  controller.resume(); assert.equal(timers.size, 1);
  controller.close(); events.dispatchEvent(new Event('online')); assert.equal(timers.size, 0);
});

function transportFixture(overrides = {}) {
  const sockets = [];
  class Socket {
    static OPEN = 1;
    constructor() { sockets.push(this); this.readyState = 0; }
    send(value) { this.sent = JSON.parse(value); }
    close() { this.readyState = 3; this.onclose?.(); }
    open() { this.readyState = 1; this.onopen?.(); }
    message(message) { return this.onmessage?.({ data: JSON.stringify(message) }); }
  }
  const transport = createWebRTCSwarm({
    config: resolveConfig({ overrides: { mesh: { enabled: true, roomId: policy.publicRoomId },
      webrtc: { signalingUrl: policy.signalingUrl, connectTimeoutMs: 30, reconnectBaseMs: 20 } } }),
    WebSocket: Socket, Utils: { logger: { info() {}, warn() {}, debug() {}, error() {} }, generateId: () => 'peer-test' },
    EventBus: { emit() {} }, getSessionId: () => 'session',
    getRoomCredentials: () => ({ roomId: policy.publicRoomId, token: policy.publicJoinMarker }),
    ...overrides
  });
  return { transport, sockets };
}

test('socket open is connecting; only a matching acknowledgement establishes joined', async () => {
  const { transport, sockets } = transportFixture();
  const pending = transport.init(); sockets[0].open();
  assert.equal(transport.getConnectionState(), 'connecting');
  await sockets[0].message({ type: 'joined', peerId: 'peer-test', roomId: policy.publicRoomId, peers: [] });
  assert.equal(await pending, true);
  assert.equal(transport.getConnectionState(), 'connected');
  assert.deepEqual(transport.getConnectedPeers(), []);
  transport.disconnect();
});

test('rejected, mismatched and timed-out joins fail and disconnect prevents retry', async () => {
  for (const message of [{ type: 'error', error: 'denied' }, { type: 'joined', peerId: 'wrong', roomId: policy.publicRoomId, peers: [] }, null]) {
    const { transport, sockets } = transportFixture();
    const pending = transport.init(); sockets[0].open();
    if (message) await sockets[0].message(message);
    assert.equal(await pending, false);
    assert.equal(transport.getConnectionState(), 'retrying');
    transport.disconnect();
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(sockets.length, 1);
    assert.equal(transport.getConnectionState(), 'stopped');
  }
});

test('disconnect during initialization settles immediately and ignores a late acknowledgement', async () => {
  const { transport, sockets } = transportFixture();
  const pending = transport.init(); transport.disconnect();
  assert.equal(await pending, false);
  sockets[0].open();
  await sockets[0].message({ type: 'joined', peerId: 'peer-test', roomId: policy.publicRoomId, peers: [] });
  assert.equal(transport.getConnectionState(), 'stopped');
});

test('asynchronous negotiation failures are caught and enter bounded reconnect', async () => {
  const { transport, sockets } = transportFixture({ RTCPeerConnection: class {
    async setRemoteDescription() { throw new Error('Bad remote description'); }
    close() {}
  } });
  const pending = transport.init(); sockets[0].open();
  await sockets[0].message({ type: 'joined', peerId: 'peer-test', roomId: policy.publicRoomId, peers: [] });
  assert.equal(await pending, true);
  await sockets[0].message({ type: 'offer', peerId: 'other', offer: {} });
  assert.equal(transport.getConnectionState(), 'retrying');
  transport.disconnect();
});

test('a disconnect from a state listener cannot start a late socket', async () => {
  const fixture = transportFixture({ EventBus: { emit(type, state) {
    if (type === 'swarm:state-change' && state.state === 'connecting') fixture.transport.disconnect();
  } } });
  assert.equal(await fixture.transport.init(), false);
  assert.equal(fixture.sockets.length, 0);
});

test('both negotiation roles obtain fresh host RTC credentials without persisting them', async () => {
  const configurations = [];
  let calls = 0;
  class PeerConnection {
    constructor(config) { configurations.push(config); }
    createDataChannel() { return { close() {} }; }
    async createOffer() { return {}; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    async createAnswer() { return {}; }
    close() {}
  }
  const { transport, sockets } = transportFixture({ RTCPeerConnection: PeerConnection,
    getRtcConfig: async () => ({ iceServers: [{ urls: 'turn:test.invalid', credential: String(++calls) }] }) });
  try {
    const pending = transport.init(); sockets[0].open();
    await sockets[0].message({ type: 'joined', peerId: 'peer-test', roomId: policy.publicRoomId, peers: ['first'] });
    assert.equal(await pending, true);
    await sockets[0].message({ type: 'offer', peerId: 'second', offer: {} });
    assert.deepEqual(configurations.map(c => c.iceServers[0].credential), ['1', '2']);
    assert.equal(JSON.stringify(transport.getStats()).includes('turn:test.invalid'), false);
  } finally { transport.disconnect(); }
});

test('disconnect retires a pending RTC credential request before it can construct a peer', async () => {
  let resolveRtc;
  let constructions = 0;
  const { transport, sockets } = transportFixture({
    getRtcConfig: () => new Promise(resolve => { resolveRtc = resolve; }),
    RTCPeerConnection: class { constructor() { constructions++; } }
  });
  const pending = transport.init(); sockets[0].open();
  const negotiating = sockets[0].message({ type: 'joined', peerId: 'peer-test', roomId: policy.publicRoomId, peers: ['other'] });
  assert.equal(await pending, true);
  transport.disconnect();
  resolveRtc({ iceServers: [] });
  await negotiating;
  assert.equal(constructions, 0);
  assert.equal(transport.getConnectionState(), 'stopped');
});

test('RTC credential failures use the existing reconnect lifecycle without an uncredentialed fallback', async () => {
  let constructions = 0;
  const { transport, sockets } = transportFixture({
    getRtcConfig: async () => { throw new Error('RTC authorization unavailable'); },
    RTCPeerConnection: class { constructor() { constructions++; } }
  });
  const pending = transport.init(); sockets[0].open();
  await sockets[0].message({ type: 'joined', peerId: 'peer-test', roomId: policy.publicRoomId, peers: ['other'] });
  await pending;
  assert.equal(constructions, 0);
  assert.equal(transport.getConnectionState(), 'retrying');
  transport.disconnect();
});

test('WebRTC carries request cancellation to the peer job owner', async () => {
  const channel = { close() {} };
  const disconnected = [];
  class PeerConnection {
    createDataChannel() { return channel; }
    async createOffer() { return {}; }
    async setLocalDescription() {}
    close() {}
  }
  const { transport, sockets } = transportFixture({ RTCPeerConnection: PeerConnection,
    EventBus: { emit(type, payload) { if (type === 'swarm:peer-disconnected') disconnected.push(payload.peerId); } } });
  const delivered = [];
  transport.onMessage('reploid:generation-cancel', (peer, payload) => delivered.push({ peer, payload }));
  try {
    const pending = transport.init(); sockets[0].open();
    await sockets[0].message({ type: 'joined', peerId: 'peer-test', roomId: policy.publicRoomId, peers: ['other'] });
    await pending;
    const payload = { requestId: 'only-this-attempt' };
    channel.onmessage({ data: JSON.stringify({ protocolVersion: 1, type: 'reploid:generation-cancel',
      peerId: 'other', timestamp: 1, payload, payloadSize: JSON.stringify(payload).length }) });
    assert.deepEqual(delivered, [{ peer: 'other', payload }]);
    assert.equal(transport.getStats().rejected, 0);
    channel.onopen();
    assert.equal(transport.getConnectedPeers().length, 1);
    channel.onclose();
    assert.deepEqual(disconnected, ['other']);
    assert.deepEqual(transport.getConnectedPeers(), []);
  } finally { transport.disconnect(); }
});
