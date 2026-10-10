/** Shell lifecycle. Sessions belong to the host and outlive individual route views. */
import { createProductSession } from '../../host/product-session.js';
import { getPeerRoomId, getPeerRoomBusFactory } from '../../host/product-context.js';
import { getCurrentReploidStorage } from '../../instance.js';
import { resolveRtcConfig } from '../../pool/p2p-transport.js';
import { POOLDAY_NAME, ROUTE_COPY } from './constants.js';
import { getRouteId, renderNav, updateChangesControl } from './shell-view.js';
import { renderConversationWorkspace, bindConversationWorkspace } from './conversation-workspace.js';
import { bindNetworkControls } from './network-controls.js';
import { bindExecutionRibbon } from './execution-ribbon.js';
import { bindThemeSelector } from './theme.js';
import { bindPoolRouteControls } from './navigation.js';

let disposeWorkspace;
export function initPoolHome(mount, { operationNetwork = null } = {}) {
  if (!mount) return;
  disposeWorkspace?.();
  let disposed = false, revision = 0, changesRevision = 0;
  let detachView = () => {}, detachRibbon = () => {}, disposeSpecialists = () => {};
  let specialists, sharingView;
  const viewState = {}, documentViewState = {};
  const theme = bindThemeSelector(mount);
  const refreshChanges = async () => {
    const current = ++changesRevision;
    try {
      const candidates = await host.evolution.list();
      if (!disposed && current === changesRevision) updateChangesControl(mount, candidates);
    } catch (error) {
      if (!disposed && current === changesRevision) mount.querySelector('[data-pool-changes]')?.setAttribute('aria-label', 'Changes: review status unavailable');
      console.warn('[Reploid] Could not read changes awaiting review', error);
    }
  };
  const host = createProductSession({ storage: getCurrentReploidStorage(), operationNetwork,
    networkOptions: () => ({ roomId: getPeerRoomId(), roomBusFactory: getPeerRoomBusFactory(), rtcConfig: resolveRtcConfig() }),
    onChanges: refreshChanges,
    onDocuments: state => { if (!disposed) specialists?.updateDocumentView(mount, state); },
    onSharing: state => { if (!disposed) sharingView?.refreshOperationSharing(mount, state); }
  });
  const connectOperations = network => host.connectOperations(network);
  window.REPLOID_POOL_CONNECT_OPERATIONS = connectOperations;
  window.REPLOID_POOL_ATTACH_DOPPLER_HANDLE = (handle, model = null, runtimeInfo = null) => host.runtime.attachHandle(handle, model, runtimeInfo);
  mount.style.display = 'block'; mount.replaceChildren();
  const render = async (options = {}) => {
    const current = ++revision;
    detachView(); detachView = () => {};
    detachRibbon(); detachRibbon = () => {};
    const routeId = getRouteId();
    document.documentElement.dataset.poolRouteId = routeId;
    document.body.dataset.poolRouteId = routeId;
    document.title = window.location.pathname === '/' ? POOLDAY_NAME : `${POOLDAY_NAME} - ${ROUTE_COPY[routeId]?.title || 'Work'}`;
    if (!mount.querySelector('.pool-route-content')) mount.innerHTML = '<main class="pool-home"><div class="pool-route-content"></div></main>';
    mount.querySelector('.pool-home').dataset.poolRouteId = routeId;
    mount.querySelector('.pool-primary-nav')?.remove();
    mount.querySelector('.pool-home').insertAdjacentHTML('afterbegin', renderNav(routeId));
    const ribbon = bindExecutionRibbon(mount.querySelector('.pool-primary-nav'));
    const unsubscribeRibbon = host.chat.subscribe(state => ribbon.update(state));
    detachRibbon = () => { unsubscribeRibbon(); ribbon.dispose(); };
    theme.sync(); void refreshChanges();
    const content = mount.querySelector('.pool-route-content');
    const bindNavigation = () => bindPoolRouteControls(mount, render);
    bindNavigation();
    try {
      if (routeId === 'home') {
        content.innerHTML = renderConversationWorkspace();
        detachView = bindConversationWorkspace(content, host.chat, { getInviteUrl: () => host.swarm.getInviteUrl(), viewState });
      } else {
        content.innerHTML = '<p role="status">Loading…</p>';
        if (['network', 'improve'].includes(routeId)) {
          const workView = await import('./work.js');
          const operations = await import('./operation-sharing.js');
          if (disposed || current !== revision) return;
          sharingView = operations;
          content.innerHTML = routeId === 'network' ? workView.renderNetworkSurface() : workView.renderImproveSurface();
          const detach = routeId === 'network'
            ? bindNetworkControls(content.querySelector('[data-network-workspace]'), host.chat, { getInviteUrl: () => host.swarm.getInviteUrl() })
            : workView.bindWorkSurface(content, host.work, { evolution: host.evolution, swarm: host.swarm });
          const detachSharing = routeId === 'network' ? operations.bindOperationSharing(content, host.operationSharing) : () => {};
          detachView = () => { detach(); detachSharing(); };
        } else {
          const module = await import('./specialist-routes.js');
          if (disposed || current !== revision) return;
          if (!specialists) { specialists = module; disposeSpecialists = specialists.initializeSpecialistRoutes(); }
          // Legacy execution surfaces use the same host-owned runtime on every visit.
          window.REPLOID_DOPPLER_RUNTIME = host.runtime;
          content.innerHTML = specialists.renderSpecialistRoute(routeId);
          detachView = specialists.bindSpecialistRoute(content, routeId, host, render, documentViewState);
        }
      }
      bindNavigation();
      if (options.restoreNavigationFocus || options.type === 'popstate') {
        (mount.querySelector('.pool-nav-link[aria-current="page"]') || mount.querySelector('.pool-primary-brand'))?.focus({ preventScroll: true });
      }
    } catch (error) {
      if (disposed || current !== revision) return;
      content.replaceChildren();
      const notice = document.createElement('p'); notice.setAttribute('role', 'alert'); notice.textContent = `Could not open this view: ${error.message}`;
      const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'pool-button'; retry.textContent = 'Try again'; retry.onclick = () => render();
      content.append(notice, retry);
    }
  };
  const onPageHide = event => { if (event.persisted) void host.pause(); else dispose(); };
  const onPageShow = event => { if (event.persisted) host.resume(); };
  const dispose = () => {
    if (disposed) return;
    disposed = true; revision++; changesRevision++;
    detachView(); detachRibbon(); theme.dispose(); disposeSpecialists();
    window.removeEventListener('popstate', render); window.removeEventListener('pagehide', onPageHide); window.removeEventListener('pageshow', onPageShow);
    if (window.REPLOID_POOL_CONNECT_OPERATIONS === connectOperations) delete window.REPLOID_POOL_CONNECT_OPERATIONS;
    void host.close();
    if (disposeWorkspace === dispose) disposeWorkspace = null;
  };
  disposeWorkspace = dispose;
  window.addEventListener('popstate', render); window.addEventListener('pagehide', onPageHide); window.addEventListener('pageshow', onPageShow);
  void render();
  return dispose;
}
export default { initPoolHome };
