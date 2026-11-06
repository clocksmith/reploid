/** Workspace destinations share a URL and retain the mounted conversation state. */
const views = new Set(['chat', 'threads', 'computers', 'settings', 'conversation']);
export const workspaceView = () => {
  const value = new URL(globalThis.location.href).searchParams.get('view');
  return views.has(value) ? value : 'chat';
};
export function workspaceHref(view) {
  const url = new URL(globalThis.location.href);
  if (!['/', '/network'].includes(url.pathname)) url.pathname = '/';
  if (view === 'chat') url.searchParams.delete('view'); else url.searchParams.set('view', view);
  return url.pathname + url.search + url.hash;
}
export function bindWorkspaceNavigation(root, apply) {
  const controller = new AbortController(), options = { signal: controller.signal };
  const mark = view => {
    for (const link of root.querySelectorAll('[data-workspace-view]')) {
      const selected = link.dataset.workspaceView === view;
      if (selected) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
      link.href = workspaceHref(link.dataset.workspaceView);
    }
  };
  const reflect = view => {
    if (workspaceView() !== view) globalThis.history.pushState(globalThis.history.state, '', workspaceHref(view));
    mark(view);
  };
  const navigate = view => { reflect(view); apply(view); };
  root.addEventListener('click', event => {
    const link = event.target.closest('[data-workspace-view]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); navigate(link.dataset.workspaceView);
  }, options);
  globalThis.addEventListener('popstate', () => { apply(workspaceView()); mark(workspaceView()); }, options);
  mark(workspaceView());
  return { navigate, reflect, restore: () => apply(workspaceView()), dispose: () => controller.abort() };
}
