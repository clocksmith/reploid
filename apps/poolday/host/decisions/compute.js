/**
 * "Sequence provider" (/compute) without markup: the contributor's status and notice, the model it
 * shares, the sharing limits it agreed to, its readiness, its recent receipts and the last debug event.
 * It is the vanilla binding (ui/pool-home/provider-controls.js, provider-status-view.js,
 * participation-controls.js, contribution-status-view.js) with the DOM taken out; the host's
 * contribution session (host/provider-contribution-session.js) loads, serves, signs and stops.
 * One controller per page, as the vanilla page kept one.
 */
import { createProviderContributionSession } from '../provider-contribution-session.js';
import { getPeerRoomId, getPeerRelayMode } from '../product-context.js';
import { createPeerRoomInviteUrl } from '../../pool/peer-rendezvous.js';
import { LAUNCH_MODEL, getEnabledPoolModelContract } from '../../../../shared/pool/model-contract.js';
import { readParticipationPreferences, writeParticipationPreferences } from '../../../../shared/pool/participation-profile.js';
import { getContributionSnapshot, recordContributionReceipt, subscribeContributionState, updateContributionState } from '../../ui/pool-home/contribution-state.js';
import { displayPoolError, formatDeviceLabel } from '../../ui/pool-home/control-display-text.js';
import { getProviderIdentityNamespace } from '../../ui/pool-home/page-identity.js';
import { formatContributionModel, formatContributionTokens } from '../../ui/pool-home/room-record-projection.js';
import { compactHash, compactHex } from '../../ui/pool-home/view-markup.js';
import { addReceiptLedgerRow } from './run-ledger.js';
import { projectRunResult } from './run-result.js';
import { DEFAULT_MODEL_ID, canContributeWith, modelChoices, packFacts, participationIdentity, readDeviceIdentity, workloadLabel } from './run-routes.js';

/** The contributor status word as the status dot reads it (provider-status-view.js updateProviderStatus). */
export function providerState(status = 'Idle') {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('retry') || normalized.includes('relay unavailable') || normalized.includes('checking relay')) return 'degraded';
  if (normalized.includes('could not') || normalized.includes('failed') || normalized.includes('error')) return 'error';
  if (['available', 'ready', 'answering', 'online', 'running'].some(word => normalized.includes(word))) return 'online';
  if (normalized.includes('starting') || normalized.includes('opening')) return 'starting';
  return 'offline';
}

const formatHealthValue = value => String(value ?? 'unknown').replace(/_/g, ' ');
const formatBytes = value => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown';
  if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / (1024 ** 2))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
};

/** Readiness as the host observed it: the four lines a contributor checks, then device and receipt details. Grants nothing. */
export function projectHealth(state = {}) {
  const rows = list => list.filter(([, value]) => value !== undefined && value !== null).map(([label, value]) => {
    const formatted = label === 'GPU buffer' ? formatBytes(value) : formatHealthValue(value);
    const loading = formatted.toLowerCase() === 'loading';
    return [label, loading ? formatted : compactHash(formatted), loading];
  });
  return {
    primary: rows([['Model', state.model], ['Room work', state.queue], ['Last receipt', state.lastReceipt], ['Check', state.trust]]),
    details: rows([['Capability', state.capability], ['WebGPU', state.webgpu], ['GPU', state.hardware], ['GPU buffer', state.maxBufferSize],
      ['Files', state.artifact], ['Local cache', state.storage], ['Reputation', state.reputation]])
  };
}

/** This tab's contribution counters and recent receipts, from records, never estimates. */
export function projectContribution(snapshot = getContributionSnapshot()) {
  return {
    optedIn: snapshot.optedIn === true,
    stats: [['Status', snapshot.label || 'Not active'], ['Model', formatContributionModel(snapshot.modelId)], ['24h receipts', String(snapshot.contributions24h || 0)],
      ['24h tokens', formatContributionTokens(snapshot.tokens24h)], ['Tokens/hr', formatContributionTokens(snapshot.tokensHour)]],
    recent: (snapshot.recent || []).map(row => ({ id: row.receiptHash || '—', answer: compactHex(row.receiptHash || '—'), model: formatContributionModel(row.modelId),
      tokens: formatContributionTokens(row.tokens), room: compactHash(row.roomId || '—') }))
  };
}

/** The sharing boundary the contributor reads before sharing, from the saved limits. */
export function sharingBoundary(preferences = readParticipationPreferences(), model = LAUNCH_MODEL) {
  const limits = preferences.limits;
  return [
    { strong: model.label || model.modelId, text: ' only' },
    { strong: String(limits.maxConcurrentJobs), text: ` run${limits.maxConcurrentJobs === 1 ? '' : 's'} at a time` },
    { strong: '', text: 'Public protein sequences only. Results and signed records go to the requester.' },
    { strong: '', text: `${limits.storageBudgetMiB} MiB cache · ${limits.bandwidthBudgetMbps} Mbps` },
    { strong: '', text: 'Share until you stop or close this tab' }
  ];
}

export const LIMIT_BOUNDS = Object.freeze({
  maxConcurrentJobs: { min: 1, max: 4 }, maxTokensPerJob: { min: 16, max: 2048 },
  storageBudgetMiB: { min: 128, max: 65536 }, bandwidthBudgetMbps: { min: 1, max: 10000 }
});

const LIMIT_SETTLE_MS = 600;
const HEALTH_DEFAULTS = Object.freeze({ webgpu: 'unknown', model: 'not_loaded', artifact: 'not_checked', storage: 'unknown', queue: 'idle',
  lastReceipt: 'none', trust: 'signed_record', reputation: 'not_loaded' });

export function createComputeController({ href = () => globalThis.location?.href || '', nav = globalThis.navigator, doc = globalThis.document } = {}) {
  const listeners = new Set();
  let health = { ...HEALTH_DEFAULTS };
  let status = 'Idle', notice = null, result = null, stopping = false;
  let worker = { running: false, starting: false };
  let modelId = DEFAULT_MODEL_ID;
  let identity = { label: 'Identity', protection: null, title: 'This device signs its network roles' };
  let passkeyStatus = '', passkeyBusy = false;
  let snapshot = null;
  const project = () => {
    const preferences = readParticipationPreferences();
    const model = getEnabledPoolModelContract(modelId) || LAUNCH_MODEL;
    return Object.freeze({
      status, state: providerState(status), notice, room: { id: getPeerRoomId(), relay: getPeerRelayMode() },
      active: worker.running || worker.starting, starting: worker.starting, stopping,
      modelId, modelLocked: worker.running || worker.starting, models: modelChoices(), workload: workloadLabel(modelId), facts: packFacts(modelId),
      boundary: sharingBoundary(preferences, model), permissions: { ...preferences.permissions }, limits: { ...preferences.limits }, limitBounds: LIMIT_BOUNDS,
      health: projectHealth(health), contribution: projectContribution(getContributionSnapshot()),
      identity: { ...identity }, passkey: { label: identity.protection === 'passkey' ? 'Passkey protected' : 'Protect identity with passkey',
        disabled: passkeyBusy || identity.protection === 'passkey', status: passkeyStatus },
      result: projectRunResult(result)
    });
  };
  const notify = () => { snapshot = project(); for (const listener of listeners) listener(); };
  const refreshIdentity = () => readDeviceIdentity().then(value => { identity = value; notify(); });
  const updateProviderHealth = (partial = {}) => { health = { ...health, ...partial }; notify(); };
  const session = createProviderContributionSession({
    getProviderIdentityNamespace, formatDeviceLabel, recordContributionReceipt, addReceiptLedgerRow, updateContributionState, displayPoolError, canContributeWith,
    refreshContributionStatusBar: notify,
    updateProviderHealth,
    async refreshProviderStorageHealth() {
      if (!nav?.storage?.estimate) { updateProviderHealth({ storage: nav?.storage ? 'available' : 'unknown' }); return; }
      try {
        const estimate = await nav.storage.estimate();
        const usedMb = Math.round(Number(estimate.usage || 0) / (1024 * 1024)), quotaMb = Math.round(Number(estimate.quota || 0) / (1024 * 1024));
        updateProviderHealth({ storage: quotaMb > 0 ? `${usedMb}/${quotaMb} MB` : 'available' });
      } catch { updateProviderHealth({ storage: 'unavailable' }); }
    },
    setResult(_id, value) { result = value; notify(); },
    // The server room summary feeds Records' activity panel, which this page does not show.
    refreshServerRoomActivity: async () => {},
    refreshParticipationControls: async preferences => { notify(); return preferences; },
    getPeerInviteUrl: () => createPeerRoomInviteUrl({ roomId: getPeerRoomId(), relay: getPeerRelayMode(), baseUrl: href() }),
    getSelectedModelId: () => modelId,
    hasControls: () => true,
    setProviderStatus(value) { status = value; notify(); },
    setProviderNotice(value) { notice = value ? { state: value.state || 'info', title: value.title || 'Sharing needs attention', message: value.message || '' } : null; notify(); },
    selectModel(next) { modelId = next; notify(); },
    setStopping() { stopping = true; notify(); },
    renderControls({ workerRunning, workerStarting, modelId: activeModelId }) {
      worker = { running: !!workerRunning, starting: !!workerStarting };
      if (!workerRunning && !workerStarting) stopping = false;
      if (activeModelId && (workerRunning || workerStarting)) modelId = activeModelId;
      notify();
    }
  });
  // Limits are saved as they change; a sharing tab restarts under them once the person pauses, not per keystroke.
  let applyFrom = null, applyTimer = null;
  const applyPreferences = (next, { settle = 0 } = {}) => {
    applyFrom ??= readParticipationPreferences();
    writeParticipationPreferences(next);
    notify();
    clearTimeout(applyTimer);
    applyTimer = setTimeout(async () => {
      const previous = applyFrom;
      applyFrom = null;
      await session.applyParticipationPreferences(previous, readParticipationPreferences());
      notify();
    }, settle);
  };
  const unsubscribeContribution = subscribeContributionState(() => { if (snapshot) notify(); });
  const onVisible = () => { if (doc?.visibilityState === 'visible') void session.resume(); };
  doc?.addEventListener?.('visibilitychange', onVisible);
  snapshot = project();
  session.attach();
  void refreshIdentity();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    toggle() { if (!worker.starting) void session.toggle(); },
    setModel(next) { modelId = next; notify(); void session.handleModelChange(); },
    setPermission(key, on) { const current = readParticipationPreferences(); applyPreferences({ ...current, permissions: { ...current.permissions, [key]: !!on } }); },
    setLimit(key, value) {
      const bounds = LIMIT_BOUNDS[key];
      const number = Number(value);
      if (!bounds || !Number.isFinite(number) || number < bounds.min || number > bounds.max) return;
      const current = readParticipationPreferences();
      applyPreferences({ ...current, limits: { ...current.limits, [key]: number } }, { settle: LIMIT_SETTLE_MS });
    },
    async enrollPasskey() {
      passkeyBusy = true; passkeyStatus = 'Waiting for passkey'; notify();
      try { await participationIdentity.enrollPasskey(); passkeyStatus = 'Passkey bound to this device identity.'; }
      catch (error) { passkeyStatus = String(error?.message || error?.error || error || 'Unknown error'); }
      finally { passkeyBusy = false; await refreshIdentity(); }
    },
    async dispose(options) {
      doc?.removeEventListener?.('visibilitychange', onVisible);
      clearTimeout(applyTimer);
      unsubscribeContribution();
      listeners.clear();
      await session.dispose(options);
    }
  };
}

let pageController = null;
/** The page's one contribution controller; navigating between views of the same page keeps sharing on. */
export const getComputeController = () => (pageController ??= createComputeController());
