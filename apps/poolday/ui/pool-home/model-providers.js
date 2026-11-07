import { escapeHtml as escape } from '../components/attachments.js';
import { computerLabel } from './computer-labels.js';
import { projectNetworkPeers } from './network-controls.js';
import { hardwareText } from './execution-ribbon.js';

const keyFor = model => model.selectionId || model.id;
const adapters = model => (model.adapters || []).map(adapter => adapter.identity).sort();
export const sameModelVariant = (a, b) => !!a?.identity && a.id === b?.id && a.identity === b.identity
  && JSON.stringify(adapters(a)) === JSON.stringify(adapters(b));

/** What a provider reports now; an answer's execution details keep what ran. */
export const hardwareLabel = value => hardwareText(value) ?? 'GPU not reported';

const routeStatus = model => ({ ready: 'Ready', busy: 'At capacity', loading: 'Preparing', preparing: 'Preparing' })[model.networkAvailability ?? model.availability] || 'Unavailable';

/** Catalog routes are host-owned. Separate providers never imply a distributed route. */
export function projectModelProviders(state, selected) {
  if (!selected?.identity) return [];
  const variants = (state.models || []).filter(model => sameModelVariant(model, selected));
  const whole = variants.find(model => !model.partition);
  const peers = projectNetworkPeers(state);
  const person = (id, role, hardware) => ({ id, label: id === state.participantId ? 'This device' : computerLabel(state, id),
    role, hardware: hardwareLabel(hardware) });
  const rows = [];
  if (whole) for (const peer of peers) {
    if (peer.executionType !== 'whole-model' || peer.modelId !== whole.id || peer.modelIdentity !== whole.identity
      || JSON.stringify(adapters(whole)) !== JSON.stringify([...(peer.adapterIdentities || [])].sort())) continue;
    const admitted = whole.providerIds?.includes(peer.id);
    rows.push({ id: peer.id, selectionId: keyFor(whole), type: 'Whole model',
      status: admitted ? peer.status : peer.phase === 'ready' ? 'Unavailable' : peer.status,
      participants: [person(peer.id, 'Whole model', peer.hardware)] });
  }
  for (const model of variants.filter(model => model.partition)) {
    const route = model.partition.route;
    const ids = route?.schema === 'reploid.partition-route/v1' ? route.stages?.map(stage => stage.participantId)
      : [model.partition.participantA, model.partition.participantB];
    if (!ids || ids.length < 2 || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length) continue;
    rows.push({ id: keyFor(model), selectionId: keyFor(model), type: `Distributed · ${ids.length} computers`,
      status: routeStatus(model),
      participants: ids.map((id, index) => {
        const capability = state.network?.partitionPeers?.find(peer => peer.available && (peer.participantId === id || peer.description?.participantId === id));
        const peer = peers.find(peer => peer.id === (capability?.transportId || id));
        return person(id, `Stage ${index + 1} of ${ids.length}`, peer?.hardware);
      }) });
  }
  if (whole?.localReady || whole?.localCached) rows.push({ id: 'local', selectionId: keyFor(whole), type: 'This device',
    status: whole.localReady ? 'Ready' : 'Downloaded · preparation required',
    participants: [{ id: 'local', label: 'This device', role: 'Whole model',
      hardware: hardwareLabel(state.localModel?.modelIdentity === whole.identity ? state.localModel.hardware : null) }] });
  return rows;
}

/** The selected variant's execution alternatives: its whole-model route with each provider, then each
 * distributed route with its ordered stages. A distributed route without assigned computers lists none. */
export function projectModelRoutes(state, selected) {
  if (!selected?.identity) return [];
  const variants = (state.models || []).filter(model => sameModelVariant(model, selected));
  const rows = projectModelProviders(state, selected);
  return variants.map(model => {
    const own = rows.filter(row => row.selectionId === keyFor(model));
    if (!model.partition) return { selectionId: keyFor(model), type: 'Whole model', status: routeStatus(model),
      participants: own.flatMap(row => row.participants.map(peer => ({ ...peer, role: '', status: row.status }))) };
    const route = own[0];
    return { selectionId: keyFor(model), type: route?.type || 'Distributed layers', status: routeStatus(model),
      participants: route?.participants.map(peer => ({ ...peer, status: '' })) || [] };
  });
}

export const ADAPTER_GUIDE_URL = 'https://github.com/clocksmith/reploid/blob/main/docs/adapters.md';

export const renderModelProviders = () => `<details class="pool-disclosure chat-model-providers" data-model-providers hidden><summary>Providers <span class="pool-muted" data-provider-count></span></summary><div class="pool-stack pool-gap-sm" data-provider-list></div><p class="pool-caption pool-muted">GPU details are reported by providers. The answer’s execution details show which computers were used.</p><p class="pool-caption"><a href="${ADAPTER_GUIDE_URL}" target="_blank" rel="noopener noreferrer">Prepare or serve an adapter</a></p></details>`;

let routeGroup = 0;
/** Update only the disclosure contents, keeping its open state and the surrounding controls.
 * With several routes, each route is a radio carrying its selectionId; the caller owns the value. */
export function updateModelProviders(root, state, model, { selectedId = model ? keyFor(model) : null, disabled = false } = {}) {
  const routes = projectModelRoutes(state, model);
  const count = routes.reduce((total, route) => total + route.participants.length, 0);
  for (const disclosure of root.querySelectorAll('[data-model-providers]')) {
    disclosure.hidden = !model;
    disclosure.dataset.routeName ||= `model-route-${++routeGroup}`;
    disclosure.querySelector('[data-provider-count]').textContent = count ? String(count) : '';
    const list = disclosure.querySelector('[data-provider-list]');
    const choose = routes.length > 1 || routes.length === 1 && routes[0].selectionId !== selectedId;
    // A provider's own status appears only where it differs from its route's.
    const people = route => route.participants.map(peer => `<li><span>${escape(peer.label)}</span><small class="pool-small pool-muted">${[peer.role, peer.hardware, peer.status === route.status ? '' : peer.status].filter(Boolean).map(escape).join(' · ')}</small></li>`).join('');
    const markup = count || routes.length > 1 ? routes.map(route => `<div class="chat-model-route pool-stack pool-gap-xs" data-model-route="${escape(route.selectionId)}">${choose
      ? `<label class="chat-model-route-heading"><input type="radio" name="${disclosure.dataset.routeName}" value="${escape(route.selectionId)}" data-model-route-choice><strong>${escape(route.type)}</strong><span class="pool-muted">${escape(route.status)}</span></label>`
      : `<div class="chat-model-route-heading"><strong>${escape(route.type)}</strong><span class="pool-muted">${escape(route.status)}</span></div>`}${route.participants.length
      ? `<ul class="chat-model-route-people">${people(route)}</ul>` : `<p class="pool-small pool-muted">${route.type === 'Whole model' ? 'No providers reported.' : 'No computers assigned.'}</p>`}</div>`).join('')
      : '<p class="pool-small pool-muted">No providers reported for this model.</p>';
    if (list.dataset.projection !== markup) { list.innerHTML = markup; list.dataset.projection = markup; }
    for (const input of list.querySelectorAll('[data-model-route-choice]')) {
      input.checked = input.value === selectedId; input.disabled = disabled;
    }
  }
}
