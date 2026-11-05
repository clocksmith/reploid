import { expect, it } from 'vitest';
import { hardwareLabel, projectModelProviders, renderModelProviders, updateModelProviders } from '../../self/ui/pool-home/model-providers.js';
import { withComputerLabels } from '../../self/ui/pool-home/computer-labels.js';

const model = { id: 'qwen', name: 'Qwen', identity: 'sha256:model', providerIds: ['a', 'b'], networkAvailability: 'ready' };
const peer = id => ({ peerId: id, model: model.id, modelIdentity: model.identity, readiness: 'ready',
  availableSlots: 1, hasInference: true, hardware: { vendor: 'AMD', description: 'Reported GPU' } });
const state = (models = [model], peers = [peer('a'), peer('b')]) => withComputerLabels({ models,
  network: { consumer: { peers }, connections: peers.map(peer => ({ id: peer.peerId, phase: 'connected' })) } }, {});

it('lists separate providers by existing pseudonyms without inventing distributed execution', () => {
  const snapshot = state();
  const rows = projectModelProviders(snapshot, model);
  expect(rows).toHaveLength(2);
  expect(rows.map(row => row.type)).toEqual(['Whole model', 'Whole model']);
  expect(rows.map(row => row.participants[0].label)).toEqual([snapshot.computerLabels.get('a'), snapshot.computerLabels.get('b')]);
  expect(rows[0].participants[0].hardware).toBe('AMD');
});

it('excludes different model artifacts, incompatible adapters and stale connection attempts', () => {
  const adapted = { ...model, adapters: [{ identity: 'adapter-a' }] };
  const snapshot = state([adapted], [{ ...peer('a'), modelIdentity: 'different' },
    { ...peer('b'), adapterIdentities: ['adapter-b'] }, { ...peer('c'), adapterIdentities: ['adapter-a'], attemptId: 'old' }]);
  snapshot.network.connections[2].attemptId = 'new';
  expect(projectModelProviders(snapshot, adapted)).toEqual([]);
});

it('uses only host-described complete routes, preserving ordered participants as one option', () => {
  const route = { ...model, selectionId: 'qwen/route', partition: { route: { schema: 'reploid.partition-route/v1',
    stages: [{ participantId: 'a' }, { participantId: 'b' }, { participantId: 'c' }] } } };
  const unplaced = { ...model, selectionId: 'qwen/pending', partition: { planId: 'pending' } };
  const rows = projectModelProviders(state([model, route, unplaced]), model);
  expect(rows).toHaveLength(3);
  expect(rows[2]).toMatchObject({ type: 'Distributed · 3 computers', status: 'Ready',
    participants: [{ id: 'a', role: 'Stage 1 of 3' }, { id: 'b', role: 'Stage 2 of 3' }, { id: 'c', role: 'Stage 3 of 3' }] });
});

it('separates downloaded local files from ready capacity and keeps unknown GPU details explicit', () => {
  const local = { ...model, localCached: true };
  const snapshot = state([local], []);
  snapshot.localModel = { modelIdentity: 'different', hardware: { description: 'Wrong GPU' } };
  expect(projectModelProviders(snapshot, local)).toMatchObject([{ type: 'This device', status: 'Downloaded · preparation required',
    participants: [{ hardware: 'GPU not reported' }] }]);
});

it('keeps a disclosure open across updates and renders reported GPU strings as text', () => {
  const root = document.createElement('div'); root.innerHTML = renderModelProviders();
  const disclosure = root.querySelector('details'); disclosure.open = true;
  const snapshot = state([model], [{ ...peer('a'), hardware: { description: '<img src=x onerror=alert(1)>' } }]);
  updateModelProviders(root, snapshot, model);
  expect(disclosure.open).toBe(true);
  expect(root.querySelector('img')).toBeNull();
  expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
  updateModelProviders(root, state([], []), model);
  expect(root.textContent).toContain('No providers reported');
  expect(disclosure.open).toBe(true);
});

it('renders one block per route of the variant, with route radios only when there is a choice', () => {
  const route = { ...model, selectionId: 'qwen/route', networkAvailability: 'unavailable', partition: { route: { schema: 'reploid.partition-route/v1',
    stages: [{ participantId: 'c' }, { participantId: 'd' }] } } };
  const root = document.createElement('div'); root.innerHTML = renderModelProviders();
  updateModelProviders(root, state([model]), model);
  expect(root.querySelectorAll('[data-model-route]')).toHaveLength(1);
  expect(root.querySelector('[data-model-route-choice]')).toBeNull();
  expect(root.querySelector('[data-provider-count]').textContent).toBe('2');
  // A provider's status is not repeated when it matches its route's.
  expect(root.querySelector('li small').textContent).toBe('AMD');
  updateModelProviders(root, state([model, route]), model, { selectedId: 'qwen/route' });
  expect([...root.querySelectorAll('[data-model-route]')].map(node => node.dataset.modelRoute)).toEqual(['qwen', 'qwen/route']);
  expect([...root.querySelectorAll('[data-model-route-choice]')].map(input => [input.value, input.checked])).toEqual([['qwen', false], ['qwen/route', true]]);
  expect(root.querySelector('[data-model-route="qwen/route"]').textContent).toContain('Stage 2 of 2 · GPU not reported');
  expect(root.querySelector('[data-model-route="qwen/route"]').textContent).toContain('Unavailable');
});

it('labels a GPU by its reported identity, not its driver, and drops placeholder values', () => {
  expect(hardwareLabel({ vendor: 'amd', architecture: 'rdna-3', device: 'radeon-8060s-graphics', description: 'radv: Mesa 26.0.3' }))
    .toBe('amd · rdna-3 · radeon-8060s-graphics');
  expect(hardwareLabel({ vendor: 'unknown', architecture: 'unknown', device: 'unknown', description: 'Reported adapter' })).toBe('Reported adapter');
  expect(hardwareLabel({ vendor: 'unknown', architecture: 'unknown', device: 'unknown', description: '' })).toBe('GPU not reported');
});
