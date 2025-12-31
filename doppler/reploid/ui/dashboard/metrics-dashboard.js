/**
 * @fileoverview Metrics Dashboard - Visual performance metrics with Chart.js
 * Extends PerformanceMonitor with interactive charts and visualizations
 *
 * @module MetricsDashboard
 * @version 1.0.0
 * @category ui
 * @requires Chart.js (loaded via CDN in HTML)
 */

const MetricsDashboard = {
  metadata: {
    id: 'MetricsDashboard',
    version: '1.0.0',
    dependencies: ['Utils', 'PerformanceMonitor', 'Observability?'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, PerformanceMonitor, Observability } = deps;
    const { logger } = Utils;

    // Chart instances
    let memoryChart = null;
    let toolsChart = null;
    let tokensChart = null;
    let refreshIntervalId = null;
    let _chartColors = null;

    // Read CSS variables for Chart.js theming (rd.css compliance)
    const getChartColors = () => {
      const styles = getComputedStyle(document.documentElement);
      const fg = styles.getPropertyValue('--fg').trim() || '#000000';
      const bg = styles.getPropertyValue('--bg').trim() || '#FFFFFF';
      const opacityMuted = parseFloat(styles.getPropertyValue('--opacity-muted')) || 0.5;
      const opacitySecondary = parseFloat(styles.getPropertyValue('--opacity-secondary')) || 0.6;

      // Convert hex to rgba for opacity variations
      const hexToRgba = (hex, alpha) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
      };

      return {
        fg,
        bg,
        primary: hexToRgba(fg, 0.8),
        primaryFill: hexToRgba(fg, 0.1),
        secondary: hexToRgba(fg, opacitySecondary),
        secondaryFill: hexToRgba(fg, 0.05),
        grid: hexToRgba(fg, 0.1),
        text: hexToRgba(fg, opacityMuted)
      };
    };

    /**
     * Initialize metrics dashboard with Chart.js
     * @param {HTMLElement} container - Container element for charts
     */
    const init = (container) => {
      if (!container) {
        logger.warn('[MetricsDashboard] No container provided');
        return;
      }

      // Check if Chart.js is loaded
      if (typeof Chart === 'undefined') {
        logger.error('[MetricsDashboard] Chart.js not loaded');
        return;
      }

      logger.info('[MetricsDashboard] Initializing metrics dashboard');

      const summaryHTML = Observability?.getDashboard ? `
        <div class="observability-summary" id="observability-summary">
          <div class="summary-grid">
            <div class="summary-card">
              <div class="summary-label">Tokens</div>
              <div class="summary-value" id="obs-token-total">0</div>
              <div class="summary-sub" id="obs-token-cost">$0.00</div>
            </div>
            <div class="summary-card">
              <div class="summary-label">Mutations</div>
              <div class="summary-value" id="obs-mutation-total">0</div>
              <div class="summary-sub">Recent changes</div>
            </div>
            <div class="summary-card">
              <div class="summary-label">Decisions</div>
              <div class="summary-value" id="obs-decision-total">0</div>
              <div class="summary-sub">Agent choices</div>
            </div>
            <div class="summary-card">
              <div class="summary-label">Errors</div>
              <div class="summary-value" id="obs-error-total">0</div>
              <div class="summary-sub">Warnings and failures</div>
            </div>
          </div>
          <div class="summary-lists">
            <div class="summary-list">
              <div class="summary-list-title">Recent Mutations</div>
              <div id="obs-mutation-list" class="summary-list-body">No mutations yet</div>
            </div>
            <div class="summary-list">
              <div class="summary-list-title">Recent Decisions</div>
              <div id="obs-decision-list" class="summary-list-body">No decisions yet</div>
            </div>
          </div>
        </div>
      ` : '';

      // Create chart canvases
      const chartsHTML = `
        <div class="charts-grid">
          <div class="chart-container">
            <h4>Memory Usage Over Time</h4>
            <canvas id="memory-chart"></canvas>
          </div>
          <div class="chart-container">
            <h4>Tool Usage</h4>
            <canvas id="tools-chart"></canvas>
          </div>
          <div class="chart-container">
            <h4>LLM Token Usage</h4>
            <canvas id="tokens-chart"></canvas>
          </div>
        </div>
      `;

      container.insertAdjacentHTML('beforeend', summaryHTML + chartsHTML);

      // Initialize colors from CSS variables
      _chartColors = getChartColors();

      // Initialize charts
      initMemoryChart();
      initToolsChart();
      initTokensChart();

      // Auto-refresh every 5 seconds
      refreshIntervalId = setInterval(() => {
        updateCharts();
      }, 5000);
      updateObservabilitySummary();
    };

    const buildChart = (canvasId, configFactory) => {
      const canvas = document.getElementById(canvasId);
      if (!canvas) return null;
      return new Chart(canvas.getContext('2d'), configFactory());
    };

    const baseOptions = (overrides = {}) => {
      const colors = _chartColors || getChartColors();
      return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: colors.text } } },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { color: colors.text },
            grid: { color: colors.grid }
          },
          x: {
            ticks: { color: colors.text },
            grid: { color: colors.grid }
          }
        },
        ...overrides
      };
    };

    const initMemoryChart = () => {
      const memStats = PerformanceMonitor.getMemoryStats();

      if (!memStats || !memStats.history) {
        logger.warn('[MetricsDashboard] No memory history available');
        return;
      }

      // Prepare data from history
      const labels = memStats.history.map((_, i) => `${i * 30}s`);
      const data = memStats.history.map(s => (s.usedJSHeapSize / 1024 / 1024).toFixed(2));

      const colors = _chartColors || getChartColors();
      memoryChart = buildChart('memory-chart', () => ({
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Memory Usage (MB)',
            data,
            borderColor: colors.primary,
            backgroundColor: colors.primaryFill,
            tension: 0.4,
            fill: true
          }]
        },
        options: baseOptions()
      }));
    };

    /**
     * Initialize tool usage bar chart
     */
    const initToolsChart = () => {
      const metrics = PerformanceMonitor.getMetrics();

      // Get top 10 tools by call count
      const toolData = Object.entries(metrics.tools)
        .map(([name, data]) => ({
          name: name.length > 20 ? name.substring(0, 20) + '...' : name,
          calls: data.calls
        }))
        .sort((a, b) => b.calls - a.calls)
        .slice(0, 10);

      const colors = _chartColors || getChartColors();
      toolsChart = buildChart('tools-chart', () => ({
        type: 'bar',
        data: {
          labels: toolData.map(t => t.name),
          datasets: [{
            label: 'Call Count',
            data: toolData.map(t => t.calls),
            backgroundColor: colors.secondary,
            borderColor: colors.primary,
            borderWidth: 1
          }]
        },
        options: baseOptions({
          scales: {
            y: baseOptions().scales.y,
            x: {
              ticks: { color: colors.text, maxRotation: 45, minRotation: 45 },
              grid: { color: colors.grid }
            }
          }
        })
      }));
    };

    /**
     * Initialize LLM token usage doughnut chart
     */
    const initTokensChart = () => {
      const llmStats = PerformanceMonitor.getLLMStats();
      const colors = _chartColors || getChartColors();

      tokensChart = buildChart('tokens-chart', () => ({
        type: 'doughnut',
        data: {
          labels: ['Input Tokens', 'Output Tokens'],
          datasets: [{
            data: [llmStats.tokens.input, llmStats.tokens.output],
            backgroundColor: [
              colors.primary,
              colors.secondary
            ],
            borderColor: [
              colors.fg,
              colors.fg
            ],
            borderWidth: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: 'bottom',
              labels: { color: colors.text }
            }
          }
        }
      }));
    };

    /**
     * Update all charts with latest data
     */
    const updateCharts = () => {
      const metrics = PerformanceMonitor.getMetrics();
      const memStats = PerformanceMonitor.getMemoryStats();
      const llmStats = PerformanceMonitor.getLLMStats();

      // Update memory chart
      if (memoryChart && memStats && memStats.history) {
        const labels = memStats.history.map((_, i) => `${i * 30}s`);
        const data = memStats.history.map(s => (s.usedJSHeapSize / 1024 / 1024).toFixed(2));

        memoryChart.data.labels = labels;
        memoryChart.data.datasets[0].data = data;
        memoryChart.update('none'); // No animation for performance
      }

      // Update tools chart
      if (toolsChart) {
        const toolData = Object.entries(metrics.tools)
          .map(([name, data]) => ({
            name: name.length > 20 ? name.substring(0, 20) + '...' : name,
            calls: data.calls
          }))
          .sort((a, b) => b.calls - a.calls)
          .slice(0, 10);

        toolsChart.data.labels = toolData.map(t => t.name);
        toolsChart.data.datasets[0].data = toolData.map(t => t.calls);
        toolsChart.update('none');
      }

      // Update tokens chart
      if (tokensChart) {
        tokensChart.data.datasets[0].data = [llmStats.tokens.input, llmStats.tokens.output];
        tokensChart.update('none');
      }

      updateObservabilitySummary();
      logger.debug('[MetricsDashboard] Charts updated');
    };

    const updateObservabilitySummary = () => {
      if (!Observability?.getDashboard) return;
      const dashboard = Observability.getDashboard();
      if (!dashboard) return;

      const tokenTotal = dashboard.tokens?.session?.total || 0;
      const tokenCost = dashboard.tokens?.session?.estimatedCost || 0;
      const mutationTotal = dashboard.mutations?.total || 0;
      const decisionTotal = dashboard.decisions?.total || 0;
      const errorTotal = Array.isArray(dashboard.errors) ? dashboard.errors.length : 0;

      const tokenEl = document.getElementById('obs-token-total');
      const tokenCostEl = document.getElementById('obs-token-cost');
      const mutationEl = document.getElementById('obs-mutation-total');
      const decisionEl = document.getElementById('obs-decision-total');
      const errorEl = document.getElementById('obs-error-total');
      const mutationListEl = document.getElementById('obs-mutation-list');
      const decisionListEl = document.getElementById('obs-decision-list');

      if (tokenEl) tokenEl.textContent = tokenTotal.toLocaleString();
      if (tokenCostEl) tokenCostEl.textContent = `$${tokenCost.toFixed(4)}`;
      if (mutationEl) mutationEl.textContent = mutationTotal.toLocaleString();
      if (decisionEl) decisionEl.textContent = decisionTotal.toLocaleString();
      if (errorEl) errorEl.textContent = errorTotal.toLocaleString();

      if (mutationListEl) {
        const recentMutations = dashboard.mutations?.recent || [];
        mutationListEl.innerHTML = recentMutations.length === 0
          ? 'No mutations yet'
          : recentMutations.map((m) => (
            `<div class="summary-list-item">${m.op || 'change'} ${m.path || ''}</div>`
          )).join('');
      }

      if (decisionListEl) {
        const recentDecisions = dashboard.decisions?.recent || [];
        decisionListEl.innerHTML = recentDecisions.length === 0
          ? 'No decisions yet'
          : recentDecisions.map((d) => (
            `<div class="summary-list-item">${d.action?.toolCallCount || 0} tool calls</div>`
          )).join('');
      }
    };

    /**
     * Destroy all charts and clean up
     */
    const destroy = () => {
      if (memoryChart) {
        memoryChart.destroy();
        memoryChart = null;
      }
      if (toolsChart) {
        toolsChart.destroy();
        toolsChart = null;
      }
      if (tokensChart) {
        tokensChart.destroy();
        tokensChart = null;
      }
      if (refreshIntervalId) {
        clearInterval(refreshIntervalId);
        refreshIntervalId = null;
      }
      logger.info('[MetricsDashboard] Destroyed');
    };

    /**
     * Generate metrics dashboard summary
     * @returns {string} Markdown summary
     */
    const generateSummary = () => {
      const metrics = PerformanceMonitor.getMetrics();
      const llmStats = PerformanceMonitor.getLLMStats();
      const memStats = PerformanceMonitor.getMemoryStats();

      const uptime = metrics.session.uptime;
      const uptimeMin = Math.floor(uptime / 60000);
      const uptimeSec = Math.floor((uptime % 60000) / 1000);

      const currentMem = memStats.current
        ? (memStats.current.usedJSHeapSize / 1024 / 1024).toFixed(2)
        : '0.00';
      const peakMem = memStats.max
        ? (memStats.max / 1024 / 1024).toFixed(2)
        : '0.00';
      const limitMem = memStats.current
        ? (memStats.current.jsHeapSizeLimit / 1024 / 1024).toFixed(0)
        : '0';

      return `
# Metrics Dashboard Summary

**Session Uptime:** ${uptimeMin}m ${uptimeSec}s

## LLM Usage
- **Total Calls:** ${llmStats.calls}
- **Total Tokens:** ${llmStats.tokens.total.toLocaleString()}
- **Avg Latency:** ${llmStats.avgLatency.toFixed(0)}ms
- **Error Rate:** ${(llmStats.errorRate * 100).toFixed(1)}%

## Memory
- **Current:** ${currentMem} MB
- **Peak:** ${peakMem} MB
- **Limit:** ${limitMem} MB

## Top Tools
${Object.entries(metrics.tools)
  .sort((a, b) => b[1].calls - a[1].calls)
  .slice(0, 5)
  .map(([name, data]) => `- **${name}:** ${data.calls} calls (${(data.totalTime / data.calls).toFixed(1)}ms avg)`)
  .join('\n')}
      `.trim();
    };

    return {
      api: {
        init,
        updateCharts,
        destroy,
        generateSummary
      }
    };
  }
};

// Export for module loader
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MetricsDashboard;
}
MetricsDashboard;
