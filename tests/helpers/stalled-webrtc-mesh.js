// @vitest-environment node
// A whole-model mesh on real node WebRTC (@roamhq/wrtc) and the real discovery server, with a requester
// whose data channels can be stalled. A stall holds every frame the requester sends or receives on the
// affected channels and releases them, in order, when it ends: `stream` stalls only each connection's own
// `reploid` channel (one SCTP stream stuck behind its own retransmissions), `path` stalls every channel of
// the connection until an ICE restart of it is answered (the network path itself is stuck), and either
// ends at `ms` regardless, as SCTP eventually delivers. Frames are held above SCTP: channel setup itself
// is not delayed. `reportIce` makes the requester's transport report that ICE state during a stall.
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import rtcModule from '@roamhq/wrtc';
import { WebSocket } from 'ws';
import { expect, vi } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createPeerGenerationMesh } from '../../packages/reploid/src/mesh/peer-generation.js';
import { createSwarmTransport } from '../../packages/reploid/src/transport/index.js';
import { createNativeRtcAdapter } from '../../server/native-rtc-adapter.js';
import { PublicSwarmServer } from '../../server/public-swarm-server.js';
import bootstrap from '../../shared/config/swarm-bootstrap.json' with { type: 'json' };

const rtc = createNativeRtcAdapter(rtcModule.default ?? rtcModule);
export const MODEL = Object.freeze({ id: 'model', identity: 'sha256:' + 'b'.repeat(64) });
const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map(level => [level, () => {}]));
class OriginWebSocket extends WebSocket {
  constructor(url, protocols) { super(url, protocols, { headers: { origin: 'http://localhost:8000' } }); }
}
const ufrag = sdp => /a=ice-ufrag:(\S+)/.exec(sdp || '')?.[1] ?? null;

function createStall() {
  const held = [];
  let mode = null, timer = null;
  const state = { started: 0, released: null, curedBy: null };
  const release = reason => {
    if (!mode) return;
    mode = null; clearTimeout(timer); timer = null;
    state.released = performance.now(); state.curedBy = reason;
    for (const run of held.splice(0)) run();
  };
  Object.defineProperty(state, 'mode', { get: () => mode });
  return Object.assign(state, {
    start(next, ms) { mode = next; state.started = performance.now(); state.released = null; timer = setTimeout(() => release('timeout'), ms); },
    holds: label => mode === 'path' || mode === 'stream' && label === 'reploid',
    hold: run => held.push(run),
    release
  });
}

// Requester-side RTCPeerConnection: every channel's sends and deliveries pass through the stall.
function stallableRtc(stall, labels) {
  const wrap = channel => {
    const send = channel.send.bind(channel);
    channel.send = data => {
      if (!stall.holds(channel.label)) return send(data);
      stall.hold(() => { if (channel.readyState === 'open') send(data); });
    };
    let handler = null;
    const deliver = event => {
      if (!handler) return;
      if (!stall.holds(channel.label)) return handler.call(channel, event);
      stall.hold(() => handler?.call(channel, event));
    };
    // wrtc dispatches to whatever `onmessage` reads as, so a getter can stand between it and the swarm.
    Object.defineProperty(channel, 'onmessage', { configurable: true, get: () => handler ? deliver : null, set: fn => { handler = fn; } });
    return channel;
  };
  class RTCPeerConnection extends rtc.RTCPeerConnection {
    constructor(...args) {
      super(...args);
      this.addEventListener('datachannel', event => { labels.push({ label: event.channel.label, side: 'remote' }); wrap(event.channel); });
    }
    createDataChannel(label, options) { labels.push({ label, side: 'local' }); return wrap(super.createDataChannel(label, options)); }
    async setRemoteDescription(description) {
      const previous = ufrag(this.remoteDescription?.sdp);
      const result = await super.setRemoteDescription(description);
      // A path stall ends when an ICE restart of this connection is answered with new credentials.
      if (stall.mode === 'path' && description?.type === 'answer' && previous && ufrag(description.sdp) !== previous) stall.release('ice-restart');
      return result;
    }
  }
  return { ...rtc, RTCPeerConnection };
}

export async function createStalledWebrtcMesh({ providers = ['provider'], legacy = [], mesh = {}, reportIce = null } = {}) {
  const signaling = new PublicSwarmServer({ logger, bootstrap: { ...bootstrap, allowLoopbackOrigins: true } });
  const server = http.createServer();
  server.on('upgrade', (req, socket, head) => signaling.handleUpgrade(req, socket, head));
  const signalingFrames = [];
  signaling.wss.on('connection', ws => ws.on('message', data => signalingFrames.push(JSON.parse(Buffer.from(data).toString('utf8')))));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = new URL(`ws://127.0.0.1:${server.address().port}${bootstrap.path}`);
  url.searchParams.set('scope', 'public'); url.searchParams.set('roomId', bootstrap.publicRoomId);
  const stall = createStall(), labels = [];
  let armed = null;
  const nodes = {};
  const executions = [], receipts = [], authorizations = [];
  const start = async (name, provider) => {
    const identity = await createSigningIdentity({ algorithm: 'Ed25519' });
    const hub = new EventEmitter(); hub.setMaxListeners(64);
    const events = { emit: hub.emit.bind(hub), on(event, fn) { hub.on(event, fn); return () => hub.off(event, fn); } };
    const config = resolveConfig({ overrides: {
      mesh: { enabled: true, executeJobs: provider, roomId: bootstrap.publicRoomId, maxInboundJobs: 1, ...mesh },
      webrtc: { signalingUrl: url.href, broadcastRoomId: bootstrap.publicRoomId, transportOrder: ['webrtc'], rtcConfig: { iceServers: [] } } } });
    let transport = null;
    const node = { name, identity, events };
    node.mesh = createPeerGenerationMesh({ config, ports: {
      instanceId: `${name}-${randomUUID()}`, modelConfig: provider ? { id: MODEL.id } : null, admitsBeforeDisclosure: true,
      getExecutionState: () => ({ phase: provider ? 'ready' : 'idle', modelIdentity: MODEL.identity, adapterIdentities: [] }),
      identity: { ensure: async () => identity, sync: async () => {}, save: async () => {} },
      events, eventBus: events, utils: { logger, generateId: prefix => `${prefix}-${randomUUID()}` },
      authorize: async input => {
        authorizations.push({ node: name, action: input.action, requestId: input.request?.requestId ?? input.requestId ?? null });
        // The stall begins as the approved request is dispatched, after both sides proved who they are.
        if (!provider && input.action === 'mesh.dispatch' && armed) { stall.start(armed.mode, armed.ms); armed = null; }
        return true;
      },
      onReceipt: async receipt => { receipts.push({ node: name, receipt }); },
      generate: async (_messages, update, controls) => {
        executions.push({ node: name, requestId: controls.requestId, at: performance.now() });
        update('actual '); update('answer');
        return { model: MODEL.id, modelIdentity: MODEL.identity, adapterIdentities: [], content: 'actual answer',
          completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 4, generatedTokenCount: 2, stopReason: 'eos-token' } };
      },
      createTransport: () => {
        const created = createSwarmTransport({ Utils: { logger, generateId: () => randomUUID() }, EventBus: events, config,
          ...(provider ? rtc : stallableRtc(stall, labels)), WebSocket: OriginWebSocket, getSessionId: () => `${name}-${randomUUID()}`,
          getRtcConfig: async () => ({ iceServers: [] }),
          getRoomCredentials: () => ({ roomId: bootstrap.publicRoomId, token: bootstrap.publicJoinMarker }) });
        // A provider released before delivery protocol 2: it advertises protocol 1 only.
        transport = legacy.includes(name) ? { ...created, supportsFreshPaths: () => false } : !provider && reportIce ? { ...created,
          getPeerStates: () => created.getPeerStates().map(peer => stall.mode ? { ...peer, iceState: reportIce } : peer) } : created;
        return transport;
      } } });
    await node.mesh.connect();
    node.transport = transport;
    nodes[name] = node;
    return node;
  };
  for (const name of providers) await start(name, true);
  const requester = await start('requester', false);
  const requesterPeer = requester.transport.getPeerId();
  await vi.waitFor(() => {
    for (const name of providers) nodes[name].mesh.refreshAdvertisement();
    expect(requester.mesh.getSwarmSnapshot().peers.filter(peer => peer.readiness === 'ready')).toHaveLength(providers.length);
    // Each provider has already proved who the requester is, as it would have for a page left open.
    for (const name of providers) expect(nodes[name].mesh.getVerifiedPeerIdentity(requesterPeer)).toBeTruthy();
  }, { timeout: 20000, interval: 200 });
  const peerIdOf = name => nodes[name].transport.getPeerId();
  return {
    nodes, requester, stall, labels, executions, receipts, authorizations, signalingFrames, peerIdOf,
    renegotiations: () => signalingFrames.filter(frame => frame.type === 'offer' && frame.offer?.reploidRenegotiation === 1),
    providerOf: peerId => providers.find(name => peerIdOf(name) === peerId) ?? null,
    /** The next dispatched request starts a stall of `mode` lasting at most `ms`. */
    armStall(mode, ms) { armed = { mode, ms }; },
    async ask() {
      const startedAt = performance.now();
      let firstTokenMs = null;
      try {
        const result = await requester.mesh.generate([{ role: 'user', content: 'prompt' }], () => { firstTokenMs ??= performance.now() - startedAt; },
          { modelId: MODEL.id, modelIdentity: MODEL.identity,
            privacy: createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } }) });
        return { result, firstTokenMs, totalMs: performance.now() - startedAt, startedAt };
      } catch (error) { return { error, firstTokenMs, totalMs: performance.now() - startedAt, startedAt }; }
    },
    async close() {
      stall.release('close');
      for (const node of Object.values(nodes).reverse()) { try { await node.mesh.close(); } catch { /* best effort */ } }
      await signaling.close();
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
    }
  };
}
