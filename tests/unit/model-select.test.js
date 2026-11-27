import { unavailableModelChoice, modelSelectionLabel } from '../../apps/poolday/ui/components/model-select.js';
import { beforeEach, expect, it } from 'vitest';
import { modelExecutionState } from '../../apps/poolday/ui/components/model-select.js';

const models = [
  { id: 'local', name: 'Local', localCached: true, availability: 'cached' },
  { id: 'download', name: 'Download', source: { baseUrl: 'https://models.example/base/' }, availability: 'unavailable' },
  { id: 'busy', name: 'Busy', networkAvailability: 'busy', availability: 'busy' },
  { id: 'ready', name: 'Ready', networkAvailability: 'ready', availability: 'ready', quantization: 'q4k', contextLength: 4096 }
];
beforeEach(() => { document.body.innerHTML = '<select></select>'; });

it('keeps cached local weights separate from shared capacity', () => {
  expect(modelExecutionState(models[0], 'network')).toMatchObject({ source: 'network', usable: false });
  expect(modelExecutionState(models[0], 'auto')).toMatchObject({ source: 'local', status: 'cached', usable: true });
});

it('clears saved capacity when a selected route disappears without losing its identity', () => {
  const saved = { id: 'base', name: 'Base', selectionId: 'base/route', identity: 'sha256:base',
    partition: { participantA: 'a', participantB: 'b' }, availability: 'ready', networkAvailability: 'ready',
    providerIds: ['a', 'b'], localCached: true };
  const missing = unavailableModelChoice(saved);
  expect(missing.selectionId).toBe(saved.selectionId);
  expect(modelExecutionState(missing).usable).toBe(false);
  expect(modelSelectionLabel(missing)).toBe('Base · Unavailable route');
  expect(modelExecutionState(missing).label).not.toContain('Distributed');
  expect(saved.networkAvailability).toBe('ready');
});
