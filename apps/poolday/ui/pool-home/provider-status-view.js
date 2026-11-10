/**
 * @fileoverview Contributor status, notice and readiness on the Compute route. Readiness rows
 * report what the host observed; they grant nothing.
 */
import { escapeHtml } from '../../../../shared/ui/components/html.js';
import { setPoolHtml, compactHash } from './view-markup.js';

const POOLDAY_PROVIDER_HEALTH = {
  webgpu: 'unknown',
  model: 'not_loaded',
  artifact: 'not_checked',
  storage: 'unknown',
  queue: 'idle',
  lastReceipt: 'none',
  trust: 'signed_record',
  reputation: 'not_loaded'
};

const getProviderStatusEl = (mount) => mount?.querySelector('[data-pool-provider-status]');

export const updateProviderStatus = (mount, status = 'Idle') => {
  const statusEl = getProviderStatusEl(mount);
  const normalized = String(status || '').toLowerCase();
  const recovering = normalized.includes('retry')
    || normalized.includes('relay unavailable')
    || normalized.includes('checking relay');
  const providerState = recovering
    ? 'degraded'
    : normalized.includes('could not') || normalized.includes('failed') || normalized.includes('error')
      ? 'error'
    : normalized.includes('available') || normalized.includes('ready') || normalized.includes('answering') || normalized.includes('online') || normalized.includes('running')
      ? 'online'
      : normalized.includes('starting') || normalized.includes('opening')
        ? 'starting'
        : 'offline';
  if (statusEl) {
    statusEl.textContent = status;
    statusEl.dataset.providerState = providerState;
  }
  const summary = mount?.querySelector('[data-pool-drawer-summary="network-device"]');
  if (summary) {
    summary.textContent = status === 'Idle' ? 'Not sharing' : status;
    summary.dataset.providerState = providerState;
  }
};

export const updateProviderNotice = (mount, notice = null) => {
  const noticeEl = mount?.querySelector('[data-pool-provider-notice]');
  if (!noticeEl) return;
  if (!notice) {
    noticeEl.hidden = true;
    noticeEl.dataset.noticeState = '';
    setPoolHtml(noticeEl, '');
    return;
  }
  noticeEl.hidden = false;
  noticeEl.dataset.noticeState = notice.state || 'info';
  setPoolHtml(noticeEl, `
    <strong>${escapeHtml(notice.title || 'Sharing needs attention')}</strong>
    <span>${escapeHtml(notice.message || '')}</span>
  `);
};

const formatHealthValue = (value) => String(value ?? 'unknown').replace(/_/g, ' ');

const formatBytes = (value) => {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown';
  if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / (1024 ** 2))} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
};

export const renderProviderHealth = (state = POOLDAY_PROVIDER_HEALTH) => {
  const primaryRows = [
    ['Model', state.model],
    ['Room work', state.queue],
    ['Last receipt', state.lastReceipt],
    ['Check', state.trust]
  ];
  const detailRows = [
    ['Capability', state.capability],
    ['WebGPU', state.webgpu],
    ['GPU', state.hardware],
    ['GPU buffer', state.maxBufferSize],
    ['Files', state.artifact],
    ['Local cache', state.storage],
    ['Reputation', state.reputation]
  ];
  const renderRows = (rows) => rows.filter(([, value]) => value !== undefined && value !== null).map(([label, value]) => {
    const formatted = label === 'GPU buffer' ? formatBytes(value) : formatHealthValue(value);
    const isValLoading = formatted.toLowerCase() === 'loading';
    const valueHtml = isValLoading
      ? `<span class="pool-health-loading-text pool-subheading pool-muted">${escapeHtml(formatted)}</span>`
      : escapeHtml(compactHash(formatted));
    return `
      <span class="pool-summary-item"${isValLoading ? ' data-loading="true"' : ''}>
        <span class="rgr-status-label pool-label pool-muted">${escapeHtml(label)}</span>
        <span class="rgr-status-value">${valueHtml}</span>
      </span>
    `;
  }).join('');
  return `
    <div class="pool-provider-health-stack">
      <div class="boot-status-strip pool-summary" aria-label="Contributor readiness">
        ${renderRows(primaryRows)}
      </div>
      <details class="pool-advanced pool-disclosure pool-provider-health-details">
        <summary>Device and receipt details</summary>
        <div class="boot-status-strip pool-summary" aria-label="Contributor device details">
          ${renderRows(detailRows)}
        </div>
      </details>
    </div>
  `;
};

export const updateProviderHealth = (partial = {}) => {
  Object.assign(POOLDAY_PROVIDER_HEALTH, partial);
  const health = document.getElementById('pool-provider-health');
  if (health) setPoolHtml(health, renderProviderHealth());
};

export const refreshProviderStorageHealth = async () => {
  if (!navigator.storage?.estimate) {
    updateProviderHealth({ storage: navigator.storage ? 'available' : 'unknown' });
    return;
  }
  try {
    const estimate = await navigator.storage.estimate();
    const usedMb = Math.round(Number(estimate.usage || 0) / (1024 * 1024));
    const quotaMb = Math.round(Number(estimate.quota || 0) / (1024 * 1024));
    updateProviderHealth({ storage: quotaMb > 0 ? `${usedMb}/${quotaMb} MB` : 'available' });
  } catch {
    updateProviderHealth({ storage: 'unavailable' });
  }
};
