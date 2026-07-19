/**
 * @fileoverview Room-scoped mutable ledger state for the pool home UI.
 * One store instance owns the receipt ledger, peer event ledger, stream
 * animation state, and room activity summary that the view renders from.
 * Collections keep a stable identity; reset clears them in place so
 * existing references stay valid.
 */

export const createPoolLedgerStore = () => ({
  streams: new Map(),
  receipts: [],
  peerEvents: [],
  peerEventHashes: new Set(),
  receiptRoom: null,
  peerRoom: null,
  roomActivitySummary: null
});

const activeStore = createPoolLedgerStore();

export const getPoolLedgerStore = () => activeStore;

export const resetPoolLedgerStore = () => {
  activeStore.streams.clear();
  activeStore.receipts.length = 0;
  activeStore.peerEvents.length = 0;
  activeStore.peerEventHashes.clear();
  activeStore.receiptRoom = null;
  activeStore.peerRoom = null;
  activeStore.roomActivitySummary = null;
  return activeStore;
};

export default {
  createPoolLedgerStore,
  getPoolLedgerStore,
  resetPoolLedgerStore
};
