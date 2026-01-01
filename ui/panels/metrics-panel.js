const MetricsPanel = {
  metadata: {
    id: 'MetricsPanel',
    version: '1.0.0',
    dependencies: ['Utils', 'MetricsDashboard', 'PerformanceMonitor', 'ToastNotifications?'],
    async: false,
    type: 'ui'
  },

  factory: (deps) => {
    const { Utils, MetricsDashboard, PerformanceMonitor, ToastNotifications } = deps;
    const { logger, exportAsMarkdown } = Utils;

    const init = (containerId) => {
      const container = document.getElementById(containerId);
      if (!container) return;

      if (MetricsDashboard?.init) {
        MetricsDashboard.init(container);
      }

      const refreshBtn = document.getElementById('perf-refresh-btn');
      const exportBtn = document.getElementById('perf-export-btn');

      if (refreshBtn) {
        refreshBtn.onclick = () => {
          MetricsDashboard?.updateCharts?.();
        };
      }

      if (exportBtn) {
        exportBtn.onclick = () => {
          const report = PerformanceMonitor?.generateReport?.();
          if (report) {
            exportAsMarkdown(`performance-${Date.now()}.md`, report);
            if (ToastNotifications) ToastNotifications.success('Performance report exported');
          }
        };
      }

      logger.info('[MetricsPanel] Initialized');
    };

    return { init };
  }
};

export default MetricsPanel;
