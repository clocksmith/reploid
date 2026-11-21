import rtcModule from '@roamhq/wrtc';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';
import { createMeshPeerIdentity } from '../../packages/reploid/src/mesh/peer-identity.js';
import { createWebRTCSwarm } from '../../packages/reploid/src/transport/swarm.js';

export function createPairingNetwork(turn) {
  const roomId = 'reploid-swarm-pairing-test';
  const signaling = [], joined = new Map(), connections = [];
  const rtcConfig = turn ? { iceTransportPolicy: 'relay', iceServers: [JSON.parse(turn)] } : { iceServers: [] };
  const config = resolveConfig({ overrides: { mesh: { enabled: true, roomId }, webrtc: { rtcConfig: { iceServers: [] } } } });
  const rtc = rtcModule.default ?? rtcModule;
  const logger = Object.fromEntries(['info', 'debug', 'warn', 'error'].map(key => [key, () => {}]));
  const start = async (peerId, identity) => {
    let receive;
    const transport = createWebRTCSwarm({ config, Utils: { logger, generateId: () => crypto.randomUUID() }, EventBus: { emit() {} },
      peerId, getSessionId: () => roomId, getRoomCredentials: () => ({ roomId, token: '' }), ...rtc,
      getRtcConfig: async () => rtcConfig,
      signalingAdapter: {
        subscribe(handler) { receive = handler; return () => { joined.delete(peerId); }; },
        publish(message) {
          signaling.push(message);
          if (message.type === 'join') {
            const peers = [...joined.keys()];
            joined.set(peerId, receive);
            queueMicrotask(() => void receive({ type: 'joined', roomId, peerId, peers }));
          } else if (message.targetPeer) {
            const deliver = joined.get(message.targetPeer);
            if (deliver) queueMicrotask(() => void deliver(message));
          }
        }
      } });
    const peerIdentity = createMeshPeerIdentity({ transport, getIdentity: () => identity, roomId, timeoutMs: 2000, maxPending: 4 });
    const endpoint = { transport, verifyPeer: peerIdentity.verify, currentPeer: peerIdentity.getVerified,
      close() { peerIdentity.close(); transport.disconnect(); } };
    connections.push(endpoint);
    await transport.init();
    return endpoint;
  };
  return { start, signaling, close() { for (const endpoint of connections) endpoint.close(); } };
}
