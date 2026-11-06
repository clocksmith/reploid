import { beforeEach, expect, it } from 'vitest';
import { bindModelChoices, updateModelSelect, modelExecutionState } from '../../apps/poolday/ui/components/model-select.js';

const models = [
  { id: 'local', name: 'Local', localCached: true, availability: 'cached' },
  { id: 'download', name: 'Download', source: {}, availability: 'unavailable' },
  { id: 'busy', name: 'Busy', networkAvailability: 'busy', availability: 'busy' },
  { id: 'ready', name: 'Ready', networkAvailability: 'ready', availability: 'ready', quantization: 'q4k', contextLength: 4096 }
];
beforeEach(() => { document.body.innerHTML = '<select></select>'; });

it('presents ready shared models before busy peers, local files and downloads in both picker representations', () => {
  const select = document.querySelector('select'), choices = bindModelChoices(select);
  updateModelSelect(select, models, { grouped: true }); choices.update(models, { grouped: true });
  expect([...select.options].map(option => option.value)).toEqual(['ready', 'busy', 'local', 'download']);
  expect([...document.querySelectorAll('input')].map(input => input.value)).toEqual(['ready', 'busy', 'local', 'download']);
  expect([...document.querySelectorAll('[data-choice-group]')].map(group => group.getAttribute('aria-label')))
    .toEqual(['Shared models', 'On this device', 'Download to this device']);
  expect(select.value).toBe('ready');
  // Declared facts sit beside the choice; a model without them shows no facts line.
  const facts = document.querySelector('input[value="ready"]').closest('label').querySelector('[data-choice-facts]');
  expect(facts.hidden).toBe(false); expect(facts.textContent).toBe(`Q4K · ${(4096).toLocaleString()} tokens`);
  expect(document.querySelector('input[value="local"]').closest('label').querySelector('[data-choice-facts]').hidden).toBe(true);
  choices.dispose();
});

it('moves an existing choice when discovery changes without losing its selection or keyboard focus', () => {
  const select = document.querySelector('select'), choices = bindModelChoices(select);
  updateModelSelect(select, models, { grouped: true, value: 'download' }); choices.update(models, { grouped: true });
  const input = document.querySelector('input[value="download"]'); input.focus();
  const discovered = models.map(model => model.id === 'download' ? { ...model, networkAvailability: 'ready', availability: 'ready' } : model);
  updateModelSelect(select, discovered, { grouped: true }); choices.update(discovered, { grouped: true });
  expect([...document.querySelectorAll('input')].map(input => input.value)).toEqual(['download', 'ready', 'busy', 'local']);
  expect(document.querySelector('input[value="download"]')).toBe(input);
  expect(document.activeElement).toBe(input); expect(input.checked).toBe(true); expect(select.value).toBe('download'); choices.dispose();
});

it('keeps on-device choices first when the caller has an explicit local execution preference', () => {
  const select = document.querySelector('select'), choices = bindModelChoices(select);
  updateModelSelect(select, models, { grouped: true }); choices.update(models, { grouped: true });
  updateModelSelect(select, models, { grouped: true, preferNetwork: false }); choices.update(models, { grouped: true, preferNetwork: false });
  expect([...select.options].map(option => option.value)).toEqual(['local', 'ready', 'busy', 'download']);
  expect([...document.querySelectorAll('input')].map(input => input.value)).toEqual(['local', 'ready', 'busy', 'download']); choices.dispose();
});

it('places a model family in its most usable member’s group, with each adapter beneath its base', () => {
  const select = document.querySelector('select'), choices = bindModelChoices(select);
  const identity = 'sha256:' + 'a'.repeat(64);
  const family = [
    { id: 'base', name: 'Base', identity, source: {}, availability: 'unavailable', adapters: [] },
    { id: 'base', selectionId: 'base/adapter', name: 'Base adapter', identity, adapters: [{ identity: 'sha256:' + 'b'.repeat(64) }],
      networkAvailability: 'ready', availability: 'ready' }
  ];
  choices.update([...models, ...family], { grouped: true, variants: true });
  expect([...document.querySelectorAll('input')].map(input => input.value)).toEqual(['ready', 'base', 'base/adapter', 'busy', 'local', 'download']);
  const adapter = document.querySelector('input[value="base/adapter"]').closest('label');
  expect(adapter.hasAttribute('data-choice-adapter')).toBe(true);
  expect(adapter.closest('[data-choice-group]').dataset.choiceGroup).toBe('shared');
  expect(adapter.querySelector('[data-choice-status]').textContent).toBe('Ready');
  // The base keeps its own status inside its family's group.
  expect(document.querySelector('input[value="base"]').closest('label').querySelector('[data-choice-status]').textContent).toBe('Download required');
  choices.dispose();
});


it('keeps cached local weights separate from shared capacity', () => {
  expect(modelExecutionState(models[0], 'network')).toMatchObject({ source: 'network', usable: false });
  expect(modelExecutionState(models[0], 'auto')).toMatchObject({ source: 'local', status: 'cached', usable: true });
});

it('does not use a different route readiness to label a pinned unavailable choice Ready', () => {
  const select = document.querySelector('select'), choices = bindModelChoices(select);
  const whole = { id: 'base', identity: 'same', name: 'Base', availability: 'unavailable', networkAvailability: 'unavailable' };
  const route = { ...whole, selectionId: 'distributed', partition: {}, availability: 'ready', networkAvailability: 'ready' };
  updateModelSelect(select, [whole, route], { value: 'base' }); choices.update([whole, route], { grouped: true, variants: true });
  expect(document.querySelector('input:checked').value).toBe('base');
  expect(document.querySelector('[data-choice-status]').textContent).toBe('Unavailable');
  choices.dispose();
});
