/**
 * @fileoverview Observability
 * Token tracking, mutation stream, and decision trace with dashboard aggregation.
 */

const Observability = {
  metadata: {
    id: 'Observability',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'EventBus', 'VFS', 'ErrorStore?', 'PerformanceMonitor?'],
    async: true,
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { Utils, EventBus, VFS, ErrorStore, PerformanceMonitor } = deps;
    const { logger, generateId, trunc } = Utils;

    const MUTATION_LOG_DIR = '/.logs/mutations';
    const DECISION_LOG_DIR = '/.logs/decisions';
    const MAX_MUTATIONS = 1000;
    const MAX_DECISIONS = 200;
    const MAX_ERRORS = 200;

    const _mutations = [];
    const _decisions = [];
    const _errors = [];
    let _initialized = false;

    const IGNORE_PREFIXES = [MUTATION_LOG_DIR, DECISION_LOG_DIR];

    const shouldIgnorePath = (path) => {
      if (!path) return false;
      return IGNORE_PREFIXES.some(prefix => path.startsWith(prefix));
    };

    const estimateTokensFromText = (text) => {
      if (!text || typeof text !== 'string') return 0;
      const words = text.split(/\s+/).filter(Boolean).length;
      return Math.max(1, Math.ceil(words / 0.75));
    };

    const appendJsonl = async (dir, entry) => {
      if (!VFS) return;
      const date = new Date(entry.timestamp).toISOString().split('T')[0];
      const path = `${dir}/${date}.jsonl`;
      let content = '';

      try {
        if (await VFS.exists(path)) {
          content = await VFS.read(path);
        }
      } catch (err) {
        logger.warn('[Observability] Failed to read log file', { path, error: err.message });
      }

      try {
        await VFS.write(path, content + JSON.stringify(entry) + '\n');
      } catch (err) {
        logger.warn('[Observability] Failed to write log entry', { path, error: err.message });
      }
    };

    // --- Token Tracking ---
    const _tokenUsage = {
      session: { input: 0, output: 0, total: 0 },
      byModel: {},
      history: []
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

    const estimateCost = (model, inputTokens, outputTokens) => {
      const rates = COST_PER_1K[model] || COST_PER_1K.default;
      return (inputTokens / 1000) * rates.input + (outputTokens / 1000) * rates.output;
    };

    const recordTokens = (usage = {}) => {
      const model = usage.model || 'unknown';
      const provider = usage.provider || 'unknown';
      const inputTokens = Number.isFinite(usage.inputTokens)
        ? usage.inputTokens
        : estimateTokensFromText(usage.inputText);
      const outputTokens = Number.isFinite(usage.outputTokens)
        ? usage.outputTokens
        : estimateTokensFromText(usage.outputText);
      const total = inputTokens + outputTokens;

      _tokenUsage.session.input += inputTokens;
      _tokenUsage.session.output += outputTokens;
      _tokenUsage.session.total += total;

      if (!_tokenUsage.byModel[model]) {
        _tokenUsage.byModel[model] = { input: 0, output: 0, total: 0, calls: 0, provider };
      }
      _tokenUsage.byModel[model].input += inputTokens;
      _tokenUsage.byModel[model].output += outputTokens;
      _tokenUsage.byModel[model].total += total;
      _tokenUsage.byModel[model].calls += 1;

      _tokenUsage.history.push({
        timestamp: Date.now(),
        model,
        provider,
        inputTokens,
        outputTokens,
        total
      });
      if (_tokenUsage.history.length > 100) _tokenUsage.history.shift();

      EventBus.emit('observability:tokens', {
        session: { ..._tokenUsage.session },
        latest: { model, inputTokens, outputTokens, total }
      });
    };

    const getTokenUsage = () => {
      const sessionCost = Object.entries(_tokenUsage.byModel).reduce((sum, [model, usage]) => {
        return sum + estimateCost(model, usage.input, usage.output);
      }, 0);

      return {
        session: { ..._tokenUsage.session, estimatedCost: sessionCost },
        byModel: { ..._tokenUsage.byModel },
        history: [..._tokenUsage.history]
      };
    };

    // --- Mutation Stream ---
    const recordMutation = async (pathOrEntry, op, beforeBytes, afterBytes, meta = {}) => {
      const base = typeof pathOrEntry === 'object'
        ? { ...pathOrEntry }
        : { path: pathOrEntry, op, beforeBytes, afterBytes, ...meta };

      if (!base.path) return null;
      if (shouldIgnorePath(base.path)) return null;

      const entry = {
        id: generateId('mut'),
        timestamp: Date.now(),
        path: base.path,
        op: base.op || base.operation || 'unknown',
        beforeBytes: Number.isFinite(base.beforeBytes) ? base.beforeBytes : null,
        afterBytes: Number.isFinite(base.afterBytes) ? base.afterBytes : null,
        source: base.source || 'vfs'
      };

      _mutations.push(entry);
      if (_mutations.length > MAX_MUTATIONS) {
        const overflow = _mutations.shift();
        if (overflow) {
          await appendJsonl(MUTATION_LOG_DIR, overflow);
        }
      }

      EventBus.emit('observability:mutation', entry);
      return entry;
    };

    const getMutations = (limit = 100) => {
      if (limit <= 0) return [];
      return _mutations.slice(Math.max(0, _mutations.length - limit));
    };

    // --- Decision Trace ---
    const recordDecision = async (decisionOrGoal, context, reasoning, action, meta = {}) => {
      const base = typeof decisionOrGoal === 'object'
        ? { ...decisionOrGoal }
        : { goal: decisionOrGoal, context, reasoning, action, ...meta };

      const entry = {
        id: generateId('dec'),
        timestamp: Date.now(),
        goal: base.goal || null,
        cycle: Number.isFinite(base.cycle) ? base.cycle : null,
        context: base.context ? trunc(base.context, 2000) : null,
        reasoning: base.reasoning ? trunc(base.reasoning, 2000) : null,
        action: base.action || null,
        model: base.model || null,
        provider: base.provider || null
      };

      _decisions.push(entry);
      if (_decisions.length > MAX_DECISIONS) _decisions.shift();

      await appendJsonl(DECISION_LOG_DIR, entry);
      EventBus.emit('observability:decision', entry);
      return entry;
    };

    const getDecisions = (limit = 50) => {
      if (limit <= 0) return [];
      return _decisions.slice(Math.max(0, _decisions.length - limit));
    };

    // --- Errors ---
    const loadErrors = async () => {
      if (!ErrorStore?.getErrors) return;
      try {
        const errors = await ErrorStore.getErrors();
        _errors.length = 0;
        _errors.push(...errors.slice(0, MAX_ERRORS));
      } catch (err) {
        logger.warn('[Observability] Failed to load errors', err.message);
      }
    };

    const addError = (error) => {
      if (!error) return;
      _errors.unshift(error);
      if (_errors.length > MAX_ERRORS) _errors.length = MAX_ERRORS;
    };

    const clearErrors = () => {
      _errors.length = 0;
    };

    // --- Dashboard ---
    const getDashboard = () => {
      const performance = PerformanceMonitor?.getMetrics
        ? {
          metrics: PerformanceMonitor.getMetrics(),
          memory: PerformanceMonitor.getMemoryStats?.(),
          llm: PerformanceMonitor.getLLMStats?.(),
          report: PerformanceMonitor.getReport?.()
        }
        : null;

      return {
        tokens: getTokenUsage(),
        mutations: {
          recent: getMutations(20),
          total: _mutations.length
        },
        decisions: {
          recent: getDecisions(20),
          total: _decisions.length
        },
        performance,
        errors: [..._errors]
      };
    };

    // --- Event Wiring ---
    const _wireEventBus = () => {
      EventBus.on('vfs:file_changed', (data = {}) => {
        recordMutation({
          path: data.path,
          op: data.operation || 'unknown',
          beforeBytes: data.beforeSize,
          afterBytes: data.afterSize ?? data.size,
          source: 'vfs'
        }).catch(() => {});
      }, 'Observability');

      EventBus.on('agent:decision', (data = {}) => {
        recordDecision(data).catch(() => {});
      }, 'Observability');

      EventBus.on('llm:complete', (data = {}) => {
        recordTokens({
          model: data.model,
          provider: data.provider,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          inputText: data.inputText,
          outputText: data.outputText
        });
      }, 'Observability');

      EventBus.on('error:added', (error) => addError(error), 'Observability');
      EventBus.on('error:cleared', () => clearErrors(), 'Observability');
    };

    const init = async () => {
      if (_initialized) return true;
      await loadErrors();
      _wireEventBus();
      _initialized = true;
      logger.info('[Observability] Initialized');
      return true;
    };

    return {
      init,
      // Tokens
      recordTokens,
      getTokenUsage,
      estimateCost,
      // Mutations
      recordMutation,
      getMutations,
      // Decisions
      recordDecision,
      getDecisions,
      // Dashboard
      getDashboard
    };
  }
};

export default Observability;
