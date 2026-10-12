import { afterEach, expect, it, vi } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createAutomaticPartitions } from '../../packages/reploid/src/mesh/partitions/automatic-partitions.js';

// Exercise the actual contribution owner; discovery alone is supplied by this fixture.
vi.mock('../../packages/reploid/src/mesh/partitions/partition-discovery.js', () => ({
  createPartitionDiscovery: ({ catalog }) => ({
    getModels: () => [], refresh: async () => {}, close: async () => {},
    getSnapshot: () => [{ available: true, participantId: 'peer:' + '0'.repeat(24),
      transportId: 'remote', description: { phase: 'ready', index: 0,
        offer: { id: catalog[0].id, identity: catalog[0].identity } } }]
  })
}));
const cleanups = [];
afterEach(async () => { await Promise.allSettled(cleanups.splice(0).map(fn => fn())); });
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function fixture(closeResident, beforeLoad = async () => {}) {
  const identity = await createSigningIdentity({ algorithm: 'ECDSA' });
  const resident = { index: 1, close: vi.fn(closeResident),
    getState: () => ({ descriptor: { ready: true }, reservations: { active: 0, availableSlots: 1, closed: false } }) };
  const load = vi.fn(async (model, index, controls) => { await beforeLoad(controls); return { resident, model, planId: 'plan' }; });
  const mesh = createAutomaticPartitions({ identity, meshId: 'mesh',
    models: [{ id: 'model', identity: 'sha256:' + 'a'.repeat(64) }],
    policy: { pollMs: 60000, maxPeers: 4, connectTimeoutMs: 1000, grantMs: 10000,
      limits: { maxAttempts: 8 }, inputLimits: {}, receiver: {} },
    peers: () => [], createNetwork: () => ({ close: vi.fn(async () => {}) }), loadProgram: load });
  cleanups.push(() => mesh.close());
  return { mesh, resident, load };
}

it('coalesces overlapping stops and denies replacement until the owned resident settles', async () => {
  const closing = gate(); cleanups.push(() => closing.resolve());
  const f = await fixture(() => closing.promise);
  await f.mesh.contribute('model', true);
  const first = f.mesh.stop(), second = f.mesh.stop();
  let secondSettled = false; second.then(() => { secondSettled = true; });
  await vi.waitFor(() => expect(f.resident.close).toHaveBeenCalledTimes(1));
  await expect(f.mesh.contribute('model', true)).rejects.toThrow(/settle|stopping/i);
  expect(secondSettled).toBe(false);
  expect(f.mesh.getState().phase).not.toBe('idle');
  closing.resolve(); await Promise.all([first, second]);
  expect(f.mesh.getState().phase).toBe('idle');
  await f.mesh.contribute('model', true);
  expect(f.load).toHaveBeenCalledTimes(2);
  expect(f.mesh.getState().phase).toBe('ready');
});

it('keeps failed cleanup owned and blocks replacement until an explicit retry succeeds', async () => {
  let fail = true;
  const f = await fixture(async () => { if (fail) throw Error('device cleanup rejected'); });
  await f.mesh.contribute('model', true);
  await expect(f.mesh.stop()).rejects.toThrow('settlement failed');
  expect(f.mesh.getState().phase).toBe('failed');
  await expect(f.mesh.contribute('model', true)).rejects.toThrow(/settle|cleanup/i);
  fail = false; await f.mesh.stop();
  expect(f.resident.close).toHaveBeenCalledTimes(2);
  expect(f.mesh.getState().phase).toBe('idle');
  await f.mesh.contribute('model', true);
  expect(f.load).toHaveBeenCalledTimes(2);
});

it('waits for a cancelled loader and prevents its late result from retiring a replacement', async () => {
  const loading = gate(); cleanups.push(() => loading.resolve());
  const preparationClose = vi.fn(async () => {});
  const f = await fixture(async () => {}, ({ registerCleanup }) => {
    registerCleanup({ close: preparationClose }); return loading.promise;
  });
  const starting = f.mesh.contribute('model', true);
  await vi.waitFor(() => expect(f.load).toHaveBeenCalledTimes(1));
  expect(f.mesh.getState()).toMatchObject({ phase: 'loading', unsettledOwners: 0 });
  const stopping = f.mesh.stop();
  await expect(f.mesh.contribute('model', true)).rejects.toThrow(/settle|stopping/i);
  loading.resolve(); await Promise.all([starting, stopping]);
  expect(f.resident.close).toHaveBeenCalledTimes(1);
  expect(preparationClose).not.toHaveBeenCalled(); // Successful handoff owns cleanup through its resident.
  await f.mesh.contribute('model', true);
  expect(f.load).toHaveBeenCalledTimes(2);
  expect(f.mesh.getState().phase).toBe('ready');
});

it('retains failed loader resources and blocks replacement until explicit cleanup succeeds', async () => {
  let fail = true, rejectLoad = true;
  const cleanupOwner = { close: vi.fn(async () => { if (fail) throw new Error('unreturned Capsule cleanup failed'); }) };
  const f = await fixture(async () => {}, async ({ registerCleanup }) => {
    registerCleanup(cleanupOwner);
    if (rejectLoad) throw new Error('Capsule admission failed');
  });
  await f.mesh.contribute('model', true);
  expect(f.mesh.getState()).toMatchObject({ phase: 'failed', unsettledOwners: 1 });
  await expect(f.mesh.stop()).rejects.toThrow('settlement failed');
  await expect(f.mesh.contribute('model', true)).rejects.toThrow('settle');
  fail = false; await f.mesh.stop();
  expect(cleanupOwner.close).toHaveBeenCalledTimes(2);
  expect(f.mesh.getState()).toMatchObject({ phase: 'idle', unsettledOwners: 0 });
  rejectLoad = false; await f.mesh.contribute('model', true);
  expect(f.mesh.getState()).toMatchObject({ phase: 'ready', unsettledOwners: 0 });
});

it('retains cleanup registered by a loader that throws synchronously', async () => {
  const owner = { close: vi.fn(async () => {}) };
  const f = await fixture(async () => {});
  f.load.mockImplementation((_model, _index, { registerCleanup }) => {
    registerCleanup(owner); throw new Error('synchronous preparation failed');
  });
  await f.mesh.contribute('model', true);
  expect(f.mesh.getState()).toMatchObject({ phase: 'failed', unsettledOwners: 1 });
  await f.mesh.stop(); expect(owner.close).toHaveBeenCalledOnce();
  expect(f.mesh.getState()).toMatchObject({ phase: 'idle', unsettledOwners: 0 });
});

it('does not retain a preparation owner whose cleanup already succeeded', async () => {
  const close = vi.fn(async () => {});
  const f = await fixture(async () => {}, async ({ registerCleanup }) => {
    const settled = registerCleanup({ close });
    await close(); settled();
    throw new Error('authorized supplier unavailable');
  });
  await f.mesh.contribute('model', true);
  expect(f.mesh.getState()).toMatchObject({ phase: 'failed', unsettledOwners: 0,
    error: 'authorized supplier unavailable' });
  await f.mesh.stop();
  expect(close).toHaveBeenCalledOnce();
  expect(f.mesh.getState()).toMatchObject({ phase: 'idle', unsettledOwners: 0 });
});
