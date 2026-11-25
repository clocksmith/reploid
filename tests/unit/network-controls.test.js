import { describe, it, expect, vi } from 'vitest';
import { projectNetworkPeers, bindNetworkControls, renderConnectionControl,
  renderSharingControls } from '../../apps/poolday/ui/pool-home/network-controls.js';

it('offers cleanup retry instead of enabling contribution while an owner remains unsettled', async () => {
  const state = { models: [], network: { sharing: false, stopping: false,
    contribution: { modelId: 'resident', phase: 'failed', unsettledOwners: 1 } } };
  let update;
  const session = { getState: () => state, setComputeContribution: vi.fn(),
    subscribe: listener => { update = listener; listener(state); return () => {}; } };
  const root = document.createElement('div');
  root.innerHTML = renderConnectionControl() + renderSharingControls()
    + '<ul data-insp-device-list></ul><span data-network-message></span>'
    + '<button data-mesh-invite></button>';
  const dispose = bindNetworkControls(root, session);
  try {
    expect(root.querySelector('[data-contrib-label]').textContent).toBe('Cleanup not confirmed');
    expect(root.querySelector('[data-toggle-contribution]').disabled).toBe(true);
    const retry = root.querySelector('[data-retry-contribution-stop]');
    expect(retry.hidden).toBe(false); retry.click(); await Promise.resolve();
    expect(session.setComputeContribution).toHaveBeenCalledWith(false);
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
      + '<button data-mesh-invite></button>';
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
    + '<button data-mesh-invite></button>';
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
    +'<ul data-insp-device-list></ul><span data-network-message></span><button data-mesh-invite></button>';
  const dispose=bindNetworkControls(root,session);
  try {
    const mode=value=>root.querySelector(`[data-file-mode][value="${value}"]`), input=root.querySelector('[data-file-download]');
    // Files to share is a single-select list: one radio group whose rows state what each mode downloads.
    expect(mode('cached-only').closest('[role=radiogroup]')).not.toBeNull();
    expect(root.querySelector('[data-file-mode]:checked').value).toBe('cached-only');expect(session.setFileSharing).not.toHaveBeenCalled();
    expect(mode('cached-only').closest('.pool-option').textContent).toContain('Nothing is downloaded yet');
    mode('bounded-acquisition').click();input.value='32';
    expect(root.querySelector('[data-file-download-label]').hidden).toBe(false);
    root.querySelector('[data-toggle-file-contribution]').click();await Promise.resolve();
    expect(session.setFileSharing).toHaveBeenCalledWith(true,'fixture',true,{mode:'bounded-acquisition',downloadBytes:33554432});
    expect(session.setSharing).not.toHaveBeenCalled();
    state.network.files.acquisitionBudget={maxBytes:33554432,reservedBytes:1048576};update(state);
    expect(input.disabled).toBe(true);expect(input.value).toBe('32');expect(root.querySelector('[data-file-limits]').textContent).toContain('Download allowance used');
    state.network.files.stopping=true;update(state);
    expect(root.querySelector('[data-toggle-file-contribution]').disabled).toBe(true);
    // While files are shared the mode is fixed, and each row says how to change it.
    expect(mode('full-model').disabled).toBe(true);
    expect(mode('full-model').closest('.pool-option').textContent).toContain('Turn off Share model files to change this.');
  } finally {dispose();}
});

it('states the whole-model download and storage before full-model seeding is switched on', () => {
  const state={models:[{id:'fixture',name:'Fixture'}],network:{files:{limits:{storedBytes:3221225472,supplyBytes:4294967296},
    seedingBytes:{fixture:1156250409}}}};
  const session={getState:()=>state,setSharing:vi.fn(),setFileSharing:vi.fn(),subscribe:listener=>{listener(state);return()=>{};}};
  const root=document.createElement('div');root.innerHTML=renderConnectionControl()+renderSharingControls()
    +'<ul data-insp-device-list></ul><span data-network-message></span><button data-mesh-invite></button>';
  const dispose=bindNetworkControls(root,session);
  try {
    const mode=root.querySelector('[data-file-mode][value="full-model"]'), limits=()=>root.querySelector('[data-file-limits]').textContent;
    expect(limits()).not.toContain('Full-model seeding');
    mode.click();
    expect(limits()).toContain('Full-model seeding downloads and keeps 1.08 GiB on this device');
    expect(limits()).toContain('at least 1,103 MiB');
    expect(session.setFileSharing).not.toHaveBeenCalled();
    delete state.network.files.seedingBytes;mode.dispatchEvent(new Event('change',{bubbles:true}));
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
    + '<ul data-insp-device-list></ul><span data-network-message></span><button data-mesh-invite></button>';
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
    expect(row.textContent).toContain('cleanup state are unknown');
    expect(row.querySelector('[data-computer-model-label]').textContent).toBe('Last model');
    expect(row.querySelector('[data-computer-model]').textContent).toBe('Qwen');
    state.network.connections[0] = { id: 'peer', attemptId: 'second', phase: 'connected' }; update(state);
    expect(row.dataset.computerState).toBe('awaiting-advertisement');
    expect(row.dataset.attemptId).toBe('second'); expect(row.textContent).not.toContain('Working');
    expect(root.querySelectorAll('[data-computer-id]').length).toBe(1); expect(root.querySelector('[data-computer-id]')).toBe(row);
    expect(row.querySelector('details')).toBe(details); expect(details.open).toBe(true);
  } finally { dispose(); }
});

it('shows reported peer hardware without leaking host metadata or inventing local hardware', () => {
  const state = { models: [], network: { consumer: { peers: [{ peerId: 'peer-a', model: 'model', readiness: 'ready',
    hardware: { vendor: 'AMD', description: 'Reported adapter', hostname: 'private-machine' } }] } } };
  const session = { getState: () => state, subscribe(fn) { fn(state); return () => {}; } };
  const root = document.createElement('div');
  root.innerHTML = renderConnectionControl() + renderSharingControls() + '<ul data-insp-device-list></ul><span data-network-message></span>'
    + '<button data-mesh-invite></button><p data-local-computer></p>';
  const dispose = bindNetworkControls(root, session);
  expect(root.querySelector('[data-computer-hardware]').textContent).toBe('AMD');
  expect(root.querySelector('[data-computer-hardware-row] dt').textContent).toContain('(reported)');
  expect(root.querySelector('[data-local-computer]').textContent).toBe('GPU not reported');
  expect(root.textContent).not.toContain('private-machine'); dispose();
});

it('projects only explicitly reported nonnegative integer contribution counts', () => {
  const peers = [
    { peerId: 'reported', contribution: { providedInputTokens: 128, providedOutputTokens: 0, receiptsServed: 2, receiptsConsumed: 3 } },
    { peerId: 'missing' },
    { peerId: 'invalid', contribution: { providedInputTokens: '128', providedOutputTokens: -1, receiptsServed: 1.5, receiptsConsumed: Infinity } }
  ];
  const rows = projectNetworkPeers({ network: { consumer: { peers } } });
  expect(rows[0].contribution).toEqual({ inputTokens: 128, outputTokens: 0, served: 2, consumed: 3 });
  for (const row of rows.slice(1)) expect(row.contribution).toEqual({ inputTokens: null, outputTokens: null, served: null, consumed: null });
});

it('renders reported contribution scope and clears counts when the connection loses its advertisement', () => {
  const state = { models: [], network: { consumer: { peers: [{ peerId: 'remote', readiness: 'ready',
    contribution: { providedInputTokens: 128, providedOutputTokens: 0, receiptsServed: 1, receiptsConsumed: 2 } }] } } };
  let update;
  const session = { getState: () => state, subscribe: listener => { update = listener; listener(state); return () => {}; } };
  const root = document.createElement('div');
  root.innerHTML = renderConnectionControl() + renderSharingControls()
    + '<ul data-insp-device-list></ul><span data-network-message></span><button data-mesh-invite></button>';
  const dispose = bindNetworkControls(root, session);
  try {
    const row = root.querySelector('[data-computer-id="remote"]');
    expect(row.querySelector('[data-computer-input-tokens]').textContent).toBe('128');
    expect(row.querySelector('[data-computer-output-tokens]').textContent).toBe('0');
    expect(root.querySelector('[data-computer-usage-scope]').textContent).toContain('Peer-reported reward-eligible');
    expect(root.querySelector('[data-computer-usage-scope]').textContent).toContain('Consumed token counts are not reported');
    expect(row.querySelector('[data-computer-served-receipts]').textContent).toBe('1');
    expect(row.querySelector('[data-computer-consumed-receipts]').textContent).toBe('2');
    expect(row.querySelector('table[aria-label="Peer-reported eligible contribution"]')).not.toBeNull();
    expect(row.querySelector('[data-computer-identity]').textContent).toBe('Not reported');
    expect(row.querySelector('[data-computer-connection-id]').textContent).toBe('remote');
    expect(row.querySelector('[data-computer-identifiers]').open).toBe(false);
    row.querySelector('details').open = true;
    state.network.consumer.peers[0].contribution.providedOutputTokens = 4; update(state);
    expect(root.querySelector('[data-computer-id="remote"]')).toBe(row);
    expect(row.querySelector('details').open).toBe(true);
    expect(row.querySelector('[data-computer-output-tokens]').textContent).toBe('4');
    state.network.consumer.peers = [];
    state.network.consumer.connections = [{ id: 'remote', phase: 'disconnected' }]; update(state);
    expect(row.querySelector('[data-computer-input-tokens]').textContent).toBe('Not reported');
    expect(row.querySelector('[data-computer-output-tokens]').textContent).toBe('Not reported');
    expect(row.querySelector('[data-computer-served-receipts]').textContent).toBe('Not reported');
    expect(root.querySelectorAll('[data-computer-usage-help]').length).toBe(1);
  } finally { dispose(); }
});

it('preserves the disconnect action for surviving peers and keeps private invitation errors out of public discovery', () => {
  const network = { introductionState: 'stopped', consumer: { connectionState: 'connected', peers: [] },
    discoveryScope: 'public', error: 'Missing private invitation' };
  const state = { models: [], network };
  const root = document.createElement('div');
  root.innerHTML = renderConnectionControl() + renderSharingControls()
    + '<ul data-insp-device-list></ul><span data-network-message></span><button data-mesh-invite></button>';
  let update;
  const dispose = bindNetworkControls(root, { getState: () => state, subscribe(fn) { update = fn; fn(state); return () => {}; } });
  try {
    expect(root.querySelector('[data-connection-label]').textContent).toBe('Discovery interrupted');
    expect(root.querySelector('[data-mesh-connect]').dataset.disconnect).toBe('true');
    expect(root.querySelector('[data-network-message]').textContent).not.toMatch(/invitation/i);
    network.discoveryScope = 'private'; network.introductionState = 'awaiting-introduction'; update(state);
    expect(root.querySelector('[data-connection-label]').textContent).toBe('Needs an invitation');
    expect(root.querySelector('[data-network-message]').textContent).toBe(network.error);
  } finally { dispose(); }
});
