/**
 * @fileoverview Room-scoped persistence adapter for Poolday UI records.
 */

import { DEFAULT_PEER_ROOM_ID } from '../../pool/peer-room.js';
import {
  POOLDAY_PEER_LEDGER_STORAGE_KEY,
  POOLDAY_RECEIPT_LEDGER_LIMIT,
  POOLDAY_RECEIPT_LEDGER_STORAGE_KEY
} from './constants.js';

const encodeRoom = (roomId) => encodeURIComponent(String(roomId || DEFAULT_PEER_ROOM_ID));

export const getPooldayRecordStorageKeys = (roomId = DEFAULT_PEER_ROOM_ID) => ({
  receipts: `${POOLDAY_RECEIPT_LEDGER_STORAGE_KEY}::${encodeRoom(roomId)}`,
  peerLedger: `${POOLDAY_PEER_LEDGER_STORAGE_KEY}::${encodeRoom(roomId)}`,
  draft: `reploid.pool.room-draft.v1::${encodeRoom(roomId)}`
});

export const getPeerEventHash = (event = {}) => (
  event?.messageHash || `${event?.type || 'event'}:${event?.body?.agreementHash || ''}:${event?.body?.receiptHash || ''}:${event?.body?.userId || event?.body?.providerId || ''}`
);

export function createPoolRecordPersistence({
  ledgerStore,
  getRoomId,
  getStorage = () => {
    try {
      return globalThis.localStorage || null;
    } catch {
      return null;
    }
  }
}) {
  if (!ledgerStore) throw new TypeError('ledgerStore is required');
  if (typeof getRoomId !== 'function') throw new TypeError('getRoomId is required');

  const readArray = (key) => {
    try {
      const value = getStorage()?.getItem(key);
      const parsed = value ? JSON.parse(value) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const writeArray = (key, value) => {
    try {
      getStorage()?.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be unavailable in hardened browser contexts.
    }
  };

  const readDraft = (roomId = getRoomId()) => {
    try {
      const value = getStorage()?.getItem(getPooldayRecordStorageKeys(roomId).draft);
      const parsed = value ? JSON.parse(value) : null;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const writeDraft = (roomId, draft) => {
    try {
      const key = getPooldayRecordStorageKeys(roomId).draft;
      if (!draft || typeof draft !== 'object') {
        getStorage()?.removeItem(key);
        return;
      }
      getStorage()?.setItem(key, JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }));
    } catch {
      // Draft recovery remains optional when browser storage is unavailable.
    }
  };

  const replaceContents = (target, values = []) => {
    target.splice(0, target.length, ...values);
  };

  const reloadPeerEventHashes = () => {
    ledgerStore.peerEventHashes.clear();
    for (const event of ledgerStore.peerEvents) {
      const eventHash = getPeerEventHash(event);
      if (eventHash) ledgerStore.peerEventHashes.add(eventHash);
    }
  };

  const loadReceiptRows = (roomId = getRoomId()) => (
    readArray(getPooldayRecordStorageKeys(roomId).receipts).slice(0, POOLDAY_RECEIPT_LEDGER_LIMIT)
  );

  const loadPeerEvents = (roomId = getRoomId()) => {
    const keys = getPooldayRecordStorageKeys(roomId);
    const scopedEvents = readArray(keys.peerLedger);
    if (scopedEvents.length > 0 || roomId !== DEFAULT_PEER_ROOM_ID) return scopedEvents;
    const legacyEvents = readArray(POOLDAY_PEER_LEDGER_STORAGE_KEY);
    if (legacyEvents.length > 0) writeArray(keys.peerLedger, legacyEvents.slice(-100));
    return legacyEvents;
  };

  return Object.freeze({
    getStorageKeys: (roomId = getRoomId()) => getPooldayRecordStorageKeys(roomId),
    loadDraft(roomId = getRoomId()) {
      return readDraft(roomId);
    },
    persistDraft(draft, roomId = getRoomId()) {
      writeDraft(roomId, draft);
    },
    clearDraft(roomId = getRoomId()) {
      writeDraft(roomId, null);
    },
    ensureReceiptsLoaded(roomId = getRoomId()) {
      if (ledgerStore.receiptRoom === roomId) return;
      ledgerStore.receiptRoom = roomId;
      replaceContents(ledgerStore.receipts, loadReceiptRows(roomId));
    },
    ensurePeerEventsLoaded(roomId = getRoomId()) {
      if (ledgerStore.peerRoom === roomId) return;
      ledgerStore.peerRoom = roomId;
      replaceContents(ledgerStore.peerEvents, loadPeerEvents(roomId));
      reloadPeerEventHashes();
    },
    ensureLoaded(roomId = getRoomId()) {
      this.ensureReceiptsLoaded(roomId);
      this.ensurePeerEventsLoaded(roomId);
    },
    persistReceipts(roomId = getRoomId()) {
      writeArray(
        getPooldayRecordStorageKeys(roomId).receipts,
        ledgerStore.receipts.slice(0, POOLDAY_RECEIPT_LEDGER_LIMIT)
      );
    },
    persistPeerEvents(roomId = getRoomId()) {
      writeArray(
        getPooldayRecordStorageKeys(roomId).peerLedger,
        ledgerStore.peerEvents.slice(-100)
      );
    }
  });
}
