// @vitest-environment node
import { it, expect, vi } from 'vitest';
const observed = vi.hoisted(() => ({ options: null }));
vi.mock('../../shared/vendor/reploid/transport/index.js', async importOriginal => ({
  ...await importOriginal(),
  createSwarmTransport: options => { observed.options = options; throw new Error('transport-witness'); }
}));
import { createNativeParticipant } from '../../server/native-participant-runtime.js';
import { createSigningIdentity } from '../../shared/vendor/reploid/artifacts/identity.js';
import bootstrap from '../../shared/config/swarm-bootstrap.json' with { type: 'json' };
it('forwards the live configuration port to transport without opening a GPU', async () => {
  const getRtcConfig = vi.fn(async () => ({ iceServers: [], iceTransportPolicy: 'relay' }));
  const nativeGpu = vi.fn();
  await expect(createNativeParticipant({ identity: await createSigningIdentity({ algorithm: 'Ed25519' }),
    model: { id: 'test', identity: 'sha256:' + 'a'.repeat(64) }, modelDirectory: '/unused', nativeGpu,
    rtc: { RTCPeerConnection: class {} }, WebSocket: class {}, signalingUrl: bootstrap.signalingUrl,
    roomId: bootstrap.publicRoomId, roomToken: bootstrap.publicJoinMarker, getRtcConfig,
    executionMode: 'whole-model', createWholeModel: () => ({ getExecutionState: () => ({ ready: false }), getState: () => ({ ready: false }), close: async () => {} })
  })).rejects.toThrow('transport-witness');
  expect(observed.options.getRtcConfig).toBe(getRtcConfig);
  expect(await observed.options.getRtcConfig()).toEqual({ iceServers: [], iceTransportPolicy: 'relay' });
  expect(nativeGpu).not.toHaveBeenCalled();
});
