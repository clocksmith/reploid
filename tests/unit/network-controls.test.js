import { describe, it, expect, vi } from 'vitest';
import { projectNetworkPeers, bindNetworkControls, renderConnectionControl,
  renderSharingControls } from '../../self/ui/pool-home/network-controls.js';

it('offers cleanup retry instead of enabling contribution while an owner remains unsettled', async () => {
  const state = { models: [], network: { sharing: false, stopping: false,
    contribution: { phase: 'failed', unsettledOwners: 1 } } };
  let update;
  const session = { getState: () => state, setSharing: vi.fn(),
    subscribe: listener => { update = listener; listener(state); return () => {}; } };
  const root = document.createElement('div');
  root.innerHTML = renderConnectionControl() + renderSharingControls()
    + '<ul data-insp-device-list></ul><span data-network-message></span>'
    + '<button data-mesh-invite></button><span data-mesh-peers></span>';
  const dispose = bindNetworkControls(root, session);
  try {
    expect(root.querySelector('[data-contrib-label]').textContent).toBe('Cleanup not confirmed');
    expect(root.querySelector('[data-toggle-contribution]').disabled).toBe(true);
    const retry = root.querySelector('[data-retry-contribution-stop]');
    expect(retry.hidden).toBe(false); retry.click(); await Promise.resolve();
    expect(session.setSharing).toHaveBeenCalledWith(false, '', false);
    state.network.stopping = true; update(state); expect(retry.disabled).toBe(true);
    state.network.stopping = false; state.network.contribution = { phase: 'idle', unsettledOwners: 0 }; update(state);
    expect(retry.hidden).toBe(true);
    expect(root.querySelector('[data-toggle-contribution]').disabled).toBe(false);
    expect(root.querySelector('[data-contrib-label]').textContent).toBe('Not sharing');
  } finally { dispose(); }
});

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

it('requires a separate click to grant introduction assistance without granting compute or files', async () => {
  const state = { models: [], network: { introductionAssistance: false } };
  const session = { getState: () => state, subscribe: listener => { listener(state); return () => {}; },
    setIntroductionAssistance: vi.fn(), setSharing: vi.fn(), setFileSharing: vi.fn() };
  const root = document.createElement('div');
  root.innerHTML = renderConnectionControl() + renderSharingControls()
    + '<ul data-insp-device-list></ul><span data-network-message></span>'
    + '<button data-mesh-invite></button><span data-mesh-peers></span>';
  const dispose = bindNetworkControls(root, session);
  try {
    expect(session.setIntroductionAssistance).not.toHaveBeenCalled();
    root.querySelector('[data-toggle-introductions]').click();
    await Promise.resolve();
    expect(session.setIntroductionAssistance).toHaveBeenCalledWith(true);
    expect(session.setSharing).not.toHaveBeenCalled(); expect(session.setFileSharing).not.toHaveBeenCalled();
  } finally { dispose(); }
});
