/**
 * @fileoverview Observability - Token tracking, mutation stream, and metrics
 * Real-time visibility into agent behavior and resource usage.
 */

const Observability = {
  metadata: {
    id: 'Observability',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'EventBus', 'StateManager?'],
    async: false,
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { Utils, EventBus, StateManager } = deps;
    const { logger } = Utils;

    // --- Token Tracking ---
    const _tokenUsage = {
      session: { input: 0, output: 0, total: 0 },
      daily: { input: 0, output: 0, total: 0, date: null },
      byModel: {},
      history: [] // Last 100 requests
    };

    const COST_PER_1K = {
      'gpt-4': { input: 0.03, output: 0.06 },
      'gpt-4-turbo': { input: 0.01, output: 0.03 },
      'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
      'claude-3-opus': { input: 0.015, output: 0.075 },
      'claude-3-sonnet': { input: 0.003, output: 0.015 },
      'claude-3-haiku': { input: 0.00025, output: 0.00125 },
      'gemini-pro': { input: 0.00025, output: 0.0005 },
      'gemini-1.5-pro': { input: 0.00125, output: 0.005 },
      default: { input: 0.001, output: 0.002 }
    };

    /**
     * Record token usage from an LLM call
     * @param {Object} usage - { inputTokens, outputTokens, model, provider }
     */
    const recordTokens = (usage) => {
      const { inputTokens = 0, outputTokens = 0, model = 'unknown', provider = 'unknown' } = usage;
      const total = inputTokens + outputTokens;

      // Update session totals
      _tokenUsage.session.input += inputTokens;
      _tokenUsage.session.output += outputTokens;
      _tokenUsage.session.total += total;

      // Update daily totals
      const today = new Date().toISOString().split('T')[0];
      if (_tokenUsage.daily.date !== today) {
        _tokenUsage.daily = { input: 0, output: 0, total: 0, date: today };
      }
      _tokenUsage.daily.input += inputTokens;
      _tokenUsage.daily.output += outputTokens;
      _tokenUsage.daily.total += total;

      // Track by model
      if (!_tokenUsage.byModel[model]) {
        _tokenUsage.byModel[model] = { input: 0, output: 0, total: 0, calls: 0 };
      }
      _tokenUsage.byModel[model].input += inputTokens;
      _tokenUsage.byModel[model].output += outputTokens;
      _tokenUsage.byModel[model].total += total;
      _tokenUsage.byModel[model].calls++;

      // Add to history
      _tokenUsage.history.push({
        timestamp: Date.now(),
        model,
        provider,
        inputTokens,
        outputTokens,
        total
      });
      if (_tokenUsage.history.length > 100) {
        _tokenUsage.history.shift();
      }

      // Emit event for UI
      EventBus.emit('observability:tokens', {
        session: { ..._tokenUsage.session },
        daily: { ..._tokenUsage.daily },
        latest: { model, inputTokens, outputTokens, total }
      });
    };

    /**
     * Estimate cost for token usage
     * @param {string} model - Model name
     * @param {number} inputTokens
     * @param {number} outputTokens
     * @returns {number} Estimated cost in USD
     */
    const estimateCost = (model, inputTokens, outputTokens) => {
      const rates = COST_PER_1K[model] || COST_PER_1K.default;
      return (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output;
    };

    /**
     * Get token usage summary
     */
    const getTokenUsage = () => {
      const sessionCost = Object.entries(_tokenUsage.byModel).reduce((sum, [model, usage]) => {
        return sum + estimateCost(model, usage.input, usage.output);
      }, 0);

      return {
        session: { ..._tokenUsage.session, estimatedCost: sessionCost },
        daily: { ..._tokenUsage.daily },
        byModel: { ..._tokenUsage.byModel },
        history: [..._tokenUsage.history]
      };
    };

    // --- Mutation Stream ---
    const _mutations = [];
    const MAX_MUTATIONS = 500;

    /**
     * Record a VFS mutation
     * @param {Object} mutation - { type, path, bytesBefore, bytesAfter, source }
     */
    const recordMutation = (mutation) => {
      const entry = {
        id: Utils.generateId('mut'),
        timestamp: Date.now(),
        ...mutation
      };

      _mutations.push(entry);
      if (_mutations.length > MAX_MUTATIONS) {
        _mutations.shift();
      }

      EventBus.emit('observability:mutation', entry);
    };

    /**
     * Get mutation history
     * @param {Object} [filter] - { type, path, since }
     */
    const getMutations = (filter = {}) => {
      let result = [..._mutations];

      if (filter.type) {
        result = result.filter(m => m.type === filter.type);
      }
      if (filter.path) {
        result = result.filter(m => m.path.includes(filter.path));
      }
      if (filter.since) {
        result = result.filter(m => m.timestamp >= filter.since);
      }

      return result;
    };

    // --- Agent Decision Trace ---
    const _decisionTrace = [];
    const MAX_DECISIONS = 200;

    /**
     * Record an agent decision point
     * @param {Object} decision - { cycle, type, input, output, reasoning }
     */
    const recordDecision = (decision) => {
      const entry = {
        id: Utils.generateId('dec'),
        timestamp: Date.now(),
        ...decision
      };

      _decisionTrace.push(entry);
      if (_decisionTrace.length > MAX_DECISIONS) {
        _decisionTrace.shift();
      }

      EventBus.emit('observability:decision', entry);
    };

    /**
     * Get decision trace
     * @param {number} [limit] - Max entries to return
     */
    const getDecisionTrace = (limit = 50) => {
      return _decisionTrace.slice(-limit);
    };

    // --- Performance Metrics ---
    const _metrics = {
      llmLatency: [], // Last 50 LLM call latencies
      toolLatency: {}, // By tool name
      errorRate: { total: 0, errors: 0 }
    };

    /**
     * Record LLM latency
     */
    const recordLLMLatency = (ms, model) => {
      _metrics.llmLatency.push({ ms, model, timestamp: Date.now() });
      if (_metrics.llmLatency.length > 50) {
        _metrics.llmLatency.shift();
      }
    };

    /**
     * Record tool execution latency
     */
    const recordToolLatency = (tool, ms, success) => {
      if (!_metrics.toolLatency[tool]) {
        _metrics.toolLatency[tool] = { calls: 0, totalMs: 0, errors: 0 };
      }
      _metrics.toolLatency[tool].calls++;
      _metrics.toolLatency[tool].totalMs += ms;
      if (!success) _metrics.toolLatency[tool].errors++;

      _metrics.errorRate.total++;
      if (!success) _metrics.errorRate.errors++;
    };

    /**
     * Get performance metrics summary
     */
    const getMetrics = () => {
      const avgLLMLatency = _metrics.llmLatency.length > 0
        ? _metrics.llmLatency.reduce((sum, l) => sum + l.ms, 0) / _metrics.llmLatency.length
        : 0;

      const toolMetrics = {};
      for (const [tool, data] of Object.entries(_metrics.toolLatency)) {
        toolMetrics[tool] = {
          calls: data.calls,
          avgMs: data.calls > 0 ? Math.round(data.totalMs / data.calls) : 0,
          errorRate: data.calls > 0 ? (data.errors / data.calls * 100).toFixed(1) + '%' : '0%'
        };
      }

      return {
        llm: {
          avgLatencyMs: Math.round(avgLLMLatency),
          recentCalls: _metrics.llmLatency.length
        },
        tools: toolMetrics,
        errorRate: _metrics.errorRate.total > 0
          ? (_metrics.errorRate.errors / _metrics.errorRate.total * 100).toFixed(1) + '%'
          : '0%'
      };
    };

    // --- Event Subscriptions ---
    const init = () => {
      // Subscribe to relevant events
      EventBus.on('agent:history', (data) => {
        if (data.type === 'llm_response') {
          recordDecision({
            cycle: data.cycle,
            type: 'llm_response',
            outputLength: data.content?.length || 0
          });
        } else if (data.type === 'tool_result') {
          recordDecision({
            cycle: data.cycle,
            type: 'tool_call',
            tool: data.tool,
            success: !data.result?.startsWith('Error:')
          });
        }
      }, 'Observability');

      EventBus.on('vfs:write', (data) => {
        recordMutation({ type: 'write', path: data.path, source: 'tool' });
      }, 'Observability');

      EventBus.on('artifact:created', (data) => {
        recordMutation({ type: 'create', path: data.path, source: 'tool' });
      }, 'Observability');

      EventBus.on('artifact:deleted', (data) => {
        recordMutation({ type: 'delete', path: data.path, source: 'tool' });
      }, 'Observability');

      logger.info('[Observability] Initialized');
      return true;
    };

    /**
     * Reset all metrics (for new session)
     */
    const reset = () => {
      _tokenUsage.session = { input: 0, output: 0, total: 0 };
      _tokenUsage.byModel = {};
      _tokenUsage.history = [];
      _mutations.length = 0;
      _decisionTrace.length = 0;
      _metrics.llmLatency = [];
      _metrics.toolLatency = {};
      _metrics.errorRate = { total: 0, errors: 0 };

      EventBus.emit('observability:reset', {});
      logger.info('[Observability] Metrics reset');
    };

    /**
     * Get full observability dashboard data
     */
    const getDashboard = () => {
      return {
        tokens: getTokenUsage(),
        mutations: {
          recent: _mutations.slice(-20),
          total: _mutations.length
        },
        decisions: {
          recent: _decisionTrace.slice(-20),
          total: _decisionTrace.length
        },
        metrics: getMetrics()
      };
    };

    return {
      init,
      reset,
      // Token tracking
      recordTokens,
      getTokenUsage,
      estimateCost,
      // Mutation stream
      recordMutation,
      getMutations,
      // Decision trace
      recordDecision,
      getDecisionTrace,
      // Performance
      recordLLMLatency,
      recordToolLatency,
      getMetrics,
      // Dashboard
      getDashboard
    };
  }
};

export default Observability;
