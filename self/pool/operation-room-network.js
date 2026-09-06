/** Complete operations reuse room rendezvous, signaling, transport and durable execution. */
import config from './pool-config.json' with { type: 'json' };
import { createRoomSignaling, runPeerOperationJob, PEER_ROOM_VERSION } from './peer-room.js';
import { createP2PTransport } from './p2p-transport.js';
import { createPackJobDataChannel } from './peer-pack-job-channel.js';
import { createPackPeerProvider } from './peer-pack-provider.js';
import { verifyPackPeerMessage, packPeerModel } from './peer-pack-job.js';
import { PEER_MESSAGE_TYPES } from './peer-protocol.js';
import { hashDopplerEvidence } from './executable-pack.js';
import { snapshotPackOperationData as snapshot } from './pack-operation.js';

const assert = (ok, message) => { if (!ok) throw new Error(`Operation room: ${message}`); };
const post = (channel, roomId, type, body) => channel.postMessage({ peerRoomVersion: PEER_ROOM_VERSION,
  roomId, type, body, createdAt: new Date().toISOString() });
function settings(input) {
  const policy = snapshot(input);
  assert(policy.schema === 'reploid.pool.operation-network-policy/v1', 'network policy required');
  for (const key of ['discoveryMs', 'advertMs', 'advertLifetimeMs', 'connectionMs', 'maxConnections', 'maxChannelBytes',
    'channelTimeoutMs', 'maxPendingIce', 'pendingIceMs']) assert(Number.isSafeInteger(policy[key]) && policy[key] > 0, `${key} required`);
  assert(typeof policy.dataChannelLabel === 'string' && policy.dataChannelLabel.length > 0, 'data channel label required');
  assert(policy.maxConnections === 1, 'the complete-job provider supports one connection');
  return policy;
}
function connection({ channel, roomId, assignmentId, localPeerId, remotePeerId, initiator, rtcConfig, policy, install }) {
  const signaling = createRoomSignaling({ roomId, sessionId: assignmentId, localPeerId, remotePeerId, sharedChannel: channel });
  let bus;
  const transport = createP2PTransport({ signaling, initiator, rtcConfig, dataChannelLabel: policy.dataChannelLabel,
    dataChannelOptions: { ordered: true }, maxPendingRemoteIceCandidates: policy.maxPendingIce, pendingRemoteIceTtlMs: policy.pendingIceMs,
    onDataChannel(dataChannel) {
      const opened = () => { bus = createPackJobDataChannel({ channel: dataChannel, maxTransferBytes: policy.maxChannelBytes,
        timeoutMs: policy.channelTimeoutMs }); install?.(bus); };
      if (dataChannel.readyState === 'open') opened(); else dataChannel.addEventListener('open', opened, { once: true });
    } });
  return { transport, get bus() { return bus; }, close() { bus?.close(); transport.close(); signaling.close(); } };
}

export function createOperationRoomNetwork({ roomId, roomBusFactory, requesterClient, rtcConfig,
  policy: input = config.operationNetwork, jobPolicy = config.peerJobs }) {
  const policy = settings(input);
  assert(roomId && typeof roomBusFactory === 'function' && requesterClient && rtcConfig, 'room, requester and RTC configuration required');
  return Object.freeze({
    async describe({ model }) {
      const channel = roomBusFactory({ roomId, role: 'requester' });
      const adverts = new Map();
      const handler = event => {
        const message = event.data, advert = message?.body?.advert;
        if (message?.roomId === roomId && message.type === 'provider-advert' && advert?.body?.schema === jobPolicy.schemas.providerAdvert) {
          if (adverts.size < jobPolicy.assignmentPolicy.maxCandidates || adverts.has(advert.fromPeerId)) adverts.set(advert.fromPeerId, advert);
        }
      };
      channel.addEventListener('message', handler);
      try {
        await post(channel, roomId, 'provider-advert-request', { schema: 'reploid.peer.operation-discovery/v1', model });
        await new Promise(resolve => setTimeout(resolve, policy.discoveryMs));
        return snapshot({ adverts: [...adverts.values()], resources: policy.requestResources, limits: policy.requestLimits });
      } finally { channel.removeEventListener('message', handler); channel.close(); }
    },
    run({ request, providerAdverts, signal, onPartial }) {
      return runPeerOperationJob({ requesterClient, request, providerAdverts, signal, onPartial, policy: jobPolicy,
        connectTransport: async ({ providerId, assignment, signal }) => {
          const channel = roomBusFactory({ roomId, role: 'requester', localPeerId: assignment.requesterId });
          let peer, timer, handler, rejectAcknowledgement;
          const close = () => { clearTimeout(timer); channel.removeEventListener('message', handler); signal.removeEventListener('abort', abort); peer?.close(); channel.close(); };
          const abort = () => { rejectAcknowledgement?.(signal.reason); close(); };
          signal.addEventListener('abort', abort, { once: true });
          try {
            const ticket = await requesterClient.createPeerOperationConnection({ assignment, policy: jobPolicy });
            signal.throwIfAborted();
            const acknowledged = new Promise((resolve, reject) => {
              rejectAcknowledgement = reject;
              timer = setTimeout(() => reject(new Error('Other computer did not connect')), policy.connectionMs);
              handler = event => {
                const message = event.data;
                if (message?.roomId === roomId && message.type === 'peer-run-accepted'
                  && message.body?.schema === 'reploid.peer.operation-ready/v1'
                  && message.body.assignmentId === assignment.assignmentId && message.body.providerId === providerId) resolve();
              };
              channel.addEventListener('message', handler);
            });
            acknowledged.catch(() => {});
            await post(channel, roomId, 'peer-run-request', { schema: 'reploid.peer.operation-connect/v1', requesterId: assignment.requesterId, ticket });
            await acknowledged;
            signal.throwIfAborted();
            clearTimeout(timer);
            peer = connection({ channel, roomId, assignmentId: assignment.assignmentId, localPeerId: assignment.requesterId,
              remotePeerId: providerId, initiator: true, rtcConfig, policy });
            await peer.transport.connect();
            signal.throwIfAborted();
            assert(peer.bus, 'operation channel did not open');
            return { bus: peer.bus, close };
          } catch (error) { close(); throw error; }
        } });
    }
  });
}

/** Calling start is explicit provider participation. Discovery alone never enables execution. */
export function createOperationRoomProvider({ roomId, roomBusFactory, identity, models, observeCapabilities, authorize,
  adapterResolver = null, executor, rtcConfig, policy: input = config.operationNetwork, jobPolicy = config.peerJobs, onError = () => {} }) {
  const policy = settings(input);
  assert(typeof observeCapabilities === 'function' && typeof authorize === 'function', 'explicit observations and admission required');
  models = snapshot(models);
  let channel, provider, interval, closed = true, announcing = null, latest = null;
  const connections = new Map(), listeners = new Set(), disconnected = new Set(), issued = new Map();
  const hub = { subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    onDisconnect(fn) { disconnected.add(fn); return () => disconnected.delete(fn); },
    async send(message) { const peer = [...connections.values()].find(row => row.requesterId === message.toPeerId && row.bus);
      assert(peer, 'requester disconnected'); await peer.bus.send(message); } };
  const announce = async () => {
    if (closed) return;
    if (announcing) return announcing;
    if (latest && Date.now() - Date.parse(latest.createdAt) < policy.advertMs) {
      await post(channel, roomId, 'provider-advert', { advert: latest }); return;
    }
    announcing = (async () => {
    for (const [hash, advert] of issued) if (Date.parse(advert.expiresAt) <= Date.now()) issued.delete(hash);
    const advert = await provider.createAdvert({ capabilities: await observeCapabilities(provider.getState()),
      limits: policy.requestLimits, expiresAt: Date.now() + policy.advertLifetimeMs });
    if (closed) return;
    issued.set(advert.messageHash, advert);
    latest = advert;
    await post(channel, roomId, 'provider-advert', { advert });
    })();
    try { await announcing; } finally { announcing = null; }
  };
  const receive = async event => {
    const message = event.data;
    if (closed || message?.roomId !== roomId) return;
    if (message.type === 'provider-advert-request') { await announce(); return; }
    const ticket = message.body?.ticket;
    if (message.type !== 'peer-run-request' || message.body?.schema !== 'reploid.peer.operation-connect/v1' || ticket?.toPeerId !== identity.keyId) return;
    await verifyPackPeerMessage(ticket, { type: PEER_MESSAGE_TYPES.HEARTBEAT, recipient: identity.keyId, policy: jobPolicy });
    const body = ticket.body;
    assert(body.schema === 'reploid.peer.operation-connect/v1' && body.requesterId === ticket.fromPeerId
      && body.providerId === identity.keyId && typeof body.assignmentId === 'string' && body.assignmentId.length > 0
      && body.assignmentId.length <= jobPolicy.limits.maxIdentityCharacters
      && Date.parse(issued.get(body.providerAdvertHash)?.expiresAt) > Date.now(), 'connection ticket rejected');
    assert((await Promise.all(models.map(model => hashDopplerEvidence(packPeerModel(model))))).includes(await hashDopplerEvidence(body.model)), 'unknown connection model');
    if (closed) return;
    const existing = connections.get(body.assignmentId);
    assert(!existing || existing.requesterId === ticket.fromPeerId, 'connection belongs to a different requester');
    if (!connections.has(body.assignmentId)) {
      assert(connections.size < policy.maxConnections, 'connection limit reached');
      let timer;
      const peer = connection({ channel, roomId, assignmentId: body.assignmentId, localPeerId: identity.keyId,
        remotePeerId: ticket.fromPeerId, initiator: false, rtcConfig, policy, install(bus) {
          clearTimeout(timer); bus.subscribe(value => { for (const fn of listeners) fn(value); });
          bus.onDisconnect(() => { peer.close(); });
        } });
      const closePeer = peer.close;
      let peerClosed = false;
      peer.close = () => {
        if (peerClosed) return;
        peerClosed = true; clearTimeout(timer); connections.delete(body.assignmentId);
        for (const fn of disconnected) fn();
        closePeer();
      };
      peer.requesterId = ticket.fromPeerId;
      connections.set(body.assignmentId, peer);
      timer = setTimeout(() => { peer.close(); connections.delete(body.assignmentId); }, policy.connectionMs);
      void peer.transport.connect().catch(error => { clearTimeout(timer); peer.close(); connections.delete(body.assignmentId); onError(error); });
    }
    await post(channel, roomId, 'peer-run-accepted', { schema: 'reploid.peer.operation-ready/v1', assignmentId: body.assignmentId, providerId: identity.keyId });
  };
  const handler = event => { void receive(event).catch(onError); };
  const close = async () => {
    closed = true; clearInterval(interval);
    channel?.removeEventListener('message', handler);
    for (const peer of connections.values()) peer.close();
    connections.clear(); issued.clear(); latest = null;
    try { await provider?.close(); } finally { channel?.close(); }
  };
  return {
    async start() {
      assert(closed, 'provider is already sharing'); closed = false;
      try {
      channel = roomBusFactory({ roomId, role: 'provider', localPeerId: identity.keyId });
      provider = createPackPeerProvider({ identity, models, authorize, adapterResolver, executor, bus: hub, policy: jobPolicy, onError });
      channel.addEventListener('message', handler);
      interval = setInterval(() => { void announce().catch(onError); }, policy.advertMs);
      await announce();
      } catch (error) { await close(); throw error; }
    },
    close,
    getState() { return { sharing: !closed, connections: connections.size, execution: provider?.getState() ?? null }; }
  };
}
