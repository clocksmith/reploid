/** Shell lifecycle. Sessions belong to the host and outlive individual route views. */
import { createProductSession } from '../../host/product-session.js';
import { openBrowserEarning, deferredEarning } from '../../host/credits/browser.js';
import { getPeerRoomId, getPeerRoomBusFactory, getOrderedParticipation } from '../../host/product-context.js';
import { getCurrentReploidStorage } from '../../../../shared/instance.js';
import { resolveRtcConfig } from '../../../../shared/pool/p2p-transport.js';
import { POOLDAY_NAME, ROUTE_COPY } from './constants.js';
import { getRouteId, renderNav, renderAppShortcuts, updateChangesControl } from './shell-view.js';
import { renderConversationWorkspace, bindConversationWorkspace } from './conversation-workspace.js';
import { renderNetworkInspector, renderInspectorNavigation, renderInspectorRail, renderModelSetupDialog, bindNetworkInspector } from './network-inspector.js';
import { renderProductionContribution } from './contribution-models.js';
import { bindExecutionRibbon } from './execution-ribbon.js';
import { bindThemeSelector } from './theme.js';
import { bindPoolRouteControls } from './navigation.js';
import { renderHandedOver } from './history-handover-view.js';
import { bindButtonFeedback } from '../components/button-feedback.js';

let disposeWorkspace;
export function initPoolHome(mount, { operationNetwork = null, canonical = null, ordered, signal } = {}) {
  if (!mount) return;
  signal?.throwIfAborted();
  // Host context, like the room, comes from this instance; a malformed stage stops before any binding.
  const storage = getCurrentReploidStorage();
  if (ordered === undefined) ordered = getOrderedParticipation(storage);
  disposeWorkspace?.();
  let disposed = false, revision = 0, changesRevision = 0;
  let detachView = () => {}, detachRibbon = () => {}, disposeSpecialists = () => {};
  let specialists, sharingView, inspector, host;
  const viewState = {}, documentViewState = {};
  const theme = bindThemeSelector(mount);
  const disposeButtonFeedback = bindButtonFeedback(mount);
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
  // The earning loop opens beside the session: off unless this page's server publishes it.
  const earningOpening = openBrowserEarning({ storage }).catch(error => {
    console.warn('[Reploid] Credits are unavailable', error);
    return null;
  });
  const openedHost = createProductSession({ webContribution: globalThis.REPLOID_WEB_CONTRIBUTION ?? null, storage, operationNetwork, canonical, ordered, earning: deferredEarning(earningOpening),
    participantIdentity: async () => (await earningOpening)?.identity ?? null,
    networkOptions: () => ({ roomId: getPeerRoomId(), roomBusFactory: getPeerRoomBusFactory(), rtcConfig: resolveRtcConfig() }),
    onChanges: refreshChanges,
    onDocuments: state => { if (!disposed) specialists?.updateDocumentView(mount, state); },
    onSharing: state => { if (!disposed) sharingView?.refreshOperationSharing(mount, state); }
  });
  if (openedHost?.then) {
    const cancelOpening = () => {
      if (disposed) return;
      disposed = true; theme.dispose(); disposeButtonFeedback();
      signal?.removeEventListener('abort', cancelOpening);
      window.removeEventListener('pagehide', cancelOpening);
      if (disposeWorkspace === cancelOpening) disposeWorkspace = null;
    };
    disposeWorkspace = cancelOpening;
    window.addEventListener('pagehide', cancelOpening);
    signal?.addEventListener('abort', cancelOpening, { once: true });
    return openedHost.then(async opened => {
      window.removeEventListener('pagehide', cancelOpening);
      signal?.removeEventListener('abort', cancelOpening);
      if (disposed) { await opened.close(); return () => {}; }
      try { return bindHost(opened); }
      catch (error) {
        cancelOpening();
        try { await opened.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Application view opening failed'); }
        throw error;
      }
    }, error => { cancelOpening(); throw error; });
  }
  return bindHost(openedHost);
  function bindHost(opened) {
    host = opened;
    const connectOperations = network => host.connectOperations(network);
    window.REPLOID_POOL_CONNECT_OPERATIONS = connectOperations;
    window.REPLOID_POOL_ATTACH_DOPPLER_HANDLE = (handle, model = null, runtimeInfo = null) => host.runtime.attachHandle(handle, model, runtimeInfo);
    document.documentElement.classList.add('pool-page'); mount.replaceChildren();
    let renderedLocation = null;
    const render = async (options = {}) => {
      const location = new URL(window.location.href); location.searchParams.delete('view');
      // Workspace history changes only the visible destination, retaining drafts and attachments.
      if (options.type === 'popstate' && renderedLocation === location.href && mount.querySelector('[data-chat-workspace]')) return;
      renderedLocation = location.href;
      const current = ++revision;
      detachView(); detachView = () => {};
      detachRibbon(); detachRibbon = () => {}; inspector?.dispose();
      mount.querySelector('[data-shell-inspector]')?.remove();
      const routeId = getRouteId();
      document.documentElement.dataset.poolRouteId = routeId;
      document.body.dataset.poolRouteId = routeId;
      document.title = window.location.pathname === '/' ? POOLDAY_NAME : `${POOLDAY_NAME} - ${ROUTE_COPY[routeId]?.title || 'Work'}`;
      if (!mount.querySelector('.pool-route-content')) mount.innerHTML = '<main class="pool-home"><div class="pool-route-content"></div></main>';
      const surface = mount.querySelector('.pool-home');
      surface.dataset.poolRouteId = routeId;
      mount.querySelector('.pool-primary-nav')?.remove();
      const appBar = renderNav(routeId);
      if (appBar) surface.insertAdjacentHTML('afterbegin', appBar);
      const content = mount.querySelector('.pool-route-content');
      const workspaceRoute = ['home', 'network'].includes(routeId);
      // Each route renders the inspector's parts where its layout shows them. The
      // conversation workspace takes the section buttons in its toolbar and the panel
      // in its slot; every other route keeps both beside its content. Nothing moves later.
      const inspectorRoot = document.createElement('div'); inspectorRoot.dataset.shellInspector = '';
      if (workspaceRoute) {
        content.innerHTML = renderConversationWorkspace({ inspector: false });
        content.querySelector('[data-network-trigger-slot]').innerHTML = renderInspectorNavigation({ workspace: true });
        content.querySelector('[data-chat-inspector-slot]').innerHTML = renderInspectorRail({ mounted: true, apps: renderAppShortcuts(routeId), contribution: renderProductionContribution() });
        inspectorRoot.innerHTML = renderModelSetupDialog();
      } else {
        content.innerHTML = '<p role="status">Loading…</p>';
        inspectorRoot.innerHTML = renderNetworkInspector();
      }
      surface.append(inspectorRoot);
      inspector = bindNetworkInspector(surface, host.chat, { getInviteUrl: () => host.swarm.getInviteUrl(), webSearch: host.webSearch, search: host.search, earning: earningOpening,
        loadSpecialized: async target => {
          const operations = await import('./operation-sharing.js'); sharingView = operations;
          target.innerHTML = operations.renderOperationSharing();
          return operations.bindOperationSharing(target, host.operationSharing);
        }
      });
      const appBarNode = mount.querySelector('.pool-primary-nav');
      if (appBarNode) {
        const ribbon = bindExecutionRibbon(appBarNode, { onInspect: (section, opener) => inspector.open(section, opener), labelSession: host.chat });
        const networkAction = appBarNode.querySelector('[data-open-network]');
        if (networkAction) networkAction.onclick = event => {
          const settings = event.currentTarget.closest('details'); if (settings) settings.open = false;
          inspector.open('participants', settings?.querySelector('summary') || event.currentTarget);
        };
        const unsubscribeRibbon = host.chat.subscribe(state => ribbon.update(state));
        detachRibbon = () => { unsubscribeRibbon(); ribbon.dispose(); };
      }
      theme.sync(); void refreshChanges();
      const bindNavigation = () => bindPoolRouteControls(mount, render);
      bindNavigation();
      try {
        if (workspaceRoute) {
          detachView = bindConversationWorkspace(content, host.chat, { viewState, inspector, webSearch: host.webSearch, search: host.search, historyHandover: host.historyHandover });
        } else {
          if (routeId === 'experiments') {
            const plugins = await import('./research-plugins.js');
            if (disposed || current !== revision) return;
            content.innerHTML = plugins.renderResearchPlugins();
            detachView = plugins.bindResearchPlugins(content, host);
          } else if (routeId === 'improve') {
            const workView = await import('./work.js');
            if (disposed || current !== revision) return;
            content.innerHTML = workView.renderImproveSurface();
            detachView = workView.bindWorkSurface(content, host.work, { evolution: host.evolution, swarm: host.swarm, training: host.training });
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
    // A tab that hands its history to another tab closes its session and keeps only the
    // handover, so it can ask for the history back.
    const handover = host.historyHandover;
    const unsubscribeHandover = handover?.subscribe(({ state }) => {
      if (state !== 'moved' || disposed) return;
      const appearance = document.documentElement.dataset.reploidTheme;
      dispose({ keepHandover: true });
      const detachHandedOver = renderHandedOver(mount, handover, appearance);
      disposeWorkspace = () => { detachHandedOver(); handover.close(); disposeWorkspace = null; };
    }) || (() => {});
    const dispose = ({ keepHandover = false } = {}) => {
      if (disposed) return;
      disposed = true; revision++; changesRevision++;
      unsubscribeHandover(); if (!keepHandover) handover?.close();
      detachView(); detachRibbon(); inspector?.dispose(); theme.dispose(); disposeButtonFeedback(); disposeSpecialists();
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
}
export default { initPoolHome };
