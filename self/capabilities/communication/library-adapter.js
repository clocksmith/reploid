import { resolveConfig } from '../../vendor/reploid/config/index.js';
import profile from '../../config/reploid-library.json' with { type: 'json' };
import { getCurrentReploidStorage } from '../../instance.js';
import policy from '../../config/swarm-bootstrap.json' with { type: 'json' };
import { resolveSwarmJoin, resolveSwarmSignalingUrl } from './swarm-join-policy.js';
import { resolveRtcConfig } from '../../pool/p2p-transport.js';

export function createLegacyNetworkOptions(deps = {}, { enabled } = {}) {
  const win = globalThis.window;
  const storage = getCurrentReploidStorage();
  const params = new URLSearchParams(win?.location?.search || '');
  const randomId = () => globalThis.crypto.randomUUID();
  const location = win?.location || { href: 'http://localhost:8000/' };
  const join = resolveSwarmJoin({ location, storage, policy, randomId });
  const signalingUrl = resolveSwarmSignalingUrl({ location, policy, join, privateOverride: params.get('signaling') });
  const config = deps.config || resolveConfig({ profile: profile.profile, overrides: {
    mesh: { enabled: enabled === undefined ? true : enabled, roomId: join.roomId },
    webrtc: { signalingUrl, broadcastRoomId: join.roomId, transportOrder: ['webrtc'] }
  } });
  return {
    ...deps, config, rtcConfig: deps.rtcConfig || resolveRtcConfig(),
    autoConnect: join.autoConnect && enabled !== false, discoveryScope: join.scope,
    getInviteUrl() {
      const url = new URL(location.href);
      for (const key of ['room', 'swarm', 'swarmToken', 'signaling', 'instance']) url.searchParams.delete(key);
      url.searchParams.set('swarm', join.scope === 'public' ? 'public' : join.roomId);
      if (join.scope === 'private') {
        url.searchParams.set('swarmToken', join.token);
        if (params.get('signaling')) url.searchParams.set('signaling', params.get('signaling'));
      }
      return url.href;
    },
    getSessionId() {
      const target = win?.localStorage;
      const id = target?.getItem('REPLOID_SESSION_ID') || randomId();
      target?.setItem('REPLOID_SESSION_ID', id);
      return id;
    },
    getRoomCredentials() {
      return { roomId: join.roomId, token: join.token };
    }
  };
}
