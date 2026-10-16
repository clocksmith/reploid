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
