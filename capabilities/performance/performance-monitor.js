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
      session: { startTime: Date.now() },
      tools: {},
      errors: 0
    };

    const llmStats = {
      calls: 0,
      tokens: { input: 0, output: 0, total: 0 },
      latencies: [],
      errorCount: 0,
      lastCall: null
    };

    const memoryStats = {
      history: [],
      current: null,
      max: 0,
      intervalId: null
    };

    const MAX_LATENCY_SAMPLES = 50;
    const MAX_MEMORY_SAMPLES = 120;
    const MEMORY_SAMPLE_INTERVAL_MS = 30000;

    const logTimeline = (type, payload, options = {}) => {
      if (!TelemetryTimeline) return;
      TelemetryTimeline.record(type, payload, options).catch((err) => {
        logger.warn('[PerfMon] Failed to record timeline entry', err?.message || err);
      });
    };

    const sampleMemory = () => {
      if (typeof performance === 'undefined' || !performance.memory) return;
      const snapshot = {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        timestamp: Date.now()
      };
      memoryStats.current = snapshot;
      memoryStats.max = Math.max(memoryStats.max, snapshot.usedJSHeapSize || 0);
      memoryStats.history.push(snapshot);
      if (memoryStats.history.length > MAX_MEMORY_SAMPLES) memoryStats.history.shift();
    };

    const init = () => {
      EventBus.on('agent:tool:end', (data = {}) => {
        const name = data.tool || 'unknown';
        if (!metrics.tools[name]) {
          metrics.tools[name] = { calls: 0, totalTime: 0, errors: 0 };
        }
        metrics.tools[name].calls += 1;
        if (Number.isFinite(data.durationMs)) {
          metrics.tools[name].totalTime += data.durationMs;
        }
        if (data.success === false) {
          metrics.tools[name].errors += 1;
        }

        logTimeline('tool:end', {
          tool: name,
          durationMs: data.durationMs,
          success: data.success,
          workerId: data.workerId
        }, { tags: ['tool'] });
      });

      EventBus.on('agent:error', (data = {}) => {
        metrics.errors += 1;
        logTimeline('agent:error', data, { severity: 'error', tags: ['agent'] });
      });

      EventBus.on('llm:complete', (data = {}) => {
        llmStats.calls += 1;
        llmStats.lastCall = Date.now();
        if (Number.isFinite(data.inputTokens)) llmStats.tokens.input += data.inputTokens;
        if (Number.isFinite(data.outputTokens)) llmStats.tokens.output += data.outputTokens;
        if (Number.isFinite(data.tokens)) {
          llmStats.tokens.total += data.tokens;
        } else {
          llmStats.tokens.total += (data.inputTokens || 0) + (data.outputTokens || 0);
        }
        if (Number.isFinite(data.latency)) {
          llmStats.latencies.push(data.latency);
          if (llmStats.latencies.length > MAX_LATENCY_SAMPLES) llmStats.latencies.shift();
        }

        logTimeline('llm:complete', {
          provider: data.provider,
          model: data.model,
          tokens: data.tokens,
          latency: data.latency
        }, { tags: ['llm'] });
      });

      if (typeof performance !== 'undefined' && performance.memory) {
        sampleMemory();
        memoryStats.intervalId = setInterval(sampleMemory, MEMORY_SAMPLE_INTERVAL_MS);
      }

      logger.info('[PerfMon] Monitoring started');
    };

    const getMetrics = () => {
      const uptime = Date.now() - metrics.session.startTime;
      return {
        session: { uptime },
        tools: { ...metrics.tools },
        errors: metrics.errors
      };
    };

    const getMemoryStats = () => ({
      current: memoryStats.current,
      history: [...memoryStats.history],
      max: memoryStats.max
    });

    const getLLMStats = () => {
      const avgLatency = llmStats.latencies.length > 0
        ? llmStats.latencies.reduce((a, b) => a + b, 0) / llmStats.latencies.length
        : 0;
      const errorRate = llmStats.calls > 0
        ? llmStats.errorCount / llmStats.calls
        : 0;

      return {
        calls: llmStats.calls,
        tokens: { ...llmStats.tokens },
        avgLatency,
        errorRate,
        lastCall: llmStats.lastCall
      };
    };

    const getReport = () => {
      const metricsSnapshot = getMetrics();
      const llmSnapshot = getLLMStats();
      const uptimeSec = Math.floor(metricsSnapshot.session.uptime / 1000);

      return {
        uptime: `${uptimeSec}s`,
        toolsUsed: Object.values(metricsSnapshot.tools).reduce((sum, t) => sum + t.calls, 0),
        tokens: llmSnapshot.tokens.total,
        errors: metricsSnapshot.errors,
        avgLatency: `${llmSnapshot.avgLatency.toFixed(0)}ms`
      };
    };

    const generateReport = () => {
      const report = getReport();
      return [
        '# Performance Report',
        '',
        `Uptime: ${report.uptime}`,
        `Tools Used: ${report.toolsUsed}`,
        `Tokens: ${report.tokens}`,
        `Errors: ${report.errors}`,
        `Avg Latency: ${report.avgLatency}`
      ].join('\n');
    };

    const destroy = () => {
      if (memoryStats.intervalId) {
        clearInterval(memoryStats.intervalId);
        memoryStats.intervalId = null;
      }
    };

    return {
      init,
      getMetrics,
      getMemoryStats,
      getLLMStats,
      getReport,
      generateReport,
      destroy
    };
  }
};

export default PerformanceMonitor;
