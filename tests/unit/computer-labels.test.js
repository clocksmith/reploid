import { it, expect } from 'vitest';
import { computerLabel, withComputerLabels } from '../../self/ui/pool-home/computer-labels.js';
import { projectExecutionRibbon } from '../../self/ui/pool-home/execution-ribbon.js';

it('shares computer labels across transport aliases, assigned stage order and discovery changes', () => {
  const session = {};
  const state = { participantId: 'requester', network: {
    consumer: { peerId: 'self-transport', peers: [{ peerId: 'transport-z' }, { peerId: 'transport-b' }, { peerId: 'self-transport' }] },
    partitionPeers: [{ transportId: 'transport-z', participantId: 'participant-a' }, { transportId: 'transport-b', participantId: 'participant-b' }]
  }, activeThread: { messages: [], model: { name: 'Model' }, attempts: [{ status: 'completed', execution: {
    placement: 'two-device-layer-partition', participantA: 'participant-b', participantB: 'participant-a', requesterId: 'requester'
  } }] } };
  let view = withComputerLabels(state, session);
  expect(projectExecutionRibbon(view).executors.map(node => node.label)).toEqual(['Computer 2', 'Computer 1']);
  expect(computerLabel(view, 'transport-z')).toBe('Computer 1');
  expect(computerLabel(view, 'transport-b')).toBe('Computer 2');
  state.network.partitionPeers.push({ transportId: 'transport-reconnected', participantId: 'participant-a' });
  state.network.consumer.peers.push({ peerId: 'transport-reconnected' });
  view = withComputerLabels(state, session);
  expect(computerLabel(view, 'transport-reconnected')).toBe('Computer 1');
  state.network.consumer.peers.reverse();
  state.network.consumer.peers.push({ peerId: 'arrived-earlier-alphabetically' });
  view = withComputerLabels(state, session);
  expect(computerLabel(view, 'transport-z')).toBe('Computer 1');
  expect(computerLabel(view, 'arrived-earlier-alphabetically')).toBe('Computer 3');
  state.network.consumer.peers = []; state.network.partitionPeers = [];
  expect(projectExecutionRibbon(withComputerLabels(state, session)).executors.map(node => node.label)).toEqual(['Computer 2', 'Computer 1']);
});

it('retains ordered route labels when disconnected executors only exist in saved history', () => {
  const execution = { identity: { schema: 'reploid.partition-attempt/v2', requesterId: 'self',
    route: { schema: 'reploid.partition-route/v1', stages: ['c', 'a', 'b'].map((participantId, index) => ({ index, participantId })) } } };
  const thread = { messages: [], model: { name: 'Model' }, attempts: [{ status: 'completed', execution }] };
  const session = {}, state = { participantId: 'self', threads: [thread], activeThread: thread };
  const first = projectExecutionRibbon(withComputerLabels(state, session)).executors.map(node => node.label);
  expect(new Set(first).size).toBe(3);
  state.network = { consumer: { peers: [{ peerId: 'new' }] } };
  expect(projectExecutionRibbon(withComputerLabels(state, session)).executors.map(node => node.label)).toEqual(first);
});
