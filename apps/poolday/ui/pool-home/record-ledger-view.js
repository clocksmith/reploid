/**
 * @fileoverview Room-scoped receipt, peer and activity ledgers and the records timeline:
 * persistence through record-persistence.js, disclosure state, rendering and refresh.
 */
import { escapeHtml } from '../../../../shared/ui/components/html.js';
import { getPeerRoomId, getPeerRelayMode } from '../../host/product-context.js';
import { createPeerEventReducer } from '../../pool/peer-control-plane.js';
import { getRouteId } from './shell-view.js';
import { POOLDAY_PEER_LEDGER_STORAGE_KEY, POOLDAY_RECEIPT_LEDGER_LIMIT } from './constants.js';
import { getContributionSnapshot } from './contribution-state.js';
import { getPoolLedgerStore } from './ledger-store.js';
import { createPoolRecordPersistence, getPeerEventHash, getPooldayRecordStorageKeys as buildPooldayRecordStorageKeys } from './record-persistence.js';
import { roomHref } from './room-view.js';
import { projectRoomRecordRows, receiptOccurredAt, recordTimeMs } from './room-record-projection.js';
import { applyPoolNetworkVisualState } from './run-visual-state.js';
import { refreshResearchRoomState } from './research-room-route.js';
import { setPoolHtml, compactHex, compactHash, firstPresent, safeJsonStringify } from './view-markup.js';

const ledgerStore = getPoolLedgerStore();

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
export const readRecordViewState = (roomId = getPeerRoomId()) => {
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

export const ensureReceiptLedgerLoaded = (roomId = getPeerRoomId()) => recordPersistence.ensureReceiptsLoaded(roomId);
const ensurePeerLedgerLoaded = (roomId = getPeerRoomId()) => recordPersistence.ensurePeerEventsLoaded(roomId);
const ensureRecordLedgersLoaded = (roomId = getPeerRoomId()) => recordPersistence.ensureLoaded(roomId);
const persistReceiptLedgerRows = (roomId = getPeerRoomId()) => recordPersistence.persistReceipts(roomId);
const persistPeerLedgerEvents = (roomId = getPeerRoomId()) => recordPersistence.persistPeerEvents(roomId);

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
    return '<p class="pool-caption pool-receipt-empty">No answers saved yet.</p>';
  }
  return `
    <div class="pool-ledger pool-table" role="table" aria-label="Saved answer receipts">
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
    return '<p class="pool-caption pool-receipt-empty">No local scores yet.</p>';
  }
  return `
    <div class="pool-ledger pool-table" role="group" aria-label="Local contributor scores">
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
    return '<p class="pool-caption pool-receipt-empty">This room is local to this browser profile. Use a server relay link to share across devices.</p>';
  }
  if (!summary) {
    return '<p class="pool-caption pool-receipt-empty">Checking room activity...</p>';
  }
  if (summary.error) {
    return `<p class="pool-caption pool-receipt-empty">Room activity unavailable: ${escapeHtml(summary.error)}</p>`;
  }
  const recent = Array.isArray(summary.recent) ? summary.recent : [];
  return `
    <div class="pool-ledger pool-table" role="table" aria-label="Shared room activity">
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
    <p class="pool-caption pool-room-recent">
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
  return `<button type="button" class="pool-lane-chip pool-button btn-ghost pool-record-facet-chip${active}"
    data-pool-record-facet="${escapeHtml(facet.id)}" aria-pressed="${facet.id === facetId ? 'true' : 'false'}">${escapeHtml(facet.label)} (${count})</button>`;
}).join('');

export const renderRecordLedger = (facetId = getPoolRecordFacet()) => {
  const rows = unifiedRecordRows();
  if (!rows.length) {
    return '<p class="pool-record-empty pool-muted pool-edge-top">No records yet. Requests, completed runs, and contributions will appear here.</p>';
  }
  const visible = facetId === 'all' ? rows : rows.filter((row) => row.type === facetId);
  const chips = `<div class="pool-record-facets" role="group" aria-label="Record types">${renderRecordFacetChips(rows, facetId)}</div>`;
  if (!visible.length) {
    return `${chips}<p class="pool-record-empty pool-muted pool-edge-top">No records of this type yet.</p>`;
  }
  return `
    ${chips}
    <ol class="pool-record-timeline pool-list pool-edge-top" aria-label="Reploid records">
      ${visible.map((row) => `
        <li data-record-type="${escapeHtml(row.type)}">
          <details class="pool-record-event pool-small" data-pool-record-disclosure="record:${escapeHtml(row.id)}"${readRecordViewState().open[`record:${row.id}`] ? ' open' : ''}>
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
    return '<p class="pool-record-empty pool-muted pool-edge-top">No recent work. Requests, contributions, and room events appear here.</p>';
  }
  return `
    <ol class="pool-record-timeline pool-list pool-edge-top pool-record-timeline-compact pool-caption" aria-label="Recent network activity">
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
    <a class="link-secondary pool-drawer-link pool-small" href="${escapeHtml(roomHref('/records', getPeerRoomId()))}" data-pool-route-link="${escapeHtml(roomHref('/records', getPeerRoomId()))}">View all records</a>
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

let disposeRecordStorageSync;

export const bindRecordStorageSync = () => {
  if (typeof window === 'undefined') return () => {};
  disposeRecordStorageSync?.();
  const listener = (event) => {
    const keys = getPooldayRecordStorageKeys();
    if (
      event.key !== keys.receipts &&
      event.key !== keys.peerLedger &&
      event.key !== POOLDAY_PEER_LEDGER_STORAGE_KEY
    ) {
      return;
    }
    refreshRecordLedgerState({ reload: true });
  };
  window.addEventListener('storage', listener);
  const dispose = () => {
    window.removeEventListener('storage', listener);
    if (disposeRecordStorageSync === dispose) disposeRecordStorageSync = null;
  };
  disposeRecordStorageSync = dispose;
  return dispose;
};
