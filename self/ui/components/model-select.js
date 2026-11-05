import { escapeHtml } from './attachments.js';

let choiceId = 0;
export const isSharedModelChoice = model => ['ready', 'busy', 'loading', 'preparing'].includes(model.networkAvailability);

/** Catalog facts shown beside a choice: declared weights and advertised context, nothing inferred. */
export const modelFacts = model => [
  model?.quantization ? String(model.quantization).toUpperCase() : null,
  Number.isSafeInteger(model?.contextLength) && model.contextLength > 0 ? `${model.contextLength.toLocaleString()} tokens` : null
].filter(Boolean).join(' · ');

/** Presentation groups never change model identities or execution permissions. */
export function modelChoiceGroups(models, { preferNetwork = true } = {}) {
  const shared = [], local = [], downloads = [], unavailable = [];
  for (const model of models) {
    if (isSharedModelChoice(model)) shared.push(model);
    else if (model.localReady || model.localCached || model.availability === 'cached') local.push(model);
    else if (model.source && !model.partition && !model.adapters?.length) downloads.push(model);
    else unavailable.push(model);
  }
  const rank = model => model.networkAvailability === 'ready' ? 0 : model.networkAvailability === 'busy' ? 1 : 2;
  shared.sort((a, b) => rank(a) - rank(b));
  const groups = [
    { id: 'shared', label: 'Shared models', models: shared },
    { id: 'local', label: 'On this device', models: local },
    { id: 'download', label: 'Download to this device', models: downloads },
    { id: 'unavailable', label: 'Unavailable', models: unavailable }
  ];
  const ordered = preferNetwork ? groups : [groups[1], groups[0], ...groups.slice(2)];
  return ordered.filter(group => group.models.length);
}

/** Native radios keep keyboard selection; the select remains the caller's value port. */
export function bindModelChoices(select) {
  const group = document.createElement('fieldset');
  group.className = 'chat-model-choices pool-bare';
  group.innerHTML = '<legend class="chat-visually-hidden">Model</legend>';
  const name = `model-choice-${++choiceId}`;
  select.classList.add('chat-model-value');
  select.after(group);
  const change = event => {
    if (event.target.name !== name) return;
    select.value = event.target.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  group.addEventListener('change', change);
  return {
    update(models, { grouped = false, preferNetwork = true } = {}) {
      group.hidden = select.hidden;
      const active = group.contains(document.activeElement) ? document.activeElement : null;
      const sections = grouped ? modelChoiceGroups(models, { preferNetwork }) : [{ id: 'all', models }];
      const ids = models.map(model => model.selectionId || model.id);
      for (const label of [...group.querySelectorAll('label')]) {
        if (!ids.includes(label.querySelector('input').value)) label.remove();
      }
      const parents = new Map();
      for (const [sectionIndex, section] of sections.entries()) {
        let parent = grouped ? group.querySelector(`[data-choice-group="${section.id}"]`) : group;
        if (!parent) {
          parent = document.createElement('div'); parent.dataset.choiceGroup = section.id;
          parent.className = 'pool-stack pool-gap-xs'; parent.setAttribute('role', 'group');
          parent.setAttribute('aria-label', section.label);
          const heading = document.createElement('p'); heading.className = 'pool-caption pool-muted';
          heading.textContent = section.label; parent.append(heading); group.append(parent);
        }
        parents.set(section.id, parent);
        if (grouped) {
          const position = group.querySelectorAll(':scope > [data-choice-group]')[sectionIndex];
          if (position !== parent) group.insertBefore(parent, position || null);
        }
        section.models.forEach((model, index) => {
          const id = model.selectionId || model.id;
          let input = [...group.querySelectorAll('input')].find(item => item.value === id);
          if (!input) {
            const label = document.createElement('label');
            label.className = 'chat-model-choice pool-button btn-ghost pool-choice';
            label.innerHTML = '<input type="radio"><span><span data-choice-name></span><small class="pool-muted" data-choice-status></small><small class="pool-muted" data-choice-facts hidden></small></span>';
            input = label.querySelector('input'); input.name = name; input.value = id;
            parent.append(label);
          }
          input.checked = select.value === id;
          input.disabled = select.disabled;
          const label = input.closest('label');
          label.querySelector('[data-choice-name]').textContent = modelSelectionLabel(model);
          label.querySelector('[data-choice-status]').textContent = grouped ? choiceStatus(model, section.id) : availabilityLabel(model);
          const facts = modelFacts(model), factsNode = label.querySelector('[data-choice-facts]');
          factsNode.textContent = facts; factsNode.hidden = !facts;
          const position = parent.querySelectorAll(':scope > label')[index];
          if (position !== label) parent.insertBefore(label, position || null);
        });
      }
      for (const section of [...group.querySelectorAll('[data-choice-group]')]) {
        if (!parents.has(section.dataset.choiceGroup)) section.remove();
      }
      if (active?.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
    },
    focus() { (group.querySelector('input:checked') || group.querySelector('input'))?.focus(); },
    dispose() { group.removeEventListener('change', change); group.remove(); select.classList.remove('chat-model-value'); }
  };
}

const availabilityLabel = model => ({ ready: 'Ready', cached: 'On this device', busy: 'Busy', loading: 'Preparing', preparing: 'Preparing', unavailable: 'Unavailable' }[model.availability] || '');
const choiceStatus = (model, group) => group === 'shared'
  ? ({ ready: 'Ready', busy: 'Busy · waits for capacity', loading: 'Preparing', preparing: 'Preparing' }[model.networkAvailability])
  : group === 'download' ? 'Download required' : availabilityLabel(model);

/** Options only: selection, availability policy and execution remain caller-owned. */
export const modelSelectionLabel = model => [...new Set([model.name, ...(model.adapters || []).map(adapter => adapter.name || adapter.id)].filter(Boolean))].join(' + ') + (model.executionModes?.length || model.partition ? (model.partition ? ' · Distributed layers' : ' · Whole model') : '');

export function updateModelSelect(select, models, { value = select.value, showAvailability = false, empty = 'No models available', grouped = false, preferNetwork = true } = {}) {
  const groups = grouped ? modelChoiceGroups(models, { preferNetwork }) : [{ id: 'all', models }];
  const rows = groups.map(group => ({ ...group, entries: group.models.map(model => [model.selectionId || model.id, modelSelectionLabel(model),
    showAvailability ? grouped ? choiceStatus(model, group.id) : availabilityLabel(model) : '']) }));
  const entries = rows.flatMap(group => group.entries);
  const key = JSON.stringify(rows.map(({ id, entries }) => [id, entries]));
  if (select.dataset.catalog !== key) {
    select.innerHTML = entries.length ? rows.map(group => {
      const options = group.entries.map(([id, name, status]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}${status ? ' · ' + status : ''}</option>`).join('');
      return grouped ? `<optgroup label="${escapeHtml(group.label)}">${options}</optgroup>` : options;
    }).join('')
      : `<option value="">${escapeHtml(empty)}</option>`;
    select.dataset.catalog = key;
  }
  select.value = entries.some(([id]) => id === value) ? value : entries[0]?.[0] || '';
}
