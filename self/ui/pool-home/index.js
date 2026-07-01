/**
 * @fileoverview Public product home for Reploid.
 */

import { createDopplerRuntime } from '../../pool/doppler-runtime.js';
import { POOLDAY_NAME, ROUTE_COPY } from './constants.js';
import {
  getRouteId,
  isProductPath,
  renderNav,
  renderRouteDetail,
  renderRoutePanel
} from './view.js';
import {
  bindProviderControls,
  bindReceiptControls,
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

const bindPoolRouteControls = (mount, render) => {
  mount.querySelectorAll('[data-pool-route], [data-pool-route-link]').forEach((control) => {
    control.addEventListener('click', (event) => {
      const path = control.dataset.poolRoute || control.dataset.poolRouteLink || control.getAttribute('href');
      if (!isProductPath(path)) return;
      event.preventDefault();
      const nextUrl = new URL(path, window.location.origin);
      const currentUrl = new URL(window.location.href);
      for (const key of ['room']) {
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
  const runtime = window.REPLOID_DOPPLER_RUNTIME || createDopplerRuntime();
  window.REPLOID_DOPPLER_RUNTIME = runtime;
  window.REPLOID_POOL_ATTACH_DOPPLER_HANDLE = (handle, model = null, runtimeInfo = null) => runtime.attachHandle(handle, model, runtimeInfo);
  mount.style.display = 'block';

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
        ${renderNav(routeId)}
        ${renderRoutePanel(routeId)}
        ${secondaryContent}
      </main>
    `;
    bindPoolRouteControls(mount, render);
    bindHomeSimulation(mount);
    bindRunControls();
    bindProviderControls();
    bindReceiptControls();
  };

  if (window.REPLOID_POOL_POPSTATE_HANDLER) {
    window.removeEventListener('popstate', window.REPLOID_POOL_POPSTATE_HANDLER);
  }
  window.REPLOID_POOL_POPSTATE_HANDLER = render;
  window.addEventListener('popstate', render);
  render();
}

export default {
  initPoolHome
};
