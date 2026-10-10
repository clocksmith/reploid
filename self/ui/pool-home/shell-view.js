import { PRODUCT_ROUTES, POOLDAY_NAME, POOLDAY_NAV_ROUTES } from './constants.js';
import { renderSettings } from './theme.js';
import { renderExecutionRibbon } from './execution-ribbon.js';
import { escapeHtml } from '../components/attachments.js';
import { getPeerRoomId } from '../../host/product-context.js';
const roomHref = (path, room) => { const url = new URL(path, 'https://reploid.invalid'); if (room) url.searchParams.set('room', room); return url.pathname + url.search; };

export const normalizeProductPath = (path = window.location.pathname) => {
  try {
    const url = new URL(path || '/', window.location.origin);
    if (url.origin !== window.location.origin || url.username || url.password) return null;
    return url.pathname.replace(/\/+$/, '') || '/';
  } catch { return null; }
};
export const getRouteId = () => PRODUCT_ROUTES[normalizeProductPath()] || 'home';
export const isProductPath = (path) => Object.prototype.hasOwnProperty.call(PRODUCT_ROUTES, normalizeProductPath(path));

export const renderPowerTower = (inverse = false) => `<span class="pool-power-tower" aria-hidden="true">${inverse ? '<span>7</span><sup>7</sup>' : '<sup>7</sup><span>7</span>'}</span>`;

export const renderNav = (activeRoute) => {
  const home = escapeHtml(roomHref('/', getPeerRoomId()));
  const changes = POOLDAY_NAV_ROUTES.find(route => route.id === 'improve');
  const changesPath = escapeHtml(roomHref(changes.path, getPeerRoomId()));
  return `
    <nav class="pool-nav-rail pool-primary-nav pool-surface" aria-label="${escapeHtml(POOLDAY_NAME)}">
      <a class="pool-primary-brand" aria-label="${escapeHtml(POOLDAY_NAME)} home"${activeRoute === 'home' ? ' aria-current="page"' : ''} href="${home}" data-pool-route-link="${home}">${renderPowerTower()}<span class="pool-primary-wordmark">${escapeHtml(POOLDAY_NAME)}</span></a>
      ${renderExecutionRibbon()}
      <div class="pool-primary-actions">
        ${renderSettings(renderPowerTower(true), `<a class="pool-nav-link pool-button" href="${changesPath}" data-pool-route-link="${changesPath}" data-pool-nav-id="improve" data-pool-changes aria-label="Changes"${activeRoute === 'improve' ? ' aria-current="page"' : ''}>Changes<span class="pool-change-count" data-pool-change-count aria-hidden="true" hidden></span></a><button class="pool-button" type="button" data-open-network>Network</button><a class="pool-button" href="/examples" data-pool-route-link="/examples">Examples</a>`)}
      </div>
    </nav>
  `;
};

export function updateChangesControl(root, candidates) {
  const control = root.querySelector('[data-pool-changes]');
  if (!control) return;
  const count = candidates.filter(item => item.status === 'awaiting-approval').length;
  const badge = control.querySelector('[data-pool-change-count]');
  badge.textContent = String(count); badge.hidden = count === 0;
  control.dataset.reviewNeeded = String(count > 0);
  const settings = root.querySelector('[data-pool-settings]');
  if (settings) {
    settings.querySelector('[data-pool-settings-review]').hidden = count === 0;
    settings.querySelector('summary').setAttribute('aria-label', count ? `Settings: ${count} changes awaiting review` : 'Settings');
  }
  control.setAttribute('aria-label', count ? `Changes: ${count} awaiting review` : 'Changes');
}
