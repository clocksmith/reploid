import { describe, expect, it, vi } from 'vitest';
import { classifyConnectionPath, observeConnectionPath } from '../../packages/reploid/src/transport/connection-path.js';
import { createWebRTCSwarm } from '../../packages/reploid/src/transport/swarm.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { bindNetworkControls, projectNetworkPeers, renderConnectionControl,
  renderSharingControls } from '../../apps/poolday/ui/pool-home/network-controls.js';

const report = (local, remote, { transport = true, selected = false, extra = [] } = {}) => new Map([
  ...(transport ? [['T', { id: 'T', type: 'transport', selectedCandidatePairId: 'P' }]] : []),
  ['P', { id: 'P', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R', selected, nominated: true, state: 'succeeded' }],
  ...(local ? [['L', { id: 'L', type: 'local-candidate', candidateType: local }]] : []),
  ...(remote ? [['R', { id: 'R', type: 'remote-candidate', candidateType: remote }]] : []),
  ...extra
]);

describe('connection path classification', () => {
  it.each([
    ['host', 'host', 'direct'], ['srflx', 'prflx', 'direct'],
    ['relay', 'host', 'relayed'], ['srflx', 'relay', 'relayed'], ['relay', 'relay', 'relayed']
  ])('reads %s/%s on the selected pair as %s', (local, remote, expected) => {
    expect(classifyConnectionPath(report(local, remote))).toBe(expected);
  });

  it('accepts a pair marked selected when no transport record names one', () => {
    expect(classifyConnectionPath(report('relay', 'srflx', { transport: false, selected: true }))).toBe('relayed');
  });

  it('stays unknown rather than guessing', () => {
    expect(classifyConnectionPath(null)).toBeNull();
    expect(classifyConnectionPath(new Map())).toBeNull();
    // Nominated and succeeded, but nothing says it is the pair in use.
    expect(classifyConnectionPath(report('relay', 'relay', { transport: false }))).toBeNull();
    expect(classifyConnectionPath(report('host', null))).toBeNull();
    expect(classifyConnectionPath(report('host', 'unheard-of'))).toBeNull();
    expect(classifyConnectionPath(report('host', 'host', { extra: [
      ['T2', { id: 'T2', type: 'transport', selectedCandidatePairId: 'P' }]] }))).toBeNull();
    expect(classifyConnectionPath(new Map([['T', { type: 'transport', selectedCandidatePairId: 'gone' }]]))).toBeNull();
  });

  it('reports unknown when statistics are missing or fail', async () => {
    expect(await observeConnectionPath({})).toBeNull();
    expect(await observeConnectionPath({ getStats: async () => { throw new Error('closed'); } })).toBeNull();
    expect(await observeConnectionPath({ getStats: async () => report('relay', 'host') })).toBe('relayed');
  });
});

function swarmFixture(stats) {
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
    iceConnectionState = 'connected';
    constructor() { connections.push(this); }
    close = vi.fn();
    getStats = vi.fn(async () => stats.current);
    createDataChannel(label, options) {
      if (label === 'reploid') return this.channel;
      return Object.assign(new EventTarget(), { label, ...options, readyState: 'open', close: vi.fn(), send: vi.fn() });
    }
    async createOffer() { return { type: 'offer', sdp: '' }; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
  }
  const config = resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'test' },
    webrtc: { signalingUrl: 'wss://fixture.invalid', heartbeatIntervalMs: 100000, peerTimeoutMs: 500000, reconnectBaseMs: 1000 } } });
  const swarm = createWebRTCSwarm({ config, peerId: 'local', getSessionId: () => 'session',
    getRoomCredentials: () => ({ roomId: 'test', token: 'x'.repeat(32) }),
    WebSocket: Socket, RTCPeerConnection: Connection,
    Utils: { generateId: () => 'local', logger: { info() {}, debug() {}, warn() {}, error() {} } },
    EventBus: { emit: (...args) => events.push(args) } });
  async function open() {
    const pending = swarm.init(); sockets[0].onopen();
    await sockets[0].receive({ type: 'joined', peerId: 'local', roomId: 'test', peers: ['remote'] });
    connections[0].channel.onopen();
    await pending;
  }
  return { swarm, connections, events, open };
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
const pathOf = swarm => swarm.getPeerStates().find(peer => peer.id === 'remote').path;

describe('swarm peer state', () => {
  it('records the observed path once the channel opens and re-reads it on ICE changes', async () => {
    const stats = { current: report('relay', 'srflx') };
    const f = swarmFixture(stats);
    try {
      await f.open(); await settle();
      expect(pathOf(f.swarm)).toBe('relayed');
      const progress = f.events.filter(([name]) => name === 'swarm:peer-progress').length;
      stats.current = report('host', 'host');
      f.connections[0].oniceconnectionstatechange(); await settle();
      expect(pathOf(f.swarm)).toBe('direct');
      expect(f.events.filter(([name]) => name === 'swarm:peer-progress').length).toBeGreaterThan(progress);
      stats.current = new Map();
      f.connections[0].oniceconnectionstatechange(); await settle();
      expect(pathOf(f.swarm)).toBeNull();
    } finally { f.swarm.disconnect(); }
  });

  it('leaves the path unknown when statistics do not name the pair in use', async () => {
    const f = swarmFixture({ current: report('relay', 'relay', { transport: false }) });
    try { await f.open(); await settle(); expect(pathOf(f.swarm)).toBeNull(); }
    finally { f.swarm.disconnect(); }
  });
});

describe('Computers panel', () => {
  const mount = state => {
    const session = { getState: () => state, subscribe(listener) { session.update = listener; listener(state); return () => {}; } };
    const root = document.createElement('div');
    root.innerHTML = renderConnectionControl() + renderSharingControls()
      + '<ul data-insp-device-list></ul><span data-network-message></span><button data-mesh-invite></button><span data-mesh-peers></span>';
    return { root, session, dispose: bindNetworkControls(root, session) };
  };

  it('labels a relayed or direct connection in Details and leaves an unknown one unlabelled', () => {
    const state = { models: [], network: { connections: [
      { id: 'a', attemptId: '1', phase: 'connected', path: 'relayed' },
      { id: 'b', attemptId: '2', phase: 'connected', path: 'direct' },
      { id: 'c', attemptId: '3', phase: 'connected', path: null },
      { id: 'd', attemptId: '4', phase: 'negotiating', path: 'relayed' },
      { id: 'e', attemptId: '5', phase: 'connected', path: 'something-else' }
    ], consumer: { peers: [{ peerId: 'a', attemptId: '1', model: 'Qwen', readiness: 'ready' }] } } };
    expect(projectNetworkPeers(state).map(peer => peer.connectionPath)).toEqual(['relayed', 'direct', null, null, null]);
    const view = mount(state);
    try {
      const label = id => view.root.querySelector(`[data-computer-id="${id}"] details [data-computer-path]`);
      expect(label('a').textContent).toBe('Relayed connection'); expect(label('a').hidden).toBe(false);
      expect(label('b').textContent).toBe('Direct connection');
      for (const id of ['c', 'd', 'e']) { expect(label(id).textContent).toBe(''); expect(label(id).hidden).toBe(true); }
      state.network.connections[0] = { id: 'a', attemptId: '1', phase: 'connected', path: null }; view.session.update(state);
      expect(label('a').textContent).toBe(''); expect(label('a').hidden).toBe(true);
    } finally { view.dispose(); }
  });
});
