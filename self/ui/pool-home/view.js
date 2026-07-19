/**
 * @fileoverview Rendering and UI state helpers for the Reploid product home.
 */

import {
  LAUNCH_MODEL,
  POOLDAY_MODEL_WORKLOADS,
  getEnabledPoolModelContract,
  getPoolModelWorkload,
  listPoolModels
} from '../../pool/model-contract.js';
import { DETERMINISTIC_GENERATION_CONFIG, FASTEST_RECEIPT_POLICY_ID, getPolicy, listPolicies } from '../../pool/policy-router.js';
import { DEFAULT_PEER_ROOM_ID } from '../../pool/peer-room.js';
import { createPeerEventReducer } from '../../pool/peer-control-plane.js';
import { createPoolSdk } from '../../pool/sdk.js';
import { readParticipationPreferences } from '../../pool/participation-profile.js';
import {
  createPeerRoomBusFactory,
  createPeerRoomInviteUrl
} from '../../pool/peer-rendezvous.js';
import {
  PRODUCT_ROUTES,
  POOLDAY_FLOW_LABELS,
  POOLDAY_GRAPH_LABEL_STAGES,
  POOLDAY_NAME,
  POOLDAY_NAV_ROUTES,
  POOLDAY_NETWORK_VISUAL_EVENT,
  POOLDAY_RUN_VISUAL_EVENT,
  POOLDAY_PARTICIPANT_NODE_IDS,
  POOLDAY_PEER_LEDGER_STORAGE_KEY,
  POOLDAY_PROTOCOL,
  POOLDAY_RECEIPT_LEDGER_STORAGE_KEY,
  POOLDAY_RECEIPT_LEDGER_LIMIT,
  POOLDAY_STREAM_CHUNK_SIZE,
  POOLDAY_STREAM_TICK_MS,
  POOLDAY_VERSION_TAG,
  ROUTE_COPY,
  choosePooldayAskPlaceholder
} from './constants.js';
import { getContributionSnapshot } from './contribution-state.js';
import { getPoolLedgerStore } from './ledger-store.js';

const ledgerStore = getPoolLedgerStore();

// Single sink for markup writes: every fragment below builds attribute and
// text values through escapeHtml before reaching this assignment.
const setPoolHtml = (element, markup) => {
  element.innerHTML = String(markup ?? '');
};

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
  ledgerStore.peerEventHashes.clear();
  for (const event of ledgerStore.peerEvents) {
    const eventHash = getPeerEventHash(event);
    if (eventHash) ledgerStore.peerEventHashes.add(eventHash);
  }
};

const loadReceiptLedgerRows = (roomId = getPeerRoomId()) => {
  const keys = getPooldayRecordStorageKeys(roomId);
  return readStorageArray(keys.receipts).slice(0, POOLDAY_RECEIPT_LEDGER_LIMIT);
};

const persistReceiptLedgerRows = (roomId = getPeerRoomId()) => {
  const keys = getPooldayRecordStorageKeys(roomId);
  writeStorageArray(keys.receipts, ledgerStore.receipts.slice(0, POOLDAY_RECEIPT_LEDGER_LIMIT));
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
  writeStorageArray(keys.peerLedger, ledgerStore.peerEvents.slice(-100));
};

const ensureReceiptLedgerLoaded = (roomId = getPeerRoomId()) => {
  if (ledgerStore.receiptRoom === roomId) return;
  ledgerStore.receiptRoom = roomId;
  replaceArrayContents(ledgerStore.receipts, loadReceiptLedgerRows(roomId));
};

const ensurePeerLedgerLoaded = (roomId = getPeerRoomId()) => {
  if (ledgerStore.peerRoom === roomId) return;
  ledgerStore.peerRoom = roomId;
  replaceArrayContents(ledgerStore.peerEvents, loadPeerLedgerEvents(roomId));
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
  trust: 'signed_record',
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

export const updateProviderStatus = (mount, status = 'Idle') => {
  const statusEl = getProviderStatusEl(mount);
  if (!statusEl) return;
  statusEl.textContent = status;
  const normalized = String(status || '').toLowerCase();
  statusEl.dataset.providerState = normalized.includes('available') || normalized.includes('ready') || normalized.includes('answering') || normalized.includes('online') || normalized.includes('running')
    ? 'online'
    : normalized.includes('starting') || normalized.includes('opening')
      ? 'starting'
      : 'offline';
};

const streamOutputText = (elementId, text) => {
  const outputEl = document.getElementById(elementId);
  if (!outputEl) return;
  const value = String(text || '');
  const previous = ledgerStore.streams.get(elementId);
  if (previous?.timer) window.clearTimeout(previous.timer);
  outputEl.textContent = '';
  if (!value.length) {
    const cursorEl = document.getElementById(`${elementId}-cursor`);
    if (cursorEl) cursorEl.classList.remove('is-visible', 'is-active');
    ledgerStore.streams.delete(elementId);
    return;
  }
  ledgerStore.streams.set(elementId, {
    text: value,
    timer: null,
    index: 0
  });
  const cursorEl = document.getElementById(`${elementId}-cursor`);
  const tick = () => {
    const state = ledgerStore.streams.get(elementId);
    if (!state) return;
    state.index += POOLDAY_STREAM_CHUNK_SIZE;
    outputEl.textContent = value.slice(0, state.index);
    if (state.index < value.length) {
      state.timer = window.setTimeout(tick, POOLDAY_STREAM_TICK_MS);
    } else {
      ledgerStore.streams.delete(elementId);
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

const receiptOccurredAt = (record = {}) => firstPresent(
  record?.receipt?.timing?.completedAt,
  record?.receipt?.timing?.endedAt,
  record?.receipt?.endTimestamp,
  record?.timing?.completedAt,
  record?.completedAt,
  record?.createdAt,
  new Date().toISOString()
);

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
  const existingIndex = ledgerStore.receipts.findIndex((row) => row.receiptHash === rowReceiptHash);
  if (existingIndex >= 0) ledgerStore.receipts.splice(existingIndex, 1);
  ledgerStore.receipts.unshift({
    jobId: String(jobId || '—'),
    provider: String(provider || '—'),
    fidelity,
    speed,
    receiptHash: rowReceiptHash,
    occurredAt: receiptOccurredAt(record),
    record
  });
  while (ledgerStore.receipts.length > POOLDAY_RECEIPT_LEDGER_LIMIT) {
    ledgerStore.receipts.pop();
  }
  persistReceiptLedgerRows();
};

export const findReceiptLedgerRecord = (receiptHash = '') => {
  ensureReceiptLedgerLoaded();
  const normalized = String(receiptHash || '').trim();
  if (!normalized) return null;
  return ledgerStore.receipts.find((row) => row.receiptHash === normalized)?.record || null;
};

export const renderReceiptLedger = (rows = ledgerStore.receipts) => {
  if (rows === ledgerStore.receipts) ensureReceiptLedgerLoaded();
  if (!rows.length) {
    return '<p class="type-caption pool-receipt-empty">No answers saved yet.</p>';
  }
  return `
    <div class="pool-ledger" role="table" aria-label="Saved answer receipts">
      <table>
        <thead>
          <tr>
            <th>Answer</th>
            <th>Contributor</th>
            <th>Status</th>
            <th>Speed</th>
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
  if (ledger) setPoolHtml(ledger, renderReceiptLedger());
};

const recordPeerLedgerEvents = (events = []) => {
  if (!Array.isArray(events) || events.length === 0) return;
  ensurePeerLedgerLoaded();
  let changed = false;
  for (const event of events) {
    const eventHash = getPeerEventHash(event);
    if (ledgerStore.peerEventHashes.has(eventHash)) continue;
    ledgerStore.peerEventHashes.add(eventHash);
    ledgerStore.peerEvents.push(event);
    changed = true;
  }
  if (changed) persistPeerLedgerEvents();
};

export const renderPeerLedgerState = () => {
  ensurePeerLedgerLoaded();
  const reduced = createPeerEventReducer().reduce(ledgerStore.peerEvents);
  const pointRows = Object.entries(reduced.points || {}).sort(([left], [right]) => left.localeCompare(right));
  const reputationRows = Object.values(reduced.reputation || {}).sort((left, right) => String(left.providerId).localeCompare(String(right.providerId)));
  if (pointRows.length === 0 && reputationRows.length === 0) {
    return '<p class="type-caption pool-receipt-empty">No local scores yet.</p>';
  }
  return `
    <div class="pool-ledger" role="group" aria-label="Local contributor scores">
      <table aria-label="Local contributor scores">
        <thead>
          <tr>
            <th>Tab</th>
            <th>Points</th>
            <th>Matched</th>
            <th>Flagged</th>
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
  if (ledger) setPoolHtml(ledger, renderPeerLedgerState());
};

export const renderRoomActivity = (summary = null) => {
  if (getPeerRelayMode() === 'local') {
    return '<p class="type-caption pool-receipt-empty">This room is local to this browser profile. Use a server relay link to share across devices.</p>';
  }
  if (!summary) {
    return '<p class="type-caption pool-receipt-empty">Checking room activity...</p>';
  }
  if (summary.error) {
    return `<p class="type-caption pool-receipt-empty">Room activity unavailable: ${escapeHtml(summary.error)}</p>`;
  }
  const recent = Array.isArray(summary.recent) ? summary.recent : [];
  return `
    <div class="pool-ledger" role="table" aria-label="Shared room activity">
      <table>
        <thead>
          <tr>
            <th>Room</th>
            <th>Messages</th>
            <th>Tabs</th>
            <th>Contributors</th>
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
        : 'No shared-room messages yet.'}
    </p>
  `;
};

const recordTimeMs = (value) => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatRecordTime = (value) => {
  const parsed = recordTimeMs(value);
  if (!parsed) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(parsed));
};

const receiptRecordKind = (row = {}) => {
  const record = row.record || {};
  return record.requesterAcceptance || record.agreement
    ? 'Answer completed'
    : 'Contribution made';
};

const unifiedRecordRows = () => {
  ensureRecordLedgersLoaded();
  const receiptRows = ledgerStore.receipts.map((row) => ({
    id: `receipt:${row.receiptHash}`,
    type: 'answer',
    occurredAt: row.occurredAt || receiptOccurredAt(row.record),
    title: receiptRecordKind(row),
    meta: [row.fidelity, row.provider !== '—' ? compactHash(row.provider) : null]
      .filter(Boolean)
      .join(' · '),
    detail: row.record
  }));
  const knownReceiptHashes = new Set(receiptRows.map((row) => row.detail?.receiptHash || row.detail?.receipt?.receiptHash).filter(Boolean));
  const contributionRows = (getContributionSnapshot().recent || [])
    .filter((row) => row.receiptHash && !knownReceiptHashes.has(row.receiptHash))
    .map((row) => ({
      id: `contribution:${row.receiptHash}`,
      type: 'contribution',
      occurredAt: row.completedAt,
      title: 'Contribution made',
      meta: [
        row.tokens > 0 ? `${formatContributionTokens(row.tokens)} tokens` : null,
        row.modelId ? formatContributionModel(row.modelId) : null
      ].filter(Boolean).join(' · '),
      detail: row
    }));
  const peerRows = ledgerStore.peerEvents.map((event) => {
    const body = event.body || {};
    const isScore = event.type === 'reputation_event' || event.type === 'points_event';
    return {
      id: `peer:${getPeerEventHash(event)}`,
      type: 'room',
      occurredAt: event.createdAt,
      title: isScore ? 'Contributor score updated' : 'Room activity',
      meta: [
        body.providerId || body.userId || event.fromPeerId,
        body.reason
      ].filter(Boolean).map(compactHash).join(' · '),
      detail: event
    };
  });
  const roomRows = ledgerStore.roomActivitySummary && !ledgerStore.roomActivitySummary.error
    && (Number(ledgerStore.roomActivitySummary.messageCount || 0) > 0 || ledgerStore.roomActivitySummary.recent?.length)
    ? [{
        id: `room:${getPeerRoomId()}`,
        type: 'room',
        occurredAt: ledgerStore.roomActivitySummary.recent?.[0]?.createdAt || new Date().toISOString(),
        title: 'Room activity',
        meta: `${Number(ledgerStore.roomActivitySummary.peerCount || 0)} tabs · ${Number(ledgerStore.roomActivitySummary.providerCount || 0)} contributors`,
        detail: ledgerStore.roomActivitySummary
      }]
    : [];
  const byId = new Map();
  for (const row of [...receiptRows, ...contributionRows, ...peerRows, ...roomRows]) {
    byId.set(row.id, row);
  }
  return [...byId.values()]
    .sort((left, right) => recordTimeMs(right.occurredAt) - recordTimeMs(left.occurredAt))
    .slice(0, 60);
};

const RECORD_FACETS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'answer', label: 'Answers' },
  { id: 'contribution', label: 'Contributions' },
  { id: 'room', label: 'Room' }
]);

const renderRecordFacetChips = (rows, facetId) => RECORD_FACETS.map((facet) => {
  const count = facet.id === 'all' ? rows.length : rows.filter((row) => row.type === facet.id).length;
  const active = facet.id === facetId ? ' is-active' : '';
  return `<button type="button" class="pool-lane-chip pool-record-facet-chip${active}"
    data-pool-record-facet="${escapeHtml(facet.id)}" aria-pressed="${facet.id === facetId ? 'true' : 'false'}">${escapeHtml(facet.label)} (${count})</button>`;
}).join('');

export const renderRecordLedger = (facetId = 'all') => {
  const rows = unifiedRecordRows();
  if (!rows.length) {
    return '<p class="pool-record-empty">No records yet. Completed runs and contributions will appear here.</p>';
  }
  const visible = facetId === 'all' ? rows : rows.filter((row) => row.type === facetId);
  const chips = `<div class="pool-record-facets" role="group" aria-label="Record types">${renderRecordFacetChips(rows, facetId)}</div>`;
  if (!visible.length) {
    return `${chips}<p class="pool-record-empty">No records of this type yet.</p>`;
  }
  return `
    ${chips}
    <ol class="pool-record-timeline" aria-label="Reploid records">
      ${visible.map((row) => `
        <li data-record-type="${escapeHtml(row.type)}">
          <details class="pool-record-event">
            <summary>
              <time datetime="${escapeHtml(row.occurredAt || '')}">${escapeHtml(formatRecordTime(row.occurredAt))}</time>
              <strong>${escapeHtml(row.title)}</strong>
              <span>${escapeHtml(row.meta || 'Recorded')}</span>
            </summary>
            <pre>${escapeHtml(safeJsonStringify(row.detail) || '')}</pre>
          </details>
        </li>
      `).join('')}
    </ol>
  `;
};

export const refreshRecordTimelineState = () => {
  const ledger = document.getElementById('pool-record-ledger');
  if (ledger) setPoolHtml(ledger, renderRecordLedger(ledger.dataset.recordFacet || 'all'));
};

const networkCount = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};

const uniqueNetworkIds = (values = []) => [...new Set(values
  .map((value) => String(value || '').trim())
  .filter(Boolean))];

export const resolvePoolNetworkVisualState = (summary = null) => {
  const unavailable = Boolean(summary?.error);
  const providers = Array.isArray(summary?.providers) ? summary.providers : [];
  const providerIds = uniqueNetworkIds(providers.map((provider) => provider?.providerId));
  const recent = Array.isArray(summary?.recent) ? summary.recent : [];
  const peerIds = uniqueNetworkIds([
    ...(Array.isArray(summary?.peers) ? summary.peers : []),
    ...recent.map((entry) => entry?.fromPeerId),
    ...providerIds
  ]);
  const peerCount = unavailable ? 0 : Math.max(networkCount(summary?.peerCount), peerIds.length);
  const providerCount = unavailable ? 0 : Math.max(networkCount(summary?.providerCount), providerIds.length);
  const messageCount = unavailable ? 0 : networkCount(summary?.messageCount);
  const reportedParticipants = unavailable ? 0 : Math.max(peerCount, providerCount, peerIds.length);
  const liveParticipantCount = Math.min(POOLDAY_PARTICIPANT_NODE_IDS.length, reportedParticipants);
  const providerSet = new Set(providerIds);
  const orderedIds = uniqueNetworkIds([
    ...providerIds,
    ...peerIds.filter((id) => !providerSet.has(id))
  ]);
  const participants = Array.from({ length: liveParticipantCount }, (_, index) => {
    const id = orderedIds[index] || null;
    return {
      id,
      provider: id ? providerSet.has(id) : index < providerCount
    };
  });
  const hasLiveData = liveParticipantCount > 0 || messageCount > 0 || recent.length > 0;
  const mode = !hasLiveData
    ? 'simulation'
    : liveParticipantCount >= POOLDAY_PARTICIPANT_NODE_IDS.length
      ? 'live'
      : 'hybrid';
  return {
    mode,
    available: !unavailable,
    error: unavailable ? String(summary.error) : null,
    roomId: summary?.roomId || null,
    peerCount,
    providerCount,
    messageCount,
    liveParticipantCount,
    participants,
    recent: recent.slice(0, 10).map((entry) => ({
      type: String(entry?.type || 'unknown'),
      fromPeerId: entry?.fromPeerId ? String(entry.fromPeerId) : null,
      createdAt: entry?.createdAt || null
    }))
  };
};

export const applyPoolNetworkVisualState = (summary = null) => {
  const visual = resolvePoolNetworkVisualState(summary);
  const status = visual.available
    ? `${visual.peerCount} live tab${visual.peerCount === 1 ? '' : 's'}, ${visual.providerCount} contributor${visual.providerCount === 1 ? '' : 's'}, ${visual.messageCount} message${visual.messageCount === 1 ? '' : 's'}`
    : 'room status unavailable';
  for (const control of document.querySelectorAll('[data-pool-network-state]')) {
    control.dataset.networkMode = visual.mode;
    control.setAttribute('aria-label', `Live Network, ${status}`);
    control.setAttribute('title', status);
    const badge = control.querySelector('[data-pool-network-count]');
    if (badge) {
      const count = Math.max(visual.peerCount, visual.liveParticipantCount);
      badge.textContent = String(count);
      badge.hidden = visual.mode === 'simulation';
    }
  }
  for (const shell of document.querySelectorAll('.pool-simulation-shell')) {
    shell.dataset.networkMode = visual.mode;
  }
  window.REPLOID_POOL_NETWORK_VISUAL_STATE = visual;
  window.dispatchEvent(new CustomEvent(POOLDAY_NETWORK_VISUAL_EVENT, { detail: visual }));
  return visual;
};

const RUN_STATE_COPY = Object.freeze({
  idle: 'Ready',
  submitting: 'Preparing request',
  running: 'Running on the network',
  complete: 'Answer verified',
  error: 'Run needs attention',
  inspecting: 'Inspecting proof'
});

export const setPoolRunVisualState = ({ state = 'idle', phase = '', message = '' } = {}) => {
  const visual = {
    state,
    phase,
    message: message || RUN_STATE_COPY[state] || RUN_STATE_COPY.idle
  };
  const outputVisible = ['complete', 'error', 'inspecting'].includes(visual.state);
  for (const surface of document.querySelectorAll('[data-pool-run-surface]')) {
    surface.dataset.runState = visual.state;
    surface.dataset.runPhase = visual.phase;
  }
  for (const status of document.querySelectorAll('[data-pool-run-status]')) {
    status.textContent = visual.message;
  }
  for (const output of document.querySelectorAll('[data-pool-run-output]')) {
    output.hidden = !outputVisible;
  }
  window.REPLOID_POOL_RUN_VISUAL_STATE = visual;
  window.dispatchEvent(new CustomEvent(POOLDAY_RUN_VISUAL_EVENT, { detail: visual }));
  return visual;
};

export const refreshRoomActivityState = (summary = null) => {
  ledgerStore.roomActivitySummary = summary;
  const activity = document.getElementById('pool-room-activity');
  if (activity) setPoolHtml(activity, renderRoomActivity(summary));
  refreshRecordTimelineState();
  applyPoolNetworkVisualState(summary);
};

export const refreshRecordLedgerState = (options = {}) => {
  const roomId = getPeerRoomId();
  if (options.reload === true) {
    ledgerStore.receiptRoom = null;
    ledgerStore.peerRoom = null;
  }
  ensureRecordLedgersLoaded(roomId);
  refreshRecordTimelineState();
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

const formatHealthValue = (value) => String(value ?? 'unknown').replace(/_/g, ' ');

const formatBytes = (value) => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown';
  if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / (1024 ** 2))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
};

const renderProviderHealth = (state = POOLDAY_PROVIDER_HEALTH) => {
  const primaryRows = [
    ['Model', state.model],
    ['Room work', state.queue],
    ['Last receipt', state.lastReceipt],
    ['Check', state.trust]
  ];
  const detailRows = [
    ['Capability', state.capability],
    ['WebGPU', state.webgpu],
    ['GPU', state.hardware],
    ['GPU buffer', state.maxBufferSize],
    ['Files', state.artifact],
    ['Local cache', state.storage],
    ['Reputation', state.reputation]
  ];
  const renderRows = (rows) => rows.filter(([, value]) => value !== undefined && value !== null).map(([label, value]) => `
    <span class="pool-summary-item">
      <span class="rgr-status-label">${escapeHtml(label)}</span>
      <span class="rgr-status-value">${escapeHtml(compactHash(label === 'GPU buffer' ? formatBytes(value) : formatHealthValue(value)))}</span>
    </span>
  `).join('');
  return `
    <div class="pool-provider-health-stack">
      <div class="boot-status-strip pool-summary" aria-label="Contributor readiness">
        ${renderRows(primaryRows)}
      </div>
      <details class="pool-advanced pool-provider-health-details">
        <summary>Device and receipt details</summary>
        <div class="boot-status-strip pool-summary" aria-label="Contributor device details">
          ${renderRows(detailRows)}
        </div>
      </details>
    </div>
  `;
};

export const updateProviderHealth = (partial = {}) => {
  Object.assign(POOLDAY_PROVIDER_HEALTH, partial);
  const health = document.getElementById('pool-provider-health');
  if (health) setPoolHtml(health, renderProviderHealth());
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
  const routeDecision = value.plan?.routeDecision || value.routeDecision || null;
  const fields = [
    ['Job', firstPresent(job.jobId, record.jobId, receipt.jobId)],
    ['Answer ID', firstPresent(job.receiptHash, record.receiptHash, verifier?.receiptHash, acceptance?.receiptHash)],
    ['Status', formatProductStatusText(firstPresent(job.status, agreement?.status, verifier?.accepted === true ? 'accepted' : verifier?.accepted === false ? 'rejected' : null))],
    ['Match', agreement ? `${agreement.status || 'pending'} ${Number(agreement.requiredAgreement || agreement.requiredProviders || 1)}-of-${Number(agreement.providerCount || agreement.providerIds?.length || 1)}` : firstPresent(job.trustTier, job.effectiveTrustTier, agreement?.effectiveTrustTier, ring?.effectiveTrustTier, receipt?.trustTier)],
    ['Connection', firstPresent(job.transport, value.transport, receipt?.promptTransport)],
    ['Route', firstPresent(routeDecision?.decisionHash, receipt?.routeDecisionHash)],
    ['Model', firstPresent(job.model?.id, job.modelRequirements?.modelId, receipt?.model?.id, value.model?.modelId)],
    ['Spend', firstPresent(acceptance?.pointSpend, value.pointSpend)],
    ['Runtime hash', firstPresent(receipt?.verification?.runtimeProfileHash, job.runtimeProfileHash, record.runtimeProfileHash)],
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

const renderRawDetails = (id, label = 'Full result', options = {}) => `
  <details class="pool-raw-details${options.full ? ' pool-raw-details-full' : ''}">
    <summary>${escapeHtml(label)}</summary>
    <pre class="pool-result pool-result-raw" id="${id}-raw" aria-live="polite"></pre>
  </details>
`;

const receiptTokenTotal = (record = {}) => {
  const receipt = record.receipt || record.body?.receipt || record;
  const counts = receipt.tokenCounts || record.tokenCounts || {};
  const input = Number(counts.input || 0);
  const output = Number(counts.output || 0);
  const tokenIds = record.tokenIds || record.body?.tokenIds || receipt.tokenIds || [];
  return (Number.isFinite(input) ? input : 0)
    + (Number.isFinite(output) && output > 0 ? output : Array.isArray(tokenIds) ? tokenIds.length : 0);
};

const formatContributionPolicy = (policyId) => ({
  fastest_receipt: 'First answer',
  canary_audited: 'Sample checked',
  redundant_agreement: 'Two matching answers',
  ring_quorum_receipt: 'Group match'
}[policyId] || String(policyId || 'default').replace(/_/g, ' '));

const renderRunContributionLayer = (value = {}) => {
  const payloads = Array.isArray(value.receiptPayloads) ? value.receiptPayloads : [];
  const assignments = Array.isArray(value.assignments) ? value.assignments : [];
  const agreement = value.agreement || {};
  const acceptedHashes = new Set(agreement.receiptHashes || []);
  const validHashes = new Set((agreement.validRecords || []).map((record) => record.receiptHash).filter(Boolean));
  const rejectedByHash = new Map((agreement.rejectedRecords || []).map((record) => [
    record.receiptHash || record.receiptPayload?.body?.receiptHash || record.receiptPayload?.fromPeerId || 'unknown',
    record.reasons || []
  ]));
  const rows = payloads.map((payload) => {
    const body = payload.body || payload;
    const receipt = body.receipt || {};
    const hash = body.receiptHash || receipt.receiptHash || '';
    const providerId = body.providerId || receipt.providerId || payload.fromPeerId || 'unknown';
    const status = acceptedHashes.has(hash)
      ? 'matched'
      : validHashes.has(hash)
        ? 'returned'
        : 'flagged';
    const reason = rejectedByHash.get(hash)?.join('; ') || null;
    return {
      providerId,
      status,
      hash,
      tokens: receiptTokenTotal(body),
      outputHash: receipt.outputHash || body.outputHash || null,
      reason
    };
  });
  const assignmentRows = rows.length ? rows : assignments.map((assignment) => ({
    providerId: assignment.providerId || 'unknown',
    status: 'selected',
    hash: assignment.assignmentId || assignment.jobId || '—',
    tokens: '—',
    outputHash: null,
    reason: null
  }));
  const policyId = value.policyId || agreement.policyId || value.assignment?.policyId || 'default';
  const checkStatus = agreement.accepted
    ? `${agreement.acceptedProviderCount || acceptedHashes.size || 1}/${agreement.requiredAgreement || 1} matched`
    : value.status === 'finding_peer_provider'
      ? 'waiting for matching tabs'
      : 'not accepted';
  const sharedCount = assignments.length || value.acceptedSessionCount || rows.length || 0;
  const routeDecision = value.plan?.routeDecision || value.routeDecision || null;
  const routeCandidates = Array.isArray(routeDecision?.candidates) ? routeDecision.candidates : [];
  const selectedRoute = routeCandidates.find((candidate) => (
    routeDecision.selectedProviderIds?.includes(candidate.providerId)
  ));
  const rejectedRoutes = routeCandidates.filter((candidate) => !candidate.eligible);
  return `
    <div class="pool-contributor-layer">
      <div class="pool-contributor-summary">
        <span><b>Shared</b>${escapeHtml(sharedCount)} contributor tab${sharedCount === 1 ? '' : 's'}</span>
        <span><b>Match</b>${escapeHtml(checkStatus)}</span>
        <span><b>Policy</b>${escapeHtml(formatContributionPolicy(policyId))}</span>
      </div>
      ${routeDecision ? `
        <div class="pool-contributor-summary pool-route-summary">
          <span><b>Artifact</b>${escapeHtml(String(selectedRoute?.artifactSourcePlan || 'provider_loaded_model').replace(/_/g, ' '))}</span>
          <span><b>Eligible</b>${escapeHtml(routeCandidates.filter((candidate) => candidate.eligible).length)}</span>
          <span><b>Excluded</b>${escapeHtml(rejectedRoutes.length)}</span>
        </div>
        ${rejectedRoutes.length ? `
          <details class="pool-route-rejections">
            <summary>Why other contributors were excluded</summary>
            <ul>
              ${rejectedRoutes.map((candidate) => `
                <li><b>${escapeHtml(compactHash(candidate.providerId || 'unknown'))}</b>: ${escapeHtml((candidate.rejectionReasons || []).join(', ') || 'not eligible')}</li>
              `).join('')}
            </ul>
          </details>
        ` : ''}
      ` : ''}
      ${assignmentRows.length ? `
        <div class="pool-ledger pool-contributor-table" role="table" aria-label="Answer contributors">
          <table>
            <thead>
              <tr>
                <th>Contributor</th>
                <th>Status</th>
                <th>Tokens</th>
                <th>Output</th>
              </tr>
            </thead>
            <tbody>
              ${assignmentRows.map((row) => `
                <tr>
                  <td title="${escapeHtml(row.providerId)}">${escapeHtml(compactHash(row.providerId))}</td>
                  <td title="${escapeHtml(row.reason || row.status)}">${escapeHtml(row.status)}</td>
                  <td>${escapeHtml(row.tokens || '—')}</td>
                  <td title="${escapeHtml(row.outputHash || row.hash || '—')}">${escapeHtml(compactHash(row.outputHash || row.hash || '—'))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : '<p class="type-caption pool-receipt-empty">Contributor evidence appears after matching tabs answer.</p>'}
    </div>
  `;
};

const renderContributionDetails = (id, label = 'Contributors') => `
  <details class="pool-raw-details pool-contributor-details">
    <summary>${escapeHtml(label)}</summary>
    <div class="pool-contributor-content" id="${id}-evidence" aria-live="polite">
      ${renderRunContributionLayer({ status: 'finding_peer_provider' })}
    </div>
  </details>
`;

const renderResultBox = (id, options = {}) => {
  if (options?.stream) {
    return `
      <div class="boot-status-strip pool-summary" id="${id}-summary" aria-live="polite"></div>
      <div class="pool-stream-box pool-answer-box">
        <label class="pool-result-label" for="${id}-stream">${escapeHtml(options.streamLabel || 'Output stream')}</label>
        <div class="pool-stream-shell">
          <pre class="pool-stream-output" id="${id}-stream" aria-live="polite"></pre>
          <span class="pool-stream-cursor" id="${id}-stream-cursor" aria-hidden="true">▍</span>
        </div>
      </div>
      ${options.evidence ? renderContributionDetails(id, options.evidenceLabel || 'Contributors') : ''}
      ${renderRawDetails(id, options.rawLabel || 'Full result', { full: options.rawFull === true })}
    `;
  }
  const placeholder = options.placeholder || 'No local activity yet.';
  return `
  <div class="boot-status-strip pool-summary" id="${id}-summary" aria-live="polite"></div>
  <p class="pool-result-message" id="${id}" aria-live="polite">${escapeHtml(placeholder)}</p>
  ${renderRawDetails(id, options.rawLabel || 'Full result', { full: options.rawFull === true })}
  `;
};

const PRODUCT_STATUS_LABELS = Object.freeze({
  accepted: 'Accepted',
  rejected: 'Rejected',
  pending: 'Pending',
  finding_peer_provider: 'Looking for matching contributor tabs',
  peer_provider_listening: 'This contributor tab is available',
  peer_provider_stopped: 'Contributor tab stopped',
  peer_room_starting: 'Starting this contributor tab',
  peer_room_listening: 'This contributor tab is available',
  provider_advertised: 'This contributor tab is visible in the room',
  provider_advert_failed: 'Contributor advert failed',
  peer_session_queued: 'Contributor tab queued',
  peer_session_dequeued: 'Contributor tab selected',
  peer_session_rejected: 'Contributor tab rejected the run',
  peer_assignment_rejected: 'Assignment rejected',
  peer_session_opening: 'Opening a browser-to-browser session',
  peer_session_open: 'Contributor is answering',
  peer_receipt_sent: 'Receipt sent',
  peer_acceptance_received: 'Receipt accepted',
  peer_session_failed: 'Run failed',
  stopped: 'Stopped'
});

const formatProductStatusText = (value = '') => {
  const normalized = String(value || '');
  if (!normalized) return '';
  if (PRODUCT_STATUS_LABELS[normalized]) return PRODUCT_STATUS_LABELS[normalized];
  if (/^webrtc_peer_room_(local|server)$/.test(normalized)) return 'Room connection ready';
  return normalized.replace(/_/g, ' ');
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
  if (status) return formatProductStatusText(status);
  const summary = extractResultSummary(value);
  if (summary.length > 0) {
    return summary.slice(0, 4).map(([label, fieldValue]) => `${label}: ${fieldValue}`).join('\n');
  }
  return 'Local peer state updated.';
};

const safeJsonStringify = (value) => {
  const ancestors = [];
  try {
    return JSON.stringify(value, function replaceJsonEntry(_key, entry) {
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
        while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
          ancestors.pop();
        }
        if (ancestors.includes(entry)) return '[Circular]';
        ancestors.push(entry);
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
    refreshRecordTimelineState();
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
  const evidenceEl = document.getElementById(`${id}-evidence`);
  if (summaryEl) {
    setPoolHtml(summaryEl, summary.length > 0 ? renderSummaryRows(summary) : '');
  }
  if (rawEl) rawEl.textContent = raw;
  if (evidenceEl && value && typeof value === 'object') {
    setPoolHtml(evidenceEl, renderRunContributionLayer(value));
  }
  if (streamMode && streamEl) {
    if (outputText && outputText.length > 0) {
      if (streamCursor) streamCursor.classList.add('is-visible', 'is-active');
      streamOutputText(`${id}-stream`, outputText);
    } else {
      const previous = ledgerStore.streams.get(`${id}-stream`);
      if (previous?.timer) window.clearTimeout(previous.timer);
      ledgerStore.streams.delete(`${id}-stream`);
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

export const POOL_DASHBOARD_VIEWS = Object.freeze(['home', 'ask', 'compute', 'records']);

export const normalizePoolDashboardView = (value) => (
  POOL_DASHBOARD_VIEWS.includes(value) ? value : 'home'
);

export const getPoolDashboardView = () => {
  try {
    return normalizePoolDashboardView(new URLSearchParams(window.location.search || '').get('view'));
  } catch {
    return 'home';
  }
};

export const renderNav = (activeRoute, {
  open = false,
  dashboard = false,
  dashboardView = 'home'
} = {}) => {
  const glyphs = {
    home: '⌂',
    ask: '?',
    compute: '☇',
    records: '☷',
    zero: '0',
    x: 'X'
  };
  const tooltips = {
    home: 'Return to the public network landing page',
    ask: 'Submit a prompt to browser model contributors',
    compute: 'Share this tab as browser compute',
    records: 'Review receipts, room activity, and contributor scores',
    zero: 'Experimental: open the local tabula rasa runtime',
    x: 'Experimental: open the mature self-improving workspace runtime',
    toggleClosed: 'Open the navigation details from the left',
    toggleOpen: 'Close the navigation details and keep the activity rail'
  };
  const descriptions = {
    home: 'Live network and one-step runs',
    ask: 'Prompt peers and inspect the proof',
    compute: 'Offer browser compute; stop any time',
    records: 'Answers, work, rooms, and receipts'
  };
  const toggleTooltip = open ? tooltips.toggleOpen : tooltips.toggleClosed;
  const renderItem = ({ id, path, label }) => {
    const isActive = dashboard
      ? normalizePoolDashboardView(dashboardView) === id
      : activeRoute === id;
    const currentAttr = isActive ? ' aria-current="page"' : '';
    const ariaLabel = escapeHtml(label);
    const tooltip = escapeHtml(tooltips[id] || `Open ${label} in Reploid navigation`);
    const glyph = glyphs[id] || label.slice(0, 1);
    const description = escapeHtml(descriptions[id] || tooltips[id]);
    const dashboardAttributes = dashboard
      ? ` href="${id === 'home' ? '/' : `/?view=${id}`}" data-pool-dashboard-view="${id}"`
      : ` href="${path}" data-pool-route-link="${path}"`;
    return `<a class="pool-nav-link${isActive ? ' is-active' : ''}"${dashboardAttributes} aria-label="${ariaLabel}" title="${tooltip}" data-pool-nav-tooltip="${tooltip}"${currentAttr}><span class="pool-nav-glyph" aria-hidden="true">${escapeHtml(glyph)}</span><span class="pool-nav-label">${ariaLabel}</span><span class="pool-nav-description">${description}</span></a>`;
  };
  const renderSubstrateItem = ({ id, path, label }) => {
    const tooltip = escapeHtml(tooltips[id] || `Open ${label} runtime`);
    const ariaLabel = escapeHtml(`${label} Experimental`);
    const description = id === 'zero'
      ? 'Blank local substrate'
      : 'Self-modifying workspace';
    return `<a class="pool-nav-link pool-nav-substrate-link pool-zero-link link-secondary" href="${path}" data-pool-substrate-route="${path}" aria-label="${ariaLabel}" title="${tooltip}" data-pool-nav-tooltip="${tooltip}"><span class="pool-nav-glyph" aria-hidden="true">${escapeHtml(glyphs[id])}</span><span class="pool-nav-label">${escapeHtml(label)}</span><span class="pool-nav-description">${escapeHtml(description)}</span><span class="pool-nav-badge">Experimental</span></a>`;
  };
  return `
    <nav class="pool-nav-rail${open ? ' is-open' : ''}" aria-label="Navigation">
      <div class="pool-nav-top">
        <button class="pool-nav-toggle" type="button" aria-label="${open ? 'Close navigation' : 'Open navigation'}" title="${escapeHtml(toggleTooltip)}" data-pool-nav-tooltip="${escapeHtml(toggleTooltip)}" aria-controls="pool-nav-menu" aria-expanded="${String(open)}">
          <span class="pool-nav-mark" aria-hidden="true">
            <span class="pool-nav-mark-seven pool-nav-mark-seven-top">7</span>
            <span class="pool-nav-mark-seven pool-nav-mark-seven-bottom">7</span>
          </span>
          <span class="pool-nav-brand-copy" aria-hidden="true">
            <strong>Reploid</strong>
            <small>Peer inference</small>
          </span>
        </button>
        <div class="pool-nav-menu" id="pool-nav-menu">
          ${POOLDAY_NAV_ROUTES.map(renderItem).join('')}
        </div>
      </div>
      <div class="pool-nav-bottom">
        ${renderRoomContext()}
        <details class="pool-nav-more">
          <summary class="pool-nav-more-summary">
            <span class="pool-nav-glyph" aria-hidden="true">···</span>
            <span class="pool-nav-label">More</span>
            <span class="pool-nav-description">Zero and X workspaces</span>
          </summary>
          <div class="pool-nav-more-panel">
            ${renderSubstrateItem({ id: 'zero', path: '/zero', label: 'Zero' })}
            ${renderSubstrateItem({ id: 'x', path: '/x', label: 'X' })}
          </div>
        </details>
      </div>
    </nav>
  `;
};

const renderRoomContext = () => `
  <div class="pool-room-context" aria-label="Peer room details">
    <div class="pool-room-context-heading">
      <b>Peer room</b>
      <small>Connection context</small>
    </div>
    <span><b>Room</b><code data-pool-room-id>${escapeHtml(getPeerRoomId())}</code></span>
    <span><b>Relay</b><code data-pool-relay-mode>${escapeHtml(getPeerRelayLabel())}</code></span>
    <span><b>Version</b><code>${escapeHtml(POOLDAY_VERSION_TAG)}</code></span>
    <a class="link-secondary" href="${escapeHtml(getPeerInviteUrl())}" data-pool-invite-link>Invite to this room</a>
  </div>
`;

const renderRouteShell = (copy, content) => `
  <section class="panel pool-panel pool-route-shell">
    <div class="pool-page-heading">
      <h1 class="type-h1">${escapeHtml(copy.title)}</h1>
      <p class="type-caption pool-hero-body">${escapeHtml(copy.body)}</p>
    </div>
    ${content}
  </section>
`;

const renderPolicyTrustLabel = (policy) => (
  policy.adaptiveRing ? 'group check' : 'one tab'
);

const formatContributionTokens = (value) => {
  const tokens = Number(value || 0);
  if (!Number.isFinite(tokens) || tokens <= 0) return '0';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(Math.round(tokens));
};

const formatContributionLast = (snapshot = {}) => {
  const recent = snapshot.recent?.[0];
  if (!recent) return 'none';
  const hash = recent.receiptHash ? ` ${compactHex(recent.receiptHash)}` : '';
  return `${formatContributionTokens(recent.tokens)}${hash}`;
};

const formatContributionModel = (modelId) => {
  if (!modelId) return 'none loaded';
  const contract = getEnabledPoolModelContract(modelId);
  return contract?.label || modelId;
};

const renderRecentContributionRows = (snapshot = {}) => {
  const recent = snapshot.recent || [];
  if (!recent.length) {
    return '<p class="type-caption pool-receipt-empty">No completed work from this tab yet.</p>';
  }
  return `
    <div class="pool-ledger pool-contribution-table" role="table" aria-label="Recent compute work">
      <table>
        <thead>
          <tr>
            <th>Answer</th>
            <th>Model</th>
            <th>Tokens</th>
            <th>Room</th>
          </tr>
        </thead>
        <tbody>
          ${recent.map((row) => `
            <tr>
              <td title="${escapeHtml(row.receiptHash || '—')}">${escapeHtml(compactHex(row.receiptHash || '—'))}</td>
              <td title="${escapeHtml(row.modelId || '—')}">${escapeHtml(formatContributionModel(row.modelId))}</td>
              <td>${escapeHtml(formatContributionTokens(row.tokens))}</td>
              <td title="${escapeHtml(row.roomId || '—')}">${escapeHtml(compactHash(row.roomId || '—'))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
};

export const renderComputeNodeStats = (snapshot = getContributionSnapshot()) => `
  <div class="pool-node-stats" aria-label="This contributor tab status">
    <span><b>Status</b>${escapeHtml(snapshot.label || 'Not active')}</span>
    <span><b>Model</b>${escapeHtml(formatContributionModel(snapshot.modelId))}</span>
    <span><b>24h receipts</b>${escapeHtml(snapshot.contributions24h || 0)}</span>
    <span><b>24h tokens</b>${escapeHtml(formatContributionTokens(snapshot.tokens24h))}</span>
    <span><b>Tokens/hr</b>${escapeHtml(formatContributionTokens(snapshot.tokensHour))}</span>
  </div>
`;

export const renderRecentContributionHistory = (snapshot = getContributionSnapshot()) => `
  <div class="pool-node-history" aria-label="This contributor tab recent work">
    ${renderRecentContributionRows(snapshot)}
  </div>
`;

export const shouldRenderContributionStatusBar = (snapshot = getContributionSnapshot()) => {
  return snapshot?.optedIn === true;
};

export const refreshContributionPanels = () => {
  const stats = document.getElementById('pool-provider-node-stats');
  const history = document.getElementById('pool-provider-node-history');
  const historySection = document.querySelector('[data-pool-contribution-history]');
  const snapshot = getContributionSnapshot();
  if (stats) {
    setPoolHtml(stats, renderComputeNodeStats(snapshot));
    stats.hidden = !snapshot.optedIn;
  }
  if (history) setPoolHtml(history, renderRecentContributionHistory(snapshot));
  if (historySection) historySection.hidden = !snapshot.recent?.length;
  refreshRecordTimelineState();
};

export const renderContributionStatusBar = (snapshot = getContributionSnapshot()) => {
  if (!shouldRenderContributionStatusBar(snapshot)) return '';
  const hasHourTokens = Number(snapshot.tokensHour || 0) > 0;
  const hasDayTokens = Number(snapshot.tokens24h || 0) > 0;
  const hasRecent = Boolean(snapshot.recent?.length);
  return `
    <aside
      class="pool-contribution-status"
      id="pool-contribution-status"
      data-contribution-state="${escapeHtml(snapshot.state || 'inactive')}"
      aria-label="Contribution status"
    >
      <span class="pool-contribution-dot" aria-hidden="true"></span>
      <span class="pool-contribution-state">${escapeHtml(snapshot.label || 'Not active')}</span>
      ${hasDayTokens ? `<span class="pool-contribution-metric"><b>24h</b> ${escapeHtml(formatContributionTokens(snapshot.tokens24h))}</span>` : ''}
      ${hasHourTokens ? `<span class="pool-contribution-metric"><b>1h</b> ${escapeHtml(formatContributionTokens(snapshot.tokensHour))}/hr</span>` : ''}
      ${hasRecent ? `<span class="pool-contribution-metric pool-contribution-last"><b>Last</b> ${escapeHtml(formatContributionLast(snapshot))}</span>` : ''}
    </aside>
  `;
};

export const refreshContributionStatusBar = () => {
  const snapshot = getContributionSnapshot();
  const current = document.getElementById('pool-contribution-status');
  if (!shouldRenderContributionStatusBar(snapshot)) {
    current?.remove();
    return;
  }
  const template = document.createElement('template');
  setPoolHtml(template, renderContributionStatusBar(snapshot).trim());
  const next = template.content.firstElementChild;
  if (!next) {
    current?.remove();
    return;
  }
  if (current) {
    current.replaceWith(next);
    return;
  }
  const main = document.querySelector('.pool-home');
  const nav = main?.querySelector('.pool-nav-rail');
  if (main && nav) {
    nav.insertAdjacentElement('afterend', next);
  }
};

const renderPolicyProductLabel = (policy) => {
  const labels = {
    fastest_receipt: 'First answer',
    canary_audited: 'Sample checked',
    redundant_agreement: 'Two matching answers',
    ring_quorum_receipt: 'Group match'
  };
  return labels[policy.policyId] || policy.policyId.replace(/_/g, ' ');
};

export const describeSelectedRun = ({
  policyId,
  modelId,
  adapterPackHash = null,
  status = 'finding_peer_provider'
} = {}) => {
  const policy = getPolicy(policyId || FASTEST_RECEIPT_POLICY_ID);
  const model = getEnabledPoolModelContract(modelId || LAUNCH_MODEL.modelId) || LAUNCH_MODEL;
  return {
    status,
    transport: `webrtc_peer_room_${getPeerRelayMode()}`,
    roomId: getPeerRoomId(),
    relay: getPeerRelayMode(),
    workMode: 'whole_job_redundant_records',
    policyId: policy?.policyId || policyId || FASTEST_RECEIPT_POLICY_ID,
    trustTier: policy?.adaptiveRing ? 'group check' : 'one tab',
    requiredAgreement: policy?.adaptiveRing
      ? `${policy.minRingSize || 1}-${policy.maxRingSize || 1} tabs, match by output hash`
      : `${policy?.redundancy || 1} tab${Number(policy?.redundancy || 1) === 1 ? '' : 's'}`,
    model: {
      modelId: model.modelId,
      modelHash: model.modelHash,
      manifestHash: model.manifestHash,
      runtime: model.runtime,
      backend: model.backend
    },
    adapter: adapterPackHash ? {
      packHash: adapterPackHash,
      state: 'selected_pending_provider'
    } : null
  };
};

const renderPolicyOptions = () => listPolicies().map((policy) => `
  <option value="${escapeHtml(policy.policyId)}">${escapeHtml(renderPolicyProductLabel(policy))} - ${escapeHtml(renderPolicyTrustLabel(policy))}</option>
`).join('');

const renderModelOptions = ({ workload = null, includeWorkloadLabel = false, disableSequence = false } = {}) => listPoolModels({
  enabledOnly: true,
  workload
}).map((model) => {
  const label = model.label || model.modelId;
  const modelWorkload = getPoolModelWorkload(model);
  const isSequence = modelWorkload !== POOLDAY_MODEL_WORKLOADS.textGeneration;
  const selected = model.modelId === LAUNCH_MODEL.modelId ? ' selected' : '';
  const disabled = disableSequence && isSequence ? ' disabled' : '';
  const workloadLabel = (includeWorkloadLabel || disableSequence) && isSequence
    ? ` · ${modelWorkload}${disabled ? ' (sequence lane pending)' : ''}`
    : '';
  return `<option value="${escapeHtml(model.modelId)}" data-workload="${escapeHtml(modelWorkload)}"${selected}${disabled}>${escapeHtml(label)}${escapeHtml(workloadLabel)}</option>`;
}).join('');

const renderParticipationControl = ({ surface = 'home', advanced = false, shareAction = surface === 'home' } = {}) => {
  const preferences = readParticipationPreferences();
  const modeButton = (mode, label) => `
    <button
      type="button"
      class="pool-participation-mode${preferences.mode === mode ? ' is-active' : ''}${mode === 'both' ? ' is-primary' : ''}"
      data-pool-participation-mode="${mode}"
      aria-pressed="${preferences.mode === mode}"
    >${label}</button>
  `;
  return `
    <section class="pool-participation" data-pool-participation data-pool-participation-surface="${surface}" data-participation-mode="${preferences.mode}" aria-label="Network participation">
      <div class="pool-participation-modes" role="group" aria-label="Network mode">
        ${modeButton('request', 'Request')}
        ${modeButton('contribute', 'Contribute')}
        ${modeButton('both', 'Both')}
      </div>
      <span class="pool-device-identity" data-pool-device-identity title="This device signs its network roles">Identity</span>
      ${shareAction ? `
        <button class="btn btn-primary pool-home-share-toggle" id="pool-home-provider-toggle" type="button" aria-pressed="false">Start sharing</button>
      ` : ''}
      ${advanced ? `
        <details class="pool-advanced pool-sharing-limits">
          <summary>Sharing limits</summary>
          <div class="pool-sharing-limit-grid">
            <label><input type="checkbox" data-pool-permission="relayArtifacts"${preferences.permissions.relayArtifacts ? ' checked' : ''}> Relay verified model and adapter files</label>
            <label><input type="checkbox" data-pool-permission="verifyResults"${preferences.permissions.verifyResults ? ' checked' : ''}> Verify peer results</label>
            <label><span>Concurrent runs</span><input type="number" min="1" max="4" step="1" value="${preferences.limits.maxConcurrentJobs}" data-pool-limit="maxConcurrentJobs"></label>
            <label><span>Tokens per run</span><input type="number" min="16" max="2048" step="16" value="${preferences.limits.maxTokensPerJob}" data-pool-limit="maxTokensPerJob"></label>
            <label><span>Adapter cache MiB</span><input type="number" min="128" max="65536" step="128" value="${preferences.limits.storageBudgetMiB}" data-pool-limit="storageBudgetMiB"></label>
            <label><span>Available network Mbps</span><input type="number" min="1" max="10000" step="1" value="${preferences.limits.bandwidthBudgetMbps}" data-pool-limit="bandwidthBudgetMbps"></label>
          </div>
          <button class="btn btn-ghost" type="button" data-pool-passkey>Protect identity with passkey</button>
          <p class="type-caption" data-pool-passkey-status></p>
        </details>
      ` : ''}
    </section>
  `;
};

const dashboardPanelAttributes = (id, activeView) => (
  `data-pool-dashboard-panel="${id}"${id === activeView ? '' : ' hidden'}`
);

const renderDashboardCapability = () => `
  <section class="pool-capability-card" data-pool-capability-profile data-capability-state="checking" aria-live="polite">
    <div class="pool-capability-heading">
      <div>
        <span class="pool-dashboard-kicker">This device</span>
        <h3 data-pool-capability-tier>Checking WebGPU</h3>
      </div>
      <strong data-pool-capability-score>--</strong>
    </div>
    <p data-pool-capability-summary>Measuring browser limits and a bounded compute kernel. No model is loaded.</p>
    <div class="pool-capability-meter" aria-hidden="true"><span data-pool-capability-meter></span></div>
    <dl class="pool-capability-metrics">
      <div><dt>WebGPU</dt><dd data-pool-capability-webgpu>Checking</dd></div>
      <div><dt>GPU buffer</dt><dd data-pool-capability-buffer>--</dd></div>
      <div><dt>Kernel</dt><dd data-pool-capability-kernel>--</dd></div>
      <div><dt>Stable</dt><dd data-pool-capability-stability>--</dd></div>
    </dl>
    <div class="pool-capability-models">
      <b>Eligible here</b>
      <div data-pool-capability-models><span>Checking model contracts</span></div>
    </div>
    <button class="btn btn-ghost" type="button" data-pool-capability-rerun>Check again</button>
  </section>
`;

const renderDashboardInspector = (activeView) => `
  <aside class="pool-dashboard-inspector" aria-label="Workspace inspector" data-pool-dashboard-inspector>
    <header class="pool-dashboard-inspector-header">
      <div>
        <span class="pool-dashboard-kicker">Inspector</span>
        <strong data-pool-dashboard-title>Workspace</strong>
      </div>
      <button type="button" class="pool-dashboard-close" data-pool-dashboard-view-target="home" aria-label="Close inspector">☈</button>
    </header>
    <div class="pool-dashboard-inspector-scroll">
      <section ${dashboardPanelAttributes('home', activeView)}>
        <div class="pool-dashboard-intro">
          <h2>One network, two ways to participate.</h2>
          <p>Ask browser models, share this device's compute, or do both in the same room.</p>
        </div>
        ${renderDashboardCapability()}
        <ol class="pool-dashboard-steps" aria-label="How a run works">
          <li><b>Request</b><span>Your prompt and requirements are signed.</span></li>
          <li><b>Match</b><span>Only compatible contributor tabs qualify.</span></li>
          <li><b>Run</b><span>The selected model or approved adapter executes.</span></li>
          <li><b>Verify</b><span>The answer returns with a signed receipt.</span></li>
        </ol>
      </section>
      <section ${dashboardPanelAttributes('ask', activeView)}>
        <span class="pool-dashboard-kicker">Run</span>
        <h2>Ask the network</h2>
        <p>The composer stays over the topology. Choose Text or an approved Adapter, then Run.</p>
        <div class="pool-dashboard-facts">
          <span><b>Model</b>${escapeHtml(LAUNCH_MODEL.label || LAUNCH_MODEL.modelId)}</span>
          <span><b>Room</b>${escapeHtml(getPeerRoomId())}</span>
          <span><b>Relay</b>${escapeHtml(getPeerRelayLabel())}</span>
        </div>
        <p class="pool-dashboard-consent"><span aria-hidden="true">⚿</span> Run signs approval bound to the prompt, model, and selected adapter.</p>
        <section class="pool-home-result-panel" data-pool-run-output hidden aria-label="Run result">
          <h2 class="type-h2">Answer</h2>
          ${renderResultBox('pool-home-run-result', {
            stream: true,
            streamLabel: 'Answer',
            evidence: true,
            evidenceLabel: 'Proof',
            rawLabel: 'Raw result',
            rawFull: true
          })}
        </section>
      </section>
      <section ${dashboardPanelAttributes('compute', activeView)} data-pool-provider>
        <span class="pool-dashboard-kicker">Contribute</span>
        <h2>Share this browser</h2>
        <p>Reploid qualifies the device before advertising work. Stop remains immediate.</p>
        <p class="pool-provider-status" data-pool-provider-status>Idle</p>
        <label class="pool-field">
          <span>Model</span>
          <select id="pool-provider-model">${renderModelOptions({ includeWorkloadLabel: true })}</select>
        </label>
        <p class="pool-provider-capability type-caption">This tab accepts <span class="pool-workload-badge" data-pool-provider-workload>text generation</span> jobs when the device qualifies.</p>
        ${renderParticipationControl({ surface: 'dashboard', advanced: true, shareAction: true })}
        <div id="pool-provider-health" class="pool-ledger-shell" aria-live="polite">${renderProviderHealth()}</div>
      </section>
      <section ${dashboardPanelAttributes('records', activeView)}>
        <span class="pool-dashboard-kicker">Records</span>
        <h2>Work and proof</h2>
        <p>Answers, contributions, and room events share one local timeline.</p>
        <button class="btn btn-primary" type="button" data-pool-activity-toggle aria-expanded="true">Open activity</button>
      </section>
    </div>
  </aside>
`;

const renderDashboardActivity = (activeView) => `
  <section class="pool-dashboard-activity${activeView === 'records' ? ' is-expanded' : ''}" data-pool-dashboard-activity aria-label="Activity" data-expanded="${activeView === 'records'}">
    <button class="pool-dashboard-activity-bar" type="button" data-pool-activity-toggle aria-expanded="${activeView === 'records'}">
      <span class="pool-dashboard-activity-dot" aria-hidden="true"></span>
      <strong>Activity</strong>
      <span>Runs, contributions, and receipts appear here.</span>
      <span class="pool-dashboard-activity-chevron" aria-hidden="true">⌃</span>
    </button>
    <div class="pool-dashboard-activity-body">
      <div id="pool-record-ledger" aria-live="polite" data-record-facet="all">${renderRecordLedger()}</div>
    </div>
  </section>
`;

const renderFlowLabels = () => POOLDAY_GRAPH_LABEL_STAGES.map((stage) => ({
  stage,
  item: POOLDAY_FLOW_LABELS.find((candidate) => candidate.id === stage.ids[0])
})).filter(({ item }) => Boolean(item)).map(({ stage, item }) => `
  <span
    class="pool-flow-label pool-flow-label-${escapeHtml(item.id)}"
    data-pool-flow-label="${escapeHtml(item.id)}"
    data-pool-flow-stage="${escapeHtml(stage.id)}"
    data-tooltip-title="${escapeHtml(item.label)}"
    data-tooltip-body="${escapeHtml(item.body)}"
    style="--pool-label-x: ${escapeHtml(String(item.x).replace('%', 'vw'))}; --pool-label-y: ${escapeHtml(String(item.y).replace('%', 'vh'))};"
    tabindex="0"
    aria-label="${escapeHtml(`${item.label}: ${item.body}`)}"
  >
    <b>${escapeHtml(item.label)}</b>
  </span>
`).join('');

const renderHomeSimulation = ({ dashboardView = 'home' } = {}) => {
  const activeView = normalizePoolDashboardView(dashboardView);
  const suggestedPrompt = choosePooldayAskPlaceholder();
  return `
    <section class="pool-home-stage" aria-label="Reploid network" data-pool-run-surface="home" data-run-state="idle" data-run-phase="" data-pool-lane="text" data-pool-dashboard-view="${activeView}">
      <div class="pool-home-toolbar" aria-label="Reploid home controls">
        <div class="pool-home-toolbar-leading pool-home-overlay" aria-label="Reploid overview">
          <div class="pool-home-title-lockup">
            <h1 class="type-h1 pool-home-brand-word">REPLOID</h1>
            <p class="pool-hero-body">Run browser models together.</p>
          </div>
        </div>
        <div class="pool-home-lane-chips" role="group" aria-label="Workload lanes">
          <button type="button" class="pool-lane-chip is-active" data-pool-lane="text" data-pool-request-control aria-pressed="true">Text</button>
          <button type="button" class="pool-lane-chip" data-pool-lane="adapters" data-pool-request-control aria-pressed="false"
                  title="Adapter packs run through the same loop on top of a base model">Adapters</button>
          <button type="button" class="pool-lane-chip" data-pool-lane="sequence" data-pool-request-control disabled
                  title="No qualified sequence model artifacts yet">Sequence</button>
        </div>
        ${renderParticipationControl({ surface: 'home', shareAction: false })}
      </div>
      <p class="pool-home-run-status" data-pool-run-status aria-live="polite">Ready</p>
      <div class="pool-dashboard-empty-state" aria-label="Network overview">
        <span class="pool-dashboard-preview"><span aria-hidden="true">○</span> Network preview</span>
        <h2>Ask browser models.<br>Share compute. Or both.</h2>
        <p>Watch each request move from match to verified answer.</p>
        <div class="pool-capability-compact" data-pool-capability-profile data-capability-state="checking">
          <span>This device</span>
          <b data-pool-capability-tier>Checking WebGPU</b>
          <strong data-pool-capability-score>--</strong>
        </div>
      </div>
      <div class="pool-simulation-shell" data-pool-network-state data-network-mode="simulation" aria-label="Reploid network graph">
        <canvas class="pool-simulation-canvas" data-pool-simulation width="1200" height="680"></canvas>
        <div class="pool-simulation-labels">
          ${renderFlowLabels()}
        </div>
        <div class="pool-simulation-tooltip" data-pool-tooltip data-placement="above" role="tooltip" aria-hidden="true">
          <b data-pool-tooltip-title></b>
          <span data-pool-tooltip-body></span>
        </div>
      </div>
      <form class="pool-home-ask-dock pool-home-cta-row pool-home-ask-form" id="pool-home-ask-form" aria-label="Ask the network">
        <label class="pool-home-adapter-picker" data-pool-home-adapter-picker hidden>
          <span>Adapter pack</span>
          <select id="pool-home-adapter" data-pool-run-adapter data-pool-request-control disabled>
            <option value="">Loading published packs…</option>
          </select>
          <small>Run signs approval for this pack, base model, and prompt.</small>
        </label>
        <div class="pool-home-ask-pill">
          <input
            id="pool-home-ask-prompt"
            class="pool-home-ask-input"
            name="prompt"
            type="text"
            aria-label="Ask prompt"
            autocomplete="off"
            value="${escapeHtml(suggestedPrompt)}"
            data-pool-suggested-prompt="${escapeHtml(suggestedPrompt)}"
            data-pool-request-control
          >
          <button class="pool-shape-action pool-shape-action--circle pool-shape-action--ask pool-home-ask-submit"
                  id="pool-home-run-submit"
                  type="submit"
                  data-pool-request-control
                  aria-label="Run">
            <span class="pool-shape-action-glyph" aria-hidden="true">▶</span>
            <span class="pool-shape-action-label">Run</span>
          </button>
        </div>
      </form>
      ${renderDashboardInspector(activeView)}
      ${renderDashboardActivity(activeView)}
    </section>
  `;
};

export const renderRoutePanel = (routeId, options = {}) => {
  if (routeId === 'home') return renderHomeSimulation(options);
  return '';
};

export const renderRouteDetail = (routeId) => {
  const normalizedRouteId = routeId === 'history' || routeId === 'network' ? 'records' : routeId;
  const copy = ROUTE_COPY[normalizedRouteId] || ROUTE_COPY.home;
  if (normalizedRouteId === 'ask') {
    return renderRouteShell(copy, `
        ${renderParticipationControl({ surface: 'ask' })}
        <div class="pool-form pool-route-grid pool-run-layout" data-pool-run data-pool-run-surface="run" data-run-state="idle" data-run-phase="">
          <div class="pool-run-compose">
            <label class="pool-field">
              <span data-pool-run-prompt-label>Prompt</span>
              <textarea id="pool-run-prompt" rows="6">Summarize Reploid in one sentence.</textarea>
            </label>
            <div class="pool-run-model-row">
              <label class="pool-field pool-run-model-field">
                <span>Model</span>
                <select id="pool-run-model">${renderModelOptions({ disableSequence: true })}</select>
              </label>
              <span class="pool-workload-badge" data-pool-run-workload>text generation</span>
            </div>
            <label class="pool-field">
              <span>Adapter pack</span>
              <select id="pool-run-adapter" data-pool-run-adapter>
                <option value="">Base model only</option>
              </select>
              <small>Choosing a pack and running signs a prompt- and model-bound approval.</small>
            </label>
            <details class="pool-advanced">
              <summary>Settings</summary>
              <div class="pool-advanced-grid">
                <label class="pool-field">
                  <span>Check</span>
                  <select id="pool-run-policy">${renderPolicyOptions()}</select>
                </label>
              </div>
            </details>
            <p class="pool-run-status" data-pool-run-status aria-live="polite">Ready</p>
            <div class="pool-control-row pool-primary-actions" aria-label="Run controls">
              <button class="btn btn-primary btn-op" data-op="▶" id="pool-run-submit" type="button">Run</button>
            </div>
          </div>
          <section class="pool-run-output" data-pool-run-output hidden>
            <h2 class="type-h2">Answer</h2>
            ${renderResultBox('pool-run-result', {
              stream: true,
              streamLabel: 'Answer',
              evidence: true,
              evidenceLabel: 'Proof',
              rawLabel: 'Raw result',
              rawFull: true
            })}
          </section>
        </div>
    `);
  }
  if (normalizedRouteId === 'compute') {
    return renderRouteShell(copy, `
        ${renderParticipationControl({ surface: 'compute', advanced: true })}
        <div class="pool-form pool-route-grid pool-provider-layout" data-pool-provider>
          <div class="pool-provider-main">
            <div class="pool-section-heading pool-provider-heading">
              <p class="pool-provider-status" data-pool-provider-status>Idle</p>
            </div>
            <div id="pool-provider-node-stats" class="pool-node-status-line" aria-live="polite" hidden></div>
            <label class="pool-field">
              <span>Model</span>
              <select id="pool-provider-model">${renderModelOptions({ includeWorkloadLabel: true })}</select>
            </label>
            <p class="pool-provider-capability type-caption">This tab accepts <span class="pool-workload-badge" data-pool-provider-workload>text generation</span> jobs for the selected model.</p>
            <div class="pool-control-row pool-primary-actions" aria-label="Contribution controls">
              <button class="btn btn-primary btn-op" data-op="▶" id="pool-provider-worker-toggle" type="button" aria-pressed="false">Start contributing</button>
            </div>
          </div>
          <section class="pool-inspector-shell" data-pool-contribution-history hidden>
            <h2 class="type-h2">Recent receipts</h2>
            <div id="pool-provider-node-history" class="pool-ledger-shell" aria-live="polite">${renderRecentContributionHistory()}</div>
          </section>
          <details class="pool-advanced pool-provider-details" id="pool-provider-details">
            <summary>Details</summary>
            <div class="pool-provider-detail-grid">
              <section aria-label="Contributor readiness">
                <h2 class="type-h2">Readiness</h2>
                <div id="pool-provider-health" class="pool-ledger-shell" aria-live="polite">${renderProviderHealth()}</div>
              </section>
              <details class="pool-advanced">
                <summary>Debug event</summary>
              ${renderResultBox('pool-provider-result', { placeholder: 'No activity yet.', rawLabel: 'Full event' })}
              </details>
            </div>
          </details>
        </div>
    `);
  }
  if (normalizedRouteId === 'records') {
    return renderRouteShell(copy, `
        <div class="pool-form pool-route-grid pool-record-layout" data-pool-receipts data-pool-reputation>
          <div id="pool-record-ledger" aria-live="polite" data-record-facet="all">${renderRecordLedger()}</div>
          <details class="pool-advanced pool-record-tools">
            <summary>Technical tools</summary>
            <div class="pool-record-tool-grid">
              <section data-pool-room-activity>
                <h2 class="type-h2">Room activity</h2>
                <div id="pool-room-activity" class="pool-ledger-shell" aria-live="polite">${renderRoomActivity()}</div>
              </section>
              <section>
                <h2 class="type-h2">Contributor scores</h2>
                <div id="pool-peer-ledger" class="pool-ledger-shell" aria-live="polite">${renderPeerLedgerState()}</div>
              </section>
              <section>
                <h2 class="type-h2">Saved answer receipts</h2>
                <div id="pool-receipt-ledger" class="pool-ledger-shell" aria-live="polite">${renderReceiptLedger()}</div>
              </section>
              <details class="pool-advanced pool-record-lookup">
                <summary>Find by receipt hash</summary>
                <label class="pool-field">
                  <span>Hash</span>
                  <input id="pool-receipt-hash" placeholder="sha256:..." />
                </label>
                <div class="pool-control-row pool-primary-actions">
                  <button class="btn btn-primary btn-op" data-op="⚲" id="pool-receipt-lookup" type="button">Lookup</button>
                </div>
                ${renderResultBox('pool-receipt-result', { placeholder: 'No lookup yet.' })}
              </details>
            </div>
            <p class="type-caption pool-protocol-version" aria-label="protocol identifier">Protocol ${POOLDAY_VERSION_TAG}</p>
          </details>
        </div>
    `);
  }
  return '';
};
