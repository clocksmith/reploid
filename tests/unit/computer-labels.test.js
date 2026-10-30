import { it, expect } from 'vitest';
import { computerLabel, participantLabel, withComputerLabels } from '../../self/ui/pool-home/computer-labels.js';
import { projectExecutionRibbon } from '../../self/ui/pool-home/execution-ribbon.js';

it('keeps names consistent across reloads and different discovery orders', () => {
  const first = { network: { consumer: { peers: [{ peerId: 'peer-a' }, { peerId: 'peer-b' }] } } };
  const reversed = { network: { consumer: { peers: [{ peerId: 'peer-b' }, { peerId: 'peer-a' }] } } };
  const a = withComputerLabels(first, {}), b = withComputerLabels(reversed, {});
  expect(computerLabel(a, 'peer-a')).toBe(computerLabel(b, 'peer-a'));
  expect(computerLabel(a, 'peer-b')).toBe(computerLabel(b, 'peer-b'));
  expect(computerLabel(a, 'peer-a')).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ · [0-9A-F]{4}$/);
  expect(computerLabel(a, 'peer-a')).not.toBe(computerLabel(a, 'peer-b'));
});

it('uses participant identity when a temporary transport is subsequently identified', () => {
  const session = {}, state = { network: { consumer: { peers: [{ peerId: 'temporary-wire' }] } } };
  withComputerLabels(state, session);
  state.network.partitionPeers = [{ transportId: 'temporary-wire', participantId: 'stable-participant' }];
  const identified = withComputerLabels(state, session);
  expect(computerLabel(identified, 'temporary-wire')).toBe(participantLabel('stable-participant'));
  expect(computerLabel(withComputerLabels(state, {}), 'temporary-wire')).toBe(computerLabel(identified, 'temporary-wire'));
});

it('distinguishes repeated word pairs with the short identity tag', () => {
  const words = new Map(); let pair;
  for (let i = 0; i < 2000 && !pair; i++) {
    const label = participantLabel('participant-' + i), name = label.split(' · ')[0];
    if (words.has(name)) pair = [words.get(name), label];
    else words.set(name, label);
  }
  expect(pair).toBeDefined(); expect(pair[0]).not.toBe(pair[1]);
});

it('shares computer labels across transport aliases, assigned stage order and discovery changes', () => {
  const session = {};
  const state = { participantId: 'requester', network: {
    consumer: { peerId: 'self-transport', peers: [{ peerId: 'transport-z' }, { peerId: 'transport-b' }, { peerId: 'self-transport' }] },
    partitionPeers: [{ transportId: 'transport-z', participantId: 'participant-a' }, { transportId: 'transport-b', participantId: 'participant-b' }]
  }, activeThread: { messages: [], model: { name: 'Model' }, attempts: [{ status: 'completed', execution: {
    placement: 'two-device-layer-partition', participantA: 'participant-b', participantB: 'participant-a', requesterId: 'requester'
  } }] } };
  let view = withComputerLabels(state, session);
  const a = participantLabel('participant-a'), b = participantLabel('participant-b');
  expect(projectExecutionRibbon(view).executors.map(node => node.label)).toEqual([b, a]);
  expect(computerLabel(view, 'transport-z')).toBe(a);
  expect(computerLabel(view, 'transport-b')).toBe(b);
  state.network.partitionPeers.push({ transportId: 'transport-reconnected', participantId: 'participant-a' });
  state.network.consumer.peers.push({ peerId: 'transport-reconnected' });
  view = withComputerLabels(state, session);
  expect(computerLabel(view, 'transport-reconnected')).toBe(a);
  state.network.consumer.peers.reverse();
  state.network.consumer.peers.push({ peerId: 'arrived-earlier-alphabetically' });
  view = withComputerLabels(state, session);
  expect(computerLabel(view, 'transport-z')).toBe(a);
  expect(computerLabel(view, 'arrived-earlier-alphabetically')).toBe(participantLabel('arrived-earlier-alphabetically'));
  state.network.consumer.peers = []; state.network.partitionPeers = [];
  expect(projectExecutionRibbon(withComputerLabels(state, session)).executors.map(node => node.label)).toEqual([b, a]);
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
