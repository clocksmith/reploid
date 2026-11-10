import { escapeHtml } from './attachments.js';

let choiceId = 0;
/** Retain a saved choice's identity without retaining old capacity observations. */
export const unavailableModelChoice = model => ({ ...model, availability: 'unavailable', networkAvailability: 'unavailable',
  localReady: false, localCached: false, providerIds: [] });
export const isSharedModelChoice = model => ['ready', 'busy', 'loading', 'preparing'].includes(model.networkAvailability);

/** The selected execution source, matching the host's local-cache reuse policy. */
export function modelExecutionState(model, location = 'auto') {
  const local = !model?.partition && (model?.localReady || model?.localCached || model?.availability === 'cached');
  const source = location === 'local' || location === 'auto' && local ? 'local' : 'network';
  const status = source === 'local' ? model?.partition ? 'unavailable' : model?.localReady ? 'ready' : local ? 'cached' : 'unavailable'
    : model?.networkAvailability ?? (local ? 'unavailable' : model?.availability ?? 'unavailable');
  return { source, status, usable: ['ready', 'busy', 'cached'].includes(status),
    label: !['ready', 'busy', 'cached'].includes(status) ? ['loading', 'preparing'].includes(status) ? 'Loading' : 'Unavailable' : source === 'local' ? 'This device' : model?.fleet ? 'Private computers' : model?.partition && ['ready', 'busy'].includes(status) ? 'Public network · Split model' : 'Public network' };
}

/** Catalog facts shown beside a choice: declared weights and advertised context, nothing inferred. */
export const modelFacts = model => [
  model?.quantization ? String(model.quantization).toUpperCase() : null,
  Number.isSafeInteger(model?.contextLength) && model.contextLength > 0 ? `${model.contextLength.toLocaleString()} tokens` : null
].filter(Boolean).join(' · ');

/** Presentation groups never change model identities or execution permissions. */
export function modelChoiceGroups(models, { preferNetwork = true } = {}) {
  const privateModels = [], shared = [], local = [], downloads = [], unavailable = [];
  for (const model of models) {
    if (model.fleet) privateModels.push(model);
    else if (isSharedModelChoice(model)) shared.push(model);
    else if (model.localReady || model.localCached || model.availability === 'cached') local.push(model);
    else if (model.source && !model.partition && !model.adapters?.length) downloads.push(model);
    else unavailable.push(model);
  }
  const rank = model => model.networkAvailability === 'ready' ? 0 : model.networkAvailability === 'busy' ? 1 : 2;
  shared.sort((a, b) => rank(a) - rank(b));
  const groups = [
    { id: 'shared', label: 'Public network', models: shared },
    { id: 'local', label: 'On this device', models: local },
    { id: 'private', label: 'Your private computers', models: privateModels },
    { id: 'download', label: 'Download to this device', models: downloads },
    { id: 'unavailable', label: 'Unavailable', models: unavailable }
  ];
  const ordered = preferNetwork ? groups : [groups[1], groups[0], ...groups.slice(2)];
  return ordered.filter(group => group.models.length);
}

/** One exact model artifact with its exact adapters. Whole-model and distributed routes are alternatives of it. */
export const modelVariantKey = model => JSON.stringify([model.id, model.identity ?? null, model.fleet?.requester.participantId ?? null,
  (model.adapters || []).map(adapter => adapter.identity ?? adapter.id ?? null).sort()]);

/** Ready shared capacity first, then busy, on-device, preparing, downloadable and unavailable routes. */
const routeRank = (model, preferNetwork) => {
  const local = model.localReady || model.localCached || model.availability === 'cached';
  if (!preferNetwork && local && !model.partition) return 0;
  return isSharedModelChoice(model) ? ({ ready: 1, busy: 2 }[model.networkAvailability] ?? 4)
    : local ? 3 : model.source && !model.partition && !model.adapters?.length ? 5 : 6;
};

/** One entry per exact model/adapter variant. Its value is the caller's selected route of that variant,
 * otherwise its most usable route; a whole model precedes a distributed route of equal standing. */
export function modelVariants(models, { value = null, preferNetwork = true } = {}) {
  const variants = new Map();
  for (const model of models) {
    const key = modelVariantKey(model);
    if (!variants.has(key)) variants.set(key, []);
    variants.get(key).push(model);
  }
  return [...variants.entries()].map(([key, routes]) => {
    const model = [...routes].sort((a, b) => routeRank(a, preferNetwork) - routeRank(b, preferNetwork)
      || Number(!!a.partition) - Number(!!b.partition))[0];
    const ids = routes.map(route => route.selectionId || route.id);
    return { key, model, routes, ids, value: ids.includes(value) ? value : model.selectionId || model.id };
  });
}

/** An adapter variant's base is the variant of the same exact model artifact with no adapter. Entries are grouped
 * into families: a base model followed by its adapter variants, placed in the group of the family's most usable member.
 * An adapter whose base variant is absent stands alone. Compatibility was settled by the catalog's declared identity. */
const familyRank = model => isSharedModelChoice(model) ? ({ ready: 0, busy: 1 }[model.networkAvailability] ?? 2)
  : model.localReady || model.localCached || model.availability === 'cached' ? 3 : model.source && !model.partition && !model.adapters?.length ? 4 : 5;
export function modelFamilies(entries) {
  const bases = new Map(entries.filter(entry => !entry.model.adapters?.length)
    .map(entry => [JSON.stringify([entry.model.id, entry.model.identity ?? null, entry.model.fleet?.requester.participantId ?? null]), { base: entry, adapters: [] }]));
  const families = [...bases.values()];
  for (const entry of entries) {
    if (!entry.model.adapters?.length) continue;
    const family = bases.get(JSON.stringify([entry.model.id, entry.model.identity ?? null, entry.model.fleet?.requester.participantId ?? null]));
    if (family) family.adapters.push(entry); else families.push({ base: entry, adapters: [] });
  }
  return families.map(family => ({ ...family, members: [family.base, ...family.adapters],
    lead: [family.base, ...family.adapters].reduce((best, entry) => familyRank(entry.model) < familyRank(best.model) ? entry : best).model }));
}
const ownGroup = (model, preferNetwork) => modelChoiceGroups([model], { preferNetwork })[0]?.id;

/** Native radios keep keyboard selection; the select remains the caller's value port.
 * With `variants`, one radio stands for an exact model/adapter variant and its routes stay with the caller;
 * adapter variants sit directly beneath their base model. `describe(model)` may return { status, facts, note } for a choice. */
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
  const reselect = event => {
    const input = event.target;
    // Native radios emit no change when the user chooses the checked default.
    // The caller still needs that deliberate choice to stop following discovery.
    if (input.name !== name || input.disabled || !input.checked || input.value !== select.value) return;
    if (event.type === 'keydown') {
      if (event.key !== ' ' || event.repeat) return;
      event.preventDefault();
    }
    change(event);
  };
  group.addEventListener('change', change);
  group.addEventListener('click', reselect);
  group.addEventListener('keydown', reselect);
  return {
    update(models, { grouped = false, preferNetwork = true, variants = false, describe = null, compact = false } = {}) {
      group.hidden = select.hidden;
      const active = group.contains(document.activeElement) ? document.activeElement : null;
      const entries = variants ? modelVariants(models, { value: select.value, preferNetwork })
        : models.map(model => ({ key: model.selectionId || model.id, model, ids: [model.selectionId || model.id], value: model.selectionId || model.id }));
      const families = variants && !compact ? modelFamilies(entries) : entries.map(entry => ({ base: entry, adapters: [], members: [entry], lead: entry.model }));
      const byLead = new Map(families.map(family => [family.lead, family]));
      const sections = grouped ? modelChoiceGroups(families.map(family => family.lead), { preferNetwork }) : [{ id: 'all', models: families.map(family => family.lead) }];
      const keys = new Set(entries.map(entry => entry.key));
      // Only this group's own choices; a caller may place other controls beneath a choice.
      for (const label of [...group.querySelectorAll('label[data-choice-key]')]) {
        if (!keys.has(label.dataset.choiceKey)) label.remove();
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
        section.models.flatMap(lead => byLead.get(lead).members.map(entry => [entry, byLead.get(lead).base !== entry])).forEach(([entry, nested], index) => {
          const model = entry.routes?.find(route => (route.selectionId || route.id) === entry.value) || entry.model;
          let label = [...group.querySelectorAll('label[data-choice-key]')].find(item => item.dataset.choiceKey === entry.key);
          if (!label) {
            label = document.createElement('label');
            label.className = 'chat-model-choice pool-button btn-ghost pool-choice';
            label.dataset.choiceKey = entry.key;
            label.innerHTML = '<input type="radio"><span><span data-choice-name></span><small class="pool-muted" data-choice-status></small><small class="pool-muted" data-choice-facts hidden></small><small class="pool-muted" data-choice-note hidden></small></span>';
            label.querySelector('input').name = name;
            parent.append(label);
          }
          label.toggleAttribute('data-choice-adapter', nested);
          const input = label.querySelector('input');
          input.value = entry.value;
          input.checked = entry.ids.includes(select.value);
          input.disabled = select.disabled;
          label.querySelector('[data-choice-name]').textContent = variants ? modelVariantLabel(model) : modelSelectionLabel(model);
          // Each family member reports its own availability, which may differ from its family's group.
          const described = describe?.(model) || {};
          label.querySelector('[data-choice-status]').textContent = described.status
            ?? (grouped ? choiceStatus(model, ownGroup(model, preferNetwork)) : availabilityLabel(model));
          const facts = compact ? '' : described.facts ?? modelFacts(model), factsNode = label.querySelector('[data-choice-facts]');
          factsNode.textContent = facts; factsNode.hidden = !facts;
          const noteNode = label.querySelector('[data-choice-note]');
          noteNode.textContent = compact ? '' : described.note || ''; noteNode.hidden = compact || !described.note;
          const position = parent.querySelectorAll(':scope > label[data-choice-key]')[index];
          if (position !== label) parent.insertBefore(label, position || null);
        });
      }
      for (const section of [...group.querySelectorAll('[data-choice-group]')]) {
        if (!parents.has(section.dataset.choiceGroup)) section.remove();
      }
      if (active?.isConnected && document.activeElement !== active) active.focus({ preventScroll: true });
    },
    focus() { (group.querySelector(`input[name="${name}"]:checked`) || group.querySelector(`input[name="${name}"]`))?.focus(); },
    /** The checked choice's label, beneath which a caller may place that choice's details. */
    checkedChoice: () => [...group.querySelectorAll(`input[name="${name}"]`)].find(input => input.checked)?.closest('label') || null,
    dispose() {
      group.removeEventListener('change', change);
      group.removeEventListener('click', reselect);
      group.removeEventListener('keydown', reselect);
      group.remove();
      select.classList.remove('chat-model-value');
    }
  };
}

const availabilityLabel = model => ({ ready: 'Ready', cached: 'On this device', busy: 'Busy', loading: 'Preparing', preparing: 'Preparing', unavailable: 'Unavailable' }[model.availability] || '');
const choiceStatus = (model, group) => group === 'shared'
  ? ({ ready: 'Ready', busy: 'Busy · waits for capacity', loading: 'Preparing', preparing: 'Preparing' }[model.networkAvailability])
  : group === 'download' ? 'Download required' : availabilityLabel(model);

/** Options only: selection, availability policy and execution remain caller-owned. */
/** The model and adapter names, without the execution route. */
export const modelVariantLabel = model => [...new Set([model.name, ...(model.adapters || []).map(adapter => adapter.name || adapter.id)].filter(Boolean))].join(' + ');
export const modelSelectionLabel = model => modelVariantLabel(model) + (model.executionModes?.length || model.partition ? (model.partition ? ['ready', 'busy'].includes(model.networkAvailability ?? model.availability) ? ' · Distributed layers' : ' · Unavailable route' : ' · Whole model') : '');

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
