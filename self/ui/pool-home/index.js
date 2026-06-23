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
  bindAgentControls,
  bindProviderControls,
  bindReceiptControls,
  bindReputationControls,
  bindRunControls
} from './controls.js';
import { bindHomeSimulation } from './simulation-bind.js';

const bindPoolRouteControls = (mount, render) => {
  mount.querySelectorAll('[data-pool-route], [data-pool-route-link]').forEach((control) => {
    control.addEventListener('click', (event) => {
      const path = control.dataset.poolRoute || control.dataset.poolRouteLink || control.getAttribute('href');
      if (!isProductPath(path)) return;
      event.preventDefault();
      if (window.location.pathname !== path) {
        window.history.pushState({ reploidPoolRoute: path }, '', path);
      }
      render();
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
    if (routeId !== 'home' && window.REPLOID_POOL_SIMULATION_STOP) {
      window.REPLOID_POOL_SIMULATION_STOP();
      window.REPLOID_POOL_SIMULATION_STOP = null;
    }
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
    bindAgentControls();
    bindProviderControls();
    bindReceiptControls();
    bindReputationControls();
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
