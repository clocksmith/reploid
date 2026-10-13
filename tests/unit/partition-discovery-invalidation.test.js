import { describe, it, expect, vi } from 'vitest';
import { createPartitionDiscovery } from '../../packages/reploid/src/mesh/partitions/partition-discovery.js';

describe('authoritative entry unavailability', () => {
  it('withdraws only the rejected model and does not resurrect it from an older in-flight observation', async () => {
    const selected = { id: 'selected', identity: 'sha256:selected', availability: 'ready' };
    const unrelated = { id: 'unrelated', identity: 'sha256:unrelated', availability: 'ready' };
    const description = { participantId: 'input-owner', models: [selected, unrelated], index: 0,
      phase: 'ready', capacity: { availableSlots: 2, active: 0, closed: false } };
    const request = vi.fn(async () => structuredClone(description));
    let networkOptions;
    const changed = vi.fn();
    const discovery = createPartitionDiscovery({ identity: { peerId: 'requester' },
      catalog: [selected, unrelated], policy: { maxPeers: 2, connectTimeoutMs: 100,
        inputLimits: { descriptorTtlMs: 10000 } }, peers: () => [], describe: () => ({}),
      onChange: changed, createNetwork(options) {
        networkOptions = options; return { async close() {} };
      } });
    networkOptions.onPeer('transport-a', { participantId: 'input-owner', description: null,
      observedAt: 0, revision: 0, endpoint: { request } });
    try {
      await discovery.refresh();
      expect(discovery.getModels()).toEqual([selected, unrelated]);
      let finishOldObservation;
      request.mockImplementationOnce(() => new Promise(resolve => { finishOldObservation = resolve; }));
      const pending = discovery.refresh();
      discovery.invalidateModel('transport-a', selected);
      expect(discovery.getModels()).toEqual([unrelated]);
      expect(changed.mock.lastCall[0][0].description.models).toEqual([unrelated]);
      expect(discovery.getSnapshot()[0].description.capacity).toEqual(description.capacity);
      finishOldObservation(structuredClone(description)); await pending;
      expect(discovery.getModels()).toEqual([unrelated]);
      // A subsequent successful observation can offer the model again.
      await discovery.refresh();
      expect(discovery.getModels()).toEqual([selected, unrelated]);
    } finally { await discovery.close(); }
  });
});
it('retries only unsettled discovery transport after a failed close', async () => {
  const close = vi.fn().mockRejectedValueOnce(Error('transport still owned')).mockResolvedValue(undefined);
  const discovery = createPartitionDiscovery({ identity: { peerId: 'owner' }, catalog: [],
    policy: { maxPeers: 2, connectTimeoutMs: 100, inputLimits: { descriptorTtlMs: 1000 } },
    peers: () => [], describe: () => ({}), createNetwork: () => ({ close }) });
  const pending = discovery.close(); expect(discovery.close()).toBe(pending);
  await expect(pending).rejects.toThrow('settlement failed');
  await discovery.close(); await discovery.close(); expect(close).toHaveBeenCalledTimes(2);
});

it('admits explicitly versioned ordered inventories with host bounds, preserving the legacy index guard', async () => {
  let networkOptions;
  const ordered = { schema: 'reploid.partition-capability/v2', participantId: 'contributor', phase: 'ready',
    capacity: { availableSlots: 5, active: 0, closed: false }, models: [0, 6].map(index => ({ id: 'model',
      identity: 'sha256:' + 'a'.repeat(64), availability: 'ready', planId: 'plan', index,
      residentId: 'resident-' + index, executionId: 'execution', activation: {} })) };
  const request = vi.fn(async () => structuredClone(ordered));
  const policy = { maxPeers: 2, maxStageOffersPerPeer: 2, connectTimeoutMs: 100, inputLimits: { descriptorTtlMs: 1000 } };
  const discovery = createPartitionDiscovery({ identity: { peerId: 'requester' }, catalog: [], policy,
    peers: () => [], describe: () => ({}), createNetwork: options => { networkOptions = options; return { async close() {} }; } });
  networkOptions.onPeer('transport', { participantId: 'contributor', description: null, observedAt: 0, revision: 0, endpoint: { request } });
  try {
    await discovery.refresh(); expect(discovery.getModels()).toHaveLength(2);
    delete policy.maxStageOffersPerPeer;
    await discovery.refresh(); expect(discovery.getModels()).toEqual([]);
    policy.maxStageOffersPerPeer = 1;
    await discovery.refresh(); expect(discovery.getModels()).toEqual([]);
    policy.maxStageOffersPerPeer = 2;
    request.mockResolvedValue({ ...ordered, participantId: 'impostor' });
    await discovery.refresh(); expect(discovery.getModels()).toEqual([]);
    request.mockResolvedValue({ participantId: 'contributor', phase: 'ready', index: 6, models: [] });
    await discovery.refresh(); expect(discovery.getModels()).toEqual([]);
  } finally { await discovery.close(); }
});
