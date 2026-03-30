/**
 * @fileoverview Multi-Model Evaluator
 * Runs task suites across model configs and scores outputs.
 */

const MultiModelEvaluator = {
  metadata: {
    id: 'MultiModelEvaluator',
    version: '1.0.0',
    genesis: { introduced: 'full' },
    dependencies: ['Utils', 'LLMClient', 'EventBus?', 'SchemaRegistry?', 'VFS?'],
    async: true,
    type: 'core'
  },

  factory: (deps) => {
    const { Utils, LLMClient, EventBus, SchemaRegistry, VFS } = deps;
    const { Errors, generateId, logger } = Utils;

    const DEFAULT_MODEL_CONCURRENCY = 2;
    const DEFAULT_LENGTH_TARGET = 400;
    const RUN_DIR = '/.memory/multi-model-eval';
    const INDEX_PATH = `${RUN_DIR}/index.jsonl`;

    const emit = (event, payload) => {
      if (EventBus) {
        EventBus.emit(event, payload);
      }
    };

    const ensureRunDir = async () => {
      if (!VFS) return false;
      try {
        if (!await VFS.exists(RUN_DIR)) {
          await VFS.mkdir(RUN_DIR);
        }
        return true;
      } catch (err) {
        logger.warn('[MultiModelEvaluator] Failed to create run directory', err?.message || err);
        return false;
      }
    };

    const sanitizeOptions = (options) => {
      if (!options || typeof options !== 'object') return {};
      const { scoreOutput, persist, ...rest } = options;
      return rest;
    };

    const normalizePersistConfig = (persist) => {
      if (!persist) return null;
      if (persist === true) {
        return {
          enabled: true,
          includeInputs: true,
          includeOutputs: true,
          includeOptions: true,
          path: null
        };
      }
      if (typeof persist === 'object') {
        return {
          enabled: true,
          includeInputs: persist.includeInputs !== false,
          includeOutputs: persist.includeOutputs !== false,
          includeOptions: persist.includeOptions !== false,
          path: persist.path || null
        };
      }
      return null;
    };

    const appendIndex = async (entry) => {
      if (!VFS) return false;
      try {
        let content = '';
        if (await VFS.exists(INDEX_PATH)) {
          content = await VFS.read(INDEX_PATH);
        }
        content += JSON.stringify(entry) + '\n';
        await VFS.write(INDEX_PATH, content);
        return true;
      } catch (err) {
        logger.warn('[MultiModelEvaluator] Failed to append index', err?.message || err);
        return false;
      }
    };

    const persistRun = async (record, config) => {
      if (!VFS) return { ok: false, reason: 'VFS unavailable' };
      const ok = await ensureRunDir();
      if (!ok) return { ok: false, reason: 'Failed to prepare run directory' };
      const runPath = config?.path || `${RUN_DIR}/${record.runId}.json`;
      try {
        await VFS.write(runPath, JSON.stringify(record, null, 2));
        await appendIndex({
          runId: record.runId,
          createdAt: record.persistedAt,
          path: runPath,
          totals: record.totals,
          summary: record.summary
        });
        return { ok: true, path: runPath };
      } catch (err) {
        logger.warn('[MultiModelEvaluator] Failed to persist run', err?.message || err);
        return { ok: false, reason: 'Persist failed' };
      }
    };

    const loadRun = async (runId) => {
      if (!VFS || !runId) return null;
      const runPath = `${RUN_DIR}/${runId}.json`;
      try {
        if (!await VFS.exists(runPath)) return null;
        return JSON.parse(await VFS.read(runPath));
      } catch (err) {
        logger.warn('[MultiModelEvaluator] Failed to load run', err?.message || err);
        return null;
      }
    };

    const listRuns = async (limit = 25) => {
      if (!VFS) return [];
      try {
        if (!await VFS.exists(INDEX_PATH)) return [];
        const content = await VFS.read(INDEX_PATH);
        const lines = content.split('\n').filter(Boolean);
        const recent = lines.slice(-limit);
        return recent.map((line) => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean);
      } catch (err) {
        logger.warn('[MultiModelEvaluator] Failed to list runs', err?.message || err);
        return [];
      }
    };

    const replayRun = async (runId, options = {}) => {
      const record = await loadRun(runId);
      if (!record) {
        throw new Errors.StateError(`MultiModelEvaluator run not found: ${runId}`);
      }
      if (!Array.isArray(record.tasks) || !Array.isArray(record.modelConfigs)) {
        throw new Errors.StateError('MultiModelEvaluator replay missing inputs');
      }
      const mergedOptions = {
        ...record.options,
        ...options,
        runId: options.runId || generateId('mmeval_replay')
      };
      return evaluate(record.tasks, record.modelConfigs, mergedOptions);
    };

    const nowMs = () => (
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now()
    );

    const resolveTimeoutMs = (task, options) => {
      const taskTimeout = task?.timeoutMs;
      if (Number.isFinite(taskTimeout) && taskTimeout > 0) return taskTimeout;
      const optionTimeout = options?.timeoutMs;
      if (Number.isFinite(optionTimeout) && optionTimeout > 0) return optionTimeout;
      return 0;
    };

    const runWithTimeout = async (promise, timeoutMs) => {
      if (!timeoutMs) return promise;
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          const err = new Error(`MultiModelEvaluator timeout after ${timeoutMs}ms`);
          err.code = 'TIMEOUT';
          reject(err);
        }, timeoutMs);
      });
      try {
        return await Promise.race([promise, timeoutPromise]);
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    };

    const estimateTokens = (text) => {
      if (!text || typeof text !== 'string') return 0;
      const words = text.split(/\s+/).filter(Boolean).length;
      return Math.ceil(words / 0.7);
    };

    const buildMessages = (task) => {
      if (Array.isArray(task?.messages) && task.messages.length > 0) {
        return task.messages;
      }
      const content = task?.prompt || task?.description || '';
      return [{ role: 'user', content }];
    };

    const scoreOutput = (task, output, modelId, options = {}) => {
      if (typeof options.scoreOutput === 'function') {
        return options.scoreOutput({ task, output, modelId, SchemaRegistry });
      }

      let valid = true;
      const errors = [];
      let score = 0.5;

      if (task?.schema && SchemaRegistry?.validateCombinedOutput) {
        const validation = SchemaRegistry.validateCombinedOutput({ [modelId]: output }, task.schema);
        valid = validation.valid;
        if (!validation.valid && Array.isArray(validation.errors)) {
          errors.push(...validation.errors);
        }
        score = validation.valid ? 0.7 : 0.1;
      }

      if (task?.expected !== undefined) {
        const expected = String(task.expected).trim().toLowerCase();
        const actual = String(output || '').trim().toLowerCase();
        const matchMode = task.matchMode || options.matchMode || 'contains';
        const matches = matchMode === 'exact'
          ? actual === expected
          : actual.includes(expected);

        if (!matches) {
          valid = false;
          errors.push('Expected output mismatch');
          score = Math.max(0, score - 0.2);
        } else {
          score = Math.min(1, score + 0.2);
        }
      }

      const lengthTarget = options.lengthTarget || DEFAULT_LENGTH_TARGET;
      if (lengthTarget > 0) {
        const lengthScore = Math.min(1, (output || '').length / lengthTarget) * 0.2;
        score = Math.min(1, score + lengthScore);
      }

      return { score, valid, errors };
    };

    const summarizeResults = (results, meta = {}) => {
      const total = results.length;
      if (total === 0) {
        return {
          total: 0,
          successRate: 0,
          avgScore: 0,
          avgLatencyMs: 0,
          avgTokens: 0,
          errorCount: 0,
          aborted: !!meta.aborted
        };
      }

      const successes = results.filter(r => r.valid && !r.error).length;
      const errorCount = results.filter(r => r.error).length;
      const avgScore = results.reduce((sum, r) => sum + (r.score || 0), 0) / total;
      const avgLatencyMs = results.reduce((sum, r) => sum + (r.durationMs || 0), 0) / total;
      const avgTokens = results.reduce((sum, r) => sum + (r.tokens || 0), 0) / total;

      return {
        total,
        successRate: successes / total,
        avgScore,
        avgLatencyMs,
        avgTokens,
        errorCount,
        aborted: !!meta.aborted
      };
    };

    const runTask = async (task, modelConfig, options = {}) => {
      const modelId = modelConfig?.id || modelConfig?.modelId || modelConfig?.provider || 'unknown';
      const taskId = task?.id || generateId('mmeval_task');
      const messages = buildMessages(task);
      const timeoutMs = resolveTimeoutMs(task, options);

      const started = nowMs();
      try {
        const response = await runWithTimeout(
          LLMClient.chat(messages, modelConfig, null, task?.chatOptions || options.chatOptions || {}),
          timeoutMs
        );
        const output = response?.content || '';
        const durationMs = nowMs() - started;
        const tokens = estimateTokens(output);
        const scoring = scoreOutput(task, output, modelId, options);

        return {
          taskId,
          modelId,
          output,
          score: scoring.score,
          valid: scoring.valid,
          errors: scoring.errors,
          durationMs,
          tokens
        };
      } catch (err) {
        const durationMs = nowMs() - started;
        const isTimeout = err?.code === 'TIMEOUT' || String(err?.message || '').toLowerCase().includes('timeout');
        return {
          taskId,
          modelId,
          output: '',
          score: 0,
          valid: false,
          errors: [err?.message || String(err)],
          durationMs,
          tokens: 0,
          error: err?.message || String(err),
          timeout: isTimeout
        };
      }
    };

    const runWithConcurrency = async (items, concurrency, worker) => {
      const results = new Array(items.length);
      let cursor = 0;

      const runNext = async () => {
        const idx = cursor++;
        if (idx >= items.length) return;
        results[idx] = await worker(items[idx], idx);
        await runNext();
      };

      const runners = Array.from(
        { length: Math.max(1, Math.min(concurrency, items.length)) },
        () => runNext()
      );

      await Promise.all(runners);
      return results;
    };

    const evaluate = async (tasks = [], modelConfigs = [], options = {}) => {
      if (!Array.isArray(tasks) || tasks.length === 0) {
        throw new Errors.ValidationError('Task list required');
      }
      if (!Array.isArray(modelConfigs) || modelConfigs.length === 0) {
        throw new Errors.ValidationError('Model configs required');
      }

      const runId = options.runId || generateId('mmeval');
      const startedAt = Date.now();
      const totalRuns = tasks.length * modelConfigs.length;
      let completed = 0;

      emit('multi-model:eval:start', {
        runId,
        tasks: tasks.length,
        models: modelConfigs.length,
        totalRuns
      });

      const modelConcurrency = options.modelConcurrency || DEFAULT_MODEL_CONCURRENCY;
      const abortOnError = options.abortOnError === true;

      const modelResults = await runWithConcurrency(modelConfigs, modelConcurrency, async (modelConfig) => {
        const modelId = modelConfig?.id || modelConfig?.modelId || modelConfig?.provider || 'unknown';
        const results = [];
        let aborted = false;

        for (const task of tasks) {
          const result = await runTask(task, modelConfig, options);
          results.push(result);
          completed += 1;

          emit('multi-model:eval:progress', {
            runId,
            modelId,
            taskId: result.taskId,
            completed,
            totalRuns
          });

          if (abortOnError && result.error) {
            aborted = true;
            break;
          }
        }

        return {
          modelId,
          results,
          summary: summarizeResults(results, { aborted })
        };
      });

      const finishedAt = Date.now();
      const summary = modelResults.map((entry) => ({
        modelId: entry.modelId,
        ...entry.summary
      }));

      emit('multi-model:eval:complete', {
        runId,
        durationMs: finishedAt - startedAt,
        summary
      });

      const persistConfig = normalizePersistConfig(options.persist);
      const record = persistConfig ? {
        runId,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        totals: {
          tasks: tasks.length,
          models: modelConfigs.length,
          totalRuns
        },
        summary,
        models: persistConfig.includeOutputs ? modelResults : [],
        tasks: persistConfig.includeInputs ? tasks : [],
        modelConfigs: persistConfig.includeInputs ? modelConfigs : [],
        options: persistConfig.includeOptions ? sanitizeOptions(options) : {},
        persistedAt: new Date().toISOString()
      } : null;
      const persistResult = persistConfig ? await persistRun(record, persistConfig) : null;

      return {
        runId,
        startedAt,
        finishedAt,
        durationMs: finishedAt - startedAt,
        totals: {
          tasks: tasks.length,
          models: modelConfigs.length,
          totalRuns
        },
        summary,
        models: modelResults,
        persist: persistConfig ? {
          enabled: true,
          stored: !!persistResult?.ok,
          path: persistResult?.path || null,
          reason: persistResult?.ok ? null : persistResult?.reason || 'Persist failed'
        } : {
          enabled: false
        }
      };
    };

    return {
      evaluate,
      listRuns,
      loadRun,
      replayRun
    };
  }
};

export default MultiModelEvaluator;
