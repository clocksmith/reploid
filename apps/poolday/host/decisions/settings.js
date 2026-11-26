/**
 * Settings as records, for any shell: answer preference, stored downloads, file sharing, credits, sign-in, network
 * answers and web search. Framework-free and pure. Each line is the vanilla Settings pane's own wording, built from
 * the host's choice and wording functions (choice-availability.js, web-search-settings.js, remote-permission.js);
 * nothing here stores a preference, grants a permission or decides a price.
 */
import { routePreferenceChoices, fileModeChoices, webSearchAvailability } from '../../ui/pool-home/choice-availability.js';
import { webSearchDisclosure } from '../../ui/pool-home/web-search-settings.js';
import { DEFAULT_ROUTE_PREFERENCE, ROUTE_PREFERENCES } from '../route-preference.js';
import { modelKey, servingStatus } from './model-state.js';

export { ROUTE_PREFERENCES, DEFAULT_ROUTE_PREFERENCE, routePreferenceChoices, fileModeChoices, webSearchAvailability, webSearchDisclosure };

/** "When several computers can answer": the options, why they are off, and the fix. */
export function projectRoutePreference(state, session) {
  return routePreferenceChoices({ remoteAnswersEnabled: state.remoteAnswersEnabled === true, canSet: !!session?.setRoutePreference,
    value: session?.getRoutePreference?.() ?? DEFAULT_ROUTE_PREFERENCE });
}

/** One stored download as the Storage list shows it. */
export const storedModelLabel = row => `${row.name} · ${(row.sizeBytes / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`;

export const STORAGE_TEXT = Object.freeze({
  checking: 'Checking stored files…',
  measured: 'Measured stored files, including partial downloads. Shared files may count toward more than one model.',
  empty: 'No model downloads stored. Choose a model in Answer on to download one.'
});

/** The summary shown where this page has no storage port: the catalog's own downloaded models. */
export function storageSummary(state) {
  const stored = (state.models || []).filter(model => model.localCached);
  return stored.length ? stored.map(model => model.name || model.id).join(' · ') : 'No downloaded models';
}

const gib = bytes => (bytes / 1073741824).toLocaleString(undefined, { maximumFractionDigits: 2 }) + ' GiB';

/**
 * "Share model files" and its download options (network-controls.js): the switch, its status line, progress, the
 * model and mode choices with their availability, the allowance field and the limits line.
 * `selection` is { modelId, mode, allowance } as staged in the options; the host owns the effect.
 */
/** The file-sharing switch's status, read the same way in Settings and in Computers (one state, two places). */
export function fileSharingStatus(network = {}) {
  const files = network.files;
  return files?.error || (files?.stopping ? 'Stopping' : files?.preparing ? 'Preparing' : files?.sharing ? 'Sharing'
    : files?.enabled ? 'On · waiting for cached files' : 'Not sharing');
}

export function projectFileSharing(state, selection = {}) {
  const network = state.network || {}, catalogModels = (state.models || []).filter(model => !model.partition);
  const prepared = catalogModels.find(model => model.id === state.defaultModel?.id && servingStatus(state.defaultModel?.availability));
  const modelId = selection.modelId && catalogModels.some(model => modelKey(model) === selection.modelId) ? selection.modelId : modelKey(prepared || catalogModels[0]) || null;
  const sharingFiles = !!(network.files?.sharing || network.files?.preparing || network.files?.stopping);
  const stored = (state.models || []).filter(model => model.localCached).length;
  const mode = selection.mode || 'cached-only';
  const fileLimits = network.files?.limits;
  let limits = fileLimits ? `Store up to ${gib(fileLimits.storedBytes)} · Send up to ${gib(fileLimits.supplyBytes)}` : 'Limits will be shown when file sharing is prepared.';
  if (mode === 'full-model') {
    const seeding = network.files?.seedingBytes?.[modelId];
    limits += Number.isSafeInteger(seeding)
      ? ` · Full-model seeding downloads and keeps ${gib(seeding)} on this device and needs an allowance of at least ${Math.ceil(seeding / 1048576).toLocaleString()} MiB`
      : ' · The full-model size is checked against your allowance when seeding starts';
  }
  const budget = network.files?.acquisitionBudget;
  if (budget) limits += ` · Download allowance used ${gib(budget.reservedBytes)} of ${gib(budget.maxBytes)}`;
  const allowance = budget ? String(budget.maxBytes / 1048576)
    : selection.allowance ?? (fileLimits?.downloadBytes ? String(fileLimits.downloadBytes / 1048576) : '');
  return {
    enabled: network.files?.enabled ?? sharingFiles,
    toggleDisabled: !!network.files?.stopping,
    status: fileSharingStatus(network),
    progress: network.files?.progress?.message || '',
    models: catalogModels.map(model => ({ id: modelKey(model), name: model.name || model.id })),
    modelId,
    modelDisabled: sharingFiles,
    modes: fileModeChoices({ storedModels: stored, sharing: sharingFiles, value: mode }),
    mode,
    allowanceShown: mode !== 'cached-only',
    allowance,
    allowanceDisabled: sharingFiles || !!budget,
    allowanceMax: fileLimits?.maxDownloadBytes ? fileLimits.maxDownloadBytes / 1048576 : null,
    limits,
    paused: !!network.paused
  };
}

/** The file-sharing request the switch makes: cached files only, or the chosen model with its mode and allowance. */
export function fileSharingRequest(state, selection) {
  const files = state.network?.files;
  const enable = !(files?.enabled ?? (files?.sharing || files?.preparing));
  const mode = selection.mode || 'cached-only';
  return { enable, paused: !!state.network?.paused, cachedOnly: enable && mode === 'cached-only', modelId: selection.modelId,
    controls: { mode, ...(mode !== 'cached-only' ? { downloadBytes: Number(selection.allowance) * 1048576 } : {}) } };
}

/** "Allow network answers": on or off and what it means. */
export function remoteAnswersText(state) {
  return state.remoteAnswersEnabled === true
    ? "Your messages and conversation context can be sent to contributors' computers on this network."
    : 'Network answers are off. Turn this on to use contributors, or choose this device.';
}

/** Web search: the switch, why it is off, its fix, who receives the query and the status line. */
export function projectWebSearch(state, search) {
  const availability = webSearchAvailability({ url: state.url, builtInAvailable: !!search?.available() });
  return {
    enabled: !!state.enabled,
    disabled: availability.disabled,
    reason: availability.reason || (state.enabled ? 'On' : 'Off'),
    fix: availability.fix?.label ?? null,
    disclosure: webSearchDisclosure(state, search),
    url: state.url || '',
    tool: state.tool || '',
    tokenPlaceholder: state.hasToken ? 'Set for this tab' : '',
    status: state.status?.message || (state.enabled && !state.url ? search?.state().message || '' : '')
  };
}

const number = value => Number.isFinite(value) ? value.toLocaleString('en-US') : '—';
const price = ({ amountMinor, currency }) => `${(amountMinor / 100).toFixed(2)} ${currency}`;
const time = value => { const at = Date.parse(value); return Number.isFinite(at) ? new Date(at).toLocaleString() : ''; };
const ISSUED = { earned: 'Earned', purchased: 'Bought', community_access: 'Community Access', subsidized: 'Reward (subsidized)', donated: 'Donated' };
const ENTRY = { reserve: 'Held for an answer', charge: 'Charged for an answer', release: 'Released', refund: 'Refunded', reverse: 'Reversed' };
const CHECKOUT = { creating: 'starting', open: 'waiting for payment', awaiting_issuance: 'paid, crediting', issued: 'credited', awaiting_reversal: 'reversing',
  reversed: 'reversed', failed: 'failed', expired: 'expired' };
const entryLabel = entry => entry.type === 'issue' ? (ISSUED[entry.lots?.[0]?.provenance] || 'Issued') : (ENTRY[entry.type] || entry.type);
const signed = entry => ['issue', 'release', 'refund'].includes(entry.type) ? `+${number(entry.amount)}` : `−${number(entry.amount)}`;

const balanceText = balance => {
  if (!balance) return '';
  const parts = [`Balance: ${number(balance.available)} credits`];
  if (balance.held) parts.push(`${number(balance.held)} held for answers in progress`);
  const earned = balance.byProvenance?.earned?.available ?? 0, bought = balance.byProvenance?.purchased?.available ?? 0;
  if (earned || bought) parts.push(`earned ${number(earned)}, bought ${number(bought)}`);
  return parts.join(' · ');
};

const quoteText = (quote, limit) => {
  if (!quote) return limit ? '' : 'No spending limit is set, so answers that cost credits are not sent.';
  const head = `Last quote: up to ${number(quote.maxCharge)} credits${quote.deadline ? `, answer by ${new Date(quote.deadline).toLocaleTimeString()}` : ''}.`;
  if (quote.funding === 'community_access') return `${head} Asked for Community Access, which the pool pays.`;
  if (quote.accepted) return `${head} Accepted.`;
  return `${head} Not sent: ${limit ? `above your limit of ${number(limit)}` : 'no spending limit is set'}.`;
};

/** The credits account (account-panel.js): balance, top-ups, the last checkout, the limit, the last quote and the journal. */
export function projectCreditAccount(state) {
  const ready = state.phase === 'ready';
  return {
    ready,
    balance: ready ? balanceText(state.balance) : '',
    topUps: (state.topUps || []).map(topUp => ({ id: topUp.topUpId, label: `Top up ${price(topUp.price)}` })),
    checkout: state.checkout ? `Last top-up: ${number(state.checkout.credits)} credits, ${CHECKOUT[state.checkout.phase] || state.checkout.phase}.` : null,
    spendingLimit: state.spendingLimit ?? null,
    quote: quoteText(state.lastQuote, state.spendingLimit),
    journal: (state.journal || []).map((entry, index) => ({ id: `${index}:${entry.type}:${entry.at}`, type: entry.type,
      text: `${entryLabel(entry)} ${signed(entry)} credits · ${time(entry.at)}` })),
    status: state.phase === 'signing_in' ? 'Signing in…' : state.message || ''
  };
}

/** Email sign-in (account-sign-in.js): what shows, and the summary line. */
export function projectSignIn(state) {
  return {
    formShown: state.phase !== 'signed_in' && state.phase !== 'unavailable',
    signedIn: state.phase === 'signed_in',
    sendDisabled: state.phase === 'idle' || state.phase === 'sending',
    summary: state.phase === 'signed_in'
      ? (state.email ? `Signed in as ${state.email}.` : 'Signed in.')
      : state.phase === 'unavailable'
        ? 'Sign-in is not available on this server.'
        : 'Sign in with a one-time link sent to your email. Supabase receives your address to send it.',
    message: state.message || ''
  };
}

/** The local test sign-in's signed-in line. */
export const localSignInText = state => state.subject ? `Signed in as ${state.subject} (local test).` : '';
