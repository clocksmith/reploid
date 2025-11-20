/**
 * @fileoverview Performance Monitor
 * Tracks system metrics and tool execution stats.
 */

const PerformanceMonitor = {
  metadata: {
    id: 'PerformanceMonitor',
    version: '2.0.0',
    dependencies: ['Utils', 'EventBus'],
    type: 'capability'
  },

  factory: (deps) => {
    const { Utils, EventBus } = deps;
    const { logger } = Utils;

    const metrics = {
      toolCalls: 0,
      apiTokens: 0,
      apiLatency: [],
      errors: 0,
      startTime: Date.now()
    };

    const init = () => {
      // Listen to system events
      EventBus.on('agent:tool:start', () => metrics.toolCalls++);
      EventBus.on('agent:error', () => metrics.errors++);

      // Listen for LLM stats (emitted by LLMClient if configured)
      EventBus.on('llm:complete', (data) => {
        if (data.tokens) metrics.apiTokens += data.tokens;
        if (data.latency) metrics.apiLatency.push(data.latency);
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
