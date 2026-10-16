import { escapeHtml } from './attachments.js';

let choiceId = 0;

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
    update(models) {
      group.hidden = select.hidden;
      const ids = models.map(model => model.selectionId || model.id);
      for (const label of [...group.querySelectorAll('label')]) {
        if (!ids.includes(label.querySelector('input').value)) label.remove();
      }
      models.forEach(model => {
        const id = model.selectionId || model.id;
        let input = [...group.querySelectorAll('input')].find(item => item.value === id);
        if (!input) {
          const label = document.createElement('label');
          label.className = 'chat-model-choice pool-button btn-ghost pool-choice';
          label.innerHTML = '<input type="radio"><span><span data-choice-name></span><small class="pool-muted" data-choice-status></small></span>';
          input = label.querySelector('input'); input.name = name; input.value = id;
          group.append(label);
        }
        input.checked = select.value === id;
        input.disabled = select.disabled;
        input.closest('label').querySelector('[data-choice-name]').textContent = modelSelectionLabel(model);
        input.closest('label').querySelector('[data-choice-status]').textContent = availabilityLabel(model);
      });
    },
    focus() { (group.querySelector('input:checked') || group.querySelector('input'))?.focus(); },
    dispose() { group.removeEventListener('change', change); group.remove(); select.classList.remove('chat-model-value'); }
  };
}

const availabilityLabel = model => ({ ready: 'Ready', cached: 'On this device', busy: 'Busy', loading: 'Preparing', preparing: 'Preparing', unavailable: 'Unavailable' }[model.availability] || '');

/** Options only: selection, availability policy and execution remain caller-owned. */
export const modelSelectionLabel = model => [...new Set([model.name, ...(model.adapters || []).map(adapter => adapter.name || adapter.id)].filter(Boolean))].join(' + ') + (model.executionModes?.length || model.partition ? (model.partition ? ' · Distributed layers' : ' · Whole model') : '');

export function updateModelSelect(select, models, { value = select.value, showAvailability = false, empty = 'No models available' } = {}) {
  const entries = models.map(model => [model.selectionId || model.id, modelSelectionLabel(model),
    showAvailability ? availabilityLabel(model) : '']);
  const key = JSON.stringify(entries);
  if (select.dataset.catalog !== key) {
    select.innerHTML = entries.length ? entries.map(([id, name, status]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}${status ? ' · ' + status : ''}</option>`).join('')
      : `<option value="">${escapeHtml(empty)}</option>`;
    select.dataset.catalog = key;
  }
  select.value = entries.some(([id]) => id === value) ? value : entries[0]?.[0] || '';
}
