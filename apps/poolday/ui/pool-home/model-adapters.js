import { escapeHtml as escape } from '../components/attachments.js';
import { modelFacts } from '../components/model-select.js';
import { sameModelVariant } from './model-providers.js';

/** How to prepare a compatible adapter or serve one; the public guide, not an in-product service. */
export const ADAPTER_GUIDE_URL = 'https://github.com/clocksmith/reploid/blob/main/docs/adapters.md';
const shortIdentity = identity => typeof identity === 'string' ? identity.slice(0, 15) + '…' : '';
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const adapterOf = model => model?.adapters?.length === 1 ? model.adapters[0] : null;
const sameBase = (a, b) => a.id === b.id && a.identity === b.identity;

/** Evaluation evidence exactly as the host verified it. Only a verified passing receipt reads as evaluated;
 * a declaration, a publisher's own scores or a runtime check never do. */
export function adapterEvidence(state, adapter) {
  const evidence = state.adapterEvidence?.[adapter?.identity];
  const url = evidence?.receiptUrl || null;
  switch (evidence?.status) {
    case 'passed': return { status: 'passed', text: 'Passed held-out evaluation', url };
    case 'failed': return { status: 'failed', text: 'Failed held-out evaluation', url };
    case 'invalid': return { status: 'invalid', text: 'Evaluation receipt rejected', url, detail: evidence.reason };
    case 'unavailable': return { status: 'unavailable', text: 'Evaluation receipt could not be read', url };
    case 'checking': return { status: 'checking', text: 'Checking evaluation receipt', url };
    default: return { status: 'none', text: 'No evaluation evidence', url: null };
  }
}

/** Who can serve this exact adapter variant now: whole-model providers and ready distributed routes. */
export function adapterAvailability(state, model) {
  const variants = (state.models || []).filter(item => sameModelVariant(item, model));
  const computers = new Set(variants.filter(item => !item.partition).flatMap(item => item.providerIds || [])).size;
  const routes = variants.filter(item => item.partition && ['ready', 'busy'].includes(item.networkAvailability ?? item.availability)).length;
  const text = computers || routes ? `Served now by ${[computers ? plural(computers, 'computer') : '', routes ? plural(routes, 'distributed route') : ''].filter(Boolean).join(' and ')}`
    : 'No computer serves this adapter now. Requests wait; the base model is not used instead.';
  return { computers, routes, text };
}

/** Choice lines for the picker: an adapter's own availability, version and evidence; a base model's adapter count. */
export function describeModelChoice(state) {
  return model => {
    const adapter = adapterOf(model);
    if (!adapter) {
      const count = (state.models || []).filter(item => !item.partition && adapterOf(item) && sameBase(item, model)).length;
      return count ? { facts: [modelFacts(model), plural(count, 'adapter')].filter(Boolean).join(' · ') } : {};
    }
    const network = model.networkAvailability ?? model.availability;
    return { status: { ready: 'Ready', busy: 'Busy · waits for capacity', loading: 'Preparing', preparing: 'Preparing' }[network]
      || (model.localReady ? 'Ready on this device' : 'No computer serves it now'),
    facts: ['Adapter', adapter.manifest?.version ? `v${adapter.manifest.version}` : 'version not declared'].join(' · '),
    note: adapterEvidence(state, adapter).text };
  };
}

export const renderAdapterDetails = () => '<div class="chat-model-adapter pool-stack pool-gap-xs" data-model-adapter-details hidden></div>';

const link = (url, text) => url ? `<a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(text)}</a>` : escape(text);

/** The highlighted variant's adapter facts: purpose with its source, version, identities, evaluation and availability.
 * A base model lists how many compatible adapters it has. Both link the preparation guide. */
export function updateAdapterDetails(root, state, model) {
  const node = root.querySelector('[data-model-adapter-details]');
  if (!node) return;
  const adapter = adapterOf(model);
  let markup = '';
  if (adapter) {
    const purpose = adapter.purpose, evidence = adapterEvidence(state, adapter), availability = adapterAvailability(state, model);
    const source = { publisher: 'Publisher’s description', owner: 'Owner’s description' }[purpose?.source] || 'Source not recorded';
    const base = (state.models || []).find(item => !item.partition && !adapterOf(item) && sameBase(item, model));
    markup = `<p class="pool-small"><strong>${escape(adapter.name || adapter.id)}</strong> · ${escape(adapter.manifest?.version ? `v${adapter.manifest.version}` : 'Version not declared')}</p>
      <p class="pool-small" data-adapter-purpose>${purpose?.statement ? `Purpose: ${escape(purpose.statement)} <small class="pool-muted">${link(purpose.url, source)}</small>` : 'Purpose not declared'}</p>
      <p class="pool-small" data-adapter-evidence data-evidence-status="${evidence.status}">Evaluation: ${link(evidence.url, evidence.text)}${evidence.detail ? ` <small class="pool-muted">${escape(evidence.detail)}</small>` : ''}</p>
      <p class="pool-small" data-adapter-availability>${escape(availability.text)}</p>
      <p class="pool-caption pool-muted">For ${escape(base?.name || model.id)} <code title="${escape(model.identity)}">${escape(shortIdentity(model.identity))}</code> · Adapter <code title="${escape(adapter.identity)}">${escape(shortIdentity(adapter.identity))}</code></p>`;
  } else if (model) {
    const count = (state.models || []).filter(item => !item.partition && adapterOf(item) && sameBase(item, model)).length;
    markup = `<p class="pool-small" data-adapter-count>${count ? `${plural(count, 'adapter')} for this model, listed beneath it.` : 'No adapters for this model yet.'}</p>`;
  }
  if (markup) markup += `<p class="pool-caption">${link(ADAPTER_GUIDE_URL, 'Prepare or serve an adapter')}</p>`;
  node.hidden = !markup;
  if (node.dataset.projection !== markup) { node.innerHTML = markup; node.dataset.projection = markup; }
}
