/**
 * @fileoverview This contributor tab's status bar, node statistics and recent receipts, read
 * from the contribution snapshot. Counts come from records, never estimates.
 */
import { escapeHtml } from '../../../../shared/ui/components/html.js';
import { getContributionSnapshot } from './contribution-state.js';
import { formatContributionModel, formatContributionTokens } from './room-record-projection.js';
import { refreshRecordTimelineState } from './record-ledger-view.js';
import { setPoolHtml, compactHex, compactHash } from './view-markup.js';

const formatContributionLast = (snapshot = {}) => {
  const recent = snapshot.recent?.[0];
  if (!recent) return 'none';
  const hash = recent.receiptHash ? ` ${compactHex(recent.receiptHash)}` : '';
  return `${formatContributionTokens(recent.tokens)}${hash}`;
};

const renderRecentContributionRows = (snapshot = {}) => {
  const recent = snapshot.recent || [];
  if (!recent.length) {
    return '<p class="pool-caption pool-receipt-empty">No completed work from this tab yet.</p>';
  }
  return `
    <div class="pool-ledger pool-table pool-contribution-table" role="table" aria-label="Recent compute work">
      <table>
        <thead>
          <tr>
            <th>Answer</th>
            <th>Model</th>
            <th>Tokens</th>
            <th>Room</th>
          </tr>
        </thead>
        <tbody>
          ${recent.map((row) => `
            <tr>
              <td title="${escapeHtml(row.receiptHash || '—')}">${escapeHtml(compactHex(row.receiptHash || '—'))}</td>
              <td title="${escapeHtml(row.modelId || '—')}">${escapeHtml(formatContributionModel(row.modelId))}</td>
              <td>${escapeHtml(formatContributionTokens(row.tokens))}</td>
              <td title="${escapeHtml(row.roomId || '—')}">${escapeHtml(compactHash(row.roomId || '—'))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
};

export const renderComputeNodeStats = (snapshot = getContributionSnapshot()) => `
  <div class="pool-node-stats pool-small" aria-label="This contributor tab status">
    <span><b>Status</b>${escapeHtml(snapshot.label || 'Not active')}</span>
    <span><b>Model</b>${escapeHtml(formatContributionModel(snapshot.modelId))}</span>
    <span><b>24h receipts</b>${escapeHtml(snapshot.contributions24h || 0)}</span>
    <span><b>24h tokens</b>${escapeHtml(formatContributionTokens(snapshot.tokens24h))}</span>
    <span><b>Tokens/hr</b>${escapeHtml(formatContributionTokens(snapshot.tokensHour))}</span>
  </div>
`;

export const renderRecentContributionHistory = (snapshot = getContributionSnapshot()) => `
  <div class="pool-node-history" aria-label="This contributor tab recent work">
    ${renderRecentContributionRows(snapshot)}
  </div>
`;

export const shouldRenderContributionStatusBar = (snapshot = getContributionSnapshot()) => {
  return snapshot?.optedIn === true;
};

export const refreshContributionPanels = () => {
  const stats = document.getElementById('pool-provider-node-stats');
  const history = document.getElementById('pool-provider-node-history');
  const historySection = document.querySelector('[data-pool-contribution-history]');
  const snapshot = getContributionSnapshot();
  if (stats) {
    setPoolHtml(stats, renderComputeNodeStats(snapshot));
    stats.hidden = !snapshot.optedIn;
  }
  if (history) setPoolHtml(history, renderRecentContributionHistory(snapshot));
  if (historySection) historySection.hidden = !snapshot.recent?.length;
  refreshRecordTimelineState();
};

export const renderContributionStatusBar = (snapshot = getContributionSnapshot()) => {
  if (!shouldRenderContributionStatusBar(snapshot)) return '';
  const hasHourTokens = Number(snapshot.tokensHour || 0) > 0;
  const hasDayTokens = Number(snapshot.tokens24h || 0) > 0;
  const hasRecent = Boolean(snapshot.recent?.length);
  return `
    <aside
      class="pool-contribution-status pool-caption"
      id="pool-contribution-status"
      data-contribution-state="${escapeHtml(snapshot.state || 'inactive')}"
      aria-label="Contribution status"
    >
      <span class="pool-contribution-state pool-label">${escapeHtml(snapshot.label || 'Not active')}</span>
      ${hasDayTokens ? `<span class="pool-contribution-metric pool-caption pool-surface"><b>24h</b> ${escapeHtml(formatContributionTokens(snapshot.tokens24h))}</span>` : ''}
      ${hasHourTokens ? `<span class="pool-contribution-metric pool-caption pool-surface"><b>1h</b> ${escapeHtml(formatContributionTokens(snapshot.tokensHour))}/hr</span>` : ''}
      ${hasRecent ? `<span class="pool-contribution-metric pool-caption pool-surface pool-contribution-last"><b>Last</b> ${escapeHtml(formatContributionLast(snapshot))}</span>` : ''}
    </aside>
  `;
};

export const refreshContributionStatusBar = () => {
  const snapshot = getContributionSnapshot();
  const current = document.getElementById('pool-contribution-status');
  if (!shouldRenderContributionStatusBar(snapshot)) {
    current?.remove();
    return;
  }
  const template = document.createElement('template');
  setPoolHtml(template, renderContributionStatusBar(snapshot).trim());
  const next = template.content.firstElementChild;
  if (!next) {
    current?.remove();
    return;
  }
  if (current) {
    current.replaceWith(next);
    return;
  }
  const main = document.querySelector('.pool-home');
  const nav = main?.querySelector('.pool-nav-rail');
  if (main && nav) {
    nav.insertAdjacentElement('afterend', next);
  }
};
