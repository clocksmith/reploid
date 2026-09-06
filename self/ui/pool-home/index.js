import { createOperationRoomNetwork } from '../../pool/operation-room-network.js';
import { createOperationParticipation } from '../../pool/operation-participation.js';
import { bindOperationSharing, refreshOperationSharing } from './operation-sharing.js';
import { createRequesterClient } from '../../pool/requester-client.js';
import { createPoolIdentity } from '../../pool/identity.js';
import { resolveRtcConfig } from '../../pool/p2p-transport.js';
import poolConfiguration from '../../pool/pool-config.json' with { type: 'json' };
/**
 * @fileoverview Public product home for Reploid.
 */

import { createDopplerRuntime } from '../../pool/doppler-runtime.js';
import { createLocalPackExecutor } from '../../pool/local-pack-executor.js';
import { createDocumentAssistant } from '../../pool/document-delegation.js';
import { bindDocumentSearch, refreshDocumentSearch, renderLocalDocumentHistory } from './document-search.js';
import { POOLDAY_NAME, ROUTE_COPY } from './constants.js';
import {
  bindRecordStorageSync,
  getPoolDashboardView,
  getPeerRoomId,
  getPeerRoomBusFactory,
  getRouteId,
  isProductPath,
  refreshContributionPanels,
  refreshContributionStatusBar,
  refreshRecordLedgerState,
  refreshResearchRoomState,
  restoreLatestCompletedRun,
  renderContributionStatusBar,
  renderNav,
  renderRouteDetail,
  renderRoutePanel,
  loadPoolRoomDraft,
  persistPoolRoomDraft
} from './view.js';
import { subscribeContributionState } from './contribution-state.js';
import { resetPoolLedgerStore } from './ledger-store.js';
import {
  applyPoolDashboardView,
  bindCapabilityAssessmentControls,
  bindEmbeddingResultControls,
  bindHomeAskControls,
  bindParticipationControls,
  bindPoolDashboardControls,
  bindProviderControls,
  bindReceiptControls,
  bindRoomActivityControls,
  bindRunControls
} from './controls.js';
import { bindPoolPrism } from './prism.js';
import { bindResearchRoomActions, bindResearchWorkspace, hydrateAndBindResearchWorkspace } from './research-view.js';
import { resetResearchStore } from './research-store.js';

const stopPoolHomeBackground = () => {
  window.REPLOID_POOL_CONTROLS_STOP?.();
  window.REPLOID_POOL_CONTROLS_STOP = null;
  window.REPLOID_POOL_PRISM_STOP?.();
  window.REPLOID_POOL_PRISM_STOP = null;
  const stopSimulation = window.REPLOID_POOL_SIMULATION_STOP;
  if (typeof stopSimulation === 'function') {
    try {
      stopSimulation();
    } finally {
      window.REPLOID_POOL_SIMULATION_STOP = null;
    }
  }
};

const POOL_NAV_TOGGLE_TOOLTIPS = Object.freeze({
  closed: 'Open the navigation details from the left',
  open: 'Close the navigation details and keep the activity rail'
});

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

const applyPoolNavOpenState = (nav, navToggle, isOpen) => {
  const openLabel = 'Close navigation';
  const closedLabel = 'Open navigation';
  nav.classList.toggle('is-open', isOpen);
  if (!isOpen) nav.querySelector('.pool-nav-more')?.removeAttribute('open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
  navToggle.setAttribute('aria-label', isOpen ? openLabel : closedLabel);
  navToggle.setAttribute('title', isOpen ? openLabel : closedLabel);
  navToggle.dataset.poolNavTooltip = isOpen ? openLabel : closedLabel;
};

const bindPoolRouteControls = (mount, render, {
  navOpen = false,
  onNavOpenChange = () => {}
} = {}) => {
  const nav = mount.querySelector('.pool-nav-rail');
  const navToggle = mount.querySelector('.pool-nav-toggle');
  const navMenu = mount.querySelector('.pool-nav-menu');
  let setNavOpen = () => {};
  if (nav && navToggle && navMenu) {
    navMenu.hidden = false;
    setNavOpen = (isOpen) => {
      applyPoolNavOpenState(nav, navToggle, isOpen);
      onNavOpenChange(isOpen);
    };
    setNavOpen(navOpen);
    navToggle.addEventListener('click', () => {
      setNavOpen(!nav.classList.contains('is-open'));
    });
    nav.querySelector('.pool-nav-more-summary')?.addEventListener('click', () => {
      if (!nav.classList.contains('is-open')) setNavOpen(true);
    });
  }

  mount.querySelectorAll('[data-pool-route], [data-pool-route-link]').forEach((control) => {
    if (control.dataset.poolRouteBound === 'true') return;
    control.dataset.poolRouteBound = 'true';
    control.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
        || control.hasAttribute('download') || (control.target && control.target !== '_self')) return;
      const path = control.dataset.poolRoute || control.dataset.poolRouteLink || control.getAttribute('href');
      const nextUrl = new URL(path, window.location.origin);
      if (nextUrl.origin !== window.location.origin || !isProductPath(nextUrl.pathname)) return;
      event.preventDefault();
      const currentUrl = new URL(window.location.href);
      for (const key of ['room', 'relay']) {
        if (!nextUrl.searchParams.has(key) && currentUrl.searchParams.has(key)) {
          nextUrl.searchParams.set(key, currentUrl.searchParams.get(key));
        }
      }
      const nextPath = `${nextUrl.pathname}${nextUrl.search}`;
      if (`${window.location.pathname}${window.location.search}` !== nextPath) {
        window.history.pushState({ reploidPoolRoute: nextPath }, '', nextPath);
      }
      setNavOpen(false);
      render({ restoreNavigationFocus: true });
    });
  });

  mount.querySelectorAll('[data-pool-substrate-route]').forEach((control) => {
    control.addEventListener('click', () => {
      stopPoolHomeBackground();
    });
  });
};

export function initPoolHome(mount, { operationNetwork = null } = {}) {
  if (!mount) return;
  stopPoolHomeBackground();
  mount.replaceChildren();
  resetPoolLedgerStore();
  resetResearchStore();
  const runtime = window.REPLOID_DOPPLER_RUNTIME || createDopplerRuntime();
  window.REPLOID_DOPPLER_RUNTIME = runtime;
  window.REPLOID_POOL_ATTACH_DOPPLER_HANDLE = (handle, model = null, runtimeInfo = null) => runtime.attachHandle(handle, model, runtimeInfo);
  mount.style.display = 'block';
  bindRecordStorageSync();
  bindResearchStoreSync();
  let navOpen = false;
  let disposeDocumentView = () => {};
  let disposeOperationSharing = () => {};
  const operationSharing = createOperationParticipation({ networkOptions: () => ({ roomId: getPeerRoomId(),
    roomBusFactory: getPeerRoomBusFactory(), rtcConfig: resolveRtcConfig() }),
    onChange: state => refreshOperationSharing(mount, state) });
  operationNetwork ??= createOperationRoomNetwork({ roomId: getPeerRoomId(), roomBusFactory: getPeerRoomBusFactory(),
    requesterClient: createRequesterClient({ sdk: null, identity: createPoolIdentity('requester', { localOnly: true,
      namespace: poolConfiguration.operationNetwork.identityNamespace }) }), rtcConfig: resolveRtcConfig() });
  const documents = createDocumentAssistant({ executor: createLocalPackExecutor(), network: operationNetwork, onChange: (state) => {
    refreshDocumentSearch(mount, state);
    if (getRouteId() === 'records') renderLocalDocumentHistory(mount, state);
  } });
  window.REPLOID_POOL_CONNECT_OPERATIONS = network => documents.connectNetwork(network);
  if (window.REPLOID_POOL_NAV_ESCAPE_HANDLER) {
    window.removeEventListener('keydown', window.REPLOID_POOL_NAV_ESCAPE_HANDLER);
  }
  window.REPLOID_POOL_NAV_ESCAPE_HANDLER = (event) => {
    if (event.key !== 'Escape' || !navOpen) return;
    const nav = mount.querySelector('.pool-nav-rail');
    const navToggle = mount.querySelector('.pool-nav-toggle');
    if (!nav || !navToggle) return;
    navOpen = false;
    applyPoolNavOpenState(nav, navToggle, false);
    navToggle.focus();
  };
  window.addEventListener('keydown', window.REPLOID_POOL_NAV_ESCAPE_HANDLER);

  const render = (options = {}) => {
    disposeDocumentView();
    disposeOperationSharing();
    if (documents.getState().busy) documents.cancel();
    const routeId = getRouteId();
    const dashboardView = routeId === 'home' ? getPoolDashboardView() : 'home';
    document.documentElement.dataset.poolRouteId = routeId;
    document.body.dataset.poolRouteId = routeId;
    stopPoolHomeBackground();
    const secondaryContent = renderRouteDetail(routeId);
    const rootPath = (window.location.pathname || '/').replace(/\/+$/, '') || '/';
    document.title = rootPath === '/'
      ? POOLDAY_NAME
      : `${POOLDAY_NAME} - ${ROUTE_COPY[routeId]?.eyebrow || 'Verified Browser Inference'}`;
    if (!mount.querySelector('.pool-route-content')) mount.innerHTML = `
      <main class="pool-home" data-pool-route-id="${routeId}">
        ${renderNav(routeId, {
          open: navOpen,
          dashboard: routeId === 'home',
          dashboardView
        })}
        ${renderContributionStatusBar()}
        <div class="pool-route-content"></div>
      </main>
    `;
    mount.querySelector('.pool-home').dataset.poolRouteId = routeId;
    mount.querySelectorAll('[data-pool-nav-id]').forEach((link) => {
      const active = link.dataset.poolNavId === (routeId === 'ask' ? 'home' : routeId);
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    mount.querySelector('.pool-route-content').innerHTML = `${renderRoutePanel(routeId, { dashboardView })}${secondaryContent}`;
    restoreRoomDraft(mount);
    bindRoomDraft(mount);
    bindPoolRouteControls(mount, render, {
      navOpen,
      onNavOpenChange: (nextOpen) => {
        navOpen = nextOpen;
      }
    });
    window.REPLOID_POOL_CONTROLS_STOP = bindHomeAskControls(render);
    window.REPLOID_POOL_PRISM_STOP = bindPoolPrism(mount);
    disposeDocumentView = bindDocumentSearch(mount, documents);
    disposeOperationSharing = bindOperationSharing(mount, operationSharing);
    if (routeId === 'records') renderLocalDocumentHistory(mount, documents.getState());
    bindPoolDashboardControls();
    bindCapabilityAssessmentControls();
    bindRunControls();
    bindEmbeddingResultControls();
    bindProviderControls();
    bindParticipationControls();
    bindRoomActivityControls();
    bindReceiptControls();
    bindResearchRoomActions(mount);
    bindResearchWorkspace();
    void hydrateAndBindResearchWorkspace(undefined, getPeerRoomId()).then(() => {
      if (document.body.dataset.poolRouteId === routeId) refreshResearchRoomState(routeId);
    });
    refreshRecordLedgerState();
    restoreLatestCompletedRun(routeId);
    if (routeId === 'home') applyPoolDashboardView(dashboardView, { updateHistory: false });
    if (options.restoreNavigationFocus || options.type === 'popstate') {
      mount.querySelector('.pool-nav-link[aria-current="page"]')?.focus({ preventScroll: true });
    }
  };

  if (window.REPLOID_POOL_POPSTATE_HANDLER) {
    window.removeEventListener('popstate', window.REPLOID_POOL_POPSTATE_HANDLER);
  }
  if (window.REPLOID_POOL_CONTRIBUTION_UNSUBSCRIBE) {
    window.REPLOID_POOL_CONTRIBUTION_UNSUBSCRIBE();
  }
  window.REPLOID_POOL_CONTRIBUTION_UNSUBSCRIBE = subscribeContributionState(() => {
    refreshContributionStatusBar();
    refreshContributionPanels();
  });
  window.REPLOID_POOL_POPSTATE_HANDLER = render;
  window.addEventListener('popstate', render);
  render();
}

export default {
  initPoolHome
};
