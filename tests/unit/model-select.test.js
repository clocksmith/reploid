import { beforeEach, expect, it } from 'vitest';
import { bindModelChoices, updateModelSelect } from '../../self/ui/components/model-select.js';

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
