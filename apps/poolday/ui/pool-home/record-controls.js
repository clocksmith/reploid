/**
 * @fileoverview Records route controls: record type facets, remembered disclosures and receipt
 * lookup with verification.
 */
import { verifyReceiptRecord } from '../../../../shared/pool/sdk.js';
import {
  findReceiptLedgerRecord,
  refreshRecordTimelineState,
  restorePoolRecordDisclosures,
  renderReceiptLedger,
  setPoolRecordDisclosureOpen,
  setPoolRecordFacet,
  setResult
} from './view.js';
import { refreshServerRoomActivity } from './room-activity-controls.js';

export const bindRecordFacetControls = () => {
  const ledger = document.getElementById('pool-record-ledger');
  if (!ledger || ledger.dataset.poolFacetBound === 'true') return;
  ledger.dataset.poolFacetBound = 'true';
  ledger.addEventListener('click', (event) => {
    const chip = event.target.closest?.('[data-pool-record-facet]');
    if (!chip) return;
    ledger.dataset.recordFacet = setPoolRecordFacet(chip.dataset.poolRecordFacet || 'all');
    refreshRecordTimelineState();
  });
};

const bindRecordDisclosureControls = () => {
  const layout = document.querySelector('.pool-record-layout');
  if (!layout || layout.dataset.poolRecordDisclosureBound === 'true') return;
  layout.dataset.poolRecordDisclosureBound = 'true';
  restorePoolRecordDisclosures(layout);
  layout.addEventListener('toggle', (event) => {
    const details = event.target;
    const disclosureId = details?.dataset?.poolRecordDisclosure;
    if (!disclosureId) return;
    setPoolRecordDisclosureOpen(disclosureId, details.open);
  }, true);
};

export const bindReceiptControls = () => {
  bindRecordFacetControls();
  bindRecordDisclosureControls();
  const button = document.getElementById('pool-receipt-lookup');
  const input = document.getElementById('pool-receipt-hash');
  if (!button || !input) return;
  const ledgerContainer = document.getElementById('pool-receipt-ledger');
  if (ledgerContainer) {
    ledgerContainer.innerHTML = renderReceiptLedger();
  }
  void refreshServerRoomActivity();
  button.addEventListener('click', async () => {
    const receiptHash = input.value.trim();
    if (!receiptHash) {
      setResult('pool-receipt-result', { error: 'Hash is required' });
      return;
    }
    button.disabled = true;
    try {
      const record = findReceiptLedgerRecord(receiptHash);
      if (!record) {
        setResult('pool-receipt-result', {
          status: 'not_found',
          receiptHash,
          action: 'Submit a local peer-room job first, then inspect Records from this browser.'
        });
        return;
      }
      setResult('pool-receipt-result', {
        ...record,
        localVerification: record.receipt ? await verifyReceiptRecord(record) : null
      });
    } catch (error) {
      setResult('pool-receipt-result', { error: error.message, payload: error.payload || null });
    } finally {
      button.disabled = false;
    }
  });
};
