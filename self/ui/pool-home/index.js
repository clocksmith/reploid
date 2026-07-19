/**
 * @fileoverview Public product home for Reploid.
 */

import { createDopplerRuntime } from '../../pool/doppler-runtime.js';
import { POOLDAY_NAME, ROUTE_COPY } from './constants.js';
import {
  bindRecordStorageSync,
  getRouteId,
  isProductPath,
  refreshContributionPanels,
  refreshContributionStatusBar,
  refreshRecordLedgerState,
  renderContributionStatusBar,
  renderNav,
  renderRouteDetail,
  renderRoutePanel
} from './view.js';
import { subscribeContributionState } from './contribution-state.js';
import { resetPoolLedgerStore } from './ledger-store.js';
import {
  bindHomeAskControls,
  bindProviderControls,
  bindReceiptControls,
  bindRoomActivityControls,
  bindRunControls
} from './controls.js';
import { bindHomeSimulation } from './simulation-bind.js';

const stopPoolHomeBackground = () => {
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

const applyPoolNavOpenState = (nav, navToggle, isOpen) => {
  nav.classList.toggle('is-open', isOpen);
  if (!isOpen) nav.querySelector('.pool-nav-more')?.removeAttribute('open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
  navToggle.setAttribute('aria-label', isOpen ? 'Close navigation' : 'Open navigation');
  navToggle.setAttribute('title', isOpen ? POOL_NAV_TOGGLE_TOOLTIPS.open : POOL_NAV_TOGGLE_TOOLTIPS.closed);
  navToggle.dataset.poolNavTooltip = isOpen ? POOL_NAV_TOGGLE_TOOLTIPS.open : POOL_NAV_TOGGLE_TOOLTIPS.closed;
};

const bindPoolRouteControls = (mount, render, {
  navOpen = false,
  onNavOpenChange = () => {}
} = {}) => {
  const nav = mount.querySelector('.pool-nav-rail');
  const navToggle = mount.querySelector('.pool-nav-toggle');
  const navMenu = mount.querySelector('.pool-nav-menu');
  if (nav && navToggle && navMenu) {
    navMenu.hidden = false;
    const setNavOpen = (isOpen) => {
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
    control.addEventListener('click', (event) => {
      const path = control.dataset.poolRoute || control.dataset.poolRouteLink || control.getAttribute('href');
      if (!isProductPath(path)) return;
      event.preventDefault();
      const nextUrl = new URL(path, window.location.origin);
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
      render();
    });
  });

  mount.querySelectorAll('[data-pool-substrate-route]').forEach((control) => {
    control.addEventListener('click', () => {
      stopPoolHomeBackground();
    });
  });
};

export function initPoolHome(mount) {
  if (!mount) return;
  resetPoolLedgerStore();
  const runtime = window.REPLOID_DOPPLER_RUNTIME || createDopplerRuntime();
  window.REPLOID_DOPPLER_RUNTIME = runtime;
  window.REPLOID_POOL_ATTACH_DOPPLER_HANDLE = (handle, model = null, runtimeInfo = null) => runtime.attachHandle(handle, model, runtimeInfo);
  mount.style.display = 'block';
  bindRecordStorageSync();
  let navOpen = false;
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

  const render = () => {
    const routeId = getRouteId();
    document.documentElement.dataset.poolRouteId = routeId;
    document.body.dataset.poolRouteId = routeId;
    if (routeId !== 'home') stopPoolHomeBackground();
    const secondaryContent = renderRouteDetail(routeId);
    const rootPath = (window.location.pathname || '/').replace(/\/+$/, '') || '/';
    document.title = rootPath === '/'
      ? POOLDAY_NAME
      : `${POOLDAY_NAME} - ${ROUTE_COPY[routeId]?.eyebrow || 'Verified Browser Inference'}`;
    mount.innerHTML = `
      <main class="pool-home" data-pool-route-id="${routeId}">
        ${renderNav(routeId, { open: navOpen })}
        ${renderContributionStatusBar()}
        ${renderRoutePanel(routeId)}
        ${secondaryContent}
      </main>
    `;
    bindPoolRouteControls(mount, render, {
      navOpen,
      onNavOpenChange: (nextOpen) => {
        navOpen = nextOpen;
      }
    });
    bindHomeAskControls(render);
    bindHomeSimulation(mount);
    bindRunControls();
    bindProviderControls();
    bindRoomActivityControls();
    bindReceiptControls();
    refreshRecordLedgerState();
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
