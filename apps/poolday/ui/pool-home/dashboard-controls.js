/**
 * @fileoverview Dashboard view and drawer controls: the URL-backed dashboard view, the control
 * drawer and the remembered open drawer sections.
 */

const setControlDrawerOpen = (open) => {
  const rail = document.querySelector('.pool-control-drawer');
  const toggle = rail?.querySelector('.pool-nav-toggle');
  if (!rail || !toggle) return;
  if (rail.classList.contains('is-open') !== open) {
    toggle.click();
  }
};

const POOL_DRAWER_SECTION_STATE_KEY = 'reploid.pool.drawerSections.v1';

const readDrawerSectionState = () => {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(POOL_DRAWER_SECTION_STATE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeDrawerSectionState = (state) => {
  try {
    globalThis.localStorage?.setItem(POOL_DRAWER_SECTION_STATE_KEY, JSON.stringify(state));
  } catch {
    // Disclosure remains usable when browser storage is unavailable.
  }
};

const bindDrawerSections = () => {
  const state = readDrawerSectionState();
  document.querySelectorAll('details[data-pool-drawer-section]').forEach((section) => {
    const id = section.dataset.poolDrawerSection;
    if (typeof state[id] === 'boolean') section.open = state[id];
    if (section.dataset.poolDrawerSectionBound === 'true') return;
    section.dataset.poolDrawerSectionBound = 'true';
    section.querySelector(':scope > summary')?.addEventListener('click', (event) => {
      // Clicking a collapsed section expands the single control rail and opens it.
      const rail = section.closest('.pool-nav-rail');
      if (rail && !rail.classList.contains('is-open')) {
        const toggle = rail.querySelector('.pool-nav-toggle');
        toggle?.click();
        section.open = true;
        event.preventDefault();
        return;
      }
      const next = readDrawerSectionState();
      next[id] = !section.open;
      writeDrawerSectionState(next);
    });
    section.addEventListener('toggle', () => {
      const next = readDrawerSectionState();
      next[id] = section.open;
      writeDrawerSectionState(next);
    });
  });
};

export const applyPoolDashboardView = (view = 'home', { updateHistory = true } = {}) => {
  const normalized = ['home', 'ask', 'compute', 'records'].includes(view) ? view : 'home';
  const stage = document.querySelector('.pool-home-stage');
  if (!stage) return normalized;
  stage.dataset.poolDashboardView = normalized;
  document.querySelectorAll('.pool-nav-link[data-pool-dashboard-view]').forEach((control) => {
    const active = control.dataset.poolDashboardView === normalized;
    control.classList.toggle('is-active', active);
    if (active) control.setAttribute('aria-current', 'page');
    else control.removeAttribute('aria-current');
  });
  if (normalized === 'ask') document.getElementById('pool-home-ask-prompt')?.focus();
  if (normalized === 'compute' || normalized === 'records') setControlDrawerOpen(true);
  if (updateHistory) {
    const url = new URL(window.location.href);
    if (normalized === 'home') url.searchParams.delete('view');
    else url.searchParams.set('view', normalized);
    window.history.pushState({ reploidPoolDashboardView: normalized }, '', `${url.pathname}${url.search}`);
  }
  return normalized;
};

export const bindPoolDashboardControls = () => {
  bindDrawerSections();
  document.querySelectorAll('.pool-nav-link[data-pool-dashboard-view], [data-pool-dashboard-view-target]').forEach((control) => {
    if (control.dataset.poolDashboardBound === 'true') return;
    control.dataset.poolDashboardBound = 'true';
    control.addEventListener('click', (event) => {
      event.preventDefault();
      applyPoolDashboardView(control.dataset.poolDashboardView || control.dataset.poolDashboardViewTarget || 'home');
    });
  });
  if (window.REPLOID_POOL_INSPECTOR_ESCAPE_HANDLER) {
    window.removeEventListener('keydown', window.REPLOID_POOL_INSPECTOR_ESCAPE_HANDLER);
    window.REPLOID_POOL_INSPECTOR_ESCAPE_HANDLER = null;
  }
};
