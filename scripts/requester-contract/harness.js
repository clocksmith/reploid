/**
 * In-process harness for the requester contract.
 *
 * Everything that decides what goes on the wire is the real code: the mesh
 * (peer-generation.js), the identity proof (peer-identity.js), the WebRTC swarm
 * transport (swarm.js, including its envelope, clock and validation), the
 * whole-model requester (server/whole-model-requester.js) and the signaling
 * server (server/public-swarm-server.js).
 *
 * Only the two things a test cannot own are replaced: the WebRTC peer
 * connection and the WebSocket. The stand-ins carry text frames between the two
 * real stacks and record them. They hold no protocol rules.
 */
import { EventEmitter } from 'node:events';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import profile from '../../shared/config/reploid-library.json' with { type: 'json' };
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createSwarmTransport } from '../../packages/reploid/src/transport/index.js';
import { createPeerGenerationMesh } from '../../packages/reploid/src/mesh/peer-generation.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { createWholeModelRequester } from '../../server/whole-model-requester.js';
import { PublicSwarmServer } from '../../server/public-swarm-server.js';
import { allowsSwarmOrigin } from '../../server/swarm-protocol.js';
import { events } from '../../server/native-host-utils.js';
import { createHostRequesterRule } from '../../server/circles/guest-access.js';

const turn = () => new Promise(resolve => setImmediate(resolve));

/**
 * Delivers one queued frame at a time and waits until its consequences have
 * settled before the next one. With the clock, UUIDs and random bytes fixed,
 * this makes the order of frames, and so every Lamport timestamp, repeatable.
 */
export function createScheduler() {
  const queue = [];
  let activity = 0, pendingCrypto = 0;
  async function settle() {
    for (let quiet = 0; quiet < 3;) {
      const before = activity;
      await turn();
      quiet = pendingCrypto === 0 && activity === before ? quiet + 1 : 0;
    }
  }
  const post = deliver => { activity++; queue.push(deliver); };
  return {
    post,
    get size() { return queue.length; },
    settle,
    cryptoBegan() { pendingCrypto++; activity++; },
    cryptoEnded() { pendingCrypto--; activity++; },
    /** Resolves once every frame queued before this call has been delivered and has settled. */
    barrier: () => new Promise(resolve => post(resolve)),
    /** Deliver the next frame after the previous one settled. False when nothing is queued. */
    async step() {
      await settle();
      const deliver = queue.shift();
      if (!deliver) return false;
      activity++;
      deliver();
      return true;
    },
    async drain() { while (await this.step()) { /* one frame at a time */ } },
    /** Run frames until `promise` settles, then return or throw its outcome. */
    async until(promise) {
      let state = 'pending', value, failure;
      promise.then(result => { state = 'done'; value = result; activity++; }, error => { state = 'failed'; failure = error; activity++; });
      while (state === 'pending') {
        if (await this.step()) continue;
        await settle();
        if (state === 'pending' && queue.length === 0) throw new Error('The exchange stalled: nothing is queued and the request has not settled');
      }
      if (state === 'failed') throw failure;
      return value;
    }
  };
}

/**
 * Fix the clock, crypto.randomUUID and crypto.getRandomValues, and let the
 * scheduler see when Web Crypto work is in flight. Restored on exit.
 *
 * `now` is a number, or a function when a capture moves the clock.
 * `randomBytes` fixes node:crypto randomBytes for the listed sizes (the desktop
 * draws its pairing code from it); other sizes are not touched.
 */
export async function withDeterministicRuntime({ now, uuids, randomValues, randomBytes = [], scheduler }, run) {
  const restore = [];
  const patch = (object, name, value) => {
    const previous = Object.getOwnPropertyDescriptor(object, name);
    Object.defineProperty(object, name, { value, configurable: true, writable: true });
    restore.push(() => { if (previous) Object.defineProperty(object, name, previous); else delete object[name]; });
  };
  const used = { uuids: [], randomValues: [] };
  const remainingUuids = [...uuids], remainingRandom = randomValues.map(bytes => [...bytes]);
  patch(Date, 'now', typeof now === 'function' ? now : () => now);
  if (randomBytes.length) {
    const nodeCrypto = createRequire(import.meta.url)('node:crypto'), original = nodeCrypto.randomBytes;
    const remaining = randomBytes.map(bytes => [...bytes]);
    nodeCrypto.randomBytes = (size, callback) => {
      if (callback || !remaining.length || remaining[0].length !== size) return original(size, callback);
      return Buffer.from(remaining.shift());
    };
    syncBuiltinESMExports();
    restore.push(() => { nodeCrypto.randomBytes = original; syncBuiltinESMExports(); });
  }
  patch(globalThis.crypto, 'randomUUID', () => {
    if (!remainingUuids.length) throw new Error('The fixed UUID list is exhausted');
    used.uuids.push(remainingUuids[0]);
    return remainingUuids.shift();
  });
  patch(globalThis.crypto, 'getRandomValues', array => {
    const next = remainingRandom.shift();
    if (!next || next.length !== array.length) throw new Error(`Unexpected request for ${array.length} random bytes`);
    array.set(next);
    used.randomValues.push(next);
    return array;
  });
  const subtle = globalThis.crypto.subtle;
  for (const name of ['digest', 'sign', 'verify', 'importKey', 'exportKey', 'generateKey']) {
    const original = subtle[name];
    patch(subtle, name, function tracked(...args) {
      scheduler.cryptoBegan();
      let pending;
      try { pending = original.apply(subtle, args); } catch (error) { scheduler.cryptoEnded(); throw error; }
      return pending.then(value => { scheduler.cryptoEnded(); return value; }, error => { scheduler.cryptoEnded(); throw error; });
    });
  }
  try { return { value: await run(), used }; }
  finally { for (const undo of restore.reverse()) undo(); }
}

const upperFingerprint = value => value.replace(/^sha-256 /, '').toUpperCase();
/** A data-channel-only session description. Only the fingerprint line is read by the protocol. */
export function sessionDescription(type, fingerprint, serial) {
  const tag = fingerprint.replace(/[^a-f0-9]/g, '').slice(0, 4);
  return { type, sdp: [
    'v=0', `o=- ${serial} 2 IN IP4 127.0.0.1`, 's=-', 't=0 0', 'a=group:BUNDLE 0', 'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0',
    `a=ice-ufrag:${tag}`, `a=ice-pwd:${tag.repeat(6)}`, 'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${upperFingerprint(fingerprint)}`, `a=setup:${type === 'offer' ? 'actpass' : 'active'}`,
    'a=mid:0', 'a=sctp-port:5000', 'a=max-message-size:262144', ''
  ].join('\r\n') };
}

/**
 * Stand-in WebRTC. `post` schedules delivery; `tap` sees each data-channel text
 * frame as it is sent. Two stand-in connections are linked when the offerer
 * receives the answer, as real connections open after both descriptions are set.
 */
export function createFakeNetwork({ post, tap = () => {}, transform = null }) {
  const offers = new Map(), answers = new Map();
  // With `transform`, frames are rewritten in transit one after another, so their order is kept.
  let rewriting = Promise.resolve();

  function createRtc({ name, fingerprint, external = null }) {
    const created = { connections: [], channels: [] };
    let serial = 0;

    class FakeDataChannel {
      constructor(label, options = {}) {
        this.label = label; this.options = options; this.ordered = options.ordered !== false;
        this.readyState = 'connecting'; this.bufferedAmount = 0; this.peer = null;
        this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
        this.listeners = new Map();
      }
      addEventListener(type, listener) {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type).add(listener);
      }
      removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
      send(data) {
        if (this.readyState !== 'open') throw new Error('Data channel is not open');
        const peer = this.peer, label = this.label;
        const deliver = text => {
          tap({ from: name, label, data: text });
          post(() => { if (peer?.readyState === 'open') peer.onmessage?.({ data: text }); });
        };
        if (!transform) { deliver(data); return; }
        rewriting = rewriting.then(async () => {
          const text = await transform({ from: name, data });
          if (text !== null) deliver(text);
        });
      }
      open() { this.readyState = 'open'; this.onopen?.({}); }
      close() {
        if (this.readyState === 'closed') return;
        this.readyState = 'closed';
        this.onclose?.({});
        for (const listener of this.listeners.get('close') || []) listener({});
        const peer = this.peer;
        if (peer && peer.readyState !== 'closed') post(() => peer.close());
      }
    }

    class RTCPeerConnection {
      constructor(configuration) {
        this.configuration = configuration; this.iceConnectionState = 'new'; this.connectionState = 'new';
        this.localDescription = null; this.remoteDescription = null; this.channels = []; this.remote = null;
        this.oniceconnectionstatechange = null; this.onconnectionstatechange = null;
        this.ondatachannel = null; this.onicecandidate = null; this.remoteCandidates = [];
        created.connections.push(this);
      }
      createDataChannel(label, options = {}) {
        const channel = new FakeDataChannel(label, options);
        this.channels.push(channel);
        created.channels.push({ label, options: { ...options } });
        if (this.remote && this.connectionState === 'connected') post(() => this.remote.accept(channel));
        return channel;
      }
      accept(remoteChannel) {
        const channel = new FakeDataChannel(remoteChannel.label, remoteChannel.options);
        channel.peer = remoteChannel; remoteChannel.peer = channel;
        this.channels.push(channel);
        channel.readyState = 'open';
        this.ondatachannel?.({ channel });
        channel.onopen?.({});
        remoteChannel.open();
      }
      async createOffer() { return sessionDescription('offer', fingerprint, ++serial); }
      async createAnswer() { return sessionDescription('answer', fingerprint, ++serial); }
      async setLocalDescription(description) {
        this.localDescription = description;
        if (description.type === 'offer') offers.set(description.sdp, this);
        else answers.set(description.sdp, this);
        const tag = fingerprint.replace(/[^a-f0-9]/g, '').slice(0, 4);
        // One host candidate from the documentation address range, so the ice-candidate frame is exercised.
        const candidate = { candidate: `candidate:1 1 udp 2122260223 192.0.2.${name === 'provider' ? 2 : 1} 50000 typ host generation 0 ufrag ${tag} network-id 1`,
          sdpMid: '0', sdpMLineIndex: 0, usernameFragment: tag };
        post(() => this.onicecandidate?.({ candidate: { ...candidate, toJSON: () => ({ ...candidate }) } }));
        if (description.type === 'answer' && this.external) post(() => this.connectExternal());
      }
      async setRemoteDescription(description) {
        this.remoteDescription = description;
        if (description.type === 'offer') {
          this.remote = offers.get(description.sdp) || null;
          if (!this.remote && external) this.external = external;
          return;
        }
        const answerer = answers.get(description.sdp);
        if (!answerer) throw new Error('Answer does not belong to a known connection');
        this.remote = answerer; answerer.remote = this;
        post(() => this.connect(answerer));
      }
      markConnected() {
        this.iceConnectionState = 'connected'; this.connectionState = 'connected';
        this.oniceconnectionstatechange?.(); this.onconnectionstatechange?.();
      }
      connect(answerer) {
        answerer.markConnected(); this.markConnected();
        for (const channel of [...this.channels]) answerer.accept(channel);
      }
      /** The far end is outside this process: its frames arrive through `external`. */
      connectExternal() {
        this.markConnected();
        const far = { readyState: 'open', onmessage: event => this.external.write(event.data), close: () => { far.readyState = 'closed'; this.external.closed?.(); } };
        const channel = new FakeDataChannel('reploid', { ordered: true });
        channel.peer = far; channel.readyState = 'open';
        this.channels.push(channel);
        this.external.attach({ deliver: data => { if (channel.readyState === 'open') channel.onmessage?.({ data }); }, close: () => channel.close() });
        this.ondatachannel?.({ channel });
        channel.onopen?.({});
      }
      async addIceCandidate(candidate) { this.remoteCandidates.push(candidate); }
      async getStats() { return new Map(); }
      setConfiguration(configuration) { this.configuration = configuration; }
      close() {
        if (this.connectionState === 'closed') return;
        this.connectionState = 'closed'; this.iceConnectionState = 'closed';
        for (const channel of [...this.channels]) channel.close();
      }
    }
    return { RTCPeerConnection, created };
  }
  return { createRtc };
}

/**
 * The real signaling server with in-process sockets. `tap` sees every frame.
 * The origin and scope gate is the one the server's upgrade handler applies.
 */
export function createInProcessSignaling({ post, tap = () => {}, logger }) {
  const server = new PublicSwarmServer({ logger });
  class ServerSocket extends EventEmitter {
    constructor(client, name) { super(); this.client = client; this.name = name; this.readyState = 1; }
    send(text) {
      tap({ direction: 'server-to-client', peer: this.name, frame: JSON.parse(text) });
      const client = this.client;
      post(() => { if (client.readyState === 1) client.onmessage?.({ data: text }); });
    }
    close() { this.terminate(); }
    terminate() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      const client = this.client;
      post(() => { this.emit('close'); if (client.readyState !== 3) { client.readyState = 3; client.onclose?.({}); } });
    }
  }
  function webSocketFor({ name, origin }) {
    return class FakeWebSocket {
      static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
      constructor(url) {
        this.url = url; this.readyState = 0;
        this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
        const remote = this.remote = new ServerSocket(this, name);
        post(() => {
          const target = new URL(url), scope = target.searchParams.get('scope');
          if (!['public', 'private'].includes(scope) || !allowsSwarmOrigin(origin, server.bootstrap)) {
            this.readyState = 3; this.onerror?.(new Error('Signaling upgrade refused')); this.onclose?.({});
            return;
          }
          this.readyState = 1;
          server.handleConnection(remote, { url: target.pathname + target.search, headers: { origin }, socket: { remoteAddress: '127.0.0.1' } });
          this.onopen?.({});
        });
      }
      send(text) {
        tap({ direction: 'client-to-server', peer: name, frame: JSON.parse(text) });
        const remote = this.remote;
        post(() => { if (remote.readyState === 1) remote.emit('message', text, false); });
      }
      close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        const remote = this.remote;
        post(() => { if (remote.readyState !== 3) { remote.readyState = 3; remote.emit('close'); } this.onclose?.({}); });
      }
    };
  }
  return { server, webSocketFor, close: () => server.close() };
}

/**
 * Let a peer that exists only as text frames reach `localTransportId`: it joins
 * through the real signaling server and sends an offer carrying its fingerprint.
 * The local stack must have been created with `createRtc({ external })`; its
 * answer opens a "reploid" data channel whose far end is `external`.
 */
export function offerFromExternalPeer({ signaling, signalingUrl, roomId, roomToken, origin, localTransportId, remoteTransportId, remoteFingerprint }) {
  const Socket = signaling.webSocketFor({ name: 'external', origin });
  const socket = new Socket(`${signalingUrl}?scope=private&roomId=${roomId}`);
  socket.onopen = () => socket.send(JSON.stringify({ type: 'join', peerId: remoteTransportId, roomId, token: roomToken, metadata: { capabilities: [] } }));
  socket.onmessage = event => {
    const frame = JSON.parse(event.data);
    if (frame.type === 'joined') socket.send(JSON.stringify({ type: 'offer', peerId: remoteTransportId, targetPeer: localTransportId,
      offer: sessionDescription('offer', remoteFingerprint, 1) }));
  };
  return socket;
}

export const quietLogger = (warnings = []) => ({ debug() {}, info() {}, log() {},
  warn: (...parts) => { warnings.push(parts.map(part => part instanceof Error ? part.message : String(part)).join(' ')); },
  error: (...parts) => { warnings.push(parts.map(part => part instanceof Error ? part.message : String(part)).join(' ')); } });

/** The mesh configuration a native participant resolves (server/native-participant-runtime.js). */
export function meshConfig({ signalingUrl, roomId, executeJobs, publicRoomId }) {
  const endpoint = new URL(signalingUrl);
  endpoint.searchParams.set('scope', roomId === publicRoomId ? 'public' : 'private');
  endpoint.searchParams.set('roomId', roomId);
  return resolveConfig({ profile: profile.profile, overrides: {
    mesh: { enabled: true, executeJobs, maxInboundJobs: 1, roomId },
    webrtc: { signalingUrl: endpoint.href, broadcastRoomId: roomId, transportOrder: ['webrtc'] }
  } });
}

/**
 * A stand-in whole model: a fixed answer in fixed chunks, with the same result
 * shape the native whole-model host returns. `pause(index)` runs before each
 * chunk and before the completion, so a cancel can arrive between chunks.
 */
export function createStubWholeModel({ model, chunks, completion, pause = async () => {}, failAfterChunks = null, onCall = () => {} }) {
  return async function generate(messages, onUpdate, controls = {}) {
    onCall(messages, controls);
    controls.onUsage?.({ inputTokens: completion.promptTokenCount });
    let content = '';
    for (let index = 0; index <= chunks.length; index++) {
      await pause(index);
      controls.signal?.throwIfAborted();
      if (failAfterChunks !== null && index >= failAfterChunks) throw new Error(`Stub model failed after ${failAfterChunks} chunks`);
      if (index === chunks.length) break;
      content += chunks[index];
      onUpdate?.(chunks[index]);
    }
    return { model: model.id, modelIdentity: model.identity, adapterIdentities: [], content,
      completion: { ...completion }, ownerPolicyDigest: null };
  };
}

function transportFor({ config, utils, eventBus, WebSocket, RTCPeerConnection, identity, roomId, roomToken, transportId, getRtcConfig }) {
  return createSwarmTransport({ config, Utils: utils, EventBus: eventBus, WebSocket, RTCPeerConnection,
    ...(transportId ? { peerId: transportId } : {}), ...(getRtcConfig ? { getRtcConfig } : {}),
    getSessionId: () => identity.peerId, getRoomCredentials: () => ({ roomId, token: roomToken }) });
}

/** The provider side of the real mesh, serving `generate` for one whole model. */
export function createProviderStack({ signalingUrl, roomId, roomToken, publicRoomId, identity, transportId, model, generate,
  WebSocket, RTCPeerConnection, logger, generateId, decline = () => false, getRtcConfig = null, ownerPairing = null }) {
  const config = meshConfig({ signalingUrl, roomId, executeJobs: true, publicRoomId });
  const eventBus = events(), bridge = events(), utils = { logger, generateId };
  let transport = null;
  const state = () => ({ ready: true, phase: 'ready', modelIdentity: model.identity, adapterIdentities: [] });
  const mesh = createPeerGenerationMesh({ config, ports: {
    instanceId: 'node:' + identity.peerId, modelConfig: model, utils, eventBus, events: bridge,
    getExecutionState: state,
    // Cleanup is confirmed, so a recoverable request that fails or is cancelled gets signed terminal evidence.
    settleGeneration: async () => true,
    identity: { ensure: async () => identity, save: async () => {}, sync: async () => {},
      rotate: async () => { throw new Error('The fixture identity is fixed'); } },
    admitsBeforeDisclosure: true,
    // With owner pairing, the rule the native host applies (server/native-participant-runtime.js):
    // only a paired owner's requests are admitted and executed.
    authorize: async request => request.action === 'mesh.connect'
      || request.action === 'mesh.admit' && decline(request) !== true && (!allowed || await allowed(request))
      || request.action === 'mesh.execute' && (!allowed || await allowed(request, 'execute')),
    generate,
    createTransport: () => transport = transportFor({ config, utils, eventBus, WebSocket, RTCPeerConnection, identity, roomId, roomToken, transportId, getRtcConfig })
  } });
  const allowed = ownerPairing && createHostRequesterRule({ ownerPairing, guestAccess: null, verifyPeer: peer => mesh.verifyPeerIdentity(peer) });
  /** Join the room and, with owner pairing, start listening for pairing requests as the native host does. */
  const connect = async () => {
    await mesh.connect();
    ownerPairing?.attach({ transport, verifyPeer: mesh.verifyPeerIdentity, currentPeer: mesh.getVerifiedPeerIdentity });
  };
  return { mesh, config, eventBus, connect, get transport() { return transport; } };
}

/** The requester side: the real mesh plus server/whole-model-requester.js, as server/native-node-ask.js drives it. */
export function createRequesterStack({ signalingUrl, roomId, roomToken, publicRoomId, identity, transportId, model,
  WebSocket, RTCPeerConnection, logger, generateId, getRtcConfig = null }) {
  const config = meshConfig({ signalingUrl, roomId, executeJobs: false, publicRoomId });
  const eventBus = events(), bridge = events(), utils = { logger, generateId };
  let transport = null, requester = null;
  const dispatches = [];
  const mesh = createPeerGenerationMesh({ config, ports: {
    instanceId: 'node:' + identity.peerId, modelConfig: null, utils, eventBus, events: bridge,
    getExecutionState: () => ({ phase: 'idle' }),
    identity: { ensure: async () => identity, save: async () => {}, sync: async () => {},
      rotate: async () => { throw new Error('The fixture identity is fixed'); } },
    admitsBeforeDisclosure: true,
    authorize: async request => {
      if (request.action === 'mesh.connect') return true;
      if (request.action !== 'mesh.dispatch') return false;
      dispatches.push(structuredClone(request));
      if (direct && request.requestContext === null) return true;
      return await requester.authorize(request) === true;
    },
    generate: async () => { throw new Error('A requester does not execute'); },
    createTransport: () => transport = transportFor({ config, utils, eventBus, WebSocket, RTCPeerConnection, identity, roomId, roomToken, transportId, getRtcConfig })
  } });
  requester = createWholeModelRequester({ mesh, models: [model] });
  let direct = false;
  /**
   * The smallest request the mesh sends: no conversation key and not recoverable, so the
   * request frame has no contextId and no recoverable member. Approval is given here.
   */
  const askDirect = async ({ messages, signal, onDelta = () => {} }) => {
    const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
    direct = true;
    try {
      const result = await mesh.generate(messages, onDelta, { signal, modelId: model.id, modelIdentity: model.identity, adapterIdentities: [], privacy });
      return { result, privacy };
    } finally { direct = false; }
  };
  /** The request server/native-node-ask.js builds: open recipients, one approval, text deltas. */
  const ask = async ({ messages, threadId, attemptId, signal, onDelta = () => {}, recipients = { kind: 'open', ids: [] } }) => {
    const route = requester.getModels().find(candidate => candidate.id === model.id && candidate.identity === model.identity
      && candidate.availability === 'ready' && !candidate.adapters?.length);
    if (!route) throw new Error('No ready provider for the fixture model');
    const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients });
    const observed = { approvals: [], deltas: [], usage: [], route: null };
    const result = await requester.generate({ model: route, threadId, attemptId, privacy, messages }, {
      signal,
      requestApproval(preview) { observed.approvals.push(structuredClone(preview)); return true; },
      onRoute(route) { observed.route = route; },
      onUsage(usage) { observed.usage.push(usage); },
      onDelta(delta) { observed.deltas.push(delta); onDelta(delta); }
    }).catch(error => { error.observed = observed; throw error; });
    return { result, observed, privacy, route };
  };
  /** What the web client hands its owner-pairing code (apps/poolday/host/work-swarm.js getOwnerPairingChannel). */
  const pairingChannel = () => transport ? {
    roomId, transport,
    verifyPeer: (peerId, signal) => mesh.verifyPeerIdentity(peerId, signal),
    currentPeer: peerId => mesh.getVerifiedPeerIdentity(peerId) ?? null,
    getPeers: () => mesh.getSwarmSnapshot()?.peers || [],
    getPeerStates: () => transport.getPeerStates?.() || []
  } : null;
  return { mesh, requester, config, eventBus, dispatches, ask, askDirect, pairingChannel, get transport() { return transport; } };
}
