import { beforeEach, expect, it, vi } from 'vitest';
import { resolveConfig } from '../../self/vendor/reploid/config/index.js';

const ports = vi.hoisted(() => ({ ensure: vi.fn(), createTransport: vi.fn() }));
vi.mock('../../self/identity.js', () => ({ ensureIdentityBundle: ports.ensure,
  saveIdentityBundle: vi.fn(), rotateIdentityBundle: vi.fn() }));
vi.mock('../../self/vendor/reploid/transport/index.js', () => ({
  createSwarmTransport: ports.createTransport, createToolOfferChannel: vi.fn(),
  TOOL_OFFER_MESSAGE: 'offer', TOOL_OFFER_ACK: 'ack'
}));
import { createWorkSwarm } from '../../self/host/work-swarm.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
let values;
const fixture = () => createWorkSwarm({ service: {}, storage: {
  getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)
}, networkOptions: () => ({ autoConnect: true, discoveryScope: 'public',
  getInviteUrl: () => 'https://replo.id/?swarm=public',
  config: resolveConfig({ overrides: { mesh: { enabled: true, roomId: 'reploid-swarm-public' } } })
}) });
beforeEach(() => { vi.clearAllMocks(); values = new Map(); });

it('closes initialization before late identity resolution can open a transport', async () => {
  const identity = deferred(); ports.ensure.mockReturnValue(identity.promise);
  const swarm = fixture();
  const pending = swarm.connect({ automatic: true });
  const failed = expect(pending).rejects.toThrow('connection stopped');
  await vi.waitFor(() => expect(ports.ensure).toHaveBeenCalledOnce());
  const stopping = swarm.disconnect();
  identity.resolve({ peerId: 'fixture', contribution: {} });
  await stopping; await failed;
  expect(ports.createTransport).not.toHaveBeenCalled();
  expect(swarm.getState()).toMatchObject({ sharing: false, connecting: false, paused: true, consumer: null });
  expect(values.get('REPLOID_SWARM_ENABLED')).toBe('false');
  await swarm.connect({ automatic: true });
  expect(ports.ensure).toHaveBeenCalledOnce();
  await swarm.close();
});

it('coalesces attempts and disconnect retires an already opening transport', async () => {
  ports.ensure.mockResolvedValue({ peerId: 'fixture', contribution: {} });
  const initialized = deferred();
  const transport = { init: vi.fn(() => initialized.promise),
    disconnect: vi.fn(() => initialized.resolve(false)), onMessage: vi.fn(), broadcast: vi.fn(),
    getConnectionState: () => 'connecting', getTransportType: () => 'webrtc' };
  ports.createTransport.mockReturnValue(transport);
  const swarm = fixture();
  const first = swarm.connect({ automatic: true }), second = swarm.connect({ automatic: true });
  const outcomes = Promise.allSettled([first, second]);
  await vi.waitFor(() => expect(transport.init).toHaveBeenCalledOnce());
  await swarm.disconnect();
  expect((await outcomes).every(result => result.status === 'rejected')).toBe(true);
  expect(transport.disconnect).toHaveBeenCalled();
  expect(ports.createTransport).toHaveBeenCalledOnce();
  expect(swarm.autoConnectEnabled()).toBe(false);
  expect(swarm.getState().sharing).toBe(false);
  transport.init.mockResolvedValue(true);
  await swarm.connect();
  expect(swarm.autoConnectEnabled()).toBe(true);
  expect(values.get('REPLOID_SWARM_ENABLED')).toBe('true');
  expect(ports.createTransport).toHaveBeenCalledTimes(2);
  await swarm.close();
});
