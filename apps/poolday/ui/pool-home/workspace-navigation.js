import { parseOwnerPairingUrl } from '../../host/owner-pairing.js';

/**
 * The narrowest window in which the threads drawer and the inspector both lie beside the conversation's reading
 * column without covering it: two page gutters (2 x 16), the reading column (720 + 32) and room for the wider drawer
 * on each side (2 x (380 + 16)). Below it, opening one drawer closes the other. The drawers reserve no layout column,
 * so the conversation never moves when one opens.
 */
export const BOTH_DRAWERS_MIN_WIDTH = 1576;

/** URL-backed drawers retain the mounted conversation and each other's state. */
const views = new Set(['chat', 'threads', 'computers', 'settings', 'conversation']);
export const workspaceView = () => {
  const value = new URL(globalThis.location.href).searchParams.get('view');
  return views.has(value) ? value : 'chat';
};
const hasThreads = () => workspaceView() === 'threads' || new URL(globalThis.location.href).searchParams.get('threads') === 'open';
export function workspaceHref(view, { threads = false } = {}) {
  const url = new URL(globalThis.location.href);
  if (!['/', '/network'].includes(url.pathname)) url.pathname = '/';
  if (parseOwnerPairingUrl(url.href)) url.hash = '';
  if (view === 'chat') url.searchParams.delete('view'); else url.searchParams.set('view', view);
  if (threads && !['chat', 'threads'].includes(view)) url.searchParams.set('threads', 'open'); else url.searchParams.delete('threads');
  return url.pathname + url.search + url.hash;
}
export function bindWorkspaceNavigation(root, apply) {
  const controller = new AbortController(), options = { signal: controller.signal };
  const mark = view => {
    for (const link of root.querySelectorAll('[data-workspace-view]')) {
      const selected = link.dataset.workspaceView === 'threads' ? hasThreads() : link.dataset.workspaceView === view;
      if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
      link.href = workspaceHref(link.dataset.workspaceView, { threads: hasThreads() });
    }
  };
  const reflect = (view, state = {}) => {
    const href = workspaceHref(view, state);
    if (globalThis.location.pathname + globalThis.location.search + globalThis.location.hash !== href) globalThis.history.pushState(globalThis.history.state, '', href);
    mark(view);
  };
  const navigate = (view, state = {}) => { reflect(view, { ...state, threads: (globalThis.innerWidth || 0) >= BOTH_DRAWERS_MIN_WIDTH && state.threads }); apply(view, { threads: hasThreads() }); };
  root.addEventListener('click', event => {
    const link = event.target.closest('[data-workspace-view]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const next = link.dataset.workspaceView, current = workspaceView();
    if (next === 'threads') {
      if ((globalThis.innerWidth || 0) >= BOTH_DRAWERS_MIN_WIDTH && ['computers', 'settings', 'conversation'].includes(current)) navigate(current, { threads: !hasThreads() });
      else navigate(hasThreads() ? 'chat' : 'threads');
    } else if (next === current) navigate(hasThreads() ? 'threads' : 'chat');
    else navigate(next, { threads: hasThreads() });
  }, options);
  const restore = () => {
    const view = workspaceView();
    if ((globalThis.innerWidth || 0) < BOTH_DRAWERS_MIN_WIDTH && view !== 'threads' && hasThreads()) globalThis.history.replaceState(globalThis.history.state, '', workspaceHref(view));
    apply(view, { threads: hasThreads() }); mark(view);
  };
  globalThis.addEventListener('popstate', restore, options);
  mark(workspaceView());
  return { navigate, reflect, restore, dispose: () => controller.abort() };
}
