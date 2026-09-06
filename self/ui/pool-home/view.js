/**
 * @fileoverview Rendering and UI state helpers for the Poolday product home.
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
import { LAB_SURFACE_IDS, SURFACE_INTENTS } from '../../config/surface-intents.js';
import { renderDocumentSearch } from './document-search.js';
import {
  createPeerRoomBusFactory,
  createPeerRoomInviteUrl
} from '../../pool/peer-rendezvous.js';
import {
  PRODUCT_ROUTES,
  POOLDAY_NAME,
  POOLDAY_NAV_ROUTES,
  POOLDAY_NETWORK_VISUAL_EVENT,
  POOLDAY_RUN_VISUAL_EVENT,
  POOLDAY_PEER_LEDGER_STORAGE_KEY,
  POOLDAY_PROTOCOL,
  POOLDAY_RECEIPT_LEDGER_LIMIT,
  POOLDAY_STREAM_CHUNK_SIZE,
  POOLDAY_STREAM_TICK_MS,
  POOLDAY_VERSION_TAG,
  ROUTE_COPY,
  choosePooldayAskPlaceholderForLane
} from './constants.js';
import { getContributionSnapshot } from './contribution-state.js';
import { getPoolLedgerStore } from './ledger-store.js';
import {
  createPoolRecordPersistence,
  getPeerEventHash,
  getPooldayRecordStorageKeys as buildPooldayRecordStorageKeys
} from './record-persistence.js';
import { resolvePoolNetworkVisualState } from './network-projection.js';
import { renderResearchWorkspace } from './research-view.js';
import {
  getCrossRoomSequenceEvidence,
  getProteinUncertaintyCampaignQueue,
  getResearchSyncState,
  loadQuarantinedResearchRecords,
  loadResearchRecords
} from './research-store.js';
import { renderResearchRoom, roomHref } from './room-view.js';
import { renderRequesterConsentRows, renderRequesterIntentFields } from './requester-controls.js';
import {
  formatContributionModel,
  formatContributionTokens,
  projectRoomRecordRows,
  receiptOccurredAt,
  recordTimeMs
} from './room-record-projection.js';

export { resolvePoolNetworkVisualState };

const ledgerStore = getPoolLedgerStore();

// Single sink for markup writes: every fragment below builds attribute and
// text values through escapeHtml before reaching this assignment.
const setPoolHtml = (element, markup) => {
  element.innerHTML = String(markup ?? '');
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

export const getPoolRoomPanel = () => {
  const params = new URLSearchParams(window.location.search || '');
  const panel = params.get('panel');
  if (['review', 'discovery'].includes(panel)) return panel;
  const path = normalizeProductPath(window.location.pathname || '');
  return path === '/network' ? 'discovery' : 'overview';
};

export const getPoolReviewTarget = () => {
  const target = new URLSearchParams(window.location.search || '').get('target') || '';
  return /^sha256:[a-f0-9]{64}$/.test(target) ? target : '';
};

const recordPersistence = createPoolRecordPersistence({
  ledgerStore,
  getRoomId: () => getPeerRoomId()
});

export const getPooldayRecordStorageKeys = (roomId = getPeerRoomId()) => (
  buildPooldayRecordStorageKeys(roomId)
);

export const loadPoolRoomDraft = (roomId = getPeerRoomId()) => recordPersistence.loadDraft(roomId);
export const persistPoolRoomDraft = (draft, roomId = getPeerRoomId()) => recordPersistence.persistDraft(draft, roomId);
export const clearPoolRoomDraft = (roomId = getPeerRoomId()) => recordPersistence.clearDraft(roomId);

const POOLDAY_RECORD_VIEW_STORAGE_KEY = 'reploid.pool.record-view.v1';
const getRecordViewStorageKey = (roomId = getPeerRoomId()) => (
  `${POOLDAY_RECORD_VIEW_STORAGE_KEY}::${encodeURIComponent(roomId)}`
);
const readRecordViewState = (roomId = getPeerRoomId()) => {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(getRecordViewStorageKey(roomId)) || '{}');
    return parsed && typeof parsed === 'object'
      ? {
          facet: typeof parsed.facet === 'string' ? parsed.facet : 'all',
          open: parsed.open && typeof parsed.open === 'object' ? parsed.open : {}
        }
      : { facet: 'all', open: {} };
  } catch {
    return { facet: 'all', open: {} };
  }
};
const writeRecordViewState = (state, roomId = getPeerRoomId()) => {
  try {
    globalThis.localStorage?.setItem(getRecordViewStorageKey(roomId), JSON.stringify(state));
  } catch {
    // Record disclosures remain usable when browser storage is unavailable.
  }
};

export const getPoolRecordFacet = () => {
  const facet = readRecordViewState().facet;
  return ['all', 'request', 'answer', 'contribution', 'room'].includes(facet) ? facet : 'all';
};

export const setPoolRecordFacet = (facet = 'all') => {
  const state = readRecordViewState();
  state.facet = ['all', 'request', 'answer', 'contribution', 'room'].includes(facet) ? facet : 'all';
  writeRecordViewState(state);
  return state.facet;
};

export const setPoolRecordDisclosureOpen = (disclosureId, open) => {
  const id = String(disclosureId || '').trim();
  if (!id) return;
  const state = readRecordViewState();
  state.open[id] = Boolean(open);
  writeRecordViewState(state);
};

export const restorePoolRecordDisclosures = (root = document) => {
  const state = readRecordViewState();
  root?.querySelectorAll?.('details[data-pool-record-disclosure]').forEach((details) => {
    const id = details.dataset.poolRecordDisclosure;
    if (typeof state.open[id] === 'boolean') details.open = state.open[id];
  });
};

const ensureReceiptLedgerLoaded = (roomId = getPeerRoomId()) => recordPersistence.ensureReceiptsLoaded(roomId);
const ensurePeerLedgerLoaded = (roomId = getPeerRoomId()) => recordPersistence.ensurePeerEventsLoaded(roomId);
const ensureRecordLedgersLoaded = (roomId = getPeerRoomId()) => recordPersistence.ensureLoaded(roomId);
const persistReceiptLedgerRows = (roomId = getPeerRoomId()) => recordPersistence.persistReceipts(roomId);
const persistPeerLedgerEvents = (roomId = getPeerRoomId()) => recordPersistence.persistPeerEvents(roomId);

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

export const getPeerQueueWindowMs = () => {
  const explicit = Number(window.REPLOID_POOL_QUEUE_WINDOW_MS || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return getPeerReceiptWindowMs();
};

export const getPeerSessionAcceptWindowMs = () => {
  const explicit = Number(window.REPLOID_POOL_SESSION_ACCEPT_WINDOW_MS || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (getPeerRelayMode() === 'server') return 15000;
  return 5000;
};

export const getPeerTransportConnectWindowMs = () => {
  const explicit = Number(window.REPLOID_POOL_TRANSPORT_CONNECT_WINDOW_MS || 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  if (getPeerRelayMode() === 'server') return 20000;
  return 5000;
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
  const normalized = String(status || '').toLowerCase();
  const recovering = normalized.includes('retry')
    || normalized.includes('relay unavailable')
    || normalized.includes('checking relay');
  const providerState = recovering
    ? 'degraded'
    : normalized.includes('could not') || normalized.includes('failed') || normalized.includes('error')
      ? 'error'
    : normalized.includes('available') || normalized.includes('ready') || normalized.includes('answering') || normalized.includes('online') || normalized.includes('running')
      ? 'online'
      : normalized.includes('starting') || normalized.includes('opening')
        ? 'starting'
        : 'offline';
  if (statusEl) {
    statusEl.textContent = status;
    statusEl.dataset.providerState = providerState;
  }
  const summary = mount?.querySelector('[data-pool-drawer-summary="network-device"]');
  if (summary) {
    summary.textContent = status === 'Idle' ? 'Not sharing' : status;
    summary.dataset.providerState = providerState;
  }
};

export const updateProviderNotice = (mount, notice = null) => {
  const noticeEl = mount?.querySelector('[data-pool-provider-notice]');
  if (!noticeEl) return;
  if (!notice) {
    noticeEl.hidden = true;
    noticeEl.dataset.noticeState = '';
    setPoolHtml(noticeEl, '');
    return;
  }
  noticeEl.hidden = false;
  noticeEl.dataset.noticeState = notice.state || 'info';
  setPoolHtml(noticeEl, `
    <strong>${escapeHtml(notice.title || 'Sharing needs attention')}</strong>
    <span>${escapeHtml(notice.message || '')}</span>
  `);
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

const refreshRoomAfterLedgerMutation = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  refreshResearchRoomState(getRouteId());
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
  refreshRoomAfterLedgerMutation();
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
              <td title="${escapeHtml(compactHash(row.provider))}">${escapeHtml(compactHash(row.provider))}</td>
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

export const recordPeerLedgerEvents = (events = []) => {
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
  if (changed) {
    persistPeerLedgerEvents();
    refreshRoomAfterLedgerMutation();
  }
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
                <td title="${escapeHtml(compactHash(peerId))}">${escapeHtml(compactHash(peerId))}</td>
                <td>${escapeHtml(points)}</td>
                <td>${escapeHtml(reputation.acceptedReceipts ?? 0)}</td>
                <td>${escapeHtml(reputation.rejectedReceipts ?? 0)}</td>
              </tr>
            `;
          }).join('')}
          ${reputationRows.filter((row) => !Object.prototype.hasOwnProperty.call(reduced.points || {}, row.providerId)).map((row) => `
            <tr>
              <td title="${escapeHtml(compactHash(row.providerId))}">${escapeHtml(compactHash(row.providerId))}</td>
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

const formatRecordTime = (value) => {
  const parsed = recordTimeMs(value);
  if (!parsed) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(parsed));
};

const unifiedRecordRows = () => {
  ensureRecordLedgersLoaded();
  return projectRoomRecordRows({
    receipts: ledgerStore.receipts,
    contributions: getContributionSnapshot().recent || [],
    peerEvents: ledgerStore.peerEvents,
    roomActivitySummary: ledgerStore.roomActivitySummary
  });
};

const RECORD_FACETS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'request', label: 'Requests' },
  { id: 'answer', label: 'Answers' },
  { id: 'contribution', label: 'Contributions' },
  { id: 'room', label: 'Network' }
]);

const renderRecordFacetChips = (rows, facetId) => RECORD_FACETS.map((facet) => {
  const count = facet.id === 'all' ? rows.length : rows.filter((row) => row.type === facet.id).length;
  const active = facet.id === facetId ? ' is-active' : '';
  return `<button type="button" class="pool-lane-chip pool-record-facet-chip${active}"
    data-pool-record-facet="${escapeHtml(facet.id)}" aria-pressed="${facet.id === facetId ? 'true' : 'false'}">${escapeHtml(facet.label)} (${count})</button>`;
}).join('');

export const renderRecordLedger = (facetId = getPoolRecordFacet()) => {
  const rows = unifiedRecordRows();
  if (!rows.length) {
    return '<p class="pool-record-empty">No records yet. Requests, completed runs, and contributions will appear here.</p>';
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
          <details class="pool-record-event" data-pool-record-disclosure="record:${escapeHtml(row.id)}"${readRecordViewState().open[`record:${row.id}`] ? ' open' : ''}>
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

const renderDashboardActivity = (allRows = unifiedRecordRows()) => {
  const rows = allRows.slice(0, 5);
  if (!rows.length) {
    return '<p class="pool-record-empty">No recent work. Requests, contributions, and room events appear here.</p>';
  }
  return `
    <ol class="pool-record-timeline pool-record-timeline-compact" aria-label="Recent network activity">
      ${rows.map((row) => `
        <li data-record-type="${escapeHtml(row.type)}">
          <span>
            <time datetime="${escapeHtml(row.occurredAt || '')}">${escapeHtml(formatRecordTime(row.occurredAt))}</time>
            <strong>${escapeHtml(row.title)}</strong>
            <small>${escapeHtml(row.meta || 'Recorded')}</small>
          </span>
        </li>
      `).join('')}
    </ol>
    <a class="link-secondary pool-drawer-link" href="${escapeHtml(roomHref('/records', getPeerRoomId()))}" data-pool-route-link="${escapeHtml(roomHref('/records', getPeerRoomId()))}">View all records</a>
  `;
};

export const refreshRecordTimelineState = () => {
  const ledger = document.getElementById('pool-record-ledger');
  if (ledger) {
    const compact = ledger.dataset.recordPresentation === 'compact';
    const activityRows = compact ? unifiedRecordRows() : null;
    setPoolHtml(
      ledger,
      compact
        ? renderDashboardActivity(activityRows)
        : renderRecordLedger(ledger.dataset.recordFacet || 'all')
    );
    restorePoolRecordDisclosures(ledger);
    const summary = document.querySelector('[data-pool-drawer-summary="network-activity"]');
    if (summary) {
      const count = activityRows?.length || 0;
      summary.textContent = count ? `${count} recent` : 'No recent work';
    }
  }
};

export const applyPoolNetworkVisualState = (summary = null) => {
  const visual = resolvePoolNetworkVisualState(summary);
  const status = visual.available
    ? `${visual.peerCount} live tab${visual.peerCount === 1 ? '' : 's'}, ${visual.providerCount} contributor${visual.providerCount === 1 ? '' : 's'}, ${visual.messageCount} message${visual.messageCount === 1 ? '' : 's'}`
    : 'room status unavailable';
  for (const connection of document.querySelectorAll('[data-pool-connection-activity]')) {
    connection.textContent = visual.available
      ? `${visual.peerCount} tab${visual.peerCount === 1 ? '' : 's'} · ${visual.providerCount} contributor${visual.providerCount === 1 ? '' : 's'}`
      : getPeerRelayMode() === 'local'
        ? 'Local tab · live discovery'
        : 'Checking live room';
  }
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
    const label = control.querySelector('[data-pool-network-label]');
    if (label) {
      label.textContent = !visual.available
        ? 'Unavailable'
        : visual.providerCount > 0
          ? `${visual.providerCount} provider${visual.providerCount === 1 ? '' : 's'}`
          : visual.peerCount > 0
            ? `${visual.peerCount} peer${visual.peerCount === 1 ? '' : 's'}`
            : summary
              ? '0 peers'
              : 'Searching';
    }
  }
  for (const state of document.querySelectorAll('[data-pool-pack-provider-state]')) {
    state.textContent = !visual.available
      ? 'Unavailable'
      : visual.providerCount > 0
        ? `${visual.providerCount} available`
        : summary
          ? 'No providers'
          : 'Searching';
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
    const documentsSelected = output.closest('.pool-home-task')?.querySelector('[data-pool-workflow="documents"][aria-pressed="true"]');
    output.hidden = !outputVisible || Boolean(documentsSelected);
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
  refreshRoomAfterLedgerMutation();
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
  refreshResearchRoomState(getRouteId());
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
  const renderRows = (rows) => rows.filter(([, value]) => value !== undefined && value !== null).map(([label, value]) => {
    const formatted = label === 'GPU buffer' ? formatBytes(value) : formatHealthValue(value);
    const isValLoading = formatted.toLowerCase() === 'loading';
    const valueHtml = isValLoading
      ? `<span class="pool-health-loading-text">${escapeHtml(formatted)}</span>`
      : escapeHtml(compactHash(formatted));
    return `
      <span class="pool-summary-item"${isValLoading ? ' data-loading="true"' : ''}>
        <span class="rgr-status-label">${escapeHtml(label)}</span>
        <span class="rgr-status-value">${valueHtml}</span>
      </span>
    `;
  }).join('');
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
  const output = String(candidates.find((entry) => typeof entry === 'string' && entry.length > 0) || '');
  if (output) return output;
  if (value.sequenceResultHash) {
    const dimensions = Number(value.embeddingDimensions || value.sequenceOutput?.pooledEmbedding?.length || 0);
    return [
      'Protein embedding ready',
      dimensions > 0 ? `${dimensions} dimensions` : null,
      `Result ${compactHash(value.sequenceResultHash)}`
    ].filter(Boolean).join('\n');
  }
  return '';
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
  try {
    const url = new URL(path || '/', window.location.origin);
    if (url.origin !== window.location.origin || url.username || url.password) return null;
    return url.pathname.replace(/\/+$/, '') || '/';
  } catch { return null; }
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
    return [['Status', value.statusLabel || value.error || 'Failed']];
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
    ['Sequence result', firstPresent(value.sequenceResultHash, receipt?.sequenceResultHash)],
    ['Dimensions', firstPresent(value.embeddingDimensions, receipt?.embeddingDimensions)],
    ['Spend', firstPresent(acceptance?.pointSpend, value.pointSpend)],
    ['Runtime hash', firstPresent(receipt?.verification?.runtimeProfileHash, job.runtimeProfileHash, record.runtimeProfileHash)],
    ['Doppler evidence', receipt?.dopplerEvidenceComparison?.verified === true
      ? firstPresent(receipt.dopplerEvidenceComparison.runtimeProfileHash, 'verified')
      : null],
    ['Output', firstPresent(receipt?.outputHash, record.outputHash, job.outputHash)],
    ['Tokens', firstPresent(receipt?.tokenIdsHash, record.tokenIdsHash, job.tokenIdsHash)],
    ['Verifier', verifier ? (verifier.ok === true || verifier.accepted === true ? 'accepted' : verifier.reasons?.length ? verifier.reasons.join('; ') : 'rejected') : null]
  ].filter(([, fieldValue]) => fieldValue !== undefined && fieldValue !== null && fieldValue !== '');
  return fields.slice(0, 10);
};

const renderSummaryRows = (summary) => summary.map(([label, value]) => `
  <span class="pool-summary-item">
    <span class="rgr-status-label">${escapeHtml(label)}</span>
    <span class="rgr-status-value">${escapeHtml(label === 'Status' ? value : compactHash(value))}</span>
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
  fastest_receipt: 'One peer',
  canary_audited: 'One peer with audit',
  redundant_agreement: 'Two matching peers',
  ring_quorum_receipt: 'Peer quorum'
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
                  <td title="${escapeHtml(compactHash(row.providerId))}">${escapeHtml(compactHash(row.providerId))}</td>
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

const renderProteinEmbeddingDetails = (id) => `
  <details class="pool-raw-details pool-protein-embedding-details" id="${id}-embedding-details" hidden>
    <summary>View embedding vector</summary>
    <p class="type-caption" id="${id}-embedding-meta"></p>
    <pre id="${id}-embedding" aria-label="Pooled protein embedding"></pre>
  </details>
`;

const renderProteinEmbeddingOutcome = (id) => `
  <section class="pool-embedding-outcome" id="${id}-embedding-outcome" aria-live="polite" hidden>
    <p class="pool-embedding-outcome-kicker">Protein representation</p>
    <h3 class="type-h3">Embedding ready</h3>
    <p class="pool-embedding-outcome-meta" id="${id}-embedding-outcome-meta"></p>
    <p class="pool-embedding-outcome-copy">480 values for comparing sequences from this exact ESM-2 model and contract.</p>
    <p class="pool-embedding-outcome-copy">Not a biological interpretation or diagnosis.</p>
    <div class="pool-embedding-outcome-actions">
      <button class="btn btn-ghost" type="button" data-pool-copy-embedding data-pool-embedding-result-id="${id}" disabled>Copy vector</button>
      <a class="btn btn-ghost" href="${escapeHtml(roomHref('/records', getPeerRoomId()))}">Recent jobs</a>
      <p class="pool-embedding-copy-status" data-pool-embedding-copy-status aria-live="polite"></p>
    </div>
    <p class="pool-embedding-copy-status" id="${id}-research-status" aria-live="polite"></p>
  </section>
`;

export const setResearchPublicationStatus = (resultId, message) => {
  const element = document.getElementById(`${resultId}-research-status`);
  if (element) element.textContent = String(message || '');
};

const renderResultBox = (id, options = {}) => {
  if (options?.stream) {
    return `
      <div class="boot-status-strip pool-summary" id="${id}-summary" aria-live="polite"></div>
      ${options.proteinEmbedding ? renderProteinEmbeddingOutcome(id) : ''}
      <div class="pool-stream-box pool-answer-box">
        <label class="pool-result-label" for="${id}-stream">${escapeHtml(options.streamLabel || 'Output stream')}</label>
        <div class="pool-stream-shell">
          <pre class="pool-stream-output" id="${id}-stream" aria-live="polite"></pre>
          <span class="pool-stream-cursor" id="${id}-stream-cursor" aria-hidden="true">▍</span>
        </div>
      </div>
      <div class="pool-run-recovery" id="${id}-recovery" aria-live="polite" hidden></div>
      ${options.evidence ? renderContributionDetails(id, options.evidenceLabel || 'Contributors') : ''}
      ${options.proteinEmbedding ? renderProteinEmbeddingDetails(id) : ''}
      ${renderRawDetails(id, options.rawLabel || 'Full result', { full: options.rawFull === true })}
    `;
  }
  const placeholder = options.placeholder || 'No local activity yet.';
  return `
  <div class="boot-status-strip pool-summary" id="${id}-summary" aria-live="polite"></div>
  <p class="pool-result-message" id="${id}" aria-live="polite">${escapeHtml(placeholder)}</p>
  <div class="pool-run-recovery" id="${id}-recovery" aria-live="polite" hidden></div>
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
  peer_provider_queued: 'Contributor queued this request',
  peer_provider_execution_started: 'Contributor started this request',
  peer_execution_started: 'Contributor is computing',
  peer_execution_abandoned: 'Interrupted execution settled without a requester',
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
    const mainReason = value.reason || value.error || 'Request failed';
    const actionText = value.action || value.payload?.action;
    return actionText ? `${mainReason}\n\n${actionText}` : mainReason;
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

const summarizedSequenceOutput = (sequenceOutput = {}) => {
  const pooledEmbedding = Array.isArray(sequenceOutput.pooledEmbedding)
    ? sequenceOutput.pooledEmbedding
    : null;
  return {
    omitted: 'Rendered in Protein embedding',
    pooledEmbeddingDimensions: pooledEmbedding?.length || 0,
    tokenEmbeddings: sequenceOutput.tokenEmbeddings == null ? null : '[omitted from raw result]',
    maskedLogits: Array.isArray(sequenceOutput.maskedLogits) && sequenceOutput.maskedLogits.length > 0
      ? '[omitted from raw result]'
      : []
  };
};

const safeJsonStringify = (value, { redactSequenceOutput = false } = {}) => {
  const ancestors = [];
  try {
    return JSON.stringify(value, function replaceJsonEntry(_key, entry) {
      if (redactSequenceOutput && _key === 'sequenceOutput' && entry && typeof entry === 'object') {
        return summarizedSequenceOutput(entry);
      }
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

const sequenceOutputFor = (value = {}) => (
  value.sequenceOutput
  || value.receiptRecord?.sequenceOutput
  || value.receiptPayload?.body?.sequenceOutput
  || value.receipt?.sequenceOutput
  || value.record?.sequenceOutput
  || value.body?.sequenceOutput
  || null
);

/**
 * Raw embedding values are publication material, not ordinary result detail.
 * Keep this decision explicit so a local execution cannot accidentally turn a
 * private vector into a copyable disclosure.
 */
export const isEmbeddingPublicationPermitted = (value = {}) => (
  value.embeddingPublicationConsent === true
  || value.researchSubmission?.consent?.publishEmbedding === true
  || value.researchResult?.consent?.publishEmbedding === true
);

const renderProteinEmbeddingOutput = (id, value = {}) => {
  const details = document.getElementById(`${id}-embedding-details`);
  const output = document.getElementById(`${id}-embedding`);
  const meta = document.getElementById(`${id}-embedding-meta`);
  const outcome = document.getElementById(`${id}-embedding-outcome`);
  const outcomeMeta = document.getElementById(`${id}-embedding-outcome-meta`);
  const copyButton = outcome?.querySelector('[data-pool-copy-embedding]');
  const copyStatus = outcome?.querySelector('[data-pool-embedding-copy-status]');
  const pooledEmbedding = sequenceOutputFor(value)?.pooledEmbedding;
  if (!details || !output || !meta) return;
  if (!Array.isArray(pooledEmbedding) || pooledEmbedding.length === 0) {
    details.hidden = true;
    output.textContent = '';
    meta.textContent = '';
    if (outcome) outcome.hidden = true;
    if (outcomeMeta) outcomeMeta.textContent = '';
    if (copyButton) copyButton.disabled = true;
    if (copyStatus) copyStatus.textContent = '';
    return;
  }
  const resultIdentity = compactHash(value.sequenceResultHash || value.vectorHash || '');
  const publicationPermitted = isEmbeddingPublicationPermitted(value);
  details.hidden = !publicationPermitted;
  meta.textContent = publicationPermitted
    ? `${pooledEmbedding.length} dimensions · ${resultIdentity}`
    : `${pooledEmbedding.length} dimensions · ${resultIdentity} · Raw vector withheld`;
  if (outcome) outcome.hidden = false;
  if (outcomeMeta) outcomeMeta.textContent = publicationPermitted
    ? `${pooledEmbedding.length} dimensions · Result ${resultIdentity}`
    : `${pooledEmbedding.length} dimensions · Result ${resultIdentity} · Raw vector withheld because embedding publication consent was not granted.`;
  if (copyButton) {
    copyButton.disabled = !publicationPermitted;
    copyButton.dataset.poolEmbeddingPublicationPermitted = String(publicationPermitted);
  }
  if (copyStatus) copyStatus.textContent = publicationPermitted
    ? ''
    : 'The raw embedding is withheld because publication consent was not granted.';
  output.textContent = publicationPermitted ? (safeJsonStringify(pooledEmbedding) || '[]') : '';
};

const formatErrorResultText = (value = {}) => {
  const payload = value.payload || {};
  const model = value.model || payload.model || payload.requiredModel || null;
  const artifact = payload.artifactPreflight || value.artifactPreflight || null;
  const providerFailures = Array.isArray(value.providerFailures)
    ? value.providerFailures
    : Array.isArray(payload.providerFailures)
      ? payload.providerFailures
      : [];
  const failedProviderIds = Array.isArray(value.failedProviderIds)
    ? value.failedProviderIds
    : Array.isArray(payload.failedProviderIds)
      ? payload.failedProviderIds
      : [];
  const routeCandidates = Array.isArray(payload.routeCandidates)
    ? payload.routeCandidates
    : [];
  const summarizeTransportDiagnostics = (diagnostics = {}) => {
    if (!diagnostics || typeof diagnostics !== 'object') return '';
    const fields = [
      diagnostics.state ? `state=${diagnostics.state}` : null,
      diagnostics.connectionState ? `connection=${diagnostics.connectionState}` : null,
      diagnostics.iceConnectionState ? `ice=${diagnostics.iceConnectionState}` : null,
      Number.isFinite(Number(diagnostics.pendingRemoteIceCandidateCount))
        ? `pending-ice=${Number(diagnostics.pendingRemoteIceCandidateCount)}`
        : null,
      Number.isFinite(Number(diagnostics.expiredRemoteIceCandidateCount)) && Number(diagnostics.expiredRemoteIceCandidateCount) > 0
        ? `expired-ice=${Number(diagnostics.expiredRemoteIceCandidateCount)}`
        : null,
      Number.isFinite(Number(diagnostics.overflowRemoteIceCandidateCount)) && Number(diagnostics.overflowRemoteIceCandidateCount) > 0
        ? `dropped-ice=${Number(diagnostics.overflowRemoteIceCandidateCount)}`
        : null,
      diagnostics.turnConfigured === true ? 'turn=configured' : diagnostics.turnConfigured === false ? 'turn=not-configured' : null
    ].filter(Boolean);
    return fields.join(', ');
  };
  const providerFailureText = providerFailures.map((failure) => {
    const providerId = compactHash(failure?.providerId || 'unknown contributor');
    const code = failure?.code ? ` (${failure.code})` : '';
    const message = failure?.message ? `: ${failure.message}` : '';
    const transport = summarizeTransportDiagnostics(failure?.diagnostics);
    return `${providerId}${code}${message}${transport ? ` [transport: ${transport}]` : ''}`;
  }).join('; ');
  const transportDiagnostics = value.transportDiagnostics || payload.transportDiagnostics || value.diagnostics || payload.diagnostics;
  const transportText = summarizeTransportDiagnostics(transportDiagnostics);
  const routeCandidateText = routeCandidates.map((candidate) => {
    const providerId = compactHash(candidate?.providerId || 'unknown contributor');
    const reasons = Array.isArray(candidate?.rejectionReasons) && candidate.rejectionReasons.length > 0
      ? candidate.rejectionReasons.join(', ')
      : 'eligible';
    return `${providerId}: ${reasons}`;
  }).join('; ');
  const lines = [
    value.error ? `Error: ${value.error}` : null,
    value.reason ? `Reason: ${value.reason}` : null,
    value.code ? `Code: ${value.code}` : null,
    value.action || payload.action ? `Next: ${value.action || payload.action}` : null,
    value.roomId || payload.roomId ? `Room: ${value.roomId || payload.roomId}` : null,
    value.relay ? `Relay: ${value.relay}` : null,
    model?.modelId || model?.id ? `Model: ${model.modelId || model.id}` : null,
    Number.isFinite(Number(payload.requiredProviders)) ? `Required contributors: ${Number(payload.requiredProviders)}` : null,
    Number.isFinite(Number(payload.eligibleProviders)) ? `Eligible contributors: ${Number(payload.eligibleProviders)}` : null,
    routeCandidateText ? `Eligibility: ${routeCandidateText}` : null,
    failedProviderIds.length > 0 ? `Contributors: ${failedProviderIds.map((providerId) => compactHash(providerId)).join(', ')}` : null,
    providerFailureText ? `Contributor failures: ${providerFailureText}` : null,
    transportText ? `Transport: ${transportText}` : null,
    artifact?.status ? `Artifact: ${artifact.status}` : null,
    artifact?.urls?.manifest || payload.urls?.manifest ? `Manifest: ${artifact?.urls?.manifest || payload.urls?.manifest}` : null
  ].filter(Boolean);
  return lines.join('\n');
};

const renderRecoveryAction = (action = {}) => {
  const id = String(action.id || '').trim();
  const label = String(action.label || '').trim();
  if (!id || !label) return '';
  const className = action.primary === true ? 'btn btn-primary' : 'btn btn-ghost';
  if (action.href) {
    return `
      <a class="${className}" href="${escapeHtml(action.href)}" data-pool-run-recovery-action="${escapeHtml(id)}">${escapeHtml(label)}</a>
    `;
  }
  return `
    <button class="${className}" type="button" data-pool-run-recovery-action="${escapeHtml(id)}">${escapeHtml(label)}</button>
  `;
};

const renderRunRecovery = (recovery = null) => {
  if (!recovery || typeof recovery !== 'object') return '';
  const actions = Array.isArray(recovery.actions)
    ? recovery.actions.map(renderRecoveryAction).filter(Boolean).join('')
    : '';
  const details = Array.isArray(recovery.details)
    ? recovery.details.filter(Boolean).map((detail) => `<li>${escapeHtml(detail)}</li>`).join('')
    : '';
  if (!recovery.title && !recovery.message && !actions && !details) return '';
  return `
    <section class="pool-run-recovery-card" data-pool-run-recovery-kind="${escapeHtml(recovery.kind || 'attention')}">
      ${recovery.title ? `<h2 class="type-h3">${escapeHtml(recovery.title)}</h2>` : ''}
      ${recovery.message ? `<p>${escapeHtml(recovery.message)}</p>` : ''}
      ${details ? `<ul>${details}</ul>` : ''}
      ${actions ? `<div class="pool-run-recovery-actions">${actions}</div>` : ''}
    </section>
  `;
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
      : safeJsonStringify(value, { redactSequenceOutput: true }) || String(value);
  const streamEl = streamMode ? document.getElementById(`${id}-stream`) : document.getElementById(id);
  const streamCursor = streamMode ? document.getElementById(`${id}-stream-cursor`) : null;
  const rawEl = document.getElementById(`${id}-raw`);
  const evidenceEl = document.getElementById(`${id}-evidence`);
  const recoveryEl = document.getElementById(`${id}-recovery`);
  const answerBox = streamMode ? streamEl?.closest?.('.pool-answer-box') : null;
  if (summaryEl) {
    setPoolHtml(summaryEl, summary.length > 0 ? renderSummaryRows(summary) : '');
  }
  if (recoveryEl) {
    const recoveryHtml = renderRunRecovery(value?.recovery);
    setPoolHtml(recoveryEl, recoveryHtml);
    recoveryEl.hidden = !recoveryHtml;
  }
  if (answerBox) answerBox.hidden = Boolean(value?.recovery);
  if (rawEl) rawEl.textContent = raw;
  if (value && typeof value === 'object') renderProteinEmbeddingOutput(id, value);
  if (evidenceEl && value && typeof value === 'object') {
    setPoolHtml(evidenceEl, renderRunContributionLayer(value));
  }
  if (streamMode && streamEl) {
    if (outputText && outputText.length > 0) {
      if (options.animate === false) {
        const previous = ledgerStore.streams.get(`${id}-stream`);
        if (previous?.timer) window.clearTimeout(previous.timer);
        ledgerStore.streams.delete(`${id}-stream`);
        streamEl.textContent = outputText;
        if (streamCursor) streamCursor.classList.remove('is-visible', 'is-active');
      } else {
        if (streamCursor) streamCursor.classList.add('is-visible', 'is-active');
        streamOutputText(`${id}-stream`, outputText);
      }
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

export const restoreLatestCompletedRun = (routeId = getRouteId()) => {
  const targetId = routeId === 'home'
    ? 'pool-home-run-result'
    : routeId === 'ask'
      ? 'pool-run-result'
      : null;
  if (!targetId || !document.getElementById(`${targetId}-raw`)) return null;
  ensureReceiptLedgerLoaded();
  const row = ledgerStore.receipts.find((candidate) => (
    candidate?.record?.agreement?.accepted === true
    || candidate?.record?.requesterAcceptance?.accepted === true
  ));
  if (!row) return null;
  const restored = {
    ...(row.record || {}),
    receiptHash: row.receiptHash,
    savedRecord: {
      restored: true,
      roomId: getPeerRoomId(),
      occurredAt: row.occurredAt || null
    }
  };
  setResult(targetId, restored, { stream: true, animate: false });
  setPoolRunVisualState({
    state: 'inspecting',
    phase: 'saved',
    message: 'Showing last saved answer'
  });
  return restored;
};

export const POOL_DASHBOARD_VIEWS = Object.freeze(['home', 'compute', 'records']);

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

export const renderNav = (activeRoute) => {
  const renderItem = ({ id, path, label }) => {
    const isActive = activeRoute === id || (activeRoute === 'ask' && id === 'home');
    const currentAttr = isActive ? ' aria-current="page"' : '';
    const ariaLabel = escapeHtml(label);
    const shortLabel = escapeHtml({ home: 'Run', compute: 'Share', records: 'Jobs' }[id] || label);
    const roomPath = roomHref(path, getPeerRoomId());
    return `<a class="pool-nav-link pool-segment${isActive ? ' is-active' : ''}" href="${escapeHtml(roomPath)}" aria-label="${ariaLabel}" data-pool-nav-id="${id}" data-pool-nav-short-label="${shortLabel}" data-pool-route-link="${escapeHtml(roomPath)}"${currentAttr}>${ariaLabel}</a>`;
  };
  return `
    <nav class="pool-nav-rail pool-primary-nav" aria-label="${escapeHtml(POOLDAY_NAME)}">
      <a class="pool-primary-brand" href="${escapeHtml(roomHref('/', getPeerRoomId()))}" data-pool-route-link="${escapeHtml(roomHref('/', getPeerRoomId()))}">${escapeHtml(POOLDAY_NAME)}</a>
      <div class="pool-nav-menu pool-segmented" id="pool-nav-menu">
        ${POOLDAY_NAV_ROUTES.map(renderItem).join('')}
      </div>
      <details class="pool-primary-network" data-pool-network-state="simulation">
        <summary aria-label="Network availability">
          <span class="pool-primary-network-dot" aria-hidden="true"></span>
          <span data-pool-network-label>Searching</span>
          <span data-pool-network-count hidden>0</span>
        </summary>
        <div class="pool-primary-network-details">
          <span><b>Room</b><code data-pool-room-id>${escapeHtml(getPeerRoomId())}</code></span>
          <span><b>Relay</b><code data-pool-relay-mode>${escapeHtml(getPeerRelayLabel())}</code></span>
          <span><b>Version</b><code>${escapeHtml(POOLDAY_VERSION_TAG)}</code></span>
          <a href="${escapeHtml(getPeerInviteUrl())}" data-pool-invite-link>Invite</a>
        </div>
      </details>
    </nav>
  `;
};

export const renderActiveResearchRoom = (routeId = getRouteId()) => {
  const roomId = getPeerRoomId();
  return renderResearchRoom({
    roomId,
    routeId,
    panel: getPoolRoomPanel(),
    researchRecords: loadResearchRecords(roomId),
    quarantinedRecords: loadQuarantinedResearchRecords(roomId),
    crossRoomEvidence: getCrossRoomSequenceEvidence(roomId),
    campaignQueue: getProteinUncertaintyCampaignQueue(roomId),
    receipts: ledgerStore.receipts,
    peerEvents: ledgerStore.peerEvents,
    syncState: getResearchSyncState(roomId)
  });
};

export const refreshResearchRoomState = (routeId = getRouteId()) => {
  const room = document.querySelector('[data-pool-research-room]');
  if (!room) return;
  room.outerHTML = renderActiveResearchRoom(routeId);
};

const renderRouteShell = (copy, content, { routeId = 'records' } = {}) => `
  <section class="panel pool-panel pool-route-shell pool-task-card" data-pool-route-shell="${escapeHtml(routeId)}">
    <div class="pool-page-heading">
      <h1 class="type-h1">${escapeHtml(copy.title)}</h1>
      <p class="type-caption pool-hero-body">${escapeHtml(copy.body)}</p>
    </div>
    ${content}
  </section>
`;

const formatContributionLast = (snapshot = {}) => {
  const recent = snapshot.recent?.[0];
  if (!recent) return 'none';
  const hash = recent.receiptHash ? ` ${compactHex(recent.receiptHash)}` : '';
  return `${formatContributionTokens(recent.tokens)}${hash}`;
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
    fastest_receipt: 'One peer',
    canary_audited: 'One peer with audit',
    redundant_agreement: 'Two matching peers',
    ring_quorum_receipt: 'Peer quorum'
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
  <option value="${escapeHtml(policy.policyId)}">${escapeHtml(renderPolicyProductLabel(policy))}</option>
`).join('');

const renderModelOptions = ({ workload = null, disableSequence = false } = {}) => listPoolModels({
  enabledOnly: true,
  workload
}).map((model) => {
  const label = model.label || model.modelId;
  const modelWorkload = getPoolModelWorkload(model);
  const isSequence = true;
  const selected = model.modelId === LAUNCH_MODEL.modelId ? ' selected' : '';
  const disabled = disableSequence && isSequence ? ' disabled' : '';
  const workloadLabel = disabled ? ' (unavailable)' : '';
  return `<option value="${escapeHtml(model.modelId)}" data-workload="${escapeHtml(modelWorkload)}"${selected}${disabled}>${escapeHtml(label)}${escapeHtml(workloadLabel)}</option>`;
}).join('');

const renderPackSummary = (model = LAUNCH_MODEL, { disclosure = true } = {}) => {
  const identity = model.artifactIdentity || {};
  const dimensions = Number(model.embeddingDimensions || model.dimensions || 0);
  const maxInput = Number(model.sequence?.maxLength || model.contextLength || 0);
  const work = model.executionMode === 'full_model_browser_sequence'
    ? 'Full model · one sequence'
    : `${model.runtime || 'Doppler'} · ${model.backend || 'qualified provider'}`;
  return `
    ${disclosure ? '<details class="pool-advanced pool-model-details"><summary>Model details</summary>' : ''}
    <dl class="pool-pack-summary" data-pool-pack-summary>
      <div><dt>Model identity</dt><dd title="${escapeHtml(identity.weightPackId || model.modelHash || model.modelId)}">${escapeHtml(compactHash(identity.weightPackId || model.modelHash || model.modelId))}</dd></div>
      <div><dt>Capability</dt><dd>${escapeHtml(dimensions ? `Sequence embedding · ${dimensions} dimensions` : getPoolModelWorkload(model).replace(/[._-]/g, ' '))}</dd></div>
      <div><dt>Input</dt><dd>${escapeHtml(maxInput ? `Public protein sequence · up to ${maxInput} residues` : 'Public protein sequence')}</dd></div>
      <div><dt>Work</dt><dd>${escapeHtml(work)}</dd></div>
      <div><dt>Providers</dt><dd data-pool-pack-provider-state>Searching</dd></div>
    </dl>
    ${disclosure ? '</details>' : ''}
  `;
};

const renderSharingLimits = (preferences = readParticipationPreferences()) => `
  <details class="pool-advanced pool-sharing-limits">
    <summary>Sharing limits</summary>
    <div class="pool-sharing-limit-grid">
      <label><input type="checkbox" data-pool-permission="relayArtifacts"${preferences.permissions.relayArtifacts ? ' checked' : ''}> Share checked model and adapter files</label>
      <label><input type="checkbox" data-pool-permission="verifyResults"${preferences.permissions.verifyResults ? ' checked' : ''}> Check peer results</label>
      <label><span>Concurrent runs</span><input type="number" min="1" max="4" step="1" value="${preferences.limits.maxConcurrentJobs}" data-pool-limit="maxConcurrentJobs"></label>
      <label><span>Tokens per run</span><input type="number" min="16" max="2048" step="16" value="${preferences.limits.maxTokensPerJob}" data-pool-limit="maxTokensPerJob"></label>
      <label><span>Adapter cache MiB</span><input type="number" min="128" max="65536" step="128" value="${preferences.limits.storageBudgetMiB}" data-pool-limit="storageBudgetMiB"></label>
      <label><span>Available network Mbps</span><input type="number" min="1" max="10000" step="1" value="${preferences.limits.bandwidthBudgetMbps}" data-pool-limit="bandwidthBudgetMbps"></label>
    </div>
    <button class="btn btn-ghost" type="button" data-pool-passkey>Protect identity with passkey</button>
    <p class="type-caption" data-pool-passkey-status></p>
  </details>
`;

const renderSharingBoundary = (preferences = readParticipationPreferences(), model = LAUNCH_MODEL) => `
  <section class="pool-sharing-boundary" aria-label="Current sharing limits">
    <h2 class="type-h2">Before you share</h2>
    <ul>
      <li><strong>${escapeHtml(model.label || model.modelId)}</strong> only</li>
      <li><strong>${escapeHtml(preferences.limits.maxConcurrentJobs)}</strong> run${preferences.limits.maxConcurrentJobs === 1 ? '' : 's'} at a time</li>
      <li>Public protein sequences only. Results and signed records go to the requester.</li>
      <li>${escapeHtml(preferences.limits.storageBudgetMiB)} MiB cache · ${escapeHtml(preferences.limits.bandwidthBudgetMbps)} Mbps</li>
      <li>Share until you stop or close this tab</li>
    </ul>
  </section>
`;

const renderParticipationControl = ({
  surface = 'home',
  advanced = false,
  shareAction = surface === 'home',
  showIdentity = true
} = {}) => {
  const preferences = readParticipationPreferences();
  const modeButton = (mode, label) => `
    <button
      type="button"
      class="pool-participation-mode${preferences.mode === mode ? ' is-active' : ''}${mode === 'both' ? ' is-primary' : ''}"
      data-pool-participation-mode="${mode}"
      aria-pressed="${preferences.mode === mode}"
    >${label}</button>
  `;
  const showModeSwitcher = surface !== 'ask' && surface !== 'compute';
  return `
    <section class="pool-participation" data-pool-participation data-pool-participation-surface="${surface}" data-participation-mode="${preferences.mode}" aria-label="Network participation">
      ${showModeSwitcher ? `
        <div class="pool-participation-modes" role="group" aria-label="Network mode">
          ${modeButton('request', 'Request')}
          ${modeButton('contribute', 'Contribute')}
          ${modeButton('both', 'Both')}
        </div>
      ` : ''}
      ${showIdentity ? '<span class="pool-device-identity" data-pool-device-identity title="This device signs its network roles">Identity</span>' : ''}
      ${shareAction ? `
        <button class="btn btn-primary pool-home-share-toggle" id="pool-home-provider-toggle" type="button" aria-pressed="false">Start sharing</button>
      ` : ''}
      ${advanced ? renderSharingLimits(preferences) : ''}
    </section>
  `;
};

const renderHomeSimulation = ({ dashboardView = 'home' } = {}) => {
  const activeView = normalizePoolDashboardView(dashboardView);
  const suggestedPrompt = choosePooldayAskPlaceholderForLane('sequence');
  return `
    <section class="pool-home-stage pool-home-stage--focused" aria-label="Run a model" data-pool-run-surface="home" data-run-state="idle" data-run-phase="" data-pool-lane="sequence" data-pool-dashboard-view="${activeView}">
      <div class="pool-home-toolbar" aria-label="${escapeHtml(POOLDAY_NAME)}">
        <div class="pool-home-toolbar-leading pool-home-overlay" aria-label="${escapeHtml(POOLDAY_NAME)} overview">
          <div class="pool-home-title-lockup">
            <h1 class="type-h1 pool-home-brand-word">${escapeHtml(POOLDAY_NAME)}</h1>
            <p class="type-caption pool-hero-body pool-home-brand-promise">${escapeHtml(ROUTE_COPY.home.body)}</p>
          </div>
          <div class="pool-prism" data-pool-prism aria-hidden="true">
            <svg class="pool-prism-still" viewBox="0 0 480 420" focusable="false">
              <defs>
                <linearGradient id="pool-prism-glass" x1="0" y1="0" x2="1" y2="1">
                  <stop stop-color="#ffffff"/><stop offset=".45" stop-color="#e3e9ee"/>
                  <stop offset=".7" stop-color="#dedaf1"/><stop offset="1" stop-color="#f6e4d7"/>
                </linearGradient>
                <linearGradient id="pool-prism-edge" x1="0" y1="0" x2="1" y2="1">
                  <stop stop-color="#bfdecd"/><stop offset=".4" stop-color="#ffffff"/>
                  <stop offset=".65" stop-color="#a6cce4"/><stop offset="1" stop-color="#d5b8ec"/>
                </linearGradient>
                <radialGradient id="pool-prism-light">
                  <stop stop-color="#c5c2df" stop-opacity=".35"/><stop offset="1" stop-color="#e9e8e4" stop-opacity="0"/>
                </radialGradient>
              </defs>
              <ellipse cx="240" cy="344" rx="154" ry="39" fill="url(#pool-prism-light)"/>
              <g stroke="url(#pool-prism-edge)" stroke-width="1.5" stroke-linejoin="round">
                <path d="M239 55 373 167 270 304 116 200Z" fill="url(#pool-prism-glass)"/>
                <path d="M239 55 244 186 116 200Z" fill="#fbfcfc" fill-opacity=".7"/>
                <path d="M239 55 373 167 244 186Z" fill="#dce7e7" fill-opacity=".45"/>
                <path d="M244 186 373 167 270 304Z" fill="#c7c9e3" fill-opacity=".45"/>
                <path d="M116 200 244 186 270 304Z" fill="#f4e6dd" fill-opacity=".5"/>
              </g>
            </svg>
            <canvas class="pool-prism-canvas" data-pool-prism-canvas></canvas>
          </div>
        </div>
      </div>
      <div class="pool-home-task">
        <div class="pool-workflow-switcher pool-segmented" role="group" aria-label="Choose a task">
          <button type="button" class="pool-segment" data-pool-workflow="sequence" aria-pressed="true" aria-controls="pool-home-ask-form">Protein sequences</button>
          <button type="button" class="pool-segment" data-pool-workflow="documents" aria-pressed="false" aria-controls="pool-document-search">Document search</button>
        </div>
        ${renderDocumentSearch()}
        <form class="pool-home-ask-dock pool-home-cta-row pool-home-ask-form pool-task-card" id="pool-home-ask-form" aria-label="Run a model">
          <header class="pool-home-task-heading">
            <h2 class="type-h2">Run a model</h2>
          </header>
          <label class="pool-field">
            <span>Model</span>
            <select id="pool-home-request-model" data-pool-request-control>
              ${renderModelOptions({ workload: POOLDAY_MODEL_WORKLOADS.sequenceEmbedding })}
            </select>
          </label>
          <label class="pool-home-sequence-field" for="pool-home-ask-prompt">
            <span class="pool-sequence-heading"><span>Public protein sequence</span><output id="pool-sequence-count" for="pool-home-ask-prompt">0 / ${Number(LAUNCH_MODEL.sequence?.maxLength || 1024)}</output></span>
            <textarea
              id="pool-home-ask-prompt"
              class="pool-home-ask-input"
              name="sequence"
              rows="4"
              aria-label="Public protein sequence"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              aria-describedby="pool-sequence-feedback pool-sequence-count"
              placeholder="${escapeHtml(suggestedPrompt)}"
              data-pool-suggested-prompt="${escapeHtml(suggestedPrompt)}"
              data-pool-request-control
            ></textarea>
          </label>
          <div class="pool-sequence-help">
            <p class="pool-sequence-feedback" id="pool-sequence-feedback" aria-live="polite"></p>
            <button class="btn btn-ghost" type="button" data-pool-use-example data-pool-request-control>Use example</button>
          </div>
          <div class="pool-sequence-options" data-pool-sequence-options>
            <label class="pool-consent-row" data-pool-sequence-consent-row>
              <input id="pool-home-sequence-public" type="checkbox" data-pool-request-control>
              <span>This input may be sent to selected peers</span>
            </label>
            <strong data-pool-sequence-consent-saved hidden>Saved</strong>
          </div>
          <details class="pool-advanced pool-home-request-details">
            <summary>Options</summary>
            ${renderPackSummary(LAUNCH_MODEL, { disclosure: false })}
            <div class="pool-advanced-grid">
              <label class="pool-field">
                <span>Verification</span>
                <select id="pool-home-request-policy" data-pool-request-control>${renderPolicyOptions()}</select>
              </label>
              <label class="pool-home-adapter-picker" data-pool-home-adapter-picker hidden>
                <span>Model adapter</span>
                <select id="pool-home-adapter" data-pool-run-adapter data-pool-request-control disabled>
                  <option value="">Loading published adapters…</option>
                </select>
                <small data-pool-adapter-status hidden></small>
              </label>
            </div>
          </details>
          <div class="pool-home-submit-row">
            <button class="btn btn-primary pool-home-run-button pool-primary-action" id="pool-home-run-submit" type="submit" data-pool-request-control aria-label="Run model">Run model</button>
            <p class="pool-home-run-status" data-pool-run-status aria-live="polite">Ready</p>
          </div>
        </form>
        <section class="pool-home-result-panel" data-pool-run-output hidden aria-label="Run result">
          ${renderResultBox('pool-home-run-result', {
            stream: true,
            streamLabel: 'Result',
            evidence: true,
            evidenceLabel: 'Proof',
            proteinEmbedding: true,
            rawLabel: 'Raw result',
            rawFull: true
          })}
        </section>
      </div>
      <footer class="pool-experiments-footer">
        <nav aria-label="Experiments">
          <span>Experiments</span>
          ${LAB_SURFACE_IDS.map((id) => {
            const { label, route } = SURFACE_INTENTS[id];
            return `<a href="${escapeHtml(route)}" data-pool-substrate-route="${escapeHtml(id)}">${escapeHtml(label)}</a>`;
          }).join('')}
        </nav>
      </footer>
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
              <span data-pool-run-prompt-label>Protein sequence</span>
              <textarea id="pool-run-prompt" rows="6">MAPLALLLLGLVAGA</textarea>
            </label>
            <div class="pool-run-model-row">
              <label class="pool-field pool-run-model-field">
                <span>Model</span>
                <select id="pool-run-model">${renderModelOptions()}</select>
              </label>
              <span class="pool-workload-badge" data-pool-run-workload>protein embedding</span>
            </div>
            ${renderPackSummary(LAUNCH_MODEL)}
            <label class="pool-field">
              <span>Input disclosure</span>
              ${renderRequesterConsentRows({ prefix: 'pool-run', rowElement: 'span', includeResearch: false })}
              <small>The peer job sends the sequence only to selected contributors.</small>
            </label>
            <details class="pool-advanced">
              <summary>Settings</summary>
              <div class="pool-advanced-grid">
                <label class="pool-field">
                  <span>Verification</span>
                  <select id="pool-run-policy">${renderPolicyOptions()}</select>
                </label>
              </div>
            </details>
            <p class="pool-run-status" data-pool-run-status aria-live="polite">Ready</p>
            <div class="pool-control-row pool-primary-actions" aria-label="Run controls">
              <button class="btn btn-primary pool-primary-action" id="pool-run-submit" type="button">Run</button>
            </div>
          </div>
          <section class="pool-run-output" data-pool-run-output hidden>
            <h2 class="type-h2">Protein embedding</h2>
            ${renderResultBox('pool-run-result', {
              stream: true,
              streamLabel: 'Result',
              evidence: true,
              evidenceLabel: 'Proof',
              proteinEmbedding: true,
              rawLabel: 'Raw result',
              rawFull: true
            })}
          </section>
        </div>
    `, { routeId: normalizedRouteId });
  }
  if (normalizedRouteId === 'compute') {
    return renderRouteShell(copy, `
        <div class="pool-form pool-route-grid pool-provider-layout" data-pool-provider>
          <div class="pool-provider-main">
            <div class="pool-section-heading pool-provider-heading">
              <p class="pool-provider-status" data-pool-provider-status>Idle</p>
            </div>
            <div id="pool-provider-node-stats" class="pool-node-status-line" aria-live="polite" hidden></div>
            <label class="pool-field">
              <span>Model</span>
              <select id="pool-provider-model">${renderModelOptions()}</select>
            </label>
            ${renderPackSummary(LAUNCH_MODEL)}
            ${renderSharingBoundary(readParticipationPreferences(), LAUNCH_MODEL)}
            ${renderSharingLimits(readParticipationPreferences())}
            <div class="pool-provider-notice" data-pool-provider-notice aria-live="assertive" hidden></div>
            <div class="pool-control-row pool-primary-actions" aria-label="Contribution controls">
              <button class="btn btn-primary pool-primary-action" id="pool-provider-worker-toggle" type="button" aria-pressed="false">Start sharing</button>
            </div>
          </div>
          <section class="pool-inspector-shell" data-pool-contribution-history hidden>
            <h2 class="type-h2">Recent receipts</h2>
            <div id="pool-provider-node-history" class="pool-ledger-shell" aria-live="polite">${renderRecentContributionHistory()}</div>
          </section>
          <details class="pool-advanced pool-provider-details" id="pool-provider-details">
            <summary>Advanced details</summary>
            <div class="pool-provider-detail-grid">
              ${renderParticipationControl({ surface: 'compute' })}
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
    `, { routeId: normalizedRouteId });
  }
  if (normalizedRouteId === 'records') {
    const recordFacet = getPoolRecordFacet();
    return renderRouteShell(copy, `
        <div class="pool-form pool-route-grid pool-record-layout" data-pool-receipts data-pool-reputation>
          <div id="pool-record-ledger" aria-live="polite" data-record-facet="${escapeHtml(recordFacet)}">${renderRecordLedger(recordFacet)}</div>
          <details class="pool-advanced pool-record-tools" data-pool-record-disclosure="technical-tools"${readRecordViewState().open['technical-tools'] ? ' open' : ''}>
            <summary>Advanced details</summary>
            <div class="pool-record-tool-grid">
              <section data-pool-room-activity>
                <h2 class="type-h2">Peer activity and retries</h2>
                <div id="pool-room-activity" class="pool-ledger-shell" aria-live="polite">${renderRoomActivity()}</div>
              </section>
              <section>
                <h2 class="type-h2">Peer identities</h2>
                <div id="pool-peer-ledger" class="pool-ledger-shell" aria-live="polite">${renderPeerLedgerState()}</div>
              </section>
              <section>
                <h2 class="type-h2">Saved answer receipts</h2>
                <div id="pool-receipt-ledger" class="pool-ledger-shell" aria-live="polite">${renderReceiptLedger()}</div>
              </section>
              <details class="pool-advanced pool-record-lookup" data-pool-record-disclosure="receipt-lookup"${readRecordViewState().open['receipt-lookup'] ? ' open' : ''}>
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
              <section class="pool-record-recovery">
                <h2 class="type-h2">Recovery</h2>
                <p>Submitted, interrupted, and failed jobs stay in the timeline. Open a job to inspect its valid retry, resume, cancel, or receipt actions.</p>
              </section>
            </div>
            <p class="type-caption pool-protocol-version" aria-label="protocol identifier">Protocol ${POOLDAY_VERSION_TAG}</p>
          </details>
        </div>
    `, { routeId: normalizedRouteId });
  }
  if (normalizedRouteId === 'room-1') {
    const roomPanel = getPoolRoomPanel();
    const secondaryWorkspaceOpen = roomPanel === 'review' || roomPanel === 'discovery';
    const contextualPanel = roomPanel === 'review'
      ? {
          title: 'Review evidence',
          body: 'Make a signed decision or attach a correction to the evidence shown above.',
          target: 'pool-room-review'
        }
      : roomPanel === 'discovery'
        ? {
            title: 'Discover the next action',
            body: 'Inspect compatible evidence and approve a bounded follow-up without promoting a proposal into memory.',
            target: 'pool-room-discovery'
          }
        : null;
    return renderRouteShell(copy, `
      <div class="pool-form pool-route-grid pool-room-1-layout" data-pool-receipts data-pool-reputation>
        <section id="pool-room-1-request" class="pool-room-1-request" data-pool-run data-pool-run-surface="run" data-run-state="idle" data-run-phase="">
          <h2 class="type-h2">Start a research question</h2>
          <label class="pool-field">
            <span>Public protein sequence</span>
            <textarea id="pool-run-prompt" rows="6">MAPLALLLLGLVAGA</textarea>
          </label>
          <label class="pool-field">
            <span>Model</span>
            <select id="pool-run-model">${renderModelOptions()}</select>
          </label>
          ${renderPackSummary(LAUNCH_MODEL)}
          <label class="pool-field">
            <span>Publication</span>
            ${renderRequesterConsentRows({ prefix: 'pool-run', rowElement: 'span' })}
            <small>Research publication is explicit and separate from ordinary model runs.</small>
          </label>
          ${renderRequesterIntentFields({ prefix: 'pool-run', textTag: 'textarea' })}
          <label class="pool-field">
            <span>Verification</span>
            <select id="pool-run-policy">${renderPolicyOptions()}</select>
          </label>
          <p class="pool-run-status" data-pool-run-status aria-live="polite">Ready</p>
          <div class="pool-control-row pool-primary-actions">
            <button class="btn btn-primary pool-primary-action" id="pool-run-submit" type="button">Run and publish</button>
          </div>
          <section class="pool-run-output" data-pool-run-output hidden>
            ${renderResultBox('pool-run-result', {
              stream: true,
              streamLabel: 'Result',
              evidence: true,
              evidenceLabel: 'Proof',
              proteinEmbedding: true,
              rawLabel: 'Raw result',
              rawFull: true
            })}
          </section>
        </section>
        ${renderActiveResearchRoom(normalizedRouteId)}
        ${contextualPanel ? `<section class="pool-room-contextual-panel" data-pool-room-contextual-panel="${escapeHtml(roomPanel)}"><h2 class="type-h2">${escapeHtml(contextualPanel.title)}</h2><p>${escapeHtml(contextualPanel.body)}</p><a class="btn btn-ghost" href="#${escapeHtml(contextualPanel.target)}">Open panel controls</a></section>` : ''}
        <section class="pool-room-secondary-workspace" data-pool-room-panel="research"${secondaryWorkspaceOpen ? ' data-pool-room-panel-open="true"' : ''}>
          <h2 class="type-h2">Research workspace</h2>
          <div id="pool-research-workspace-host">${renderResearchWorkspace(getPeerRoomId(), loadResearchRecords(getPeerRoomId()), { reviewTarget: getPoolReviewTarget() })}</div>
        </section>
      </div>
    `, { routeId: normalizedRouteId });
  }
  return '';
};
