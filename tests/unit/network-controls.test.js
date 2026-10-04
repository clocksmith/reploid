import { describe, it, expect } from 'vitest';
import { projectNetworkPeers } from '../../self/ui/pool-home/network-controls.js';

describe('network model projection', () => {
  it('shows verified partition offers alongside transport peers and excludes this tab', () => {
    const peers = [{ peerId: 'local' }, { peerId: 'remote' }, { peerId: 'requester' }];
    const state = { models: [{ id: 'qwen', name: 'Qwen' }], network: {
      consumer: { peerId: 'local', peers }, supplier: { peers },
      partitionPeers: [{ transportId: 'remote', available: true,
        description: { offer: { id: 'qwen' }, index: 1, phase: 'loading' } }]
    } };
    expect(projectNetworkPeers(state)).toEqual([
      { id: 'remote', model: 'Qwen', status: 'Partition 2 · loading' },
      { id: 'requester', model: 'No model offered', status: 'Connected' }
    ]);
    state.network.partitionPeers[0].available = false;
    expect(projectNetworkPeers(state)[0]).toMatchObject({ model: 'No model offered', status: 'Connected' });
  });
  it('never calls an unplaced offer ready or a whole-model offer a partition', () => {
    const state = { network: { consumer: { peers: [{ peerId: 'waiting' }, { peerId: 'whole', model: 'Whole model', role: 'provider' }] },
      partitionPeers: [{ transportId: 'waiting', available: true, description: { offer: { id: 'qwen' }, index: null, phase: 'waiting' } }] } };
    expect(projectNetworkPeers(state).map(peer => peer.status)).toEqual(['Waiting for placement', 'Offered']);
  });
});
