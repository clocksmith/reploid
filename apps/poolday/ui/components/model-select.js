import { modelKey, preparingStatus, servingStatus, sharedModelChoice, storedHere, usableStatus } from '../../host/decisions/model-state.js';

// The browser downloader resolves weights against baseUrl. Pinned metadata alone cannot supply them.
export const hasBrowserModelOrigin = model => !!model?.source?.baseUrl;
export const isDownloadableBaseModel = model => hasBrowserModelOrigin(model) && !model.partition && !model.adapters?.length;
/** Retain a saved choice's identity without retaining old capacity observations. */
export const unavailableModelChoice = model => ({ ...model, availability: 'unavailable', networkAvailability: 'unavailable',
  localReady: false, localCached: false, providerIds: [] });
export const isSharedModelChoice = sharedModelChoice;

/** The selected execution source, matching the host's local-cache reuse policy. */
export function modelExecutionState(model, location = 'auto') {
  const local = storedHere(model);
  const source = location === 'local' || location === 'auto' && local ? 'local' : 'network';
  const status = source === 'local' ? model?.partition ? 'unavailable' : model?.localReady ? 'ready' : local ? 'cached' : 'unavailable'
    : model?.networkAvailability ?? (local ? 'unavailable' : model?.availability ?? 'unavailable');
  return { source, status, usable: usableStatus(status),
    label: !usableStatus(status) ? preparingStatus(status) ? 'Loading' : 'Unavailable' : source === 'local' ? 'This device' : model?.fleet ? 'Private computers' : model?.partition && servingStatus(status) ? 'Public network · Split model' : 'Public network' };
}

/** Catalog facts shown beside a choice: declared weights and advertised context, nothing inferred. */
export const modelFacts = model => [
  model?.quantization ? String(model.quantization).toUpperCase() : null,
  Number.isSafeInteger(model?.contextLength) && model.contextLength > 0 ? `${model.contextLength.toLocaleString()} tokens maximum` : null
].filter(Boolean).join(' · ');

/** Presentation groups never change model identities or execution permissions. `keep` lists group ids shown even when empty. */
export function modelChoiceGroups(models, { preferNetwork = true, location = 'auto', keep = [] } = {}) {
  const privateModels = [], shared = [], local = [], downloads = [], unavailable = [];
  for (const model of models) {
    if (model.fleet) privateModels.push(model);
    // On this device, a stored or downloadable model is listed as such even when the network also shares it.
    else if (location === 'local' && storedHere(model)) local.push(model);
    else if (location === 'local' && isDownloadableBaseModel(model)) downloads.push(model);
    else if (isSharedModelChoice(model)) shared.push(model);
    else if (location === 'network') unavailable.push(model);
    else if (storedHere(model)) local.push(model);
    else if (isDownloadableBaseModel(model)) downloads.push(model);
    else unavailable.push(model);
  }
  const rank = model => model.networkAvailability === 'ready' ? 0 : model.networkAvailability === 'busy' ? 1 : 2;
  shared.sort((a, b) => rank(a) - rank(b));
  const groups = [
    { id: 'shared', label: 'Public network', models: shared },
    { id: 'local', label: 'On this device', models: local },
    { id: 'private', label: 'Your private computers', models: privateModels },
    { id: 'download', label: 'Download to this device', models: downloads },
    { id: location === 'network' ? 'network-unavailable' : 'unavailable', label: location === 'network' ? 'Unavailable on network' : 'Unavailable', models: unavailable }
  ];
  const ordered = location === 'local' ? [groups[1], groups[3], groups[0], groups[2], groups[4]]
    : preferNetwork ? groups : [groups[1], groups[0], ...groups.slice(2)];
  return ordered.filter(group => group.models.length || keep.includes(group.id));
}

/** One exact model artifact with its exact adapters. Whole-model and distributed routes are alternatives of it. */
export const modelVariantKey = model => JSON.stringify([model.id, model.identity ?? null, model.fleet?.requester.participantId ?? null,
  (model.adapters || []).map(adapter => adapter.identity ?? adapter.id ?? null).sort()]);

/** Ready shared capacity first, then busy, on-device, preparing, downloadable and unavailable routes. */
const routeRank = (model, preferNetwork) => {
  const local = model.localReady || model.localCached || model.availability === 'cached';
  if (!preferNetwork && local && !model.partition) return 0;
  return isSharedModelChoice(model) ? ({ ready: 1, busy: 2 }[model.networkAvailability] ?? 4)
    : local ? 3 : isDownloadableBaseModel(model) ? 5 : 6;
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
    const ids = routes.map(route => modelKey(route));
    return { key, model, routes, ids, value: ids.includes(value) ? value : modelKey(model) };
  });
}

/** An adapter variant's base is the variant of the same exact model artifact with no adapter. Entries are grouped
 * into families: a base model followed by its adapter variants, placed in the group of the family's most usable member.
 * An adapter whose base variant is absent stands alone. Compatibility was settled by the catalog's declared identity. */
const familyRank = model => isSharedModelChoice(model) ? ({ ready: 0, busy: 1 }[model.networkAvailability] ?? 2)
  : model.localReady || model.localCached || model.availability === 'cached' ? 3 : isDownloadableBaseModel(model) ? 4 : 5;
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
export const ownGroup = (model, preferNetwork, location) => modelChoiceGroups([model], { preferNetwork, location })[0]?.id;

export const availabilityLabel = model => ({ ready: 'Ready', cached: 'On this device', busy: 'Busy', loading: 'Preparing', preparing: 'Preparing', unavailable: 'Unavailable' }[model.availability] || '');
/** How many computers advertise this whole model now. A distributed route has no single serving computer, so it reports none. */
export const modelServingComputers = model => model?.partition ? 0 : new Set(model?.providerIds || []).size;
export const computerCountLabel = count => `${count} ${count === 1 ? 'computer' : 'computers'}`;
export const choiceStatus = (model, group, includeCount = true) => {
  if (group === 'network-unavailable') return 'Unavailable';
  if (group === 'download') return 'Download required';
  if (group !== 'shared') return availabilityLabel(model);
  const status = { ready: 'Ready', busy: 'Busy · waits for capacity', loading: 'Preparing', preparing: 'Preparing' }[model.networkAvailability];
  const count = modelServingComputers(model);
  return includeCount && status && count ? `${status} · ${computerCountLabel(count)}` : status;
};

/** Options only: selection, availability policy and execution remain caller-owned. */
/** The model and adapter names, without the execution route. */
export const modelVariantLabel = model => [...new Set([model.name, ...(model.adapters || []).map(adapter => adapter.name || adapter.id)].filter(Boolean))].join(' + ');
export const modelSelectionLabel = model => modelVariantLabel(model) + (model.executionModes?.length || model.partition ? (model.partition ? ['ready', 'busy'].includes(model.networkAvailability ?? model.availability) ? ' · Distributed layers' : ' · Unavailable route' : ' · Whole model') : '');
