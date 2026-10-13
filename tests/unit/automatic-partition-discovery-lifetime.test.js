import { afterEach, expect, it, vi } from 'vitest';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createAutomaticPartitions } from '../../packages/reploid/src/mesh/partitions/automatic-partitions.js';

const control = vi.hoisted(() => ({ peers: [], active: 0, closed: false, chat: null }));
vi.mock('../../packages/reploid/src/mesh/partitions/partition-discovery.js', () => ({
  createPartitionDiscovery: () => ({ getModels: () => [], refresh: async () => {}, close: async () => {},
    getSnapshot: () => control.peers })
}));
vi.mock('../../packages/reploid/src/mesh/partitions/partition-chat.js', () => ({
  createPartitionChat: () => control.chat
}));
let owner;
afterEach(async () => { await owner?.close(); owner = null; vi.useRealTimers(); });
async function fixture(index = 0) {
  const identity = await createSigningIdentity({ algorithm: 'ECDSA' });
  const model = { id: 'model', identity: 'sha256:' + 'a'.repeat(64) };
  control.active = 1; control.closed = false;
  control.peers = [{ available: true, participantId: index === 0 ? 'peer:zz' : 'peer:' + '0'.repeat(24), transportId: 'remote',
    description: { phase: 'ready', index: 1 - index, planId: 'plan', offer: model } }];
  control.chat = { getModels: () => [], refresh: async () => {}, getState: () => ({ active: control.active, attempts: [] }),
    close: vi.fn(async () => { control.active = 0; }) };
  const resident = { index, close: vi.fn(async () => {}),
    getState: () => ({ descriptor: { ready: true }, reservations: { active: control.active, availableSlots: 1, closed: false } }) };
  vi.useFakeTimers();
  owner = createAutomaticPartitions({ identity, meshId: 'mesh', models: [model],
    policy: { pollMs: 100, maxPeers: 4, connectTimeoutMs: 1000, grantMs: 10000,
      limits: { maxAttempts: 8 }, inputLimits: {}, receiver: {} }, peers: () => [],
    createNetwork: () => ({ close: async () => {}, connect: async () => ({ getState: () => ({ receipt: { closed: control.closed } }) }) }),
    loadProgram: async () => ({ resident, model, planId: 'plan' }) });
  await owner.contribute('model', true);
  return { resident, placement: owner.getState().placement };
}

it('keeps an active healthy route across discovery expiry and replica changes until settlement', async () => {
  const { placement, resident } = await fixture();
  control.peers = [];
  await vi.advanceTimersByTimeAsync(100);
  expect(control.chat.close).not.toHaveBeenCalled();
  expect(owner.getState()).toMatchObject({ phase: 'ready', placement });
  control.peers = [{ available: true, participantId: 'peer:replacement', transportId: 'replacement',
    description: { phase: 'ready', index: 1, planId: 'plan', offer: { id: 'model', identity: 'sha256:' + 'a'.repeat(64) } } }];
  await vi.advanceTimersByTimeAsync(100);
  expect(control.chat.close).not.toHaveBeenCalled();
  expect(owner.getState().placement).toEqual(placement);
  control.active = 0;
  await vi.advanceTimersByTimeAsync(100);
  expect(control.chat.close).toHaveBeenCalledOnce();
  expect(resident.close).not.toHaveBeenCalled();
  expect(owner.getState().placement[1]).toBe('peer:replacement');
});

it('does not treat a closed execution channel as healthy during discovery loss', async () => {
  await fixture(); control.peers = []; control.closed = true;
  await vi.advanceTimersByTimeAsync(100);
  expect(control.chat.close).toHaveBeenCalledOnce();
  expect(owner.getState().phase).toBe('waiting');
});

it('still stops an active route when contribution permission is withdrawn', async () => {
  const { resident } = await fixture();
  await owner.stop();
  expect(control.chat.close).toHaveBeenCalledOnce();
  expect(resident.close).toHaveBeenCalledOnce();
  expect(owner.getState().phase).toBe('idle');
});

// The output stage has no input-owner chat, but still owns admitted state.
it('does not reassign a busy output resident when discovery temporarily loses its input owner', async () => {
  const { resident, placement } = await fixture(1);
  control.peers = [{ available: true, participantId: 'peer:zz', transportId: 'replica',
    description: { phase: 'ready', index: 1, planId: 'plan', offer: { id: 'model', identity: 'sha256:' + 'a'.repeat(64) } } }];
  await vi.advanceTimersByTimeAsync(100);
  expect(resident.close).not.toHaveBeenCalled();
  expect(owner.getState().placement).toEqual(placement);
  await owner.stop();
  expect(resident.close).toHaveBeenCalledOnce();
});
