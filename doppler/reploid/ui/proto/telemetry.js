/**
 * Proto Telemetry - Telemetry panel logic
 */

import { formatTimestamp, formatPayloadSummary } from './utils.js';

const TELEMETRY_LIMIT = 200;

export const createTelemetryManager = (deps) => {
  const { logger, escapeHtml } = deps;

  let _telemetryTimelineSvc = null;
  let _telemetryLoaded = false;
  let _telemetryFilter = 'all';
  const _telemetryEntries = [];

  const resolveTelemetryTimeline = async () => {
    if (_telemetryTimelineSvc) return _telemetryTimelineSvc;
    try {
      _telemetryTimelineSvc = window.REPLOID?.telemetryTimeline
        || (await window.REPLOID_DI?.resolve?.('TelemetryTimeline'));
    } catch (e) {
      logger.warn('[Proto] TelemetryTimeline unavailable', e?.message || e);
    }
    return _telemetryTimelineSvc;
  };

  const renderTelemetryPanel = () => {
    const listEl = document.getElementById('telemetry-list');
    const countEl = document.getElementById('telemetry-count');
    const statusEl = document.getElementById('telemetry-status');
    if (!listEl || !countEl) return;

    const filtered = _telemetryEntries.filter(entry => {
      if (_telemetryFilter === 'all') return true;
      return (entry.severity || '').toLowerCase() === _telemetryFilter;
    });

    countEl.textContent = `${filtered.length} events`;
    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="telemetry-empty muted">No telemetry events yet</div>';
    } else {
      const items = filtered.slice().reverse().map(entry => {
        const severity = (entry.severity || 'info').toLowerCase();
        const tags = (entry.tags || []).map(tag => `<span class="telemetry-tag">${escapeHtml(tag)}</span>`).join('');
        return `
          <article class="telemetry-entry telemetry-${severity}">
            <header>
              <div>
                <strong>${escapeHtml(entry.type || 'event')}</strong>
                <span class="telemetry-time">${formatTimestamp(entry.ts)}</span>
              </div>
              <span class="telemetry-severity">${escapeHtml(severity.toUpperCase())}</span>
            </header>
            <div class="telemetry-meta">
              ${tags}
              ${entry.id ? `<span class="telemetry-id">${escapeHtml(entry.id)}</span>` : ''}
            </div>
            ${entry.payload ? `<pre>${escapeHtml(formatPayloadSummary(entry.payload))}</pre>` : ''}
          </article>
        `;
      }).join('');
      listEl.innerHTML = items;
    }

    if (statusEl) {
      if (_telemetryLoaded) {
        statusEl.textContent = `Updated ${formatTimestamp(Date.now())}`;
      } else if (!_telemetryTimelineSvc) {
        statusEl.textContent = 'Waiting for telemetry service...';
      }
    }
  };

  const appendTelemetryEntry = (entry) => {
    if (!entry) return;
    _telemetryEntries.push(entry);
    if (_telemetryEntries.length > TELEMETRY_LIMIT) {
      _telemetryEntries.splice(0, _telemetryEntries.length - TELEMETRY_LIMIT);
    }
    renderTelemetryPanel();
  };

  const loadTelemetryHistory = async () => {
    const svc = await resolveTelemetryTimeline();
    if (!svc?.getRecent) {
      const statusEl = document.getElementById('telemetry-status');
      if (statusEl) statusEl.textContent = 'Telemetry service unavailable';
      return;
    }
    try {
      const entries = await svc.getRecent(TELEMETRY_LIMIT);
      _telemetryEntries.length = 0;
      _telemetryEntries.push(...entries);
      _telemetryLoaded = true;
      renderTelemetryPanel();
    } catch (e) {
      logger.warn('[Proto] Failed to load telemetry history', e?.message || e);
      const statusEl = document.getElementById('telemetry-status');
      if (statusEl) statusEl.textContent = `Failed to load telemetry: ${e?.message || 'unknown error'}`;
    }
  };

  const setFilter = (filter) => {
    _telemetryFilter = filter;
    renderTelemetryPanel();
  };

  return {
    loadTelemetryHistory,
    appendTelemetryEntry,
    renderTelemetryPanel,
    setFilter,
    isLoaded: () => _telemetryLoaded
  };
};
