import { afterEach, expect, it, vi } from 'vitest';
import { createWebRTCSwarm } from '../../packages/reploid/src/transport/swarm.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';

afterEach(() => vi.useRealTimers());

it('renews existing peer credentials without replacing channels, coalesces refresh and retries failure', async () => {
  vi.useFakeTimers();
  let socket, connection, release;
  const initial = { iceServers: [{ urls: 'turn:fixture.invalid', credential: 'initial' }] };
  const renewed = { iceServers: [{ urls: 'turn:fixture.invalid', credential: 'renewed' }] };
  class Socket {
    static OPEN = 1;
    readyState = 1;
    constructor() { socket = this; }
    send() {}
    close() { this.readyState = 3; }
  }
  class Connection {
    constructor() { connection = this; }
    setConfiguration = vi.fn();
    close = vi.fn();
    createDataChannel() { return { readyState: 'open', send() {}, close() {} }; }
    async createOffer() { return { type: 'offer', sdp: '' }; }
    async setLocalDescription() {}
  }
  const getRtcConfig = vi.fn().mockResolvedValue(initial);
  const config = resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'test' },
    webrtc: { signalingUrl: 'wss://fixture.invalid', heartbeatIntervalMs: 100, peerTimeoutMs: 10000 } } });
  const swarm = createWebRTCSwarm({ config, peerId: 'local', getSessionId: () => 'session',
    getRoomCredentials: () => ({ roomId: 'test', token: 'x'.repeat(32) }), getRtcConfig,
    WebSocket: Socket, RTCPeerConnection: Connection,
    Utils: { generateId: () => 'local', logger: { info() {}, debug() {}, warn() {}, error() {} } },
    EventBus: { emit() {} } });
  try {
    const opening = swarm.init(); socket.onopen();
    await socket.onmessage({ data: JSON.stringify({ type: 'joined', peerId: 'local', roomId: 'test', peers: ['remote'] }) });
    expect(await opening).toBe(true);
    getRtcConfig.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    await vi.advanceTimersByTimeAsync(300);
    expect(getRtcConfig).toHaveBeenCalledTimes(2);
    release(renewed); await vi.advanceTimersByTimeAsync(0);
    expect(connection.setConfiguration).toHaveBeenCalledExactlyOnceWith(renewed);
    expect(connection.close).not.toHaveBeenCalled();
    getRtcConfig.mockRejectedValueOnce(Error('issuer unavailable')).mockResolvedValue(renewed);
    await vi.advanceTimersByTimeAsync(200);
    expect(connection.setConfiguration).toHaveBeenCalledTimes(1);
    expect(connection.close).not.toHaveBeenCalled();
    swarm.disconnect();
    const calls = getRtcConfig.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(getRtcConfig).toHaveBeenCalledTimes(calls);
  } finally { swarm.disconnect(); }
});
