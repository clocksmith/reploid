/**
 * The vanilla shell, for the specialist routes only. The conversation workspace (/ and /network: the conversation,
 * Threads, Conversation details, Computers and Settings) is the React product (apps/poolday-react); this shell links
 * to it and never renders it. Sessions belong to the host and outlive individual route views.
 */
import { openProductHost, resolveOrderedParticipation } from '../../host/open-product-host.js';
import { POOLDAY_NAME, ROUTE_COPY } from './constants.js';
import { getRouteId, renderNav, updateChangesControl } from './shell-view.js';
import { bindExecutionRibbon } from './execution-ribbon.js';
import { bindThemeSelector } from './theme.js';
import { bindPoolRouteControls, WORKSPACE_PATHS } from './navigation.js';
import { renderHandedOver } from './history-handover-view.js';
import { bindButtonFeedback } from '../components/button-feedback.js';

let disposeWorkspace;
export function initPoolHome(mount, { operationNetwork = null, canonical = null, ordered, signal } = {}) {
  if (!mount) return;
  signal?.throwIfAborted();
  // Host context, like the room, comes from this instance; a malformed stage stops before any binding.
  if (ordered === undefined) ordered = resolveOrderedParticipation();
  disposeWorkspace?.();
  let disposed = false, revision = 0, changesRevision = 0;
  let detachView = () => {}, detachRibbon = () => {}, disposeSpecialists = () => {};
  let specialists, host;
  const documentViewState = {};
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
  const { host: openedHost } = openProductHost({ operationNetwork, canonical, ordered,
    onChanges: refreshChanges,
    onDocuments: state => { if (!disposed) specialists?.updateDocumentView(mount, state); }
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
    // A destination in the React product, keeping this page's room and instance parameters.
    const workspaceHref = view => {
      const url = new URL('/', window.location.origin), current = new URL(window.location.href);
      for (const key of ['room', 'relay', 'swarm', 'swarmToken', 'signaling', 'instance']) {
        if (current.searchParams.has(key)) url.searchParams.set(key, current.searchParams.get(key));
      }
      if (view) url.searchParams.set('view', view);
      return url.pathname + url.search;
    };
    const render = async (options = {}) => {
      const current = ++revision;
      detachView(); detachView = () => {};
      detachRibbon(); detachRibbon = () => {};
      const routeId = getRouteId();
      // History can return to a workspace address; the React product loads it as a page of its own.
      if (WORKSPACE_PATHS.includes(window.location.pathname)) { window.location.assign(window.location.href); return; }
      document.documentElement.dataset.poolRouteId = routeId;
      document.body.dataset.poolRouteId = routeId;
      document.title = `${POOLDAY_NAME} - ${ROUTE_COPY[routeId]?.title || 'Work'}`;
      if (!mount.querySelector('.pool-route-content')) mount.innerHTML = '<main class="pool-home"><div class="pool-route-content"></div></main>';
      const surface = mount.querySelector('.pool-home');
      surface.dataset.poolRouteId = routeId;
      mount.querySelector('.pool-primary-nav')?.remove();
      const appBar = renderNav(routeId);
      if (appBar) surface.insertAdjacentHTML('afterbegin', appBar);
      const content = mount.querySelector('.pool-route-content');
      content.innerHTML = '<p role="status">Loading…</p>';
      const appBarNode = mount.querySelector('.pool-primary-nav');
      if (appBarNode) {
        // Inspecting an answer, Computers and Settings are the workspace's drawers.
        const ribbon = bindExecutionRibbon(appBarNode, { onInspect: () => window.location.assign(workspaceHref('conversation')), labelSession: host.chat });
        const networkAction = appBarNode.querySelector('[data-open-network]');
        if (networkAction) networkAction.onclick = () => window.location.assign(workspaceHref('computers'));
        const unsubscribeRibbon = host.chat.subscribe(state => ribbon.update(state));
        detachRibbon = () => { unsubscribeRibbon(); ribbon.dispose(); };
      }
      theme.sync(); void refreshChanges();
      const bindNavigation = () => bindPoolRouteControls(mount, render);
      bindNavigation();
      try {
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
      detachView(); detachRibbon(); theme.dispose(); disposeButtonFeedback(); disposeSpecialists();
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
