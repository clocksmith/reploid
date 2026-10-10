import { escapeHtml } from './attachments.js';

/** Options only: selection, availability policy and execution remain caller-owned. */
export function updateModelSelect(select, models, { value = select.value, showAvailability = false, empty = 'No models available' } = {}) {
  const entries = models.map(model => [model.selectionId || model.id, [model.name, ...(model.adapters || []).map(adapter => adapter.name || adapter.id)].filter(Boolean).join(' + '),
    showAvailability ? ({ ready: 'Ready', busy: 'Busy', loading: 'Preparing', preparing: 'Preparing', unavailable: 'Unavailable' }[model.availability] || '') : '']);
  const key = JSON.stringify(entries);
  if (select.dataset.catalog !== key) {
    select.innerHTML = entries.length ? entries.map(([id, name, status]) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}${status ? ' · ' + status : ''}</option>`).join('')
      : `<option value="">${escapeHtml(empty)}</option>`;
    select.dataset.catalog = key;
  }
  select.value = entries.some(([id]) => id === value) ? value : entries[0]?.[0] || '';
}
