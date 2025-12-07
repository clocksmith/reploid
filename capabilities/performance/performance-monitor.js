/**
 * @fileoverview Performance Monitor
 * Tracks system metrics and tool execution stats.
 */

const PerformanceMonitor = {
  metadata: {
    id: 'PerformanceMonitor',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'EventBus', 'TelemetryTimeline?'],
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, EventBus, TelemetryTimeline } = deps;
    const { logger } = Utils;

    const metrics = {
      toolCalls: 0,
      apiTokens: 0,
      apiLatency: [],
      errors: 0,
      startTime: Date.now()
    };

    const logTimeline = (type, payload, options = {}) => {
      if (!TelemetryTimeline) return;
      TelemetryTimeline.record(type, payload, options).catch((err) => {
        logger.warn('[PerfMon] Failed to record timeline entry', err?.message || err);
      });
    };

    const init = () => {
      // Listen to system events
      EventBus.on('agent:tool:start', (data = {}) => {
        metrics.toolCalls++;
        logTimeline('tool:start', { tool: data.tool, workerId: data.workerId }, { tags: ['tool'] });
      });
      EventBus.on('agent:error', (data = {}) => {
        metrics.errors++;
        logTimeline('agent:error', data, { severity: 'error', tags: ['agent'] });
      });

      // Listen for LLM stats (emitted by LLMClient if configured)
      EventBus.on('llm:complete', (data) => {
        if (data.tokens) metrics.apiTokens += data.tokens;
        if (data.latency) metrics.apiLatency.push(data.latency);
        logTimeline('llm:complete', {
          provider: data.provider,
          model: data.model,
          tokens: data.tokens,
          latency: data.latency
        }, { tags: ['llm'] });
      });

      logger.info('[PerfMon] Monitoring started');
    };

    const getReport = () => {
      const uptime = (Date.now() - metrics.startTime) / 1000;
      const avgLatency = metrics.apiLatency.reduce((a, b) => a + b, 0) / (metrics.apiLatency.length || 1);

      return {
        uptime: `${uptime.toFixed(0)}s`,
        toolsUsed: metrics.toolCalls,
        tokens: metrics.apiTokens,
        errors: metrics.errors,
        avgLatency: `${avgLatency.toFixed(0)}ms`
      };
    };

    return { init, getReport };
  }
};

export default PerformanceMonitor;
