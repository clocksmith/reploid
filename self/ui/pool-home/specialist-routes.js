import { bindRecordStorageSync, getPoolDashboardView, getPeerRoomId, refreshContributionPanels, refreshContributionStatusBar, refreshRecordLedgerState, refreshResearchRoomState, restoreLatestCompletedRun, renderRouteDetail, renderRoutePanel, loadPoolRoomDraft, persistPoolRoomDraft } from './view.js';
import { getRouteId } from './shell-view.js';
import { applyPoolDashboardView, bindCapabilityAssessmentControls, bindEmbeddingResultControls, bindHomeAskControls, bindParticipationControls, bindPoolDashboardControls, bindProviderControls, bindReceiptControls, bindRoomActivityControls, bindRunControls } from './controls.js';
import { bindDocumentSearch, refreshDocumentSearch, renderLocalDocumentHistory } from './document-search.js';
import { bindResearchRoomActions, bindResearchWorkspace, hydrateAndBindResearchWorkspace } from './research-view.js';
import { resetResearchStore } from './research-store.js';
import { resetPoolLedgerStore } from './ledger-store.js';
import { bindPoolPrism } from './prism.js';
import { subscribeContributionState } from './contribution-state.js';

const roomDraftFields = (root) => ({
  sequence: root.querySelector('#pool-home-ask-prompt, #pool-run-prompt')?.value || '',
  intentKind: root.querySelector('#pool-home-intent-kind, #pool-run-intent-kind')?.value || 'question',
  intentLabel: root.querySelector('#pool-home-intent-label, #pool-run-intent-label')?.value || '',
  intentText: root.querySelector('#pool-home-intent-text, #pool-run-intent-text')?.value || '',
  intentConditions: root.querySelector('#pool-home-intent-conditions, #pool-run-intent-conditions')?.value || '',
  intentObservation: root.querySelector('#pool-home-intent-observation, #pool-run-intent-observation')?.value || '',
  intentDecision: root.querySelector('#pool-home-intent-decision, #pool-run-intent-decision')?.value || '',
  intentScope: root.querySelector('#pool-home-intent-scope, #pool-run-intent-scope')?.value || '',
  intentExclusions: root.querySelector('#pool-home-intent-exclusions, #pool-run-intent-exclusions')?.value || '',
  intentUnknowns: root.querySelector('#pool-home-intent-unknowns, #pool-run-intent-unknowns')?.value || '',
  sequencePublic: Boolean(root.querySelector('#pool-home-sequence-public, #pool-run-sequence-public')?.checked),
  researchPublic: Boolean(root.querySelector('#pool-home-research-public, #pool-run-research-public')?.checked)
});

const restoreRoomDraft = (root) => {
  const draft = loadPoolRoomDraft();
  if (!draft) return;
  const setValue = (selector, value) => {
    root.querySelectorAll(selector).forEach((field) => {
      if (value !== undefined) field.value = value;
    });
  };
  const setChecked = (selector, value) => {
    root.querySelectorAll(selector).forEach((field) => {
      if (value !== undefined) field.checked = value === true;
    });
  };
  setValue('#pool-home-ask-prompt, #pool-run-prompt', draft.sequence);
  setValue('#pool-home-intent-kind, #pool-run-intent-kind', draft.intentKind);
  setValue('#pool-home-intent-label, #pool-run-intent-label', draft.intentLabel);
  setValue('#pool-home-intent-text, #pool-run-intent-text', draft.intentText);
  setValue('#pool-home-intent-conditions, #pool-run-intent-conditions', draft.intentConditions);
  setValue('#pool-home-intent-observation, #pool-run-intent-observation', draft.intentObservation);
  setValue('#pool-home-intent-decision, #pool-run-intent-decision', draft.intentDecision);
  setValue('#pool-home-intent-scope, #pool-run-intent-scope', draft.intentScope);
  setValue('#pool-home-intent-exclusions, #pool-run-intent-exclusions', draft.intentExclusions);
  setValue('#pool-home-intent-unknowns, #pool-run-intent-unknowns', draft.intentUnknowns);
  setChecked('#pool-home-sequence-public, #pool-run-sequence-public', draft.sequencePublic);
  setChecked('#pool-home-research-public, #pool-run-research-public', draft.researchPublic);
};

const bindRoomDraft = (root) => {
  const controls = root.querySelectorAll('#pool-home-ask-prompt, #pool-run-prompt, #pool-home-intent-kind, #pool-run-intent-kind, #pool-home-intent-label, #pool-run-intent-label, #pool-home-intent-text, #pool-run-intent-text, #pool-home-intent-conditions, #pool-run-intent-conditions, #pool-home-intent-observation, #pool-run-intent-observation, #pool-home-intent-decision, #pool-run-intent-decision, #pool-home-intent-scope, #pool-run-intent-scope, #pool-home-intent-exclusions, #pool-run-intent-exclusions, #pool-home-intent-unknowns, #pool-run-intent-unknowns, #pool-home-sequence-public, #pool-run-sequence-public, #pool-home-research-public, #pool-run-research-public');
  if (!controls.length) return;
  const persist = () => persistPoolRoomDraft(roomDraftFields(root));
  controls.forEach((control) => {
    control.addEventListener('input', persist);
    control.addEventListener('change', persist);
  });
};

const bindResearchStoreSync = () => {
  if (window.REPLOID_POOL_RESEARCH_UPDATE_HANDLER) {
    window.removeEventListener('reploid:pool-research-update', window.REPLOID_POOL_RESEARCH_UPDATE_HANDLER);
  }
  window.REPLOID_POOL_RESEARCH_UPDATE_HANDLER = (event) => {
    if (event.detail?.roomId !== getPeerRoomId()) return;
    refreshResearchRoomState(getRouteId());
  };
  window.addEventListener('reploid:pool-research-update', window.REPLOID_POOL_RESEARCH_UPDATE_HANDLER);
};


export function initializeSpecialistRoutes() {
  resetPoolLedgerStore(); resetResearchStore();
  const disposeRecords = bindRecordStorageSync();
  bindResearchStoreSync();
  const researchListener = window.REPLOID_POOL_RESEARCH_UPDATE_HANDLER;
  const unsubscribe = subscribeContributionState(() => { refreshContributionStatusBar(); refreshContributionPanels(); });
  return () => {
    unsubscribe(); disposeRecords(); window.removeEventListener('reploid:pool-research-update', researchListener);
    if (window.REPLOID_POOL_RESEARCH_UPDATE_HANDLER === researchListener) delete window.REPLOID_POOL_RESEARCH_UPDATE_HANDLER;
  };
}
export function renderSpecialistRoute(routeId) {
  const dashboardView = routeId === 'examples' ? getPoolDashboardView() : 'home';
  return renderRoutePanel(routeId, { dashboardView }) + renderRouteDetail(routeId);
}
export function updateDocumentView(mount, state) {
  refreshDocumentSearch(mount, state);
  if (getRouteId() === 'records') renderLocalDocumentHistory(mount, state);
}
export function bindSpecialistRoute(mount, routeId, host, render, viewState = {}) {
  const disposers = []; let detached = false;
  restoreRoomDraft(mount); bindRoomDraft(mount);
  if (routeId === 'examples') {
    disposers.push(bindHomeAskControls(render), bindPoolPrism(mount), bindDocumentSearch(mount, host.documents, { viewState }));
    bindPoolDashboardControls(); bindCapabilityAssessmentControls();
    applyPoolDashboardView(getPoolDashboardView(), { updateHistory: false });
  }
  if (routeId === 'ask') disposers.push(bindRunControls());
  if (routeId === 'records') renderLocalDocumentHistory(mount, host.documents.getState());
  bindEmbeddingResultControls(); bindProviderControls(); bindParticipationControls(); bindRoomActivityControls(); bindReceiptControls();
  bindResearchRoomActions(mount); bindResearchWorkspace();
  void hydrateAndBindResearchWorkspace(undefined, getPeerRoomId()).then(() => { if (!detached) refreshResearchRoomState(routeId); });
  refreshRecordLedgerState(); restoreLatestCompletedRun(routeId);
  return () => { detached = true; disposers.forEach(dispose => dispose?.()); };
}
