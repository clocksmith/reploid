import { availablePartitionRoute } from '../../apps/poolday/host/partition-release.js';
import { it, expect } from 'vitest';
import { projectChatCatalog } from '../../apps/poolday/host/chat-view.js';
import { updateModelSelect } from '../../apps/poolday/ui/components/model-select.js';
const model = { id: 'large', name: 'Large model', identity: 'sha256:model', adapters: [],
  executionModes: ['whole-model', 'partition'], partitionPlanId: 'sha256:plan' };
const route = { ...model, selectionId: 'large/partition/sha256:plan', partition: { planId: model.partitionPlanId,
  participantA: 'first', participantB: 'last' }, availability: 'ready' };
const approval = { modelId: route.id, modelIdentity: route.identity, adapterIdentities: [], partition: route.partition,
  evidence: 'test-fixture://qualified-route' };
it('does not turn catalog declarations or ready peer advertisements into public distributed support', () => {
  const catalog = projectChatCatalog({ models: [model], peers: [], partitionModels: [route] });
  expect(catalog).toHaveLength(1);
  expect(catalog[0].availability).toBe('unavailable');
  const select = document.createElement('select'); updateModelSelect(select, catalog, { showAvailability: true });
  expect(select.textContent).not.toContain('Distributed');
});
it('shows an explicitly approved available route without claiming whole-model readiness', () => {
  const catalog = projectChatCatalog({ models: [model], peers: [], releasedPartitionModels: [route].filter(model => availablePartitionRoute(model, [approval])) });
  expect(catalog).toHaveLength(2); expect(catalog[0].availability).toBe('unavailable');
  expect(catalog[1]).toEqual(route);
});
it('withdraws distributed choices when approved capacity is lost', () => {
  const catalog = projectChatCatalog({ models: [model], peers: [], releasedPartitionModels: [{ ...route, availability: 'unavailable' }].filter(model => availablePartitionRoute(model, [approval])) });
  expect(catalog).toHaveLength(1);
});
it('offers an adapter only under the base artifact it declares, whatever its name says', () => {
  const identity = letter => 'sha256:' + letter.repeat(64);
  const base = { id: 'base', name: 'Base model', identity: identity('a'), adapters: [], availableAdapters: [
    { id: 'declared', name: 'Base model specialist', identity: identity('b'), baseModelIdentity: identity('a') },
    { id: 'other-base', name: 'Base model specialist too', identity: identity('c'), baseModelIdentity: identity('d') },
    { id: 'unidentified', name: 'Base model helper', identity: 'unknown', baseModelIdentity: identity('a') }] };
  const peers = [{ peerId: 'peer', model: 'base', modelIdentity: identity('a'), readiness: 'ready', hasInference: true, availableSlots: 1,
    adapterIdentities: [identity('b'), identity('c')] }];
  const catalog = projectChatCatalog({ models: [base], peers, partitionModels: [] });
  expect(catalog.map(row => row.selectionId || row.id)).toEqual(['base', 'base/declared']);
  expect(catalog[1]).toMatchObject({ availability: 'ready', providerIds: ['peer'], adapters: [{ id: 'declared' }] });
});
