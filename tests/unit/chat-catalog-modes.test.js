import { it, expect } from 'vitest';
import { projectChatCatalog } from '../../self/host/chat-view.js';
import { updateModelSelect } from '../../self/ui/components/model-select.js';
const model = { id: 'large', name: 'Large model', identity: 'sha256:model', adapters: [],
  executionModes: ['whole-model', 'partition'], partitionPlanId: 'sha256:plan' };
it('keeps whole and distributed selection identities distinct without inventing ready capacity', () => {
  const catalog = projectChatCatalog({ models: [model], peers: [], partitionModels: [] });
  expect(catalog).toHaveLength(2);
  expect(catalog.map(row => row.availability)).toEqual(['unavailable', 'unavailable']);
  expect(catalog[0].partition).toBeUndefined();
  expect(catalog[1].selectionId).toBe('large/partition/sha256:plan');
  const select = document.createElement('select'); updateModelSelect(select, catalog, { showAvailability: true });
  expect([...select.options].map(option => option.textContent)).toEqual([
    'Large model · Whole model · Unavailable', 'Large model · Distributed layers · Unavailable']);
});
it('replaces the declared route with prepared discovery while preserving whole-model readiness separately', () => {
  const route = { ...model, selectionId: 'large/partition/sha256:plan', partition: { planId: model.partitionPlanId,
    participantA: 'first', participantB: 'last' }, availability: 'ready' };
  const catalog = projectChatCatalog({ models: [model], peers: [], partitionModels: [route] });
  expect(catalog).toHaveLength(2); expect(catalog[0].availability).toBe('unavailable');
  expect(catalog[1]).toEqual(route);
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
