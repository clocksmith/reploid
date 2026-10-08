import { describe, it, expect, vi } from 'vitest';
import { projectNetworkPeers, bindNetworkControls, renderConnectionControl,
  renderSharingControls } from '../../self/ui/pool-home/network-controls.js';

describe('network connection action', () => {
  it.each([
    ['connected', 'disconnected', 'disconnect', 'connect'],
    ['disconnected', 'connected', 'connect', 'disconnect']
  ])('preserves the selected action while %s becomes %s', async (shown, current, chosen, other) => {
    const state = connectionState => ({ models: [], network: { consumer: { connectionState, peers: [] } } });
    const session = { getState: () => state(current), connect: vi.fn(), disconnect: vi.fn(),
      subscribe: listener => { listener(state(shown)); return () => {}; } };
    const root = document.createElement('div');
    root.innerHTML = renderConnectionControl() + renderSharingControls()
      + '<ul data-insp-device-list></ul><span data-network-message></span>'
      + '<button data-mesh-invite></button><span data-mesh-peers></span>';
    const dispose = bindNetworkControls(root, session);
    try {
      root.querySelector('[data-mesh-connect]').click();
      await Promise.resolve();
      expect(session[chosen]).toHaveBeenCalledOnce();
      expect(session[other]).not.toHaveBeenCalled();
    } finally { dispose(); }
  });
});

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
