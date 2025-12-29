/**
 * @fileoverview Observability
 * Token tracking, mutation stream, and decision trace with dashboard aggregation.
 */

const Observability = {
  metadata: {
    id: 'Observability',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'EventBus', 'VFS', 'ErrorStore?', 'PerformanceMonitor?', 'ReflectionStore?', 'PromptScoreMap?'],
    async: true,
    type: 'infrastructure'
  },

  factory: (deps) => {
    const { Utils, EventBus, VFS, ErrorStore, PerformanceMonitor, ReflectionStore, PromptScoreMap } = deps;
    const { logger, generateId, trunc } = Utils;

    const MUTATION_LOG_DIR = '/.logs/mutations';
    const DECISION_LOG_DIR = '/.logs/decisions';
    const SUBSTRATE_LOG_DIR = '/.logs/substrate';
    const MAX_MUTATIONS = 1000;
    const MAX_DECISIONS = 200;
    const MAX_ERRORS = 200;

    const _mutations = [];
    const _decisions = [];
    const _errors = [];
    const _arenaResults = [];
    const MAX_ARENA_RESULTS = 100;
    let _initialized = false;

    const IGNORE_PREFIXES = [MUTATION_LOG_DIR, DECISION_LOG_DIR, SUBSTRATE_LOG_DIR];

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

    // --- Arena Results (Success Rate Tracking) ---
    const recordArenaResult = (result = {}) => {
      const entry = {
        id: generateId('arena'),
        timestamp: Date.now(),
        passed: Boolean(result.passed),
        passRate: Number.isFinite(result.passRate) ? result.passRate : null,
        task: result.task || null,
        level: result.level || null, // L1, L2, L3
        competitorCount: Number.isFinite(result.competitorCount) ? result.competitorCount : null
      };

      _arenaResults.push(entry);
      if (_arenaResults.length > MAX_ARENA_RESULTS) _arenaResults.shift();

      EventBus.emit('observability:arena_result', entry);
      return entry;
    };

    const getSuccessRate = (windowSize = 10) => {
      if (_arenaResults.length === 0) return { rate: 0, count: 0, passed: 0, failed: 0 };

      const window = _arenaResults.slice(Math.max(0, _arenaResults.length - windowSize));
      const passed = window.filter(r => r.passed).length;
      const failed = window.length - passed;
      const rate = window.length > 0 ? (passed / window.length) * 100 : 0;

      return {
        rate: Math.round(rate * 100) / 100, // 2 decimal places
        count: window.length,
        passed,
        failed,
        window: windowSize,
        oldest: window[0]?.timestamp || null,
        newest: window[window.length - 1]?.timestamp || null
      };
    };

    const getArenaResults = (limit = 20) => {
      if (limit <= 0) return [];
      return _arenaResults.slice(Math.max(0, _arenaResults.length - limit));
    };

    // --- L3 Substrate Change Logging ---
    const CORE_PREFIXES = ['/core/', '/infrastructure/'];

    const isSubstrateChange = (path) => {
      if (!path) return false;
      return CORE_PREFIXES.some(prefix => path.startsWith(prefix));
    };

    const recordSubstrateChange = async (change = {}) => {
      const entry = {
        id: generateId('sub'),
        timestamp: Date.now(),
        path: change.path || null,
        op: change.op || 'write',
        passed: Boolean(change.passed),
        passRate: Number.isFinite(change.passRate) ? change.passRate : null,
        rolledBack: Boolean(change.rolledBack),
        reason: change.reason || null,
        beforeHash: change.beforeHash || null,
        afterHash: change.afterHash || null
      };

      // Always persist L3 changes to JSONL (audit trail)
      await appendJsonl(SUBSTRATE_LOG_DIR, entry);

      EventBus.emit('observability:substrate_change', entry);
      logger.info(`[Observability] L3 substrate change: ${entry.path} (passed: ${entry.passed})`);
      return entry;
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
        arena: {
          recent: getArenaResults(20),
          total: _arenaResults.length,
          successRate: getSuccessRate(10)
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

      // Wire arena completion for success rate tracking
      EventBus.on('arena:complete', (data = {}) => {
        const summary = data.summary || {};
        const passed = summary.passRate >= 80; // 80% threshold for "passed"

        recordArenaResult({
          passed,
          passRate: summary.passRate,
          task: data.task,
          level: data.level,
          competitorCount: summary.total
        });

        // Persist to ReflectionStore for long-term tracking
        if (ReflectionStore?.add) {
          ReflectionStore.add({
            type: passed ? 'success' : 'error',
            content: `Arena: ${summary.passRate}% pass rate (${summary.passed}/${summary.total})`,
            context: {
              outcome: passed ? 'successful' : 'failed',
              passRate: summary.passRate,
              passed: summary.passed,
              total: summary.total,
              winner: summary.fastestPassing,
              task: data.task,
              level: data.level
            },
            tags: ['arena', data.level || 'unknown'].filter(Boolean),
            description: `Arena ${passed ? 'passed' : 'failed'}: ${summary.passRate}%`
          }).catch(err => {
            logger.warn('[Observability] Failed to persist arena result', err.message);
          });
        }

        // Track task/prompt performance for RSI selection
        if (PromptScoreMap?.record && data.task) {
          PromptScoreMap.record(data.task, summary.passRate, data.level || 'default');
        }
      }, 'Observability');
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
      // Arena / Success Rate
      recordArenaResult,
      getArenaResults,
      getSuccessRate,
      // L3 Substrate
      isSubstrateChange,
      recordSubstrateChange,
      // Dashboard
      getDashboard
    };
  }
};

export default Observability;
