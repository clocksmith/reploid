import { expect, it } from 'vitest';
import { hardwareLabel, projectModelProviders } from '../../apps/poolday/ui/pool-home/model-providers.js';
import { withComputerLabels } from '../../apps/poolday/ui/pool-home/computer-labels.js';

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

it('never lists an adapter-only provider as the base model or a provider with extra adapters as an exact variant', () => {
  const adapted = { ...model, adapters: [{ identity: 'adapter-a' }] };
  const extra = { ...peer('a'), adapterIdentities: ['adapter-a', 'adapter-b'] };
  expect(projectModelProviders(state([model], [{ ...peer('a'), adapterIdentities: ['adapter-a'] }]), model)).toEqual([]);
  expect(projectModelProviders(state([adapted], [extra]), adapted)).toEqual([]);
  expect(projectModelProviders(state([adapted], [{ ...peer('a'), adapterIdentities: ['adapter-a'] }]), adapted)).toHaveLength(1);
});

it('separates downloaded local files from ready capacity and keeps unknown GPU details explicit', () => {
  const local = { ...model, localCached: true };
  const snapshot = state([local], []);
  snapshot.localModel = { modelIdentity: 'different', hardware: { description: 'Wrong GPU' } };
  expect(projectModelProviders(snapshot, local)).toMatchObject([{ type: 'This device', status: 'Downloaded · preparation required',
    participants: [{ hardware: 'GPU not reported' }] }]);
});

it('labels a GPU by its reported identity, not its driver, and drops placeholder values', () => {
  expect(hardwareLabel({ vendor: 'amd', architecture: 'rdna-3', device: 'radeon-8060s-graphics', description: 'radv: Mesa 26.0.3' }))
    .toBe('amd · rdna-3 · radeon-8060s-graphics');
  expect(hardwareLabel({ vendor: 'unknown', architecture: 'unknown', device: 'unknown', description: 'Reported adapter' })).toBe('Reported adapter');
  expect(hardwareLabel({ vendor: 'unknown', architecture: 'unknown', device: 'unknown', description: '' })).toBe('GPU not reported');
});
