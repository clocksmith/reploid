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
    expect(projectNetworkPeers(state)).toMatchObject([
      { id: 'remote', model: 'Qwen', phase: 'loading', partitionIndex: 1, status: 'Preparing' },
      { id: 'requester', model: 'No model offered', phase: null, partitionIndex: null, status: 'Connected' }
    ]);
    state.network.partitionPeers[0].available = false;
    expect(projectNetworkPeers(state)[0]).toMatchObject({ model: 'No model offered', status: 'Connected' });
  });
  it('never calls an unplaced offer ready or a whole-model offer a partition', () => {
    const state = { network: { consumer: { peers: [{ peerId: 'waiting' }, { peerId: 'whole', model: 'Whole model', role: 'provider' }] },
      partitionPeers: [{ transportId: 'waiting', available: true, description: { offer: { id: 'qwen' }, index: null, phase: 'waiting' } }] } };
    expect(projectNetworkPeers(state).map(peer => peer.status)).toEqual(['Needs contributor', 'Status unknown']);
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

it('selects bounded file participation separately from compute and preserves the approved allowance', async () => {
  const state={models:[{id:'fixture',name:'Fixture'}],network:{files:{limits:{storedBytes:3221225472,supplyBytes:4294967296}}}};
  let update;
  const session={getState:()=>state,setSharing:vi.fn(),setFileSharing:vi.fn(),subscribe:listener=>{update=listener;listener(state);return()=>{};}};
  const root=document.createElement('div');root.innerHTML=renderConnectionControl()+renderSharingControls()
    +'<ul data-insp-device-list></ul><span data-network-message></span><button data-mesh-invite></button><span data-mesh-peers></span>';
  const dispose=bindNetworkControls(root,session);
  try {
    const mode=root.querySelector('[data-file-mode]'), input=root.querySelector('[data-file-download]');
    expect(mode.value).toBe('cached-only');expect(session.setFileSharing).not.toHaveBeenCalled();
    mode.value='bounded-acquisition';mode.dispatchEvent(new Event('change'));input.value='32';
    expect(root.querySelector('[data-file-download-label]').hidden).toBe(false);
    root.querySelector('[data-toggle-file-contribution]').click();await Promise.resolve();
    expect(session.setFileSharing).toHaveBeenCalledWith(true,'fixture',true,{mode:'bounded-acquisition',downloadBytes:33554432});
    expect(session.setSharing).not.toHaveBeenCalled();
    state.network.files.acquisitionBudget={maxBytes:33554432,reservedBytes:1048576};update(state);
    expect(input.disabled).toBe(true);expect(input.value).toBe('32');expect(root.querySelector('[data-file-limits]').textContent).toContain('Download allowance used');
    state.network.files.stopping=true;update(state);
    expect(root.querySelector('[data-toggle-file-contribution]').disabled).toBe(true);
  } finally {dispose();}
});

it('states the whole-model download and storage before full-model seeding is switched on', () => {
  const state={models:[{id:'fixture',name:'Fixture'}],network:{files:{limits:{storedBytes:3221225472,supplyBytes:4294967296},
    seedingBytes:{fixture:1156250409}}}};
  const session={getState:()=>state,setSharing:vi.fn(),setFileSharing:vi.fn(),subscribe:listener=>{listener(state);return()=>{};}};
  const root=document.createElement('div');root.innerHTML=renderConnectionControl()+renderSharingControls()
    +'<ul data-insp-device-list></ul><span data-network-message></span><button data-mesh-invite></button><span data-mesh-peers></span>';
  const dispose=bindNetworkControls(root,session);
  try {
    const mode=root.querySelector('[data-file-mode]'), limits=()=>root.querySelector('[data-file-limits]').textContent;
    expect(limits()).not.toContain('Full-model seeding');
    mode.value='full-model';mode.dispatchEvent(new Event('change'));
    expect(limits()).toContain('Full-model seeding downloads and keeps 1.08 GiB on this device');
    expect(limits()).toContain('at least 1,103 MiB');
    expect(session.setFileSharing).not.toHaveBeenCalled();
    delete state.network.files.seedingBytes;mode.dispatchEvent(new Event('change'));
    expect(limits()).toContain('checked against your allowance when seeding starts');
  } finally {dispose();}
});


it('shows whole-model readiness even when the separate partition offer is idle', () => {
  const state = { network: { consumer: { peers: [{ peerId: 'whole', model: 'qwen', readiness: 'ready', availableSlots: 1 }] },
    partitionPeers: [{ transportId: 'whole', available: true, description: { phase: 'idle', models: [] } }] } };
  expect(projectNetworkPeers(state)[0]).toMatchObject({ status: 'Ready', phase: 'ready', partitionIndex: null });
  state.network.consumer.peers[0].availableSlots = 0;
  expect(projectNetworkPeers(state)[0]).toMatchObject({ status: 'At capacity', phase: 'busy' });
});

it.each([
  [{ kind: 'downloading', receivedBytes: 5, totalBytes: 10 }, 'Downloading', '50% of the current file'],
  [{ kind: 'receiving' }, 'Receiving files', 'another computer'],
  [{ kind: 'cached' }, 'Loading cache', 'already stored'],
  [{ kind: 'pipelines', prepared: 3, total: 9 }, 'Preparing GPU', '3 of 9'],
  [null, 'Preparing', 'has not reported the current step']
])('shows the reported preparation step without guessing missing progress', (preparation, status, detail) => {
  const state = { network: { consumer: { peers: [{ peerId: 'remote', model: 'qwen', readiness: 'loading', preparation }] } } };
  expect(projectNetworkPeers(state)[0]).toMatchObject({ status, detail: expect.stringContaining(detail) });
});


it('keeps transport attempts visible before advertisements and never treats interruption as ready', () => {
  const state = { network: { consumer: { peerId: 'local', connections: [
    { id: 'local', phase: 'connected' }, { id: 'remote', phase: 'preparing' }
  ], peers: [] } } };
  expect(projectNetworkPeers(state)).toMatchObject([{ id: 'remote', status: 'Preparing connection', connectionPhase: 'preparing' }]);
  const connection = state.network.consumer.connections[1];
  connection.phase = 'connected';
  expect(projectNetworkPeers(state)[0]).toMatchObject({ status: 'Connected', detail: expect.stringContaining('Waiting') });
  state.network.consumer.peers = [{ peerId: 'remote', model: 'Qwen', readiness: 'loading', preparation: { kind: 'receiving', receivedBytes: 50, totalBytes: 100 } }];
  expect(projectNetworkPeers(state)[0]).toMatchObject({ status: 'Receiving files', progress: { value: 50, max: 100 } });
  state.network.consumer.peers[0].readiness = 'ready';
  expect(projectNetworkPeers(state)[0].status).toBe('Ready');
  connection.phase = 'interrupted';
  expect(projectNetworkPeers(state)[0]).toMatchObject({ status: 'Connection interrupted', phase: 'interrupted' });
  state.network.consumer.connections = []; state.network.consumer.peers = [];
  state.network.connectionFailure = { peerId: 'remote', message: 'Timed out' };
  expect(projectNetworkPeers(state)[0].status).toBe('Connection failed');
});


it('preserves one DOM row, its details and attempt identity through delayed observations and reconnect', () => {
  const state = { models: [], network: { connections: [{ id: 'peer', attemptId: 'first', phase: 'preparing' }], consumer: { peers: [] } } };
  let update;
  const session = { getState: () => state, subscribe(listener) { update = listener; listener(state); return () => {}; } };
  const root = document.createElement('div'); root.innerHTML = renderConnectionControl() + renderSharingControls()
    + '<ul data-insp-device-list></ul><span data-network-message></span><button data-mesh-invite></button><span data-mesh-peers></span>';
  const dispose = bindNetworkControls(root, session);
  try {
    const row = root.querySelector('[data-computer-id]'), details = row.querySelector('details'); details.open = true;
    expect(row.dataset.attemptId).toBe('first');
    state.network.connections[0].phase = 'connected'; update(state);
    expect(row.dataset.computerState).toBe('awaiting-advertisement');
    expect(row.textContent).toContain('Waiting for this computer');
    state.network.consumer.peers = [{ peerId: 'peer', attemptId: 'first', model: 'Qwen', readiness: 'ready', activity: { phase: 'executing' } }]; update(state);
    expect(row.dataset.computerState).toBe('executing'); expect(row.textContent).toContain('Working');
    state.network.connections[0].phase = 'disconnected'; update(state);
    expect(row.textContent).toContain('cleanup state are unknown'); expect(row.textContent).toContain('Last model: Qwen');
    state.network.connections[0] = { id: 'peer', attemptId: 'second', phase: 'connected' }; update(state);
    expect(row.dataset.computerState).toBe('awaiting-advertisement');
    expect(row.dataset.attemptId).toBe('second'); expect(row.textContent).not.toContain('Working');
    expect(root.querySelectorAll('[data-computer-id]').length).toBe(1); expect(root.querySelector('[data-computer-id]')).toBe(row);
    expect(row.querySelector('details')).toBe(details); expect(details.open).toBe(true);
  } finally { dispose(); }
});
