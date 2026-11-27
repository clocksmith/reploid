/**
 * The Records page ("Recent jobs", also /history) without markup: the unified timeline of requests, answers,
 * contributions and room events with its type facets, the remembered disclosures, shared-room activity, local
 * contributor scores, saved answer receipts and the receipt lookup. The same records and wording the vanilla page
 * rendered (ui/pool-home/record-ledger-view.js, record-controls.js, room-activity-controls.js), as one snapshot
 * and commands. Ledgers stay in this browser's storage per room; nothing here publishes anything.
 */
import { verifyReceiptRecord, createPoolSdk } from '../../../../shared/pool/sdk.js';
import { getPeerRoomId, getPeerRelayMode } from '../product-context.js';
import { createPeerEventReducer } from '../../pool/peer-control-plane.js';
import { POOLDAY_PEER_LEDGER_STORAGE_KEY, POOLDAY_VERSION_TAG, ROUTE_COPY } from '../../ui/pool-home/constants.js';
import { getContributionSnapshot, subscribeContributionState } from '../../ui/pool-home/contribution-state.js';
import { getPoolLedgerStore } from '../../ui/pool-home/ledger-store.js';
import { createPoolRecordPersistence, getPooldayRecordStorageKeys } from '../../ui/pool-home/record-persistence.js';
import { projectRoomRecordRows, recordTimeMs } from '../../ui/pool-home/room-record-projection.js';
import { compactHash, compactHex, safeJsonStringify } from '../../ui/pool-home/view-markup.js';
import { errorString } from '../../ui/pool-home/control-display-text.js';

export const RECORD_FACETS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'request', label: 'Requests' },
  { id: 'answer', label: 'Answers' },
  { id: 'contribution', label: 'Contributions' },
  { id: 'room', label: 'Network' }
]);
const FACET_IDS = RECORD_FACETS.map(facet => facet.id);
const VIEW_KEY = 'reploid.pool.record-view.v1';
const ROOM_ACTIVITY_POLL_MS = 5000;

const formatRecordTime = (value) => {
  const parsed = recordTimeMs(value);
  if (!parsed) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(parsed));
};

/** The open disclosures and the chosen facet, remembered per room as the vanilla page remembered them. */
function createViewState(storage, getRoomId) {
  const key = () => `${VIEW_KEY}::${encodeURIComponent(getRoomId())}`;
  const read = () => {
    try {
      const parsed = JSON.parse(storage?.getItem(key()) || '{}');
      return { facet: FACET_IDS.includes(parsed?.facet) ? parsed.facet : 'all', open: parsed?.open && typeof parsed.open === 'object' ? parsed.open : {} };
    } catch { return { facet: 'all', open: {} }; }
  };
  const write = (state) => { try { storage?.setItem(key(), JSON.stringify(state)); } catch { /* optional */ } };
  return { read, write };
}

/** The room's activity as the vanilla table states it: local, checking, unavailable, or its counts. */
export function projectRoomActivity(summary, relayMode) {
  if (relayMode === 'local') return { state: 'local', text: 'This room is local to this browser profile. Use a server relay link to share across devices.' };
  if (!summary) return { state: 'checking', text: 'Checking room activity...' };
  if (summary.error) return { state: 'error', text: `Room activity unavailable: ${summary.error}` };
  const recent = Array.isArray(summary.recent) ? summary.recent : [];
  return {
    state: 'ready',
    row: [String(summary.relay || relayMode), String(summary.messageCount ?? 0), String(summary.peerCount ?? 0), String(summary.providerCount ?? 0)],
    recent: recent.length ? recent.map(entry => `${entry.type}:${compactHash(entry.fromPeerId || 'unknown')}`).join(' / ') : 'No shared-room messages yet.'
  };
}

/** Local contributor scores from this room's peer events. */
export function projectPeerScores(peerEvents) {
  const reduced = createPeerEventReducer().reduce(peerEvents);
  const points = Object.entries(reduced.points || {}).sort(([a], [b]) => a.localeCompare(b));
  const reputations = Object.values(reduced.reputation || {}).sort((a, b) => String(a.providerId).localeCompare(String(b.providerId)));
  const rows = points.map(([peerId, value]) => {
    const reputation = reduced.reputation?.[peerId] || {};
    return [compactHash(peerId), String(value), String(reputation.acceptedReceipts ?? 0), String(reputation.rejectedReceipts ?? 0)];
  });
  for (const row of reputations) {
    if (Object.prototype.hasOwnProperty.call(reduced.points || {}, row.providerId)) continue;
    rows.push([compactHash(row.providerId), String(row.points ?? 0), String(row.acceptedReceipts ?? 0), String(row.rejectedReceipts ?? 0)]);
  }
  return rows;
}

export function createRecordsModel({
  storage = (() => { try { return globalThis.localStorage || null; } catch { return null; } })(),
  getRoomId = () => getPeerRoomId(),
  relayMode = () => getPeerRelayMode(),
  roomSummary = roomId => createPoolSdk({ authTokenProvider: null }).peerRoomSummary(roomId, { limit: 100 }),
  verifyReceipt = verifyReceiptRecord,
  documents = null,
  eventTarget = globalThis,
  poll = true
} = {}) {
  const ledgerStore = getPoolLedgerStore();
  const persistence = createPoolRecordPersistence({ ledgerStore, getRoomId, getStorage: () => storage });
  const view = createViewState(storage, getRoomId);
  const listeners = new Set();
  let disposed = false, lookup = { hash: '', pending: false, result: null }, snapshot = null;
  const notify = () => { if (disposed) return; snapshot = null; for (const listener of listeners) listener(); };

  const project = () => {
    const roomId = getRoomId();
    persistence.ensureLoaded(roomId);
    const state = view.read();
    const rows = projectRoomRecordRows({ receipts: ledgerStore.receipts, contributions: getContributionSnapshot().recent || [],
      peerEvents: ledgerStore.peerEvents, roomActivitySummary: ledgerStore.roomActivitySummary });
    const visible = state.facet === 'all' ? rows : rows.filter(row => row.type === state.facet);
    const history = documents?.getState?.().history || [];
    return Object.freeze({
      roomId,
      title: ROUTE_COPY.records.title,
      body: ROUTE_COPY.records.body,
      facet: state.facet,
      facets: RECORD_FACETS.map(facet => ({ ...facet, count: facet.id === 'all' ? rows.length : rows.filter(row => row.type === facet.id).length })),
      hasRecords: rows.length > 0,
      records: visible.map(row => ({ id: row.id, type: row.type, time: formatRecordTime(row.occurredAt), iso: row.occurredAt || '',
        title: row.title, meta: row.meta || 'Recorded', detail: safeJsonStringify(row.detail) || '', open: state.open[`record:${row.id}`] === true })),
      open: state.open,
      roomActivity: projectRoomActivity(ledgerStore.roomActivitySummary, relayMode()),
      peerScores: projectPeerScores(ledgerStore.peerEvents),
      receipts: ledgerStore.receipts.map(row => [compactHex(row.jobId), compactHash(row.provider), String(row.fidelity), String(row.speed)]),
      lookup: { ...lookup },
      documentHistory: history.map(entry => ({ summary: `${entry.startedAt} · ${entry.status}`, detail: JSON.stringify(entry, null, 2) })),
      protocol: `Protocol ${POOLDAY_VERSION_TAG}`
    });
  };

  const refreshActivity = async () => {
    if (disposed) return;
    if (relayMode() === 'local') { ledgerStore.roomActivitySummary = null; notify(); return; }
    try { ledgerStore.roomActivitySummary = await roomSummary(getRoomId()); }
    catch (error) { ledgerStore.roomActivitySummary = { error: errorString(error) }; }
    notify();
  };
  // Another tab of this profile writes the same ledgers; their change shows here as it did on the vanilla page.
  const onStorage = (event) => {
    const keys = getPooldayRecordStorageKeys(getRoomId());
    if (![keys.receipts, keys.peerLedger, POOLDAY_PEER_LEDGER_STORAGE_KEY].includes(event.key)) return;
    ledgerStore.receiptRoom = null; ledgerStore.peerRoom = null;
    notify();
  };
  eventTarget?.addEventListener?.('storage', onStorage);
  const unsubscribeContributions = subscribeContributionState(notify);
  const unsubscribeDocuments = documents?.subscribe?.(notify) || (() => {});
  let timer = null;
  if (poll) {
    void refreshActivity();
    timer = setInterval(() => { if (globalThis.document?.visibilityState !== 'hidden') void refreshActivity(); }, ROOM_ACTIVITY_POLL_MS);
  }

  return {
    getSnapshot: () => (snapshot ??= project()),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setFacet(facet) { const state = view.read(); state.facet = FACET_IDS.includes(facet) ? facet : 'all'; view.write(state); notify(); },
    setDisclosure(id, open) {
      const key = String(id || '').trim();
      if (!key) return;
      const state = view.read(); state.open[key] = Boolean(open); view.write(state); notify();
    },
    setLookupHash(hash) { lookup = { ...lookup, hash }; notify(); },
    /** Finds a saved answer receipt in this room's ledger and verifies it locally. */
    async lookupReceipt() {
      const receiptHash = lookup.hash.trim();
      if (!receiptHash) { lookup = { ...lookup, result: { error: 'Hash is required' } }; notify(); return; }
      lookup = { ...lookup, pending: true }; notify();
      try {
        persistence.ensureReceiptsLoaded(getRoomId());
        const record = ledgerStore.receipts.find(row => row.receiptHash === receiptHash)?.record || null;
        lookup = { ...lookup, result: record
          ? { ...record, localVerification: record.receipt ? await verifyReceipt(record) : null }
          : { status: 'not_found', receiptHash, action: 'Submit a local peer-room job first, then inspect Records from this browser.' } };
      } catch (error) {
        lookup = { ...lookup, result: { error: error.message, payload: error.payload || null } };
      } finally { lookup = { ...lookup, pending: false }; notify(); }
    },
    resultText: result => safeJsonStringify(result) || '',
    refreshActivity,
    dispose() {
      disposed = true; listeners.clear(); if (timer) clearInterval(timer);
      eventTarget?.removeEventListener?.('storage', onStorage); unsubscribeContributions(); unsubscribeDocuments();
    }
  };
}
