/** Shell lifecycle. Sessions belong to the host and outlive individual route views. */
import { createProductSession } from '../../host/product-session.js';
import { getPeerRoomId, getPeerRoomBusFactory } from '../../host/product-context.js';
import { getCurrentReploidStorage } from '../../instance.js';
import { resolveRtcConfig } from '../../pool/p2p-transport.js';
import { POOLDAY_NAME, ROUTE_COPY } from './constants.js';
import { getRouteId, renderNav, updateChangesControl } from './shell-view.js';
import { renderConversationWorkspace, bindConversationWorkspace } from './conversation-workspace.js';
import { renderNetworkInspector, bindNetworkInspector } from './network-inspector.js';
import { bindExecutionRibbon } from './execution-ribbon.js';
import { bindThemeSelector } from './theme.js';
import { bindPoolRouteControls } from './navigation.js';

let disposeWorkspace;
export function initPoolHome(mount, { operationNetwork = null } = {}) {
  if (!mount) return;
  disposeWorkspace?.();
  let disposed = false, revision = 0, changesRevision = 0;
  let detachView = () => {}, detachRibbon = () => {}, disposeSpecialists = () => {};
  let specialists, sharingView, inspector;
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
    detachRibbon(); detachRibbon = () => {}; inspector?.dispose();
    mount.querySelector('[data-shell-inspector]')?.remove();
    const routeId = getRouteId();
    document.documentElement.dataset.poolRouteId = routeId;
    document.body.dataset.poolRouteId = routeId;
    document.title = window.location.pathname === '/' ? POOLDAY_NAME : `${POOLDAY_NAME} - ${ROUTE_COPY[routeId]?.title || 'Work'}`;
    if (!mount.querySelector('.pool-route-content')) mount.innerHTML = '<main class="pool-home"><div class="pool-route-content"></div></main>';
    mount.querySelector('.pool-home').dataset.poolRouteId = routeId;
    mount.querySelector('.pool-primary-nav')?.remove();
    mount.querySelector('.pool-home').insertAdjacentHTML('afterbegin', renderNav(routeId));
    const inspectorRoot = document.createElement('div'); inspectorRoot.dataset.shellInspector = '';
    inspectorRoot.innerHTML = renderNetworkInspector(); mount.querySelector('.pool-home').append(inspectorRoot);
    inspector = bindNetworkInspector(inspectorRoot, host.chat, { getInviteUrl: () => host.swarm.getInviteUrl(),
      loadSpecialized: async target => {
        const operations = await import('./operation-sharing.js'); sharingView = operations;
        target.innerHTML = operations.renderOperationSharing();
        return operations.bindOperationSharing(target, host.operationSharing);
      }
    });
    const ribbon = bindExecutionRibbon(mount.querySelector('.pool-primary-nav'), { onInspect: (section, opener) => inspector.open(section, opener) });
    mount.querySelector('[data-open-network]').onclick = event => {
      const settings = event.currentTarget.closest('details'); if (settings) settings.open = false;
      inspector.open('participants', settings?.querySelector('summary') || event.currentTarget);
    };
    const unsubscribeRibbon = host.chat.subscribe(state => ribbon.update(state));
    detachRibbon = () => { unsubscribeRibbon(); ribbon.dispose(); };
    theme.sync(); void refreshChanges();
    const content = mount.querySelector('.pool-route-content');
    const bindNavigation = () => bindPoolRouteControls(mount, render);
    bindNavigation();
    try {
      if (routeId === 'home' || routeId === 'network') {
        content.innerHTML = renderConversationWorkspace({ inspector: false });
        detachView = bindConversationWorkspace(content, host.chat, { viewState, inspector });
        if (routeId === 'network') inspector.open();
      } else {
        content.innerHTML = '<p role="status">Loading…</p>';
        if (routeId === 'improve') {
          const workView = await import('./work.js');
          if (disposed || current !== revision) return;
          content.innerHTML = workView.renderImproveSurface();
          detachView = workView.bindWorkSurface(content, host.work, { evolution: host.evolution, swarm: host.swarm });
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
    detachView(); detachRibbon(); inspector?.dispose(); theme.dispose(); disposeSpecialists();
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
