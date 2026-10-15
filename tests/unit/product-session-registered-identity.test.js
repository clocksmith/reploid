// With an earning account, the browser product session requests as the participant it registered for that
// account (host/credits/browser.js), so a charged route's requester is the paying account's device. Without
// one, each connection keeps its own identity. The product session and work swarm are the shipped modules;
// only the signaling mesh, transport, identity storage, model-file IO and peer-offer lock are injected.
import { afterEach, expect, it, vi } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { resolveConfig } from '../../self/vendor/reploid/config/index.js';

const ports = vi.hoisted(() => ({ connection: null, bound: [], saved: 0, meshes: [] }));
vi.mock('../../self/identity.js', async original => ({ ...await original(),
  ensureIdentityBundle: async () => ports.connection, saveIdentityBundle: async () => { ports.saved += 1; } }));
vi.mock('../../self/vendor/reploid/mesh/index.js', async original => ({ ...await original(),
  createLegacyGenerationMesh: ({ ports: input }) => {
    let identity = null;
    const mesh = { async connect() { identity = await input.identity.ensure({}); input.createTransport(); }, async close() {},
      save: bundle => input.identity.save(bundle), rotate: value => input.identity.rotate(value),
      getSwarmSnapshot: () => ({ peerId: identity?.peerId ?? null, connectionState: identity ? 'connected' : 'disconnected', peers: [] }) };
    ports.meshes.push(mesh);
    return mesh;
  },
  createAutomaticPartitions: options => { ports.bound.push(options.identity.peerId); return { getModels: () => [], subscribe: () => () => {}, close: async () => {}, getState: () => ({}) }; }
}));
vi.mock('../../self/vendor/reploid/transport/index.js', async original => ({ ...await original(),
  createSwarmTransport: () => ({ disconnect() {}, _getPeerId: () => 'transport-requester', getConnectedPeers: () => [] }) }));
vi.mock('../../self/host/work-model-files.js', async original => ({ ...await original(),
  createWorkModelFiles: () => ({ async attach() {}, async close() {}, announce() {}, getState: () => ({ sharing: false, preparing: false }) }) }));
vi.mock('../../self/host/work-peer-offers.js', () => ({ createWorkPeerOffers: () => ({
  acquire: async () => 'transport-requester', attach: async () => {}, close() {}, getState: () => null }) }));
import { createProductSession } from '../../self/host/product-session.js';

const cleanups = [];
afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map(close => close()));
  Object.assign(ports, { connection: null, bound: [], saved: 0, meshes: [] });
});
const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
};
const open = async participantIdentity => {
  const host = await createProductSession({ storage: memoryStorage(), operationNetwork: null, canonical: null, ordered: null, networkOptions: () => ({}),
    swarmNetworkOptions: () => ({ autoConnect: true, discoveryScope: 'public', config: resolveConfig({ overrides: { mesh: { roomId: 'mesh' } } }) }),
    ...(participantIdentity ? { participantIdentity } : {}) });
  cleanups.push(() => host.close());
  return host;
};

it('requests as the registered participant when the earning account supplies one, and as the connection identity otherwise', async () => {
  const registered = await createSigningIdentity({ algorithm: 'Ed25519' });
  ports.connection = await createSigningIdentity({ algorithm: 'Ed25519' });
  const host = await open(async () => registered);
  await vi.waitFor(() => expect(host.swarm.partitions.requesterIdentity()).toBe(registered.peerId), { timeout: 5000 });
  expect(ports.bound).toEqual([registered.peerId]);
  // Connection counters are saved to the copy only; the registered identity is never rotated or stored by the swarm.
  await ports.meshes[0].save({ ...registered, contribution: { receiptsConsumed: 1 } });
  expect(ports.saved).toBe(0);
  expect(() => ports.meshes[0].rotate({})).toThrow('does not rotate here');
  expect(registered).not.toHaveProperty('contribution');

  // A page without an earning service resolves no identity: the connection's own identity applies.
  const plain = await open(async () => null);
  await vi.waitFor(() => expect(plain.swarm.partitions.requesterIdentity()).toBe(ports.connection.peerId), { timeout: 5000 });
}, 20000);
