import { resolveConfig } from '../../vendor/reploid/config/index.js';
import profile from '../../config/reploid-library.json' with { type: 'json' };
import { getCurrentReploidStorage } from '../../instance.js';
import { getResolvedSignalingConfig } from './signaling-config.js';

export function createLegacyNetworkOptions(deps = {}, { enabled } = {}) {
  const win = globalThis.window;
  const storage = getCurrentReploidStorage();
  const params = new URLSearchParams(win?.location?.search || '');
  const swarmParam = params.get('swarm');
  const signaling = getResolvedSignalingConfig();
  const oldRoom = win?.localStorage?.getItem('REPLOID_SWARM_ROOM')?.trim();
  const randomId = () => globalThis.crypto.randomUUID();
  const explicit = !!(swarmParam && swarmParam !== 'true') || !!oldRoom || signaling.explicit;
  const roomSuffix = swarmParam && swarmParam !== 'true'
    ? swarmParam.trim() : storage.getItem('REPLOID_SWARM_ROOM_ID')?.trim() || randomId();
  const roomId = explicit ? `reploid-swarm-${roomSuffix}` : `reploid-swarm-${oldRoom || 'public'}`;
  const config = deps.config || resolveConfig({ profile: profile.profile, overrides: {
    mesh: { enabled: enabled === undefined ? !!swarmParam || storage.getItem('REPLOID_SWARM_ENABLED') !== 'false' : enabled, roomId },
    webrtc: { signalingUrl: signaling.url, broadcastRoomId: `reploid-swarm-${swarmParam && swarmParam !== 'true' ? swarmParam : oldRoom || 'public'}`, transportOrder: explicit ? ['webrtc','broadcast'] : ['broadcast'] }
  } });
  return {
    ...deps, config,
    getSessionId() {
      const target = win?.localStorage;
      const id = target?.getItem('REPLOID_SESSION_ID') || randomId();
      target?.setItem('REPLOID_SESSION_ID', id);
      return id;
    },
    getRoomCredentials() {
      const configuredRoom = config.value.mesh.roomId;
      const suffix = configuredRoom.replace(/^reploid-swarm-/, '');
      const token = params.get('swarmToken') || storage.getItem('REPLOID_SWARM_ROOM_TOKEN') || randomId() + randomId();
      if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(suffix) || token.length < 32) throw new Error('Invalid swarm room capability');
      storage.setItem('REPLOID_SWARM_ROOM_ID', suffix);
      storage.setItem('REPLOID_SWARM_ROOM_TOKEN', token);
      return { roomId: configuredRoom, token };
    }
  };
}
