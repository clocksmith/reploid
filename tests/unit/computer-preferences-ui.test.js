import { it, expect } from 'vitest';
import { createComputerPreferences } from '../../apps/poolday/host/computer-preferences.js';
import { withComputerLabels, computerLabel, setComputerNames, participantLabel } from '../../apps/poolday/ui/pool-home/computer-labels.js';
import { projectNetworkPeers } from '../../apps/poolday/ui/pool-home/network-controls.js';

it('uses saved aliases only through verified key bindings, including reconnect and reset', () => {
  const session = {}, key = 'peer:' + 'a'.repeat(24);
  const state = { network: { consumer: { peers: [{ peerId: 'wire', participantId: key, identityVerified: true }] } },
    activeThread: { attempts: [{ execution: { peerId: 'wire' } }] } };
  setComputerNames(session, { [key]: 'Desk' });
  expect(computerLabel(withComputerLabels(state, session), 'wire')).toBe('Desk');
  state.network.consumer.peers = [];
  expect(computerLabel(withComputerLabels(state, session), 'wire')).toBe('Desk');
  setComputerNames(session, {});
  expect(computerLabel(withComputerLabels(state, session), 'wire')).toBe(participantLabel(key));
  setComputerNames(session, { [key]: 'Desk' });
  state.network.consumer.peers = [{ peerId: 'wire', participantId: key, identityVerified: false }];
  expect(computerLabel(withComputerLabels(state, session), 'wire')).toBe(participantLabel('wire'));
  state.network.consumer.peers = [{ peerId: 'wire', participantId: key, identityVerified: true }];
  withComputerLabels(state, session);
  state.network.consumer.peers = [];
  state.network.consumer.connections = [{ id: 'wire', phase: 'connected', attemptId: 'replacement' }];
  expect(computerLabel(withComputerLabels(state, session), 'wire')).toBe(participantLabel('wire'));
});

it('reports a verified participant proof as observed identity authentication', () => {
  const peers = projectNetworkPeers({ network: { consumer: { peers: [
    { peerId: 'wire', participantId: 'peer:' + 'a'.repeat(24), identityVerified: true }
  ] } } });
  expect(peers[0].authenticated).toBe(true);
});
