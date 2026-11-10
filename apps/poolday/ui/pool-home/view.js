/**
 * @fileoverview Stable entry for the Poolday product home's routes and UI state.
 * Each responsibility lives in its own module in this folder; this entry selects a
 * route's panel and keeps the public exports in one place.
 */
import { getPeerRoomId, getPeerRelayMode, getPeerRelayLabel, getPeerRoomBusFactory } from '../../host/product-context.js';
import { createPeerRoomInviteUrl } from '../../pool/peer-rendezvous.js';
import { renderNetworkSurface, renderImproveSurface } from './work.js';
import { renderConversationWorkspace } from './conversation-workspace.js';
import { renderProductionSurface } from './production.js';
import { renderHomeSimulation } from './examples-view.js';

export { getPeerRoomId, getPeerRelayMode, getPeerRelayLabel, getPeerRoomBusFactory };
export { getRouteId, isProductPath, renderNav, updateChangesControl } from './shell-view.js';
export { resolvePoolNetworkVisualState } from './network-projection.js';
export { renderConversationWorkspace };
export { getPeerDiscoveryWindowMs, getPeerReceiptWindowMs, getPeerQueueWindowMs, getPeerSessionAcceptWindowMs,
  getPeerTransportConnectWindowMs, getPeerGenerationConfig } from '../../host/peer-execution-config.js';

export {
  getPooldayRecordStorageKeys, loadPoolRoomDraft, persistPoolRoomDraft, clearPoolRoomDraft,
  getPoolRecordFacet, setPoolRecordFacet, setPoolRecordDisclosureOpen, restorePoolRecordDisclosures,
  addReceiptLedgerRow, findReceiptLedgerRecord, renderReceiptLedger, refreshReceiptLedgerState,
  recordPeerLedgerEvents, renderPeerLedgerState, refreshPeerLedgerState, renderRoomActivity,
  renderRecordLedger, refreshRecordTimelineState, refreshRoomActivityState, refreshRecordLedgerState,
  bindRecordStorageSync
} from './record-ledger-view.js';
export { applyPoolNetworkVisualState, setPoolRunVisualState } from './run-visual-state.js';
export { updateProviderStatus, updateProviderNotice, updateProviderHealth, refreshProviderStorageHealth } from './provider-status-view.js';
export { isEmbeddingPublicationPermitted } from './run-result-format.js';
export { setResearchPublicationStatus, setResult, restoreLatestCompletedRun } from './run-result-view.js';
export { getPoolRoomPanel, getPoolReviewTarget, renderActiveResearchRoom, refreshResearchRoomState } from './research-room-route.js';
export {
  renderComputeNodeStats, renderRecentContributionHistory, shouldRenderContributionStatusBar,
  refreshContributionPanels, renderContributionStatusBar, refreshContributionStatusBar
} from './contribution-status-view.js';
export { describeSelectedRun } from './route-controls.js';
export { POOL_DASHBOARD_VIEWS, normalizePoolDashboardView, getPoolDashboardView } from './examples-view.js';
export { renderRouteDetail } from './route-detail-view.js';

export const getPeerInviteUrl = () => createPeerRoomInviteUrl({
  roomId: getPeerRoomId(),
  relay: getPeerRelayMode(),
  baseUrl: window.location.href
});

export const renderRoutePanel = (routeId, options = {}) => {
  if (routeId === 'home') return renderProductionSurface();
  if (routeId === 'network') return renderNetworkSurface();
  if (routeId === 'improve') return renderImproveSurface();
  if (routeId === 'examples') return renderHomeSimulation(options);
  return '';
};
