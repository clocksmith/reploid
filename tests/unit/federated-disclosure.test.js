import { expect, it, vi } from 'vitest';
import FederatedLearning from '../../self/experimental/intelligence/federated-learning.js';

const fixture = () => {
  const transport = { _getPeerId: () => 'local', getConnectedPeers: () => [],
    broadcast: vi.fn(), onMessage: vi.fn() };
  const instance = FederatedLearning.factory({ SwarmTransport: transport,
    Utils: { logger: { warn: vi.fn() }, generateId: () => 'round' } });
  return { instance, transport };
};

it('refuses unsupported privacy and implicit plaintext disclosure before registering or sending', async () => {
  const { instance, transport } = fixture();
  await expect(instance.init()).rejects.toThrow('Explicit plaintext');
  await expect(instance.init({ allowPlaintextUpdates: true, secureAggregation: true })).rejects.toThrow('Secure aggregation');
  await expect(instance.init({ allowPlaintextUpdates: true, epsilon: 1 })).rejects.toThrow('Differential privacy');
  await expect(instance.startRound({ allowPlaintextUpdates: true })).rejects.toThrow('Explicit plaintext');
  expect(transport.onMessage).not.toHaveBeenCalled();
  expect(transport.broadcast).not.toHaveBeenCalled();
});

it('aggregates explicitly disclosed updates without the reconstructable public-nonce mask', async () => {
  const { instance } = fixture();
  await instance.init({ allowPlaintextUpdates: true, clipNorm: 10 });
  instance.setModel([0, 0]);
  instance.setLocalUpdateProvider(async () => [2, 4]);
  await instance.startRound();
  expect(instance.getModel()).toEqual({ model: { weights: [2, 4] }, version: 1 });
  await expect(instance.startRound({ secureAggregation: true })).rejects.toThrow('Secure aggregation');
});

it('does not commit a partial round when the declared participant minimum is missing', async () => {
  vi.useFakeTimers();
  try {
    const { instance, transport } = fixture();
    await instance.init({ allowPlaintextUpdates: true, minParticipants: 2, roundTimeoutMs: 100 });
    instance.setModel([0]);
    instance.setLocalUpdateProvider(async () => [1]);
    await instance.startRound();
    await vi.advanceTimersByTimeAsync(100);
    expect(instance.getModel()).toEqual({ model: { weights: [0] }, version: 0 });
    expect(transport.broadcast).toHaveBeenCalledWith('fl:round-failed', expect.objectContaining({ reason: 'missing_peers' }));
  } finally { vi.useRealTimers(); }
});
