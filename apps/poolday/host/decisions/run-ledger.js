/**
 * The room's saved answers and peer events, written as the vanilla record ledger wrote them
 * (ui/pool-home/record-ledger-view.js addReceiptLedgerRow and recordPeerLedgerEvents), without the
 * page refreshes: one store and one persistence per room, so Records and Room-1 read what Ask and
 * Compute saved.
 */
import { getPeerRoomId } from '../product-context.js';
import { POOLDAY_RECEIPT_LEDGER_LIMIT } from '../../ui/pool-home/constants.js';
import { getPoolLedgerStore } from '../../ui/pool-home/ledger-store.js';
import { createPoolRecordPersistence, getPeerEventHash } from '../../ui/pool-home/record-persistence.js';
import { receiptOccurredAt } from '../../ui/pool-home/room-record-projection.js';
import { firstPresent } from '../../ui/pool-home/view-markup.js';

const ledgerStore = getPoolLedgerStore();
const persistence = createPoolRecordPersistence({ ledgerStore, getRoomId: () => getPeerRoomId() });

const normalizeReceiptFidelity = value => {
  if (typeof value === 'number' && !Number.isFinite(value)) return '—';
  if (typeof value === 'string' && value.length > 0) return value;
  if (value && typeof value === 'object') {
    if (value.accepted === true) return 'accepted';
    if (value.accepted === false) return 'rejected';
    if (value.status) return String(value.status);
  }
  return 'pending';
};

const normalizeReceiptSpeed = value => {
  const candidate = firstPresent(value?.tokensPerSecond, value?.throughput, value?.runtime?.tokensPerSecond,
    value?.stats?.throughput, value?.performance?.tokensPerSecond);
  if (candidate === undefined || candidate === null || candidate === '') return '—';
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? `${parsed.toFixed(2)} t/s` : String(candidate);
};

/** Saves one answer's receipt for this room, newest first, bounded as the vanilla ledger was. */
export function addReceiptLedgerRow(record = {}, receiptHash = '') {
  persistence.ensureReceiptsLoaded(getPeerRoomId());
  const jobId = firstPresent(record?.job?.jobId, record?.jobId, record?.receipt?.jobId, receiptHash);
  const provider = firstPresent(record?.providerId, record?.providerIdHash, record?.assignment?.providerId, record?.receipt?.providerId,
    record?.receipt?.provider?.id, record?.provider?.id, typeof record?.provider === 'string' ? record.provider : null);
  const fidelity = normalizeReceiptFidelity(record?.verifierDecision || record?.verification || record?.requesterAcceptance || record?.peerDecision || record?.agreement);
  const rowReceiptHash = String(receiptHash || record?.receiptHash || record?.receipt?.receiptHash || '—');
  const existing = ledgerStore.receipts.findIndex(row => row.receiptHash === rowReceiptHash);
  if (existing >= 0) ledgerStore.receipts.splice(existing, 1);
  ledgerStore.receipts.unshift({ jobId: String(jobId || '—'), provider: String(provider || '—'), fidelity, speed: normalizeReceiptSpeed(record),
    receiptHash: rowReceiptHash, occurredAt: receiptOccurredAt(record), record });
  while (ledgerStore.receipts.length > POOLDAY_RECEIPT_LEDGER_LIMIT) ledgerStore.receipts.pop();
  persistence.persistReceipts(getPeerRoomId());
}

/** Records peer events once each, by their hash. */
export function recordPeerLedgerEvents(events = []) {
  if (!Array.isArray(events) || events.length === 0) return;
  persistence.ensurePeerEventsLoaded(getPeerRoomId());
  let changed = false;
  for (const event of events) {
    const hash = getPeerEventHash(event);
    if (ledgerStore.peerEventHashes.has(hash)) continue;
    ledgerStore.peerEventHashes.add(hash);
    ledgerStore.peerEvents.push(event);
    changed = true;
  }
  if (changed) persistence.persistPeerEvents(getPeerRoomId());
}

/** The newest answer this room accepted (or ran and verified on this device), for "Showing last saved answer". */
export function latestAcceptedReceipt() {
  persistence.ensureReceiptsLoaded(getPeerRoomId());
  return ledgerStore.receipts.find(candidate => candidate?.record?.agreement?.accepted === true
    || candidate?.record?.requesterAcceptance?.accepted === true
    || (candidate?.record?.transport === 'local_capsule' && candidate.record.status === 'completed'
      && candidate.receiptHash === candidate.record.localExecution?.receipt?.receiptDigest)) ?? null;
}
