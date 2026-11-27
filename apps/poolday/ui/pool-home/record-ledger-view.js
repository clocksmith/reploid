
import { getPeerRoomId } from '../../host/product-context.js';
import { POOLDAY_RECEIPT_LEDGER_LIMIT } from './constants.js';
import { getPoolLedgerStore } from './ledger-store.js';
import { createPoolRecordPersistence, getPeerEventHash } from './record-persistence.js';
import { receiptOccurredAt } from './room-record-projection.js';
import { firstPresent } from './view-markup.js';

const ledgerStore = getPoolLedgerStore();

const recordPersistence = createPoolRecordPersistence({
  ledgerStore,
  getRoomId: () => getPeerRoomId()
});

export const ensureReceiptLedgerLoaded = (roomId = getPeerRoomId()) => recordPersistence.ensureReceiptsLoaded(roomId);
const ensurePeerLedgerLoaded = (roomId = getPeerRoomId()) => recordPersistence.ensurePeerEventsLoaded(roomId);
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

// The Room page re-reads the ledger store itself; a ledger change needs no page refresh here.
const refreshRoomAfterLedgerMutation = () => {};

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
