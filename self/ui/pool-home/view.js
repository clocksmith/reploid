/**
 * @fileoverview Rendering and UI state helpers for the Reploid product home.
 */

import { LAUNCH_MODEL, getEnabledPoolModelContract, listPoolModels } from '../../pool/model-contract.js';
import { DETERMINISTIC_GENERATION_CONFIG, FASTEST_RECEIPT_POLICY_ID, getPolicy, listPolicies } from '../../pool/policy-router.js';
import { DEFAULT_PEER_ROOM_ID } from '../../pool/peer-room.js';
import { createPeerEventReducer } from '../../pool/peer-control-plane.js';
import { createPoolSdk } from '../../pool/sdk.js';
import {
  createPeerRoomBusFactory,
  createPeerRoomInviteUrl
} from '../../pool/peer-rendezvous.js';
import {
  PRODUCT_ROUTES,
  POOLDAY_FLOW_LABELS,
  POOLDAY_NAME,
  POOLDAY_NAV_ROUTES,
  POOLDAY_PEER_LEDGER_STORAGE_KEY,
  POOLDAY_PROTOCOL,
  POOLDAY_RECEIPT_LEDGER_STORAGE_KEY,
  POOLDAY_RECEIPT_LEDGER_LIMIT,
  POOLDAY_STREAM_CHUNK_SIZE,
  POOLDAY_STREAM_TICK_MS,
  POOLDAY_VERSION_TAG,
  ROUTE_COPY
} from './constants.js';

const POOLDAY_STREAM_STATE = new Map();
const POOLDAY_RECEIPT_LEDGER = [];
const POOLDAY_PEER_EVENTS = [];
const POOLDAY_PEER_EVENT_HASHES = new Set();
let POOLDAY_RECEIPT_LEDGER_ROOM = null;
let POOLDAY_PEER_EVENTS_ROOM = null;

const getPooldayStorage = () => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};

const encodeStorageRoom = (roomId) => encodeURIComponent(String(roomId || DEFAULT_PEER_ROOM_ID));

export const getPooldayRecordStorageKeys = (roomId = getPeerRoomId()) => ({
  receipts: `${POOLDAY_RECEIPT_LEDGER_STORAGE_KEY}::${encodeStorageRoom(roomId)}`,
  peerLedger: `${POOLDAY_PEER_LEDGER_STORAGE_KEY}::${encodeStorageRoom(roomId)}`
});

const readStorageArray = (key) => {
  try {
    const value = getPooldayStorage()?.getItem(key);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeStorageArray = (key, value) => {
  try {
    getPooldayStorage()?.setItem(key, JSON.stringify(value));
  } catch {
    // Local storage can be unavailable in hardened browser contexts.
  }
};

const replaceArrayContents = (target, values = []) => {
  target.splice(0, target.length, ...values);
};

const getPeerEventHash = (event = {}) => (
  event?.messageHash || `${event?.type || 'event'}:${event?.body?.agreementHash || ''}:${event?.body?.receiptHash || ''}:${event?.body?.userId || event?.body?.providerId || ''}`
);

const reloadPeerEventHashes = () => {
  POOLDAY_PEER_EVENT_HASHES.clear();
  for (const event of POOLDAY_PEER_EVENTS) {
    const eventHash = getPeerEventHash(event);
    if (eventHash) POOLDAY_PEER_EVENT_HASHES.add(eventHash);
  }
};

const loadReceiptLedgerRows = (roomId = getPeerRoomId()) => {
  const keys = getPooldayRecordStorageKeys(roomId);
  return readStorageArray(keys.receipts).slice(0, POOLDAY_RECEIPT_LEDGER_LIMIT);
};

const persistReceiptLedgerRows = (roomId = getPeerRoomId()) => {
  const keys = getPooldayRecordStorageKeys(roomId);
  writeStorageArray(keys.receipts, POOLDAY_RECEIPT_LEDGER.slice(0, POOLDAY_RECEIPT_LEDGER_LIMIT));
};

const loadPeerLedgerEvents = (roomId = getPeerRoomId()) => {
  const keys = getPooldayRecordStorageKeys(roomId);
  const scopedEvents = readStorageArray(keys.peerLedger);
  if (scopedEvents.length > 0 || roomId !== DEFAULT_PEER_ROOM_ID) return scopedEvents;
  const legacyEvents = readStorageArray(POOLDAY_PEER_LEDGER_STORAGE_KEY);
  if (legacyEvents.length > 0) writeStorageArray(keys.peerLedger, legacyEvents.slice(-100));
  return legacyEvents;
};

const persistPeerLedgerEvents = (roomId = getPeerRoomId()) => {
  const keys = getPooldayRecordStorageKeys(roomId);
  writeStorageArray(keys.peerLedger, POOLDAY_PEER_EVENTS.slice(-100));
};

const ensureReceiptLedgerLoaded = (roomId = getPeerRoomId()) => {
  if (POOLDAY_RECEIPT_LEDGER_ROOM === roomId) return;
  POOLDAY_RECEIPT_LEDGER_ROOM = roomId;
  replaceArrayContents(POOLDAY_RECEIPT_LEDGER, loadReceiptLedgerRows(roomId));
};

const ensurePeerLedgerLoaded = (roomId = getPeerRoomId()) => {
  if (POOLDAY_PEER_EVENTS_ROOM === roomId) return;
  POOLDAY_PEER_EVENTS_ROOM = roomId;
  replaceArrayContents(POOLDAY_PEER_EVENTS, loadPeerLedgerEvents(roomId));
  reloadPeerEventHashes();
};

const ensureRecordLedgersLoaded = (roomId = getPeerRoomId()) => {
  ensureReceiptLedgerLoaded(roomId);
  ensurePeerLedgerLoaded(roomId);
};

const POOLDAY_PROVIDER_HEALTH = {
  webgpu: 'unknown',
  model: 'not_loaded',
  artifact: 'not_checked',
  storage: 'unknown',
  queue: 'idle',
  lastReceipt: 'none',
  trust: 'receipt-backed',
  reputation: 'not_loaded'
};

export const getPeerRoomId = () => {
  const params = new URLSearchParams(window.location.search || '');
  return params.get('room') || window.REPLOID_POOL_ROOM_ID || DEFAULT_PEER_ROOM_ID;
};

export const getPeerRelayMode = () => {
  const params = new URLSearchParams(window.location.search || '');
  const configured = params.get('relay') || window.REPLOID_POOL_RELAY || 'server';
  return configured === 'local' ? 'local' : 'server';
};

export const getPeerRelayLabel = () => (
  getPeerRelayMode() === 'local' ? 'local tab' : 'server relay'
);

export const getPeerRoomBusFactory = () => createPeerRoomBusFactory({
  sdk: getPeerRelayMode() === 'local' ? null : createPoolSdk({ authTokenProvider: null }),
  relay: getPeerRelayMode()
});

export const getPeerDiscoveryWindowMs = () => {
  const explicit = Number(window.REPLOID_POOL_DISCOVERY_WINDOW_MS || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (getPeerRelayMode() === 'server') return 8000;
  return 1200;
};

export const getPeerReceiptWindowMs = () => {
  const explicit = Number(window.REPLOID_POOL_RECEIPT_WINDOW_MS || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return 60000;
};

export const getPeerGenerationConfig = () => {
  const override = window.REPLOID_POOL_GENERATION_CONFIG && typeof window.REPLOID_POOL_GENERATION_CONFIG === 'object'
    ? window.REPLOID_POOL_GENERATION_CONFIG
    : {};
  const maxOutputTokens = Number(
    window.REPLOID_POOL_MAX_OUTPUT_TOKENS
    || override.maxOutputTokens
    || DETERMINISTIC_GENERATION_CONFIG.maxOutputTokens
  );
  return {
    ...DETERMINISTIC_GENERATION_CONFIG,
    ...override,
    maxOutputTokens: Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
      ? Math.floor(maxOutputTokens)
      : DETERMINISTIC_GENERATION_CONFIG.maxOutputTokens
  };
};

export const getPeerInviteUrl = () => createPeerRoomInviteUrl({
  roomId: getPeerRoomId(),
  relay: getPeerRelayMode(),
  baseUrl: window.location.href
});

const getProviderStatusEl = (mount) => mount?.querySelector('[data-pool-provider-status]');

export const updateProviderStatus = (mount, status = 'CONTRIBUTOR // OFFLINE') => {
  const statusEl = getProviderStatusEl(mount);
  if (!statusEl) return;
  statusEl.textContent = status;
  statusEl.dataset.providerState = status.includes('ONLINE') || status.includes('RUNNING')
    ? 'online'
    : status.includes('STARTING') || status.includes('OPENING')
      ? 'starting'
      : 'offline';
};

const streamOutputText = (elementId, text) => {
  const outputEl = document.getElementById(elementId);
  if (!outputEl) return;
  const value = String(text || '');
  const previous = POOLDAY_STREAM_STATE.get(elementId);
  if (previous?.timer) window.clearTimeout(previous.timer);
  outputEl.textContent = '';
  if (!value.length) {
    const cursorEl = document.getElementById(`${elementId}-cursor`);
    if (cursorEl) cursorEl.classList.remove('is-visible', 'is-active');
    POOLDAY_STREAM_STATE.delete(elementId);
    return;
  }
  POOLDAY_STREAM_STATE.set(elementId, {
    text: value,
    timer: null,
    index: 0
  });
  const cursorEl = document.getElementById(`${elementId}-cursor`);
  const tick = () => {
    const state = POOLDAY_STREAM_STATE.get(elementId);
    if (!state) return;
    state.index += POOLDAY_STREAM_CHUNK_SIZE;
    outputEl.textContent = value.slice(0, state.index);
    if (state.index < value.length) {
      state.timer = window.setTimeout(tick, POOLDAY_STREAM_TICK_MS);
    } else {
      POOLDAY_STREAM_STATE.delete(elementId);
      if (cursorEl) cursorEl.classList.remove('is-active');
    }
  };
  if (cursorEl) cursorEl.classList.add('is-visible', 'is-active');
  tick();
};

const normalizeReceiptFidelity = (value) => {
  if (typeof value === 'number' && !Number.isFinite(value)) return '—';
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object') {
    if (value.accepted === true) return 'accepted';
    if (value.accepted === false) return 'rejected';
    if (value.status) return String(value.status);
  }
  return 'pending';
};

const normalizeReceiptSpeed = (value) => {
  const candidate = firstPresent(
    value?.tokensPerSecond,
    value?.throughput,
    value?.runtime?.tokensPerSecond,
    value?.stats?.throughput,
    value?.performance?.tokensPerSecond
  );
  if (candidate === undefined || candidate === null || candidate === '') return '—';
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? `${parsed.toFixed(2)} t/s` : String(candidate);
};

export const addReceiptLedgerRow = (record = {}, receiptHash = '') => {
  ensureReceiptLedgerLoaded();
  const jobId = firstPresent(
    record?.job?.jobId,
    record?.jobId,
    record?.receipt?.jobId,
    receiptHash
  );
  const provider = firstPresent(
    record?.providerId,
    record?.providerIdHash,
    record?.assignment?.providerId,
    record?.receipt?.providerId,
    record?.receipt?.provider?.id,
    record?.provider?.id,
    typeof record?.provider === 'string' ? record.provider : null
  );
  const fidelity = normalizeReceiptFidelity(record?.verifierDecision || record?.verification || record?.requesterAcceptance || record?.peerDecision || record?.agreement);
  const speed = normalizeReceiptSpeed(record);
  const rowReceiptHash = String(receiptHash || record?.receiptHash || record?.receipt?.receiptHash || '—');
  const existingIndex = POOLDAY_RECEIPT_LEDGER.findIndex((row) => row.receiptHash === rowReceiptHash);
  if (existingIndex >= 0) POOLDAY_RECEIPT_LEDGER.splice(existingIndex, 1);
  POOLDAY_RECEIPT_LEDGER.unshift({
    jobId: String(jobId || '—'),
    provider: String(provider || '—'),
    fidelity,
    speed,
    receiptHash: rowReceiptHash,
    record
  });
  while (POOLDAY_RECEIPT_LEDGER.length > POOLDAY_RECEIPT_LEDGER_LIMIT) {
    POOLDAY_RECEIPT_LEDGER.pop();
  }
  persistReceiptLedgerRows();
};

export const findReceiptLedgerRecord = (receiptHash = '') => {
  ensureReceiptLedgerLoaded();
  const normalized = String(receiptHash || '').trim();
  if (!normalized) return null;
  return POOLDAY_RECEIPT_LEDGER.find((row) => row.receiptHash === normalized)?.record || null;
};

export const renderReceiptLedger = (rows = POOLDAY_RECEIPT_LEDGER) => {
  if (rows === POOLDAY_RECEIPT_LEDGER) ensureReceiptLedgerLoaded();
  if (!rows.length) {
    return '<p class="type-caption pool-receipt-empty">No rounds logged yet.</p>';
  }
  return `
    <div class="pool-ledger" role="table" aria-label="Execution receipt scoreboard">
      <table>
        <thead>
          <tr>
            <th>Job ID</th>
            <th>Runner</th>
            <th>Fidelity</th>
            <th>Speed (t/s)</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td title="${escapeHtml(row.jobId)}">${escapeHtml(compactHex(row.jobId))}</td>
              <td title="${escapeHtml(row.provider)}">${escapeHtml(row.provider)}</td>
              <td>${escapeHtml(row.fidelity)}</td>
              <td>${escapeHtml(row.speed)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
};

export const refreshReceiptLedgerState = () => {
  const ledger = document.getElementById('pool-receipt-ledger');
  if (ledger) ledger.innerHTML = renderReceiptLedger();
};

const recordPeerLedgerEvents = (events = []) => {
  if (!Array.isArray(events) || events.length === 0) return;
  ensurePeerLedgerLoaded();
  let changed = false;
  for (const event of events) {
    const eventHash = getPeerEventHash(event);
    if (POOLDAY_PEER_EVENT_HASHES.has(eventHash)) continue;
    POOLDAY_PEER_EVENT_HASHES.add(eventHash);
    POOLDAY_PEER_EVENTS.push(event);
    changed = true;
  }
  if (changed) persistPeerLedgerEvents();
};

export const renderPeerLedgerState = () => {
  ensurePeerLedgerLoaded();
  const reduced = createPeerEventReducer().reduce(POOLDAY_PEER_EVENTS);
  const pointRows = Object.entries(reduced.points || {}).sort(([left], [right]) => left.localeCompare(right));
  const reputationRows = Object.values(reduced.reputation || {}).sort((left, right) => String(left.providerId).localeCompare(String(right.providerId)));
  if (pointRows.length === 0 && reputationRows.length === 0) {
    return '<p class="type-caption pool-receipt-empty">No local peer ledger events yet.</p>';
  }
  return `
    <div class="pool-ledger" role="table" aria-label="Local peer ledger">
      <table>
        <thead>
          <tr>
            <th>Peer</th>
            <th>Evidence</th>
            <th>Accepted</th>
            <th>Rejected</th>
          </tr>
        </thead>
        <tbody>
          ${pointRows.map(([peerId, points]) => {
            const reputation = reduced.reputation?.[peerId] || {};
            return `
              <tr>
                <td title="${escapeHtml(peerId)}">${escapeHtml(compactHash(peerId))}</td>
                <td>${escapeHtml(points)}</td>
                <td>${escapeHtml(reputation.acceptedReceipts ?? 0)}</td>
                <td>${escapeHtml(reputation.rejectedReceipts ?? 0)}</td>
              </tr>
            `;
          }).join('')}
          ${reputationRows.filter((row) => !Object.prototype.hasOwnProperty.call(reduced.points || {}, row.providerId)).map((row) => `
            <tr>
              <td title="${escapeHtml(row.providerId)}">${escapeHtml(compactHash(row.providerId))}</td>
              <td>${escapeHtml(row.points ?? 0)}</td>
              <td>${escapeHtml(row.acceptedReceipts ?? 0)}</td>
              <td>${escapeHtml(row.rejectedReceipts ?? 0)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
};

export const refreshPeerLedgerState = () => {
  const ledger = document.getElementById('pool-peer-ledger');
  if (ledger) ledger.innerHTML = renderPeerLedgerState();
};

export const renderRoomActivity = (summary = null) => {
  if (getPeerRelayMode() === 'local') {
    return '<p class="type-caption pool-receipt-empty">Local relay only. Add <code>?relay=server</code> to use shared room discovery.</p>';
  }
  if (!summary) {
    return '<p class="type-caption pool-receipt-empty">Loading room activity...</p>';
  }
  if (summary.error) {
    return `<p class="type-caption pool-receipt-empty">Room activity unavailable: ${escapeHtml(summary.error)}</p>`;
  }
  const recent = Array.isArray(summary.recent) ? summary.recent : [];
  return `
    <div class="pool-ledger" role="table" aria-label="Server relay room activity">
      <table>
        <thead>
          <tr>
            <th>Relay</th>
            <th>Messages</th>
            <th>Peers</th>
            <th>Providers</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>${escapeHtml(summary.relay || getPeerRelayMode())}</td>
            <td>${escapeHtml(summary.messageCount ?? 0)}</td>
            <td>${escapeHtml(summary.peerCount ?? 0)}</td>
            <td>${escapeHtml(summary.providerCount ?? 0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="type-caption pool-room-recent">
      ${recent.length
        ? escapeHtml(recent.map((entry) => `${entry.type}:${compactHash(entry.fromPeerId || 'unknown')}`).join(' / '))
        : 'No relay messages in this room yet.'}
    </p>
  `;
};

export const refreshRoomActivityState = (summary = null) => {
  const activity = document.getElementById('pool-room-activity');
  if (activity) activity.innerHTML = renderRoomActivity(summary);
};

export const refreshRecordLedgerState = (options = {}) => {
  const roomId = getPeerRoomId();
  if (options.reload === true) {
    POOLDAY_RECEIPT_LEDGER_ROOM = null;
    POOLDAY_PEER_EVENTS_ROOM = null;
  }
  ensureRecordLedgersLoaded(roomId);
  refreshReceiptLedgerState();
  refreshPeerLedgerState();
};

let recordStorageSyncBound = false;

export const bindRecordStorageSync = () => {
  if (recordStorageSyncBound || typeof window === 'undefined') return;
  recordStorageSyncBound = true;
  window.addEventListener('storage', (event) => {
    const keys = getPooldayRecordStorageKeys();
    if (
      event.key !== keys.receipts &&
      event.key !== keys.peerLedger &&
      event.key !== POOLDAY_PEER_LEDGER_STORAGE_KEY
    ) {
      return;
    }
    refreshRecordLedgerState({ reload: true });
  });
};

const renderProviderHealth = (state = POOLDAY_PROVIDER_HEALTH) => {
  const rows = [
    ['WebGPU', state.webgpu],
    ['Model', state.model],
    ['Artifact', state.artifact],
    ['Local cache', state.storage],
    ['Peer room', state.queue],
    ['Last Receipt', state.lastReceipt],
    ['Trust', state.trust],
    ['History', state.reputation]
  ];
  return `
    <div class="boot-status-strip pool-summary" aria-label="Node health">
      ${rows.map(([label, value]) => `
        <span class="pool-summary-item">
          <span class="rgr-status-label">${escapeHtml(label)}</span>
          <span class="rgr-status-value">${escapeHtml(compactHash(value))}</span>
        </span>
      `).join('')}
    </div>
  `;
};

export const updateProviderHealth = (partial = {}) => {
  Object.assign(POOLDAY_PROVIDER_HEALTH, partial);
  const health = document.getElementById('pool-provider-health');
  if (health) health.innerHTML = renderProviderHealth();
};

export const refreshProviderStorageHealth = async () => {
  if (!navigator.storage?.estimate) {
    updateProviderHealth({ storage: navigator.storage ? 'available' : 'unknown' });
    return;
  }
  try {
    const estimate = await navigator.storage.estimate();
    const usedMb = Math.round(Number(estimate.usage || 0) / (1024 * 1024));
    const quotaMb = Math.round(Number(estimate.quota || 0) / (1024 * 1024));
    updateProviderHealth({ storage: quotaMb > 0 ? `${usedMb}/${quotaMb} MB` : 'available' });
  } catch {
    updateProviderHealth({ storage: 'unavailable' });
  }
};

const extractOutputText = (value = {}) => {
  const receipt = value.receipt || value.record || null;
  const candidates = [
    value.outputText,
    value.output,
    value.responseText,
    value.text,
    value.content,
    value.completion,
    value?.job?.outputText,
    value?.job?.output,
    receipt?.outputText,
    receipt?.output,
    receipt?.transcript?.outputText
  ];
  return String(candidates.find((entry) => typeof entry === 'string' && entry.length > 0) || '');
};

const formatLedgerValue = (value, fallback = '—') => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number' && !Number.isFinite(value)) return fallback;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
};

const renderReceiptSummaryCell = (value, fallback = '—') => `<td>${escapeHtml(formatLedgerValue(value, fallback))}</td>`;

const compactHex = (value) => {
  const normalized = formatLedgerValue(value, '—');
  return normalized === '—' ? '—' : compactHash(normalized);
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const normalizeProductPath = (path = window.location.pathname) => {
  if (!path || path === '/') return '/';
  return path.replace(/\/+$/, '');
};
export const getRouteId = () => PRODUCT_ROUTES[normalizeProductPath()] || 'home';
export const isProductPath = (path) => Object.prototype.hasOwnProperty.call(PRODUCT_ROUTES, normalizeProductPath(path));

const firstPresent = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

const compactHash = (value) => {
  const normalized = String(value ?? '');
  if (normalized.length <= 24) return normalized;
  return `${normalized.slice(0, 16)}...${normalized.slice(-8)}`;
};

const isErrorResult = (value = {}) => !!(value && typeof value === 'object' && (value.error || value.status === 'error'));

const extractResultSummary = (value = {}) => {
  if (isErrorResult(value)) {
    const payload = value.payload || {};
    const model = value.model || payload.model || payload.requiredModel || null;
    const artifact = payload.artifactPreflight || value.artifactPreflight || null;
    const fields = [
      ['Error', value.error],
      ['Reason', value.reason],
      ['Code', value.code],
      ['Room', value.roomId || payload.roomId],
      ['Relay', value.relay],
      ['Model', model?.modelId || model?.id],
      ['Artifact', artifact?.status],
      ['Manifest', artifact?.urls?.manifest || payload.urls?.manifest],
      ['Retryable', value.retryable === true ? 'yes' : value.retryable === false ? 'no' : null],
      ['Action', value.action || payload.action]
    ].filter(([, fieldValue]) => fieldValue !== undefined && fieldValue !== null && fieldValue !== '');
    return fields.slice(0, 10);
  }
  const job = value.job || value;
  const record = value.receipt || value.record || value;
  const receipt = record.receipt || value.receipt?.receipt || value.receipt || {};
  const verifier = record.verifierDecision || value.verifierDecision || value.localVerification || null;
  const acceptance = record.requesterAcceptance || value.requesterAcceptance || value.acceptance || null;
  const agreement = job.agreement || acceptance?.agreement || value.agreement || null;
  const ring = receipt?.verification?.ring || job.ring || agreement?.ring || null;
  const fields = [
    ['Job', firstPresent(job.jobId, record.jobId, receipt.jobId)],
    ['Receipt', firstPresent(job.receiptHash, record.receiptHash, verifier?.receiptHash, acceptance?.receiptHash)],
    ['Status', firstPresent(job.status, agreement?.status, verifier?.accepted === true ? 'accepted' : verifier?.accepted === false ? 'rejected' : null)],
    ['Trust', firstPresent(job.trustTier, job.effectiveTrustTier, agreement?.effectiveTrustTier, ring?.effectiveTrustTier, receipt?.trustTier)],
    ['Agreement', agreement ? `${agreement.status || 'pending'} ${Number(agreement.requiredAgreement || agreement.requiredProviders || 1)}-of-${Number(agreement.providerCount || agreement.providerIds?.length || 1)}` : null],
    ['Transport', firstPresent(job.transport, value.transport, receipt?.promptTransport)],
    ['Model', firstPresent(job.model?.id, job.modelRequirements?.modelId, receipt?.model?.id, value.model?.modelId)],
    ['Spend', firstPresent(acceptance?.pointSpend, value.pointSpend)],
    ['Runtime', firstPresent(receipt?.verification?.runtimeProfileHash, job.runtimeProfileHash, record.runtimeProfileHash)],
    ['Output', firstPresent(receipt?.outputHash, record.outputHash, job.outputHash)],
    ['Tokens', firstPresent(receipt?.tokenIdsHash, record.tokenIdsHash, job.tokenIdsHash)],
    ['Verifier', verifier ? (verifier.ok === true || verifier.accepted === true ? 'accepted' : verifier.reasons?.length ? verifier.reasons.join('; ') : 'rejected') : null]
  ].filter(([, fieldValue]) => fieldValue !== undefined && fieldValue !== null && fieldValue !== '');
  return fields.slice(0, 10);
};

const renderSummaryRows = (summary) => summary.map(([label, value]) => `
  <span class="pool-summary-item">
    <span class="rgr-status-label">${escapeHtml(label)}</span>
    <span class="rgr-status-value">${escapeHtml(compactHash(value))}</span>
  </span>
`).join('');

const renderRawDetails = (id, label = 'Advanced details') => `
  <details class="pool-raw-details">
    <summary>${escapeHtml(label)}</summary>
    <pre class="pool-result pool-result-raw" id="${id}-raw" aria-live="polite"></pre>
  </details>
`;

const renderResultBox = (id, options = {}) => {
  if (options?.stream) {
    return `
      <div class="boot-status-strip pool-summary" id="${id}-summary" aria-live="polite"></div>
      <div class="pool-stream-box">
        <label class="pool-result-label" for="${id}-stream">${escapeHtml(options.streamLabel || 'Output stream')}</label>
        <div class="pool-stream-shell">
          <pre class="pool-stream-output" id="${id}-stream" aria-live="polite"></pre>
          <span class="pool-stream-cursor" id="${id}-stream-cursor" aria-hidden="true">▍</span>
        </div>
      </div>
      ${renderRawDetails(id)}
    `;
  }
  const placeholder = options.placeholder || 'No local activity yet.';
  return `
  <div class="boot-status-strip pool-summary" id="${id}-summary" aria-live="polite"></div>
  <p class="pool-result-message" id="${id}" aria-live="polite">${escapeHtml(placeholder)}</p>
  ${renderRawDetails(id)}
  `;
};

const formatResultMessage = (value = {}) => {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'string') return value;
  if (isErrorResult(value)) {
    return [
      value.error || 'Request failed',
      value.reason,
      value.action || value.payload?.action
    ].filter(Boolean).join('\n');
  }
  const output = extractOutputText(value);
  if (output) return output;
  const status = firstPresent(value.status, value.runner, value.transport, value.receiptHash);
  if (status) return String(status).replace(/_/g, ' ');
  const summary = extractResultSummary(value);
  if (summary.length > 0) {
    return summary.slice(0, 4).map(([label, fieldValue]) => `${label}: ${fieldValue}`).join('\n');
  }
  return 'Local peer state updated.';
};

const safeJsonStringify = (value) => {
  const seen = new WeakSet();
  try {
    return JSON.stringify(value, (_key, entry) => {
      if (typeof entry === 'function') return `[Function ${entry.name || 'anonymous'}]`;
      if (entry instanceof Error) {
        return {
          name: entry.name,
          message: entry.message,
          code: entry.code || null,
          payload: entry.payload || null
        };
      }
      if (entry && typeof entry === 'object') {
        if (seen.has(entry)) return '[Circular]';
        seen.add(entry);
      }
      return entry;
    }, 2);
  } catch (error) {
    return JSON.stringify({
      status: 'serialization_error',
      reason: error.message
    }, null, 2);
  }
};

const formatErrorResultText = (value = {}) => {
  const payload = value.payload || {};
  const model = value.model || payload.model || payload.requiredModel || null;
  const artifact = payload.artifactPreflight || value.artifactPreflight || null;
  const lines = [
    value.error ? `Error: ${value.error}` : null,
    value.reason ? `Reason: ${value.reason}` : null,
    value.action || payload.action ? `Next: ${value.action || payload.action}` : null,
    value.roomId || payload.roomId ? `Room: ${value.roomId || payload.roomId}` : null,
    value.relay ? `Relay: ${value.relay}` : null,
    model?.modelId || model?.id ? `Model: ${model.modelId || model.id}` : null,
    artifact?.status ? `Artifact: ${artifact.status}` : null,
    artifact?.urls?.manifest || payload.urls?.manifest ? `Manifest: ${artifact?.urls?.manifest || payload.urls?.manifest}` : null
  ].filter(Boolean);
  const detail = safeJsonStringify(value);
  return `${lines.join('\n')}${lines.length ? '\n\n' : ''}${detail}`;
};

export const setResult = (id, value, options = {}) => {
  if (value && typeof value === 'object') {
    recordPeerLedgerEvents(value.ledgerEvents || value.body?.ledgerEvents || []);
    refreshPeerLedgerState();
  }
  const summaryEl = document.getElementById(`${id}-summary`);
  const streamMode = !!options.stream;
  const outputText = streamMode ? extractOutputText(value) : null;
  const summary = value && typeof value === 'object' ? extractResultSummary(value) : [];
  const raw = value === undefined || value === null
    ? ''
    : typeof value === 'string'
      ? value
      : isErrorResult(value)
        ? formatErrorResultText(value)
      : safeJsonStringify(value) || String(value);
  const streamEl = streamMode ? document.getElementById(`${id}-stream`) : document.getElementById(id);
  const streamCursor = streamMode ? document.getElementById(`${id}-stream-cursor`) : null;
  const rawEl = document.getElementById(`${id}-raw`);
  if (summaryEl) {
    summaryEl.innerHTML = summary.length > 0 ? renderSummaryRows(summary) : '';
  }
  if (rawEl) rawEl.textContent = raw;
  if (streamMode && streamEl) {
    if (outputText && outputText.length > 0) {
      if (streamCursor) streamCursor.classList.add('is-visible', 'is-active');
      streamOutputText(`${id}-stream`, outputText);
    } else {
      const previous = POOLDAY_STREAM_STATE.get(`${id}-stream`);
      if (previous?.timer) window.clearTimeout(previous.timer);
      POOLDAY_STREAM_STATE.delete(`${id}-stream`);
      streamEl.textContent = formatResultMessage(value);
      if (streamCursor) streamCursor.classList.remove('is-visible', 'is-active');
    }
    return;
  }
  if (streamMode) return;
  const outputEl = document.getElementById(id);
  if (outputEl) {
    outputEl.textContent = formatResultMessage(value);
  }
};

export const renderNav = (activeRoute) => {
  const renderItem = ({ id, path, label }) => {
    const isActive = activeRoute === id;
    const currentAttr = isActive ? ' aria-current="page"' : '';
    return `<a class="pool-nav-link${isActive ? ' is-active' : ''}" href="${path}" data-pool-route-link="${path}"${currentAttr}>${escapeHtml(label)}</a>`;
  };
  return `
    <aside class="pool-nav-rail" aria-label="Reploid navigation">
      <nav class="pool-nav" aria-label="Reploid routes">
        ${POOLDAY_NAV_ROUTES.map(renderItem).join('')}
      </nav>
      <div class="pool-nav-substrate" aria-label="Substrate routes">
        <a class="pool-nav-link pool-nav-substrate-link pool-zero-link link-secondary" href="/zero" data-pool-substrate-route="/zero" title="Open Zero Runtime.">Zero</a>
        <a class="pool-nav-link pool-nav-substrate-link pool-zero-link link-secondary" href="/x" data-pool-substrate-route="/x" title="Open X Runtime.">X</a>
      </div>
    </aside>
  `;
};

const renderPolicyStrip = () => `
  <div class="boot-status-strip pool-policy-strip" aria-label="Launch policy">
    <span class="rgr-status-metric"><span class="rgr-status-label">Model</span><span class="rgr-status-value">${escapeHtml(LAUNCH_MODEL.modelId)}</span></span>
    <span class="rgr-status-metric"><span class="rgr-status-label">Trust</span><span class="rgr-status-value">receipt-backed</span></span>
  </div>
`;

const renderRoomStrip = () => `
  <div class="pool-room-strip" aria-label="Peer room">
    <span class="pool-room-item">
      <span class="rgr-status-label">Room</span>
      <code data-pool-room-id>${escapeHtml(getPeerRoomId())}</code>
    </span>
    <span class="pool-room-item">
      <span class="rgr-status-label">Relay</span>
      <code data-pool-relay-mode>${escapeHtml(getPeerRelayLabel())}</code>
    </span>
    <span class="pool-room-item">
      <span class="rgr-status-label">Work</span>
      <code>whole job</code>
    </span>
    <span class="pool-room-item">
      <span class="rgr-status-label">Protocol</span>
      <code>${escapeHtml(POOLDAY_VERSION_TAG)}</code>
    </span>
    <a class="link-secondary pool-room-link" href="${escapeHtml(getPeerInviteUrl())}" data-pool-invite-link>Invite</a>
  </div>
`;

const renderRouteShell = (copy, content) => `
  <section class="panel pool-panel pool-route-shell">
    <div class="pool-page-heading">
      <h1 class="type-h1">${escapeHtml(copy.title)}</h1>
      <p class="type-caption pool-hero-body">${escapeHtml(copy.body)}</p>
    </div>
    ${renderRoomStrip()}
    ${content}
  </section>
`;

const renderPolicyTrustLabel = (policy) => (
  policy.adaptiveRing ? 'adaptive quorum' : policy.trustTier
);

const renderPolicyProductLabel = (policy) => {
  const labels = {
    fastest_receipt: 'Fastest receipt',
    canary_audited: 'Canary audited',
    redundant_agreement: 'Redundant agreement',
    ring_quorum_receipt: 'Ring quorum'
  };
  return labels[policy.policyId] || policy.policyId.replace(/_/g, ' ');
};

export const describeSelectedRun = ({ policyId, modelId, status = 'finding_peer_provider' } = {}) => {
  const policy = getPolicy(policyId || FASTEST_RECEIPT_POLICY_ID);
  const model = getEnabledPoolModelContract(modelId || LAUNCH_MODEL.modelId) || LAUNCH_MODEL;
  return {
    status,
    transport: `webrtc_peer_room_${getPeerRelayMode()}`,
    roomId: getPeerRoomId(),
    relay: getPeerRelayMode(),
    workMode: 'whole_job_redundant_receipts',
    policyId: policy?.policyId || policyId || FASTEST_RECEIPT_POLICY_ID,
    trustTier: policy?.adaptiveRing ? 'adaptive quorum receipt' : (policy?.trustTier || 'signed receipt'),
    requiredAgreement: policy?.adaptiveRing
      ? `${policy.minRingSize || 1}-${policy.maxRingSize || 1} runners, quorum by matching receipt`
      : `${policy?.redundancy || 1} runner receipt${Number(policy?.redundancy || 1) === 1 ? '' : 's'}`,
    model: {
      modelId: model.modelId,
      modelHash: model.modelHash,
      manifestHash: model.manifestHash,
      runtime: model.runtime,
      backend: model.backend
    }
  };
};

const renderPolicyOptions = () => listPolicies().map((policy) => `
  <option value="${escapeHtml(policy.policyId)}">${escapeHtml(renderPolicyProductLabel(policy))} - ${escapeHtml(renderPolicyTrustLabel(policy))}</option>
`).join('');

const renderModelOptions = () => listPoolModels().map((model) => {
  const enabled = model.enabled !== false && model.modelHash && model.manifestHash;
  const label = model.label || model.modelId;
  const suffix = enabled ? '' : ` - ${model.unavailableReason || 'not enabled'}`;
  return `<option value="${escapeHtml(model.modelId)}"${enabled ? '' : ' disabled'}>${escapeHtml(`${label}${suffix}`)}</option>`;
}).join('');

const renderFlowLabels = () => POOLDAY_FLOW_LABELS.map((item) => `
  <span
    class="pool-flow-label pool-flow-label-${escapeHtml(item.id)}"
    data-pool-flow-label="${escapeHtml(item.id)}"
    data-tooltip-title="${escapeHtml(item.label)}"
    data-tooltip-body="${escapeHtml(item.body)}"
    style="--x: ${escapeHtml(item.x)}; --y: ${escapeHtml(item.y)};"
    tabindex="0"
    aria-label="${escapeHtml(`${item.label}: ${item.body}`)}"
  >
    <b>${escapeHtml(item.label)}</b>
  </span>
`).join('');

const renderHomeSimulation = () => `
  <section class="pool-simulation-shell" aria-label="Reploid network graph">
    <canvas class="pool-simulation-canvas" data-pool-simulation width="1200" height="680"></canvas>
    <div class="pool-home-overlay" aria-label="Reploid overview">
      <p class="pool-eyebrow">${escapeHtml(POOLDAY_PROTOCOL)}</p>
      <h1 class="type-h1">Ask a model. Get a signed receipt.</h1>
      <p class="pool-hero-body">Reploid routes deterministic browser inference through contributor tabs, compares receipt evidence, and keeps model identity visible.</p>
      <div class="pool-home-actions" aria-label="Primary actions">
        <a class="btn btn-primary pool-home-action" href="/ask" data-pool-route-link="/ask">Ask</a>
        <a class="btn btn-ghost pool-home-action" href="/contribute" data-pool-route-link="/contribute">Contribute</a>
        <a class="btn btn-ghost pool-home-action" href="/receipts" data-pool-route-link="/receipts">Receipts</a>
      </div>
      <div class="pool-home-proof-strip" aria-label="Pool evidence summary">
        <span><b>Model</b>${escapeHtml(LAUNCH_MODEL.label || LAUNCH_MODEL.modelId)}</span>
        <span><b>Trust</b>receipt-backed</span>
        <span><b>Work</b>whole job quorum</span>
      </div>
    </div>
    <div class="pool-simulation-labels">
      ${renderFlowLabels()}
    </div>
    <div class="pool-simulation-tooltip" data-pool-tooltip data-placement="above" role="tooltip" aria-hidden="true">
      <b data-pool-tooltip-title></b>
      <span data-pool-tooltip-body></span>
    </div>
  </section>
`;

export const renderRoutePanel = (routeId) => {
  if (routeId === 'home') return renderHomeSimulation();
  return '';
};

export const renderRouteDetail = (routeId) => {
  const copy = ROUTE_COPY[routeId] || ROUTE_COPY.home;
  if (routeId === 'ask') {
    return renderRouteShell(copy, `
        <div class="pool-form pool-route-grid pool-run-layout" data-pool-run>
          <div class="pool-run-compose">
            <div class="pool-section-heading">
              <h2 class="type-h2">Prompt</h2>
              <span class="pool-meta-tag">DataChannel prompt</span>
            </div>
            <label class="pool-field">
              <span>Prompt</span>
              <textarea id="pool-run-prompt" rows="6">Summarize Reploid in one sentence.</textarea>
            </label>
            <details class="pool-advanced">
              <summary>Advanced</summary>
              <div class="pool-advanced-grid">
                <label class="pool-field">
                  <span>Policy</span>
                  <select id="pool-run-policy">${renderPolicyOptions()}</select>
                </label>
                <label class="pool-field">
                  <span>Model</span>
                  <select id="pool-run-model">${renderModelOptions()}</select>
                </label>
              </div>
            </details>
            <div class="pool-control-row pool-primary-actions" aria-label="Ask controls">
              <button class="btn btn-primary btn-op" data-op="▶" id="pool-run-submit" type="button">Ask</button>
            </div>
          </div>
          <div class="pool-run-output">
            <div class="pool-section-heading pool-result-heading">
              <h3 class="type-h2">Result</h3>
              <span class="pool-meta-tag">Verified when receipt appears</span>
            </div>
            ${renderResultBox('pool-run-result', { stream: true, streamLabel: 'Output' })}
          </div>
        </div>
    `);
  }
  if (routeId === 'contribute') {
    return renderRouteShell(copy, `
        <div class="pool-form pool-route-grid pool-provider-layout" data-pool-provider>
          <div class="pool-provider-main">
            <div class="pool-section-heading pool-provider-heading">
              <h2 class="type-h2">Provider</h2>
              <p class="pool-provider-status" data-pool-provider-status>CONTRIBUTOR // OFFLINE</p>
            </div>
            <label class="pool-field">
              <span>Model</span>
              <select id="pool-provider-model">${renderModelOptions()}</select>
            </label>
            <div class="pool-control-row pool-primary-actions" aria-label="Contributor controls">
              <button class="btn btn-primary btn-op" data-op="▶" id="pool-provider-worker-start" type="button">Start contributing</button>
              <button class="btn btn-ghost btn-op" data-op="■" id="pool-provider-worker-stop" type="button" disabled>Stop</button>
            </div>
          </div>
          <div class="pool-provider-live" aria-label="Contributor live state">
            <div class="pool-section-heading">
              <h3 class="type-h2">Live</h3>
              <span class="pool-meta-tag">Provider room</span>
            </div>
            <div id="pool-provider-health" class="pool-ledger-shell" aria-live="polite">${renderProviderHealth()}</div>
          </div>
          <div class="pool-inspector-shell">
            <div class="pool-section-heading pool-result-heading">
              <h3 class="type-h2">Activity</h3>
              <span class="pool-meta-tag">Inspector</span>
            </div>
            ${renderResultBox('pool-provider-result', { placeholder: 'No activity yet.' })}
          </div>
        </div>
    `);
  }
  if (routeId === 'receipts') {
    return renderRouteShell(copy, `
        <div class="pool-form pool-route-grid pool-record-layout" data-pool-receipts>
          <div class="pool-record-query">
            <div class="pool-section-heading">
              <h2 class="type-h2">Lookup</h2>
              <span class="pool-meta-tag">Receipt hash</span>
            </div>
            <label class="pool-field">
              <span>Hash</span>
              <input id="pool-receipt-hash" placeholder="sha256:..." />
            </label>
            <div class="pool-control-row pool-primary-actions">
              <button class="btn btn-primary btn-op" data-op="⚲" id="pool-receipt-lookup" type="button">Lookup</button>
            </div>
            ${renderResultBox('pool-receipt-result', { placeholder: 'No receipt lookup yet.' })}
          </div>
          <div class="pool-record-ledgers">
            <div class="pool-section-heading">
              <h3 class="type-h2">Receipts</h3>
              <span class="pool-meta-tag">This room</span>
            </div>
            <div id="pool-receipt-ledger" class="pool-ledger-shell" aria-live="polite">${renderReceiptLedger()}</div>
            <div class="pool-form" data-pool-room-activity>
              <div class="pool-section-heading">
                <h3 class="type-h2">Room Activity</h3>
                <span class="pool-meta-tag">Relay metadata</span>
              </div>
              <div id="pool-room-activity" class="pool-ledger-shell" aria-live="polite">${renderRoomActivity()}</div>
            </div>
          </div>
        </div>
    `);
  }
  if (routeId === 'reputation') {
    return renderRouteShell(copy, `
        <div class="pool-form pool-route-grid pool-record-layout" data-pool-reputation>
          <div class="pool-record-query">
            <div class="pool-section-heading">
              <h2 class="type-h2">Room Evidence</h2>
              <span class="pool-meta-tag">Relay metadata</span>
            </div>
            <div id="pool-room-activity" class="pool-ledger-shell" aria-live="polite">${renderRoomActivity()}</div>
          </div>
          <div class="pool-record-ledgers">
            <div class="pool-section-heading">
              <h3 class="type-h2">Peer Ledger</h3>
              <span class="pool-meta-tag">This browser</span>
            </div>
            <div id="pool-peer-ledger" class="pool-ledger-shell" aria-live="polite">${renderPeerLedgerState()}</div>
            <p class="pool-meta-tag" aria-label="protocol identifier">Protocol ${POOLDAY_VERSION_TAG}</p>
          </div>
        </div>
    `);
  }
  return '';
};
