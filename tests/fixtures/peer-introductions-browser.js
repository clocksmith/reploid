import { createWebRTCSwarm } from '../../self/vendor/reploid/transport/swarm.js';
import { resolveConfig } from '../../self/vendor/reploid/config/index.js';
import { createSigningIdentity } from '../../self/vendor/reploid/artifacts/identity.js';
export let swarm;
export const messages = [], errors = [], events = [];
export async function start(peerId, bootstrapContact = null, restricted = false) {
  const identity = await createSigningIdentity({ algorithm: 'ECDSA' });
  swarm = createWebRTCSwarm({ peerId,
    config: resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'introduction-browser' },
      webrtc: { sessionId: peerId, signalingUrl: null, heartbeatIntervalMs: 1000,
        ...(restricted ? { rtcConfig: { iceServers: [], iceTransportPolicy: 'relay' }, connectTimeoutMs: 500 } : {}) } } }),
    Utils: { generateId: () => peerId, logger: { info() {}, debug() {}, warn: (...args) => errors.push(args.map(String).join(' ')), error: (...args) => errors.push(args.map(String).join(' ')) } },
    EventBus: { emit: (type, payload) => events.push({ type, payload }) },
    introductions: { getIdentity: () => identity, authorize: async () => true },
    ...(bootstrapContact ? { introductionBootstrap: { routes: [
      { id: 'unreachable', open: async () => { throw new Error('Entry point unavailable'); } },
      { id: 'independent-participant', open: async () => ({ contact: bootstrapContact,
        publish: envelope => globalThis.deliverIntroduction(envelope), close() {} }) }
    ] } } : {}),
    WebSocket: class { constructor() { throw new Error('Signaling is blocked'); } }
  });
  swarm.onMessage('sync-response', (from, value) => messages.push({ from, value }));
  await swarm.init();
  swarm.onDataChannel('reploid-custody', (from, channel) => {
    channel.onmessage = event => channel.send(event.data);
  });
  return swarm.getIntroductions().exportContact();
}
export const receive = envelope => swarm.getIntroductions().receive(null, 'reploid:introduction-signal', envelope,
  answer => globalThis.deliverIntroduction(answer));
export const connect = contact => swarm.getIntroductions().connect(contact, envelope => globalThis.deliverIntroduction(envelope));
export const peers = () => swarm.getConnectedPeers().map(peer => peer.id);
export const send = (remote, value) => swarm.sendToPeer(remote, 'sync-response', value);
export async function echo(remote) {
  const channel = swarm.openDataChannel(remote, 'reploid-custody');
  channel.binaryType = 'arraybuffer';
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { channel.close(); reject(new Error('Auxiliary echo timed out')); }, 10000);
    channel.onopen = () => channel.send(new Uint8Array([1, 3, 5, 7]));
    channel.onmessage = event => { clearTimeout(timeout); channel.close(); resolve([...new Uint8Array(event.data)]); };
  });
}
export const close = () => swarm.disconnect();

let host;
export async function startHost(bootstrapContact) {
  const { createProductSession } = await import('../../self/host/product-session.js');
  host = createProductSession({ storage: localStorage,
    networkOptions: () => { throw new Error('Signed job networking must remain separate'); },
    swarmNetworkOptions: deps => ({ ...deps,
      config: resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'introduction-browser' },
        webrtc: { signalingUrl: null, sessionId: 'ordinary-host', transportOrder: ['webrtc'], heartbeatIntervalMs: 1000 } } }),
      autoConnect: true, discoveryScope: 'public',
      getInviteUrl: () => location.href,
      getRtcConfig: async () => { events.push({ type: 'host:rtc-config' }); return { iceServers: [] }; },
      ...(bootstrapContact ? { introductionBootstrap: { routes: [
        { id: 'unreachable', open: async () => { throw new Error('Entry point unavailable'); } },
        { id: 'independent-participant', open: async () => ({ contact: bootstrapContact,
          publish: envelope => globalThis.deliverIntroduction(envelope), close() {} }) }
      ] } } : {}),
      EventBus: { ...deps.EventBus, emit(type, payload) { events.push({ type, payload }); deps.EventBus.emit(type, payload); } },
      WebSocket: class { constructor() { throw new Error('Company signaling is blocked'); } }
    }) });
  await host.swarm.connect();
  return host.swarm.getIntroductions().exportContact();
}
export const receiveHost = envelope => host.swarm.getIntroductions().receive(null, 'reploid:introduction-signal', envelope,
  answer => globalThis.deliverIntroduction(answer));
export function hostState() {
  const state = host.swarm.getState();
  return { peers: state.consumer?.peers.map(peer => peer.peerId) || [], sharing: state.sharing,
    introductionAssistance: state.introductionAssistance, files: host.swarm.getFileState(),
    contributionPhase: state.contribution.phase };
}
export const allowHostIntroductions = value => host.swarm.allowIntroductions(value);
export const closeHost = () => host?.close();
