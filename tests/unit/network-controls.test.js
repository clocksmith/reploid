import { describe, it, expect, vi } from 'vitest';
import { projectNetworkPeers } from '../../apps/poolday/ui/pool-home/network-controls.js';

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
