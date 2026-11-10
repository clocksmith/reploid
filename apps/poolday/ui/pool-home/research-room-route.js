/**
 * @fileoverview Research Room-1 route state: the open room panel and review target from the
 * URL, and the room rendered from local research, receipt and peer ledgers.
 */
import { getPeerRoomId } from '../../host/product-context.js';
import { normalizeProductPath, getRouteId } from './shell-view.js';
import { getPoolLedgerStore } from './ledger-store.js';
import { getCrossRoomSequenceEvidence, getProteinUncertaintyCampaignQueue, getResearchSyncState, loadQuarantinedResearchRecords, loadResearchRecords } from './research-store.js';
import { renderResearchRoom } from './room-view.js';

const ledgerStore = getPoolLedgerStore();

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
