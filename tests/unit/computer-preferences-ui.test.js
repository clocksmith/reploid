import { it, expect } from 'vitest';
import { createComputerPreferences } from '../../apps/poolday/host/computer-preferences.js';
import { renderComputerDiagnostic, renderComputerRename, bindComputerPreferences } from '../../apps/poolday/ui/pool-home/computer-preferences.js';
import { withComputerLabels, computerLabel, setComputerNames, participantLabel } from '../../apps/poolday/ui/pool-home/computer-labels.js';
import { projectNetworkPeers } from '../../apps/poolday/ui/pool-home/network-controls.js';

it('renders diagnostic controls without running the GPU and binds an explicit consented click', async () => {
  const root = document.createElement('div');
  root.innerHTML = renderComputerDiagnostic() + '<li data-computer-id="wire">' + renderComputerRename() + '</li>';
  let captures = 0, consent;
  const preferences = createComputerPreferences({ storage: null, capture: async (_, options) => {
    captures++; consent = options.consent; return { status: 'unavailable', reason: 'adapter-unavailable' };
  } });
  const binding = bindComputerPreferences(root, preferences, {}, () => {});
  expect(captures).toBe(0);
  expect(root.querySelector('[data-computer-diagnostic]').hidden).toBe(false);
  root.querySelector('[data-gpu-check]').click();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(captures).toBe(1); expect(consent).toBe(true);
  expect(root.querySelector('[data-gpu-result]').textContent).toContain('unavailable');
  binding.dispose(); await preferences.close();
});

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

it('submits a local nickname through verification and clears it with an empty form', async () => {
  const root = document.createElement('div'), key = 'peer:' + 'b'.repeat(24), values = new Map(), session = {};
  root.innerHTML = renderComputerDiagnostic() + `<li data-computer-id="wire" data-computer-participant="${key}">` + renderComputerRename() + '</li>';
  const preferences = createComputerPreferences({ storage: { getItem: k => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v) }, verifyPeer: async () => key });
  const binding = bindComputerPreferences(root, preferences, session, () => {});
  const input = root.querySelector('[data-computer-name-input]'), form = input.form;
  input.value = 'Kitchen'; input.dispatchEvent(new Event('input', { bubbles: true }));
  binding.update(); expect(input.value).toBe('Kitchen');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(preferences.getState().names).toEqual({ [key]: 'Kitchen' });
  input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true })); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(preferences.getState().names).toEqual({});
  binding.dispose(); await preferences.close();
});
